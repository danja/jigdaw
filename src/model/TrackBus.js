// src/model/TrackBus.js
//
// Making a bus from tracks that exist: one new track, and each chosen track's output set to it. Pure, and a plain
// changeset, so the whole thing is one undo step and either happens or does not. A bus is not a kind of track
// but a track other tracks send their output to (src/model/TrackKind.js), so there is nothing else to make.
//
// The new track has no outputs of its own, so pointing others at it cannot make a loop.

/** The changes that make a bus called `label` of `trackIds`. Throws an Error saying why not. */
export function describeBus (project, trackIds, { label = 'Bus', newTrackId = project.nextId('track') } = {}) {
  const ids = [...new Set(trackIds)]
  if (ids.length < 2) throw new Error('a bus takes two or more different tracks')
  for (const id of ids) if (!project.track(id)) throw new Error(`no such track: ${id}`)
  return [
    { op: 'addTrack', id: newTrackId, label },
    ...ids.map(id => ({ op: 'setTrack', id, output: newTrackId }))
  ]
}
