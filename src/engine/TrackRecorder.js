// src/engine/TrackRecorder.js
//
// A take per track: what each track's strip sounded like, captured after its
// fader and panner, while the transport played. The take is linear audio, so
// pressing Play afterwards with the plugins gone plays exactly what was
// heard, through the same faders, from audio clips the page adds.
//
// Two halves. TakeBuilder is pure: interleaved stereo chunks in, deinterleaved
// float channels out, with silence detection so a muted track makes no clip.
// TrackRecorder owns the capture nodes: one AudioWorklet sink per track, lent
// the strip so mute and solo record as heard. Everything a test cannot
// provide (the worklet class, the module URL) arrives by injection, the way
// BridgeClient takes its EventSource and fetch.
import { encodeWav } from '../host/Wav.js'

/** Frames per capture chunk, the render quantum here as everywhere. */
export const CAPTURE_FRAMES = 128
/** Buffers lent to each capture node: 8 quanta of main-thread lag before a
 * quantum is counted and skipped rather than allocated for. */
export const POOL_BUFFERS = 8

/** Float -1..1 to 16 bit, the same mapping encodeWav writes. */
export function floatToInt16 (samples) {
  const out = new Int16Array(samples.length)
  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]))
    out[i] = Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff))
  }
  return out
}

export function int16ToFloat (samples) {
  const out = new Float32Array(samples.length)
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / 0x8000
  return out
}

/**
 * One recording pass over several tracks. Chunks arrive as interleaved stereo
 * Float32Arrays and are kept as int16, halving what a long take holds, then
 * dealt back out as float channel pairs for the encoder.
 */
export class TakeBuilder {
  #tracks = new Map()

  /** Keep one chunk for a track. A chunk short of a full quantum is padded. */
  addChunk (trackId, chunk) {
    let track = this.#tracks.get(trackId)
    if (!track) {
      track = { chunks: [], frames: 0 }
      this.#tracks.set(trackId, track)
    }
    const stereo = new Float32Array(CAPTURE_FRAMES * 2)
    stereo.set(chunk.subarray(0, stereo.length))
    track.chunks.push(floatToInt16(stereo))
    track.frames += CAPTURE_FRAMES
  }

  trackIds () { return [...this.#tracks.keys()] }

  frames (trackId) { return this.#tracks.get(trackId)?.frames ?? 0 }

  /** True when every captured sample is digital zero: a muted track, or one
   * with nothing on it, makes no clip rather than a silent one. */
  isSilent (trackId) {
    const track = this.#tracks.get(trackId)
    if (!track) return true
    return track.chunks.every(chunk => chunk.every(v => v === 0))
  }

  /** The take as float channel pairs, deinterleaved. */
  take (trackId) {
    const track = this.#tracks.get(trackId)
    if (!track) throw new Error(`no take for track: ${trackId}`)
    const left = new Float32Array(track.frames)
    const right = new Float32Array(track.frames)
    let at = 0
    for (const chunk of track.chunks) {
      const floats = int16ToFloat(chunk)
      for (let i = 0; i < CAPTURE_FRAMES; i++) {
        left[at + i] = floats[i * 2]
        right[at + i] = floats[i * 2 + 1]
      }
      at += CAPTURE_FRAMES
    }
    return { left, right }
  }

  /** The take encoded, ready to store. */
  encode (trackId, sampleRate) {
    const { left, right } = this.take(trackId)
    return encodeWav([left, right], sampleRate)
  }
}

export class TrackRecorder {
  #engine
  #context
  #processorUrl
  #WorkletNode
  #poolBuffers
  #module = null
  #sessions = new Map()

  constructor ({ engine, context, processorUrl, WorkletNode = globalThis.AudioWorkletNode, poolBuffers = POOL_BUFFERS }) {
    if (!engine || !context || !processorUrl) throw new Error('TrackRecorder needs an engine, a context and a processor URL')
    this.#engine = engine
    this.#context = context
    this.#processorUrl = processorUrl
    this.#WorkletNode = WorkletNode
    this.#poolBuffers = poolBuffers
  }

  get recording () { return this.#sessions.size > 0 }

  async addModule () {
    if (!this.#module) this.#module = await this.#context.audioWorklet.addModule(this.#processorUrl)
    return this.#module
  }

  /**
   * Capture every listed track from after its strip. Refused with nothing
   * recording rather than starting a take of no tracks. Resolves with the
   * takes builder and the live capture nodes, the latter for tests driving
   * renders and for teardown inspection. `pre` lists tracks captured before
   * their fader instead of after it.
   */
  async start (trackIds, { pre = [] } = {}) {
    if (this.recording) throw new Error('already recording')
    if (!trackIds || trackIds.length === 0) throw new Error('nothing to record')
    await this.addModule()
    const takes = new TakeBuilder()
    const beforeFader = new Set(pre)
    for (const trackId of trackIds) {
      const node = new this.#WorkletNode(this.#context, 'jigdaw-capture', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [2]
      })
      // Kept pulled and silent: a sink with nowhere to go is not run, and a
      // capture node that reached the speakers would double the track.
      const sink = this.#context.createGain()
      sink.gain.value = 0
      node.connect(sink)
      sink.connect(this.#context.destination)
      // From before the fader for a track that only carries a live input, after it for the rest.
      this.#engine.trackTap(trackId, { pre: beforeFader.has(trackId) }).connect(node, 0, 0)
      const session = { node, sink, takes, dropped: 0, stopped: null }
      session.stopped = new Promise(resolve => { session.finish = resolve })
      node.port.onmessage = event => {
        const message = event?.data ?? event
        if (message instanceof ArrayBuffer || ArrayBuffer.isView(message)) {
          takes.addChunk(trackId, new Float32Array(message.buffer ?? message, message.byteOffset ?? 0, CAPTURE_FRAMES * 2))
          // Lend the next buffer: allocation on the message thread, where it
          // is ordinary, keeping the audio thread's pool whole.
          const fresh = new ArrayBuffer(CAPTURE_FRAMES * 2 * 4)
          node.port.postMessage({ type: 'return', buffer: fresh }, [fresh])
        } else if (message?.type === 'stopped' && !session.done) {
          // First report wins: a node answers stop once, and a late duplicate
          // must not overwrite the drop count the first one carried.
          session.done = true
          session.dropped = message.dropped ?? 0
          session.finish()
        }
      }
      const buffers = []
      const transfer = []
      for (let i = 0; i < this.#poolBuffers; i++) {
        const buffer = new ArrayBuffer(CAPTURE_FRAMES * 2 * 4)
        buffers.push(buffer)
        transfer.push(buffer)
      }
      node.port.postMessage({ type: 'start', buffers }, transfer)
      this.#sessions.set(trackId, session)
    }
    return { takes, nodes: new Map([...this.#sessions.entries()].map(([id, s]) => [id, s.node])) }
  }

  /**
   * Stop every capture and resolve with the takes and per-track drop counts.
   * The graph is unwired first so nothing further arrives while stopping.
   */
  async stop () {
    const entries = [...this.#sessions.entries()]
    this.#sessions.clear()
    const takes = entries.length > 0 ? entries[0][1].takes : new TakeBuilder()
    for (const [, session] of entries) {
      try { session.node.port.postMessage({ type: 'stop' }) } catch { /* already gone */ }
    }
    await Promise.all(entries.map(([, s]) => s.stopped))
    for (const [, session] of entries) {
      try { session.node.disconnect() } catch { /* already gone */ }
      try { session.sink.disconnect() } catch { /* already gone */ }
    }
    return { takes, dropped: new Map(entries.map(([trackId, s]) => [trackId, s.dropped])) }
  }
}
