// src/engine/capture-processor.js
//
// One track's take, captured where it sounds: this sits after the track's
// fader and panner with its output dropped, so what it hears is the mix the
// speakers get, and posts what it hears to the main thread in per-quantum
// chunks the take builder assembles.
//
// The real-time rules apply in full: process() allocates nothing. Buffers
// arrive with the start message, are filled and transferred back one per
// quantum with no wrapper object, and return by a later message when the main
// thread has copied them out. A quantum that arrives with the pool empty is
// counted and skipped rather than allocated for: a dropout the stopped
// message reports beats a pause the listener cannot see. The two messages
// outside the steady path, start/stop bookkeeping and the final stopped
// report, allocate small short-lived objects on event boundaries, never
// inside the per-quantum loop.

const FRAMES = 128

class CaptureProcessor extends AudioWorkletProcessor {
  constructor (options) {
    super(options)
    // Empty interleaved stereo buffers, lent by the main thread.
    this.empty = []
    this.active = false
    this.dropped = 0
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (!message || typeof message.type !== 'string') return
    if (message.type === 'start') {
      for (const buffer of message.buffers ?? []) this.empty.push(new Float32Array(buffer))
      this.active = true
      this.dropped = 0
    } else if (message.type === 'return') {
      if (message.buffer instanceof ArrayBuffer) this.empty.push(new Float32Array(message.buffer))
    } else if (message.type === 'stop') {
      this.active = false
      this.port.postMessage({ type: 'stopped', dropped: this.dropped })
    }
    // Unknown types are ignored, messaging.md section 1.
  }

  process (inputs) {
    if (this.active) {
      const input = inputs[0]
      const buffer = this.empty.pop()
      if (!buffer) {
        this.dropped += 1
        return true
      }
      const left = input?.[0]
      const right = input?.[1] ?? left
      const frames = Math.min(FRAMES, left?.length ?? 0)
      for (let i = 0; i < frames; i++) {
        buffer[i * 2] = left ? left[i] : 0
        buffer[i * 2 + 1] = right ? right[i] : 0
      }
      // Short takes pad the rest with silence further down the line; the
      // worklet never learns the take length, so it always posts full quanta.
      for (let i = frames; i < FRAMES; i++) {
        buffer[i * 2] = 0
        buffer[i * 2 + 1] = 0
      }
      // The buffer itself, transferred, with no wrapper: arrival order is the
      // take order, so no sequence number is needed and none is allocated.
      this.port.postMessage(buffer, [buffer.buffer])
    }
    return true
  }
}

registerProcessor('jigdaw-capture', CaptureProcessor)
