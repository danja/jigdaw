// src/model/Euclidean.js
//
// A Euclidean rhythm: `pulses` onsets spread as evenly as they can be over `steps` steps (Toussaint, "The Euclidean Algorithm
// Generates Traditional Musical Rhythms"). It makes notes rather than changing them, so it is not one of NoteTransform's transforms; it
// is still one edit to a clip (`describeEuclidean` returns a single setClipNotes), so one undo takes it back.

export const MAX_STEPS = 64

/**
 * The onsets of a pattern, as `steps` booleans. Step i is an onset when i times `pulses`, modulo `steps`, is below `pulses`, which
 * puts the first onset on step 0 and keeps every gap within one step of every other. `rotation` moves the pattern later by that many
 * steps, wrapping.
 */
export function euclid (pulses, steps, rotation = 0) {
  if (!Number.isInteger(steps) || steps < 1 || steps > MAX_STEPS) throw new Error(`steps is a whole number from 1 to ${MAX_STEPS}: ${steps}`)
  if (!Number.isInteger(pulses) || pulses < 0 || pulses > steps) throw new Error(`pulses is a whole number from 0 to the ${steps} steps: ${pulses}`)
  if (!Number.isInteger(rotation)) throw new Error(`rotation is a whole number of steps: ${rotation}`)
  const base = Array.from({ length: steps }, (_, i) => (i * pulses) % steps < pulses)
  const shift = ((rotation % steps) + steps) % steps
  return base.map((_, i) => base[(i - shift + steps) % steps])
}

/**
 * The change that puts a rhythm into a MIDI clip: the pattern repeated to fill the clip, one note of `pitch` at each onset. Notes already
 * at that pitch are replaced and every other note is kept, so a kick, a snare and a hat can be laid into one clip one after another.
 */
export function describeEuclidean (project, clipId, { pitch, pulses, steps, rotation = 0, stepBeats = 0.25, velocity = 100, lengthBeats = null } = {}) {
  const clip = project.clip(clipId)
  if (!clip) throw new Error(`no such clip: ${clipId}`)
  if (clip.kind !== 'midi') throw new Error(`clip ${clipId} is not a MIDI clip`)
  if (!Number.isInteger(pitch) || pitch < 0 || pitch > 127) throw new Error(`pitch is a whole number from 0 to 127: ${pitch}`)
  if (!Number.isInteger(velocity) || velocity < 1 || velocity > 127) throw new Error(`velocity is a whole number from 1 to 127: ${velocity}`)
  if (!(Number.isFinite(stepBeats) && stepBeats > 0)) throw new Error(`stepBeats is a number of beats above zero: ${stepBeats}`)
  const length = lengthBeats ?? stepBeats
  if (!(Number.isFinite(length) && length > 0)) throw new Error(`lengthBeats is a number of beats above zero: ${lengthBeats}`)
  const pattern = euclid(pulses, steps, rotation)
  const notes = clip.notes.filter(note => note.pitch !== pitch)
  for (let i = 0; ; i++) {
    const startBeat = i * stepBeats
    if (startBeat >= clip.lengthBeats - 1e-9) break
    if (!pattern[i % steps]) continue
    notes.push({ startBeat, lengthBeats: Math.min(length, clip.lengthBeats - startBeat), pitch, velocity })
  }
  notes.sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
  return [{ op: 'setClipNotes', id: clipId, notes }]
}
