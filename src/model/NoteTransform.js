// src/model/NoteTransform.js
//
// Whole-note edits on a MIDI clip: quantize, transpose, velocity scale, reverse, invert, humanize, legato, strum and fit to a scale. Each transform is a pure function
// over a list of notes. `describeNoteTransform` applies one to a clip (or to the notes at some indices of it) and
// returns a single setClipNotes change, so the edit is one undo step and the dispatcher stays the only path.

import { snapPitch } from './Scale.js'

/**
 * Move each note's start toward the nearest grid line by `strength` (0 leaves it, 1 lands on it). With `ends`, the
 * note's end moves the same way, so the length follows; a note whose length would come to nothing gets one grid step.
 */
export function quantize (notes, { grid, strength = 1, ends = false } = {}) {
  if (!(Number.isFinite(grid) && grid > 0)) throw new Error(`grid must be a number of beats above zero: ${grid}`)
  if (!(Number.isFinite(strength) && strength >= 0 && strength <= 1)) throw new Error(`strength must be from 0 to 1: ${strength}`)
  return notes.map(note => {
    const target = Math.round(note.startBeat / grid) * grid
    const startBeat = Math.max(0, note.startBeat + (target - note.startBeat) * strength)
    if (!ends) return { ...note, startBeat }
    const end = note.startBeat + note.lengthBeats
    const endTarget = Math.round(end / grid) * grid
    const raw = end + (endTarget - end) * strength - startBeat
    const lengthBeats = raw > 0 ? raw : grid
    return { ...note, startBeat, lengthBeats }
  })
}

/** Shift every pitch by whole semitones. A note that would leave 0 to 127 refuses the edit rather than being bent. */
export function transpose (notes, semitones) {
  if (!Number.isInteger(semitones)) throw new Error(`semitones must be a whole number: ${semitones}`)
  return notes.map(note => {
    const pitch = note.pitch + semitones
    if (pitch < 0 || pitch > 127) throw new Error(`transposing by ${semitones} would put pitch ${note.pitch} outside 0 to 127`)
    return { ...note, pitch }
  })
}

/** Multiply every velocity by `factor`, rounded and kept from 1 to 127 (MIDI reads 0 as a note off). */
export function scaleVelocity (notes, factor) {
  if (!(Number.isFinite(factor) && factor > 0)) throw new Error(`factor must be a number above zero: ${factor}`)
  return notes.map(note => ({ ...note, velocity: Math.min(127, Math.max(1, Math.round(note.velocity * factor))) }))
}

/** Mirror the notes in time inside a clip of `clipLength` beats; a note running past the clip's end is refused. */
export function reverse (notes, clipLength) {
  if (!(Number.isFinite(clipLength) && clipLength > 0)) throw new Error(`clipLength must be a number above zero: ${clipLength}`)
  return notes.map(note => {
    const startBeat = clipLength - (note.startBeat + note.lengthBeats)
    if (startBeat < 0) throw new Error(`a note ends after the clip does, so it cannot be reversed inside it`)
    return { ...note, startBeat }
  })
}

/**
 * Mirror every pitch about `axis` (a pitch, defaulting to the first note's), so a rising line falls by the same steps.
 * A note that would leave 0 to 127 refuses the edit.
 */
export function invert (notes, axis = notes[0]?.pitch) {
  if (notes.length === 0) return []
  if (!Number.isInteger(axis)) throw new Error(`axis must be a whole pitch: ${axis}`)
  return notes.map(note => {
    const pitch = 2 * axis - note.pitch
    if (pitch < 0 || pitch > 127) throw new Error(`inverting about ${axis} would put pitch ${note.pitch} outside 0 to 127`)
    return { ...note, pitch }
  })
}

