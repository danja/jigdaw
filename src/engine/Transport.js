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
// A smooth tempo leg is drawn as this many straight legs, which keeps seconds and beats exactly invertible.
const SMOOTH_LEGS = 16
const smoothstep = u => u * u * (3 - 2 * u)

/**
 * Tempo points sorted and defaulted, with smooth legs split into straight ones, so the rest of the file
 * has two kinds of leg to deal with: `step` (the tempo holds until the next point) and `linear` (the tempo
 * moves in a straight line, in beats, to the next point's). A point's curve says how the tempo leaves it, as
 * an envelope's does; a point with none holds, which is what a tempo map always did. After the last point
 * the tempo holds.
 */
function normalise (tempoPoints) {
  const points = [...(tempoPoints ?? [])]
    .filter(p => Number.isFinite(p.atBeat) && p.bpm > 0)
    .sort((a, b) => a.atBeat - b.atBeat)

  if (points.length === 0) return [{ atBeat: 0, bpm: 120, curve: 'step' }]
  // A map that does not start at zero leaves the opening bars undefined.
  if (points[0].atBeat > 0) points.unshift({ atBeat: 0, bpm: points[0].bpm })
  const out = []
  points.forEach((p, i) => {
    const next = points[i + 1]
    const curve = p.curve ?? 'step'
    if (curve === 'smooth' && next) {
      for (let j = 0; j < SMOOTH_LEGS; j++) {
        const u = j / SMOOTH_LEGS
        out.push({ atBeat: p.atBeat + (next.atBeat - p.atBeat) * u, bpm: p.bpm + (next.bpm - p.bpm) * smoothstep(u), curve: 'linear' })
      }
    } else {
      out.push({ atBeat: p.atBeat, bpm: p.bpm, curve: curve === 'linear' && next ? 'linear' : 'step' })
    }
  })
  return out
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

  /** The leg a beat falls in: its start point, and the tempo it ends on (null when it holds). */
  #leg (index) {
    const from = this.#points[index]
    const next = this.#points[index + 1]
    return { from, to: next ?? null, ramps: from.curve === 'linear' && next !== undefined }
  }

  /** Beats per minute per beat along a ramp: the slope of the tempo. */
  #slope (leg) { return (leg.to.bpm - leg.from.bpm) / (leg.to.atBeat - leg.from.atBeat) }

  /** The tempo in force at a beat; on a ramp, the value on the straight line. */
  tempoAtBeat (beat) {
    let tempo = this.#points[0].bpm
    for (let i = 0; i < this.#points.length; i++) {
      const leg = this.#leg(i)
      if (leg.from.atBeat > beat) break
      tempo = leg.ramps && beat < leg.to.atBeat ? leg.from.bpm + this.#slope(leg) * (beat - leg.from.atBeat) : leg.from.bpm
    }
    return tempo
  }

  /** Seconds across part of a leg, from its start to `beat` (inside it). */
  #secondsIn (leg, beat) {
    if (!leg.ramps) return ((beat - leg.from.atBeat) * MINUTE) / leg.from.bpm
    const k = this.#slope(leg)
    const end = leg.from.bpm + k * (beat - leg.from.atBeat)
    // The integral of 60 / tempo over beats, with the tempo a straight line: 60 / slope times the log of the change.
    return Math.abs(k) < 1e-12 ? ((beat - leg.from.atBeat) * MINUTE) / leg.from.bpm : (MINUTE / k) * Math.log(end / leg.from.bpm)
  }

  /** Seconds from beat zero to a beat, across every tempo change between. */
  secondsAtBeat (beat) {
    if (beat <= 0) return 0
    let seconds = 0
    for (let i = 0; i < this.#points.length; i++) {
      const leg = this.#leg(i)
      if (leg.from.atBeat >= beat) break
      seconds += this.#secondsIn(leg, Math.min(leg.to?.atBeat ?? Infinity, beat))
    }
    return seconds
  }

  /** The inverse: which beat a number of seconds reaches. */
  beatAtSeconds (seconds) {
    if (seconds <= 0) return 0
    let elapsed = 0
    for (let i = 0; i < this.#points.length; i++) {
      const leg = this.#leg(i)
      const length = leg.to ? this.#secondsIn(leg, leg.to.atBeat) : Infinity
      if (elapsed + length > seconds || !leg.to) {
        const local = seconds - elapsed
        if (!leg.ramps) return leg.from.atBeat + (local * leg.from.bpm) / MINUTE
        const k = this.#slope(leg)
        if (Math.abs(k) < 1e-12) return leg.from.atBeat + (local * leg.from.bpm) / MINUTE
        return leg.from.atBeat + (leg.from.bpm * Math.exp((k * local) / MINUTE) - leg.from.bpm) / k
      }
      elapsed += length
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
    // A tempo envelope, when there is one with points, is the tempo map: its curves say how the tempo
    // moves between points (docs/project-format.md). Without one, the transport's own points hold.
    const envelope = (project.envelopes ?? []).find(e => e.target.kind === 'tempo' && e.points.length > 0)
    const tempoPoints = envelope ? envelope.points.map(p => ({ atBeat: p.atBeat, bpm: p.value, curve: p.curve })) : t.tempoPoints
    return new Transport({
      tempoPoints,
      sampleRate,
      beatsPerBar: t.beatsPerBar,
      beatUnit: t.beatUnit,
      loopStart: t.loopStart,
      loopEnd: t.loopEnd,
      loopEnabled: t.loopEnabled
    })
  }
}
