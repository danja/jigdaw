// src/engine/Transport.js
//
// The musical clock. Converts between frames, seconds and beats across a tempo
// map, and reports the position a plugin needs each quantum.
//
// Contract section 7: a plugin derives musical timing from the supplied beat
// position and never by counting process() calls. Counting blocks
// desynchronises the moment the transport is repositioned, looped or
// retempoed, and produces a plugin that is correct only while nothing happens.
// This class exists so the host can always supply that position.
//
// The tempo map is keyed by beat, never ordered by position in a list, which is
// project-format.md's rule. That is what makes a tempo change insertable in the
// middle without rewriting anything.

const MINUTE = 60

/** Tempo points sorted and defaulted, so the rest of the file can assume shape. */
function normalise (tempoPoints) {
  const points = [...(tempoPoints ?? [])]
    .filter(p => Number.isFinite(p.atBeat) && p.bpm > 0)
    .sort((a, b) => a.atBeat - b.atBeat)

  if (points.length === 0) return [{ atBeat: 0, bpm: 120 }]
  // A map that does not start at zero leaves the opening bars undefined.
  if (points[0].atBeat > 0) points.unshift({ atBeat: 0, bpm: points[0].bpm })
  return points
}

export class Transport {
  #points
  #sampleRate
  #beatsPerBar
  #beatUnit
  #loop

  constructor ({
    tempoPoints = [{ atBeat: 0, bpm: 120 }],
    sampleRate = 48000,
    beatsPerBar = 4,
    beatUnit = 4,
    loopStart = 0,
    loopEnd = 0,
    loopEnabled = false
  } = {}) {
    this.#points = normalise(tempoPoints)
    this.#sampleRate = sampleRate
    this.#beatsPerBar = beatsPerBar
    this.#beatUnit = beatUnit
    this.#loop = { start: loopStart, end: loopEnd, enabled: loopEnabled && loopEnd > loopStart }
  }

  get tempoPoints () { return this.#points.map(p => ({ ...p })) }
  get sampleRate () { return this.#sampleRate }
  get loop () { return { ...this.#loop } }

  /** The tempo in force at a beat. */
  tempoAtBeat (beat) {
    let tempo = this.#points[0].bpm
    for (const point of this.#points) {
      if (point.atBeat > beat) break
      tempo = point.bpm
    }
    return tempo
  }

  /** Seconds from beat zero to a beat, across every tempo change between. */
  secondsAtBeat (beat) {
    if (beat <= 0) return 0
    let seconds = 0
    for (let i = 0; i < this.#points.length; i++) {
      const from = this.#points[i].atBeat
      if (from >= beat) break
      const to = Math.min(this.#points[i + 1]?.atBeat ?? Infinity, beat)
      seconds += ((to - from) * MINUTE) / this.#points[i].bpm
    }
    return seconds
  }

  /** The inverse: which beat a number of seconds reaches. */
  beatAtSeconds (seconds) {
    if (seconds <= 0) return 0
    let elapsed = 0
    for (let i = 0; i < this.#points.length; i++) {
      const { atBeat, bpm } = this.#points[i]
      const next = this.#points[i + 1]?.atBeat ?? Infinity
      const segment = ((next - atBeat) * MINUTE) / bpm
      if (elapsed + segment > seconds || next === Infinity) {
        return atBeat + ((seconds - elapsed) * bpm) / MINUTE
      }
      elapsed += segment
    }
    return 0
  }

  /** Beats advanced per frame at a given beat. Sent to plugins each quantum. */
  beatsPerFrame (beat) {
    return this.tempoAtBeat(beat) / (MINUTE * this.#sampleRate)
  }

  /**
   * Where the transport is, given how long it has been rolling.
   *
   * `elapsedFrames` counts frames since play started, not frames since the
   * context did. The two differ after a stop and restart, and using the wrong
   * one is the class of bug contract section 7 exists to prevent.
   */
  positionAtElapsed (elapsedFrames, { startBeat = 0 } = {}) {
    const startSeconds = this.secondsAtBeat(startBeat)
    let absolute = startSeconds + elapsedFrames / this.#sampleRate

    if (this.#loop.enabled) {
      const loopStartSeconds = this.secondsAtBeat(this.#loop.start)
      const loopEndSeconds = this.secondsAtBeat(this.#loop.end)
      const length = loopEndSeconds - loopStartSeconds
      // Wrapped by modulo rather than by stepping, so a transport left running
      // for an hour costs the same as one that just started.
      if (length > 0 && absolute >= loopEndSeconds) {
        absolute = loopStartSeconds + ((absolute - loopStartSeconds) % length)
      }
    }

    const beat = this.beatAtSeconds(absolute)
    return {
      beat,
      seconds: absolute,
      tempo: this.tempoAtBeat(beat),
      beatsPerFrame: this.beatsPerFrame(beat),
      bar: Math.floor(beat / this.#beatsPerBar),
      beatInBar: beat % this.#beatsPerBar
    }
  }

  /** The message a processor receives each quantum. messaging.md section 1.2. */
  messageAt (elapsedFrames, { frame, playing = true, startBeat = 0 } = {}) {
    const position = this.positionAtElapsed(elapsedFrames, { startBeat })
    return {
      type: 'transport',
      playing,
      frame,
      beat: position.beat,
      beatsPerFrame: position.beatsPerFrame,
      tempo: position.tempo,
      timeSignature: { beatsPerBar: this.#beatsPerBar, beatUnit: this.#beatUnit },
      loop: this.#loop.enabled ? { start: this.#loop.start, end: this.#loop.end } : null
    }
  }

  /** Build one from a project's transport, so the two cannot disagree. */
  static fromProject (project, sampleRate) {
    const t = project.transport
    return new Transport({
      tempoPoints: t.tempoPoints,
      sampleRate,
      beatsPerBar: t.beatsPerBar,
      beatUnit: t.beatUnit,
      loopStart: t.loopStart,
      loopEnd: t.loopEnd,
      loopEnabled: t.loopEnabled
    })
  }
}
