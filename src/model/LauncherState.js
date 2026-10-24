// src/model/LauncherState.js
//
// What the clip launcher is doing right now: which slot is playing on each track, which is waiting for its boundary, which is
// about to stop. A performance, not part of the piece, so it is held beside the project and outside the revision, as ScriptState
// and EditorState are: no undo, no revision bump, not saved (docs/clip-launcher.md). Reopening a session shows the grid stopped.
//
// A track's history is a short list of runs. A run is `{ clipId, from, to }` in transport beats: the slot plays from `from` and,
// when `to` is not null, stops at `to`. Launching a second slot on a track ends the first at the same boundary the second starts at, so
// only one slot on a track plays at a time. The state of a slot is worked out from the runs and the beat now, never stored.
//
// Boundaries are beats counted from the start of the transport, from the project's tempo map and bar length, never from blocks.

/** The launch quantisation choices, in beats, with `bar` standing for the project's own bar length. */
export const QUANTISE = Object.freeze({ none: 0, beat: 1, bar: 'bar', '2bars': '2bars', '4bars': '4bars' })
export const QUANTISE_NAMES = Object.freeze(Object.keys(QUANTISE))
export const DEFAULT_QUANTISE = 'bar'

/** The size of one launch step in beats. */
export function stepBeats (name, beatsPerBar) {
  if (!QUANTISE_NAMES.includes(name)) throw new Error(`launch quantisation is one of ${QUANTISE_NAMES.join(', ')}: ${name}`)
  if (name === 'none') return 0
  if (name === 'beat') return 1
  return beatsPerBar * (name === 'bar' ? 1 : name === '2bars' ? 2 : 4)
}

/** The first boundary at or after `beat`: the beat itself with no quantisation. */
export function nextBoundary (beat, name, beatsPerBar) {
  const step = stepBeats(name, beatsPerBar)
  if (step === 0) return beat
  // A tolerance so a beat that is a boundary up to rounding is that boundary, not the next one.
  return Math.ceil(beat / step - 1e-9) * step
}

export class LauncherState {
  #runs = new Map()
  #listeners = new Set()
  #quantise = DEFAULT_QUANTISE

  /** Told after any change, so a view can draw again. */
  subscribe (fn) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #changed () { for (const fn of [...this.#listeners]) fn(this) }

  get quantise () { return this.#quantise }

  set quantise (name) {
    if (!QUANTISE_NAMES.includes(name)) throw new Error(`launch quantisation is one of ${QUANTISE_NAMES.join(', ')}: ${name}`)
    this.#quantise = name
    this.#changed()
  }

  /**
   * Launch a slot: it starts at the next boundary at or after `nowBeat`, and whatever else plays on its track stops there.
   * `clip` is a launcher clip (a MIDI clip with a scene). Returns the beat it starts at.
   */
  launch (clip, nowBeat, beatsPerBar, { immediate = false } = {}) {
    if (clip?.kind !== 'midi' || clip.scene === undefined) throw new Error('only a MIDI clip in a scene can be launched')
    // `immediate` is for a launch that starts the transport: nothing is playing to line up with, so it starts where the transport does.
    const at = immediate ? nowBeat : nextBoundary(nowBeat, this.#quantise, beatsPerBar)
    const runs = this.#runsOf(clip.track).filter(run => run.from < at)
    for (const run of runs) if (run.to === null || run.to > at) run.to = at
    runs.push({ clipId: clip.id, from: at, to: null })
    this.#runs.set(clip.track, runs)
    this.#changed()
    return at
  }

  /** Stop what plays on a track at the next boundary; a slot still waiting for its start is called off. Returns the beat, or null if nothing was there. */
  stopTrack (trackId, nowBeat, beatsPerBar) {
    const at = nextBoundary(nowBeat, this.#quantise, beatsPerBar)
    const before = this.#runsOf(trackId)
    if (before.length === 0) return null
    const runs = before.filter(run => run.from < at)
    for (const run of runs) if (run.to === null || run.to > at) run.to = at
    this.#runs.set(trackId, runs)
    this.#changed()
    return at
  }

  /** Stop every track at the same boundary. Returns the beat. */
  stopAll (nowBeat, beatsPerBar) {
    for (const trackId of [...this.#runs.keys()]) this.stopTrack(trackId, nowBeat, beatsPerBar)
    return nextBoundary(nowBeat, this.#quantise, beatsPerBar)
  }

  /** Forget every run: the transport stopped, or a session was opened. */
  clear () {
    if (this.#runs.size === 0) return
    this.#runs.clear()
    this.#changed()
  }

  /** Drop what has finished by `nowBeat`. Quiet: nothing about a finished run changes what is drawn. */
  prune (nowBeat) {
    for (const [trackId, runs] of this.#runs) {
      const live = runs.filter(run => run.to === null || run.to > nowBeat)
      if (live.length === 0) this.#runs.delete(trackId)
      else if (live.length !== runs.length) this.#runs.set(trackId, live)
    }
  }

  #runsOf (trackId) { return [...(this.#runs.get(trackId) ?? [])] }

  /** Every run, for the scheduler: `[{ trackId, clipId, from, to }]`. */
  get runs () {
    return [...this.#runs].flatMap(([trackId, runs]) => runs.map(run => ({ trackId, ...run })))
  }

  /**
   * One slot's state at `nowBeat`: 'playing', 'queued' (starts later), 'stopping' (playing, with a stop set), or 'stopped'.
   * Whether a slot is empty is the project's to say.
   */
  stateOf (clipId, nowBeat) {
    for (const run of this.runs) {
      if (run.clipId !== clipId) continue
      if (run.from > nowBeat) return 'queued'
      if (run.to === null) return 'playing'
      if (run.to > nowBeat) return 'stopping'
    }
    return 'stopped'
  }
}
