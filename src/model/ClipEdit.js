// src/model/ClipEdit.js
//
// Clip editing as changesets over the existing Ops: split and duplicate are
// composites of setClip, addClip and setClipNotes, so undo takes back the whole
// gesture and the dispatcher stays the only path. Pure: they read the project
// and return the changes, or throw an Error saying why not.

/** Notes inside a clip are placed from the clip's own start. */
function partition (notes, at) {
  const left = []
  const right = []
  for (const note of notes) {
    const end = note.startBeat + note.lengthBeats
    if (end <= at) left.push({ ...note })
    else if (note.startBeat >= at) right.push({ ...note, startBeat: note.startBeat - at })
    else {
      // A note across the cut is two notes, so neither half loses its sound.
      left.push({ ...note, lengthBeats: at - note.startBeat })
      right.push({ ...note, startBeat: 0, lengthBeats: end - at })
    }
  }
  return { left, right }
}

/**
 * Cut a clip in two at a beat inside it. `transport` (secondsAtBeat) is needed
 * for an audio clip, whose second half starts further into the same file.
 * The first half keeps the clip's id, so a selection on it stays valid.
 */
export function splitClip (project, id, atBeat, { transport = null, newId = project.nextId('clip') } = {}) {
  const clip = project.clip(id)
  if (!clip) throw new Error(`no such clip: ${id}`)
  if (!(atBeat > clip.startBeat && atBeat < clip.startBeat + clip.lengthBeats)) {
    throw new Error('the cut must fall inside the clip')
  }
  const first = atBeat - clip.startBeat
  const second = clip.lengthBeats - first
  if (clip.kind === 'midi') {
    const { left, right } = partition(clip.notes, first)
    return [
      { op: 'setClip', id, lengthBeats: first },
      { op: 'setClipNotes', id, notes: left },
      { op: 'addClip', id: newId, track: clip.track, kind: 'midi', startBeat: atBeat, lengthBeats: second, notes: right }
    ]
  }
  if (!transport) throw new Error('splitting an audio clip needs the transport, to turn beats into seconds')
  const offsetSeconds = clip.offsetSeconds + (transport.secondsAtBeat(atBeat) - transport.secondsAtBeat(clip.startBeat))
  return [
    { op: 'setClip', id, lengthBeats: first },
    { op: 'addClip', id: newId, track: clip.track, kind: 'audio', startBeat: atBeat, lengthBeats: second, source: clip.source, offsetSeconds }
  ]
}

/** A copy of a clip, by default straight after it on the same track. */
export function duplicateClip (project, id, { track, startBeat, newId = project.nextId('clip') } = {}) {
  const clip = project.clip(id)
  if (!clip) throw new Error(`no such clip: ${id}`)
  const at = startBeat ?? clip.startBeat + clip.lengthBeats
  const where = track ?? clip.track
  return [clip.kind === 'midi'
    ? { op: 'addClip', id: newId, track: where, kind: 'midi', startBeat: at, lengthBeats: clip.lengthBeats, notes: clip.notes.map(n => ({ ...n })) }
    : { op: 'addClip', id: newId, track: where, kind: 'audio', startBeat: at, lengthBeats: clip.lengthBeats, source: clip.source, offsetSeconds: clip.offsetSeconds }]
}
