// src/model/ClipLoop.js
//
// A looped MIDI clip: its first `loopBeats` repeat to fill the clip's length. The clip's own notes and events are
// the pattern and stay as they are; what plays is the pattern repeated, which is worked out here, once, for
// every reader of a clip's content (the scheduler, the MIDI file, and the edits that cut a clip in two).
//
// A note that starts inside the pattern but runs past its end is cut there, so no repeat overlaps the next. A
// note or event that starts at or after the pattern's end is not played while the clip loops, and comes back
// when the loop is cleared. Nothing here reads a clip's end beyond `lengthBeats`: whatever lies past it is cut.

/** A loop length as stored: null for none, or a finite number above zero. */
export function checkLoopBeats (value) {
  if (value === null) return null
  if (!(typeof value === 'number' && Number.isFinite(value) && value > 0)) throw new Error('loopBeats must be above zero, or null for no loop')
  return value
}

/**
 * The notes and events a clip plays, relative to its start, repeats included. Returns the clip's own lists when
 * it does not loop, or loops at or beyond its length (nothing would repeat).
 */
export function playedContent (clip) {
  const notes = clip.notes ?? []
  const controllers = clip.controllers ?? []
  const loop = clip.loopBeats ?? null
  if (loop === null || loop >= clip.lengthBeats) return { notes, controllers }
  const out = { notes: [], controllers: [] }
  for (let offset = 0; offset < clip.lengthBeats; offset += loop) {
    for (const note of notes) {
      if (note.startBeat >= loop || offset + note.startBeat >= clip.lengthBeats) continue
      out.notes.push({ ...note, startBeat: offset + note.startBeat, lengthBeats: Math.min(note.lengthBeats, loop - note.startBeat) })
    }
    for (const event of controllers) {
      if (event.atBeat >= loop || offset + event.atBeat >= clip.lengthBeats) continue
      out.controllers.push({ ...event, atBeat: offset + event.atBeat })
    }
  }
  return out
}

/**
 * The one change that makes a MIDI clip `lengthBeats` long by repeating what it holds: the corner drag, the R key and the menu all
 * ask for this. A clip that does not loop yet starts to, repeating its own length as it stands, so what was there is the pattern. A
 * clip that already loops keeps its pattern and only gets longer. A shorter length is an ordinary resize and touches no loop, and so
 * is a length that is not a number above zero, which is refused rather than turned into something else.
 */
export function repeatClip (clip, lengthBeats) {
  if (clip.kind !== 'midi') throw new Error('only a MIDI clip can repeat')
  if (!(typeof lengthBeats === 'number' && Number.isFinite(lengthBeats) && lengthBeats > 0)) throw new Error('a clip must be longer than zero beats')
  const change = { op: 'setClip', id: clip.id, lengthBeats }
  if (lengthBeats > clip.lengthBeats && !clip.loopBeats) change.loopBeats = clip.lengthBeats
  return change
}

/** One more pattern's worth: the length R asks for. A clip that does not loop doubles, since its whole length is its pattern. */
export function oneMoreRepeat (clip) {
  return clip.lengthBeats + (clip.loopBeats ?? clip.lengthBeats)
}
