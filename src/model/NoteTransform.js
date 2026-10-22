// src/model/NoteTransform.js
//
// Whole-note edits on a MIDI clip: quantize, transpose, velocity scale and reverse. Each transform is a pure function
// over a list of notes. `describeNoteTransform` applies one to a clip (or to the notes at some indices of it) and
// returns a single setClipNotes change, so the edit is one undo step and the dispatcher stays the only path.

/** Move each note's start toward the nearest grid line by `strength` (0 leaves it, 1 lands on it). */
export function quantize (notes, { grid, strength = 1 } = {}) {
  if (!(Number.isFinite(grid) && grid > 0)) throw new Error(`grid must be a number of beats above zero: ${grid}`)
  if (!(Number.isFinite(strength) && strength >= 0 && strength <= 1)) throw new Error(`strength must be from 0 to 1: ${strength}`)
  return notes.map(note => {
    const target = Math.round(note.startBeat / grid) * grid
    return { ...note, startBeat: Math.max(0, note.startBeat + (target - note.startBeat) * strength) }
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

const TRANSFORMS = {
  quantize: (notes, options) => quantize(notes, options),
  transpose: (notes, { semitones }) => transpose(notes, semitones),
  scaleVelocity: (notes, { factor }) => scaleVelocity(notes, factor),
  reverse: (notes, options, clip) => reverse(notes, clip.lengthBeats)
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
