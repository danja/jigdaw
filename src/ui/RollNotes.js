// src/ui/RollNotes.js
//
// What the piano roll and its helpers share about notes: the grid's resolution, how a pitch is named and said, how a note is keyed in a choice, how a
// length is said, and which note sounds at a pitch and a time. Plain functions, so the roll's pointer handling and its tests need not build a roll.
/** Steps per beat: a sixteenth note in 4/4. */
export const STEPS_PER_BEAT = 4
export const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

/** C4 is 60. Shown with #, said with "sharp", because a reader says "#" as "number". */
export function noteName (pitch) {
  return `${NAMES[pitch % 12]}${Math.floor(pitch / 12) - 1}`
}
export function spokenName (pitch) {
  return noteName(pitch).replace('#', ' sharp ')
}

export const keyOf = note => `${note.startBeat}:${note.pitch}`
export const beats = n => `${n} beat${n === 1 ? '' : 's'}`

/** The note sounding at a pitch and a time, if any. */
export function noteAt (notes, pitch, beat) {
  return notes.find(n => n.pitch === pitch && n.startBeat <= beat && beat < n.startBeat + n.lengthBeats) ?? null
}
