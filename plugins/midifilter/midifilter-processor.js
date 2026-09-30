// plugins/midifilter/midifilter-processor.js
//
// The AudioWorklet processor for MIDI Filter, and the whole plugin: there is no
// WebAssembly module (Dice, Tremolo).
//
// Four things in one pass over each message: a channel filter, a channel remap,
// a transpose and a note range. A note-off follows its note-on: it is sent, as
// the pitch and channel the note-on went out on, if and only if that note-on
// was sent. So changing a setting while a note is held never leaves a note
// sounding downstream or turns off the wrong one.
//
// Stateless between sessions, so it answers no state request. process()
// allocates nothing beyond the outgoing batch: the queue and the record of
// sounding notes are allocated in the constructor, and a full queue drops and
// reports rather than growing (messaging.md 1.4).

const QUEUE_CAPACITY = 256
const RENDER_QUANTUM = 128
const NOTE_ON = 0x90
const NOTE_OFF = 0x80

class MidiFilterProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [
      { name: 'in_channel', defaultValue: 0, minValue: 0, maxValue: 16, automationRate: 'k-rate' },
      { name: 'out_channel', defaultValue: 0, minValue: 0, maxValue: 16, automationRate: 'k-rate' },
      { name: 'transpose', defaultValue: 0, minValue: -48, maxValue: 48, automationRate: 'k-rate' },
      { name: 'low_note', defaultValue: 0, minValue: 0, maxValue: 127, automationRate: 'k-rate' },
      { name: 'high_note', defaultValue: 127, minValue: 0, maxValue: 127, automationRate: 'k-rate' }
    ]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.queueFrames = new Float64Array(QUEUE_CAPACITY)
    this.queueBytes = new Uint8Array(QUEUE_CAPACITY * 3)
    this.queueLengths = new Uint8Array(QUEUE_CAPACITY)
    this.queueCount = 0
    this.dropped = 0
    // For each channel and pitch that came in, what went out for its note-on:
    // 0 for nothing, otherwise (channel * 128 + pitch) + 1.
    this.sounding = new Uint16Array(16 * 128)
    this.port.onmessage = event => this.handle(event.data)
  }

  handle (message) {
    if (message?.type === 'init') {
      this.ready = true
      this.port.postMessage({ type: 'ready', latencyFrames: 0, tailFrames: null })
      return
    }
    if (!this.ready) return
    if (message?.type === 'events') this.enqueue(message.events)
  }

  enqueue (events) {
    if (!events?.length) return
    let dropped = 0
    for (const event of events) {
      if (this.queueCount >= QUEUE_CAPACITY) { dropped += 1; continue }
      const slot = this.queueCount
      const bytes = event.bytes
      this.queueFrames[slot] = event.frame
      this.queueLengths[slot] = Math.min(3, bytes.length)
      this.queueBytes[slot * 3] = bytes[0] ?? 0
      this.queueBytes[slot * 3 + 1] = bytes[1] ?? 0
      this.queueBytes[slot * 3 + 2] = bytes[2] ?? 0
      this.queueCount += 1
    }
    if (dropped > 0) {
      this.dropped += dropped
      this.port.postMessage({ type: 'dropped', count: dropped, since: currentFrame })
    }
  }

  /**
   * Turn one incoming message into the one to send, or null. `p` holds the
   * settings for this block. Returns a fresh Uint8Array of the same length.
   */
  route (status, data1, data2, length, p) {
    // System messages carry no channel and always pass.
    if (status >= 0xf0) return Uint8Array.from([status, data1, data2].slice(0, length))
    const kind = status & 0xf0
    const channel = status & 0x0f
    const isOn = kind === NOTE_ON && data2 > 0
    const isOff = kind === NOTE_OFF || (kind === NOTE_ON && data2 === 0)
    if (isOn) {
      if (p.keep !== 0 && channel !== p.keep - 1) return null
      if (data1 < p.low || data1 > p.high) return null
      const pitch = data1 + p.transpose
      if (pitch < 0 || pitch > 127) return null
      const outChannel = p.send === 0 ? channel : p.send - 1
      this.sounding[channel * 128 + data1] = outChannel * 128 + pitch + 1
      return Uint8Array.from([NOTE_ON | outChannel, pitch, data2])
    }
    if (isOff) {
      // Found by the note-on it answers, whatever the channel setting says now.
      const held = this.sounding[channel * 128 + data1]
      if (held === 0) return null
      this.sounding[channel * 128 + data1] = 0
      const outChannel = Math.floor((held - 1) / 128)
      return Uint8Array.from([NOTE_OFF | outChannel, (held - 1) % 128, data2])
    }
    // Everything else on a channel follows the channel settings.
    if (p.keep !== 0 && channel !== p.keep - 1) return null
    const outChannel = p.send === 0 ? channel : p.send - 1
    return Uint8Array.from([kind | outChannel, data1, data2].slice(0, length))
  }

  process (inputs, outputs, parameters) {
    // No audio output, so a real AudioWorkletNode passes `outputs` empty: a MIDI processor that
    // returned early on a missing output would never run. The block is a render quantum.
    if (!this.ready) return true

    const p = {
      keep: Math.round(parameters.in_channel[0]),
      send: Math.round(parameters.out_channel[0]),
      transpose: Math.round(parameters.transpose[0]),
      low: Math.round(parameters.low_note[0]),
      high: Math.round(parameters.high_note[0])
    }
    const blockEnd = currentFrame + RENDER_QUANTUM
    const out = []
    let kept = 0
    for (let i = 0; i < this.queueCount; i++) {
      if (this.queueFrames[i] < blockEnd) {
        const routed = this.route(this.queueBytes[i * 3], this.queueBytes[i * 3 + 1], this.queueBytes[i * 3 + 2], this.queueLengths[i], p)
        // Nothing here delays a message, so it keeps its frame.
        if (routed) out.push({ frame: this.queueFrames[i], bytes: routed })
        continue
      }
      this.queueFrames[kept] = this.queueFrames[i]
      this.queueLengths[kept] = this.queueLengths[i]
      this.queueBytes[kept * 3] = this.queueBytes[i * 3]
      this.queueBytes[kept * 3 + 1] = this.queueBytes[i * 3 + 1]
      this.queueBytes[kept * 3 + 2] = this.queueBytes[i * 3 + 2]
      kept += 1
    }
    this.queueCount = kept
    if (out.length > 0) this.port.postMessage({ type: 'events', events: out })
    return true
  }
}

registerProcessor('midifilter', MidiFilterProcessor)
