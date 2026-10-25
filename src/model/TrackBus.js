// src/model/TrackBus.js
//
// Making a bus from tracks that exist: one new track, and each chosen track's output set to it. Pure, and a plain
// changeset, so the whole thing is one undo step and either happens or does not. A bus is not a kind of track
// but a track other tracks send their output to (src/model/TrackKind.js), so there is nothing else to make.
//
// The new track has no outputs of its own, so pointing others at it cannot make a loop.

/**
 * Put a bus just after the last of the tracks that feed it, so a mix reads top to bottom: the sources, then where they go.
 * A new track is last in the order and a bus made from the first three of ten would otherwise sit under all ten. Never inside
 * a folder: when the last member is in the middle of one, the bus goes after the run, not between two of its tracks, so the
 * folder keeps a single bar. Only the order changes (editor metadata: no revision, no undo). Returns whether it moved.
 */
export function placeBus (project, busId, memberIds) {
  const order = project.orderedTracks.map(t => t.id)
  const members = new Set(memberIds)
  let last = -1
  order.forEach((id, index) => { if (members.has(id)) last = index })
  if (last < 0) return false
  const folder = project.trackLayout(order[last]).folder
  if (folder) {
    while (last + 1 < order.length && order[last + 1] !== busId && project.trackLayout(order[last + 1]).folder === folder) last++
  }
  const delta = last + 1 - order.indexOf(busId)
  return delta < 0 ? project.moveTrack(busId, delta) : false
}

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