// A small seeded generator (mulberry32), so the same seed makes the same edit: the Op stays reproducible and a
// replay of a session or an agent's call gives the same notes.
function draw (seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * Nudge each note's start by up to plus or minus `timing` beats (not before zero) and its velocity by up to plus or
 * minus `velocity` (kept from 1 to 127). `seed` is required and whole: the same seed gives the same result.
 */
export function humanize (notes, { timing = 0, velocity = 0, seed } = {}) {
  if (!Number.isInteger(seed)) throw new Error(`seed must be a whole number: ${seed}`)
  if (!(Number.isFinite(timing) && timing >= 0)) throw new Error(`timing must be beats from zero up: ${timing}`)
  if (!(Number.isFinite(velocity) && velocity >= 0)) throw new Error(`velocity must be from zero up: ${velocity}`)
  const next = draw(seed)
  return notes.map(note => {
    const shift = (next() * 2 - 1) * timing
    const change = (next() * 2 - 1) * velocity
    return {
      ...note,
      startBeat: Math.max(0, note.startBeat + shift),
      velocity: Math.min(127, Math.max(1, Math.round(note.velocity + change)))
    }
  })
}

/** Move each note to the nearest pitch of the scale in `root`; a note already in it stays. */
export function fitScale (notes, { root, scale } = {}) {
  return notes.map(note => ({ ...note, pitch: snapPitch(note.pitch, root, scale) }))
}

/**
 * Hold each note until the next one starts: its length becomes the gap to the next later start, so the line has no rests. Notes that
 * start together (a chord) all stretch to the same next start. The last start has nothing after it, so those notes keep their length.
 */
export function legato (notes) {
  const starts = [...new Set(notes.map(n => n.startBeat))].sort((a, b) => a - b)
  return notes.map(note => {
    const next = starts.find(s => s > note.startBeat)
    return next === undefined ? { ...note } : { ...note, lengthBeats: next - note.startBeat }
  })
}

/**
 * Spread each chord (notes that start together) into a roll: the lowest note stays where it is and each next one starts `spread` beats
 * after the one before, going up, or down from the highest with `direction` 'down'. Lengths are kept, so each note also ends later by its offset.
 * (Chord members are sorted by pitch; equal pitches keep their order.)
 */
export function strum (notes, { spread, direction = 'up' } = {}) {
  if (!(Number.isFinite(spread) && spread > 0)) throw new Error(`spread must be beats above zero: ${spread}`)
  if (direction !== 'up' && direction !== 'down') throw new Error(`direction must be up or down: ${direction}`)
  const order = new Map()
  const chords = new Map()
  notes.forEach((note, i) => {
    const key = note.startBeat
    chords.set(key, [...(chords.get(key) ?? []), i])
  })
  for (const members of chords.values()) {
    const sorted = [...members].sort((a, b) => (notes[a].pitch - notes[b].pitch) || (a - b))
    if (direction === 'down') sorted.reverse()
    sorted.forEach((index, place) => order.set(index, place))
  }
  return notes.map((note, i) => ({ ...note, startBeat: note.startBeat + order.get(i) * spread }))
}

const TRANSFORMS = {
  quantize: (notes, options) => quantize(notes, options),
  transpose: (notes, { semitones }) => transpose(notes, semitones),
  scaleVelocity: (notes, { factor }) => scaleVelocity(notes, factor),
  reverse: (notes, options, clip) => reverse(notes, clip.lengthBeats),
  invert: (notes, { axis }) => invert(notes, axis),
  humanize: (notes, options) => humanize(notes, options),
  fitScale: (notes, options) => fitScale(notes, options),
  legato: notes => legato(notes),
  strum: (notes, options) => strum(notes, options)
}

export const NOTE_TRANSFORMS = Object.freeze(Object.keys(TRANSFORMS))

/**
 * The change that applies transform `name` to a MIDI clip's notes, or only to those at `indices` (positions in the
 * clip's own order). Throws an Error saying why not.
 */
export function describeNoteTransform (project, clipId, name, options = {}, { indices = null } = {}) {
  const clip = project.clip(clipId)
  if (!clip) throw new Error(`no such clip: ${clipId}`)
  if (clip.kind !== 'midi') throw new Error(`clip ${clipId} is not a MIDI clip`)
  const transform = TRANSFORMS[name]
  if (!transform) throw new Error(`no such transform: ${name}; use one of ${NOTE_TRANSFORMS.join(', ')}`)
  const chosen = indices === null ? null : new Set(indices)
  if (chosen) for (const i of chosen) if (!Number.isInteger(i) || i < 0 || i >= clip.notes.length) throw new Error(`no note at index ${i}`)
  const picked = clip.notes.filter((_, i) => !chosen || chosen.has(i))
  const changed = transform(picked, options, clip)
  let next = 0
  const notes = clip.notes.map((note, i) => (!chosen || chosen.has(i)) ? changed[next++] : { ...note })
  return [{ op: 'setClipNotes', id: clipId, notes }]
}
