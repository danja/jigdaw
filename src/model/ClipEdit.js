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
      { op: 'addClip', id: newId, track: clip.track, kind: 'midi', startBeat: atBeat, lengthBeats: second, muted: clip.muted, notes: right }
    ]
  }
  if (!transport) throw new Error('splitting an audio clip needs the transport, to turn beats into seconds')
  const offsetSeconds = clip.offsetSeconds + (transport.secondsAtBeat(atBeat) - transport.secondsAtBeat(clip.startBeat))
  // The cut ends the first half's sound and starts the second's, so the fade in stays with the
  // first half and the fade out goes with the second.
  return [
    { op: 'setClip', id, lengthBeats: first, fadeOutBeats: 0 },
    { op: 'addClip', id: newId, track: clip.track, kind: 'audio', startBeat: atBeat, lengthBeats: second, muted: clip.muted, source: clip.source, offsetSeconds, fadeOutBeats: clip.fadeOutBeats }
  ]
}

/** A copy of a clip, by default straight after it on the same track. The project mints its id, so several can be made at once. */
export function duplicateClip (project, id, { track, startBeat } = {}) {
  const clip = project.clip(id)
  if (!clip) throw new Error(`no such clip: ${id}`)
  const at = startBeat ?? clip.startBeat + clip.lengthBeats
  const where = track ?? clip.track
  return [clip.kind === 'midi'
    ? { op: 'addClip', track: where, kind: 'midi', startBeat: at, lengthBeats: clip.lengthBeats, muted: clip.muted, notes: clip.notes.map(n => ({ ...n })) }
    : { op: 'addClip', track: where, kind: 'audio', startBeat: at, lengthBeats: clip.lengthBeats, muted: clip.muted, source: clip.source, offsetSeconds: clip.offsetSeconds, fadeInBeats: clip.fadeInBeats, fadeOutBeats: clip.fadeOutBeats }]
}

/**
 * Shorten a clip from the front and/or the back, to beats inside it, without
 * moving what is left: a MIDI clip's notes are shifted and cut so they stay
 * where they sounded, an audio clip begins further into its file. `from` and
 * `to` are absolute beats; leave one out to keep that edge.
 */
export function trimClip (project, id, { from, to } = {}, { transport = null } = {}) {
  const clip = project.clip(id)
  if (!clip) throw new Error(`no such clip: ${id}`)
  const end = clip.startBeat + clip.lengthBeats
  const start = from ?? clip.startBeat
  const stop = to ?? end
  if (!(start >= clip.startBeat && stop <= end && stop > start)) {
    throw new Error('a trim must leave some of the clip, between its start and its end')
  }
  const cut = start - clip.startBeat
  const change = { op: 'setClip', id, startBeat: start, lengthBeats: stop - start }
  if (clip.kind === 'audio') {
    // A fade belongs to the edge it was made for: cutting that edge away takes it too.
    if (from !== undefined && from > clip.startBeat) change.fadeInBeats = 0
    if (to !== undefined && to < end) change.fadeOutBeats = 0
    if (cut > 0) {
      if (!transport) throw new Error('trimming the start of an audio clip needs the transport, to turn beats into seconds')
      change.offsetSeconds = clip.offsetSeconds + (transport.secondsAtBeat(start) - transport.secondsAtBeat(clip.startBeat))
    }
    return [change]
  }
  if (cut === 0) return [change]
  const { right } = partition(clip.notes, cut)
  return [change, { op: 'setClipNotes', id, notes: right }]
}

/**
 * What a copy holds: the clips as plain data, placed relative to the earliest
 * one, so a paste can put the group down anywhere. Not tied to a project, so it
 * outlives the clips it came from and survives an undo.
 */
export function copyClips (project, ids) {
  const clips = ids.map(id => {
    const clip = project.clip(id)
    if (!clip) throw new Error(`no such clip: ${id}`)
    return clip
  })
  if (clips.length === 0) throw new Error('there is nothing selected to copy')
  const first = Math.min(...clips.map(c => c.startBeat))
  return clips.map(c => ({
    track: c.track, kind: c.kind, offset: c.startBeat - first, lengthBeats: c.lengthBeats, muted: c.muted,
    ...(c.kind === 'midi' ? { notes: c.notes.map(n => ({ ...n })) } : { source: c.source, offsetSeconds: c.offsetSeconds, fadeInBeats: c.fadeInBeats, fadeOutBeats: c.fadeOutBeats })
  }))
}

/**
 * Put a copy down with its earliest clip at `startBeat`. Each clip goes back to
 * the track it came from, or all onto `track` when one is given. Ids are minted
 * by the project, so pasting twice gives two sets of clips.
 */
export function pasteClips (project, copied, { startBeat, track = null } = {}) {
  if (!Array.isArray(copied) || copied.length === 0) throw new Error('there is nothing copied to paste')
  return copied.map(c => {
    const where = track ?? c.track
    if (!project.track(where)) throw new Error(`the track this was copied from is gone: ${where}`)
    const common = { op: 'addClip', track: where, kind: c.kind, startBeat: startBeat + c.offset, lengthBeats: c.lengthBeats, muted: c.muted }
    return c.kind === 'midi'
      ? { ...common, notes: c.notes.map(n => ({ ...n })) }
      : { ...common, source: c.source, offsetSeconds: c.offsetSeconds, fadeInBeats: c.fadeInBeats, fadeOutBeats: c.fadeOutBeats }
  })
}
