// src/model/Scale.js
//
// Musical scales as sets of semitones above a root, and the one question the note roll asks of them: which pitch of the
// scale is nearest. Pitches are MIDI numbers (60 is C4) and roots are 0 to 11 (0 is C).

export const SCALES = Object.freeze({
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  majorPentatonic: [0, 2, 4, 7, 9],
  minorPentatonic: [0, 3, 5, 7, 10],
  blues: [0, 3, 5, 6, 7, 10]
})

export const SCALE_NAMES = Object.freeze(Object.keys(SCALES))

function degrees (root, scale) {
  if (!Number.isInteger(root) || root < 0 || root > 11) throw new Error(`root must be a whole number from 0 to 11: ${root}`)
  const steps = SCALES[scale]
  if (!steps) throw new Error(`no such scale: ${scale}; use one of ${SCALE_NAMES.join(', ')}`)
  return steps.map(step => (step + root) % 12)
}

/** True when `pitch` is a note of the scale in `root`. */
export function inScale (pitch, root, scale) {
  return degrees(root, scale).includes(((pitch % 12) + 12) % 12)
}

/**
 * The nearest pitch of the scale, within 0 to 127. A pitch halfway between two goes to the lower, so the result does not
 * depend on which way the pitch was heading.
 */
export function snapPitch (pitch, root, scale) {
  const set = new Set(degrees(root, scale))
  for (let distance = 0; distance <= 12; distance++) {
    for (const candidate of [pitch - distance, pitch + distance]) {
      if (candidate >= 0 && candidate <= 127 && set.has(candidate % 12)) return candidate
    }
  }
  throw new Error(`no pitch of the scale near ${pitch}`)
}
