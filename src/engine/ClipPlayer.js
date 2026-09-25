// src/engine/ClipPlayer.js
//
// Audio clips, played with the platform's own AudioBufferSourceNode. Message
// thread only: decoding, fetching and starting a source all happen here, and
// nothing touches process(). The scheduler says when; this says what.
//
// A source is decoded once and kept, by IRI, however many clips play it: a
// session is a description, and one file placed ten times is one file. A
// source that fails to load is remembered as failed, with the reason, so a
// clip that cannot play is reported once and the rest of the session plays.

export class ClipPlayer {
  #context
  #fetchBytes
  #buffers = new Map()
  #loading = new Map()
  #failures = new Map()
  #peaks = new Map()
  #playing = new Set()

  /**
   * - `context`: the AudioContext, which decodes and plays.
   * - `fetchBytes(iri)`: the file's bytes as an ArrayBuffer. The page gives it
   *   a function that looks in the session's own media first, then the network.
   */
  constructor ({ context, fetchBytes }) {
    if (!context || typeof fetchBytes !== 'function') throw new Error('ClipPlayer needs a context and fetchBytes')
    this.#context = context
    this.#fetchBytes = fetchBytes
  }

  /** The decoded audio, or null while it loads or if it failed. */
  buffer (iri) { return this.#buffers.get(iri) ?? null }

  /** Why a source could not be loaded, or null. */
  failure (iri) { return this.#failures.get(iri) ?? null }

  /**
   * Decode a source, once. Resolves with the AudioBuffer, or with null if it
   * cannot be had, in which case failure(iri) says why. Never rejects: one
   * missing file is one silent clip, not a session that will not play.
   */
  load (iri) {
    if (this.#buffers.has(iri)) return Promise.resolve(this.#buffers.get(iri))
    if (this.#loading.has(iri)) return this.#loading.get(iri)
    const loading = (async () => {
      try {
        const bytes = await this.#fetchBytes(iri)
        const buffer = await this.#context.decodeAudioData(bytes)
        this.#buffers.set(iri, buffer)
        this.#failures.delete(iri)
        return buffer
      } catch (error) {
        this.#failures.set(iri, error)
        return null
      } finally {
        this.#loading.delete(iri)
      }
    })()
    this.#loading.set(iri, loading)
    return loading
  }

  /**
   * The loudest sample in each of `count` equal stretches of the first
   * channel, for drawing a waveform. Computed once per source and count.
   */
  peaks (iri, count) {
    const buffer = this.buffer(iri)
    if (!buffer || !(count > 0)) return null
    const key = `${count} ${iri}`
    if (this.#peaks.has(key)) return this.#peaks.get(key)
    const data = buffer.getChannelData(0)
    const out = new Float32Array(count)
    const per = data.length / count
    for (let i = 0; i < count; i++) {
      let peak = 0
      const end = Math.min(data.length, Math.floor((i + 1) * per))
      for (let j = Math.floor(i * per); j < end; j++) {
        const v = Math.abs(data[j])
        if (v > peak) peak = v
      }
      out[i] = peak
    }
    this.#peaks.set(key, out)
    return out
  }

  /**
   * Start a source at `when` (context seconds), `offset` seconds into the
   * file, for `duration` seconds, into `destination`. Returns false, and
   * starts nothing, when the source is not loaded.
   */
  start ({ iri, when, offset, duration, destination }) {
    const buffer = this.buffer(iri)
    if (!buffer) return false
    const source = this.#context.createBufferSource()
    source.buffer = buffer
    source.connect(destination)
    // A start already in the past is started now, at the point in the clip
    // the clock has reached, rather than from its beginning late.
    const late = Math.max(0, this.#context.currentTime - when)
    source.start(when + late, offset + late, Math.max(0, duration - late))
    this.#playing.add(source)
    source.onended = () => { this.#playing.delete(source); source.disconnect() }
    return true
  }

  /** Stop everything this has started. */
  stopAll () {
    for (const source of this.#playing) {
      try { source.stop() } catch { /* never started, or already over */ }
      source.disconnect()
    }
    this.#playing.clear()
  }

  /** How many sources are playing or scheduled, for a caller that wants to know. */
  get active () { return this.#playing.size }
}
