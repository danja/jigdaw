// src/model/TrackDuplicate.js
//
// Copying a track, as changes over the existing Ops. Pure: it reads the project and
// returns what to do, or throws an Error saying why not.
//
// It comes in two halves because a node is a loaded plugin, not data, and loading
// reaches the network. `describeTrackCopy` is what to create: the track, and each
// plugin to load onto it. Once the new nodes exist their ids are known, and
// `finishTrackCopy` is everything that names them: track inputs, the connections
// between them, automation, clips and the track's sends. src/ops/DuplicateTrack.js
// runs the two in order as one undoable edit.
//
// What is not copied, on purpose: a connection with an end on some other track (the
// copy would double into the same destination, and which end to move is a person's
// call), sends into the track, and a plugin's live state beyond what a saved
// session carries. Each of the first two comes back in `skipped`, so a caller can say.

/** The label a copy gets: the original's, or its id when it has none, and "copy". */
function copyLabel (track) {
  return `${track.label ?? track.id} copy`
}

/**
 * @returns {{ track: object, nodes: object[], skipped: string[] }}
 *   `track` is the addTrack change; `nodes` are in the order they were added, each with
 *   `from` (the original node's id), `pluginIri`, `label`, `settings`, `state` and `bypassed`.
 */
export function describeTrackCopy (project, trackId, { newTrackId = project.nextId('track') } = {}) {
  const track = project.track(trackId)
  if (!track) throw new Error(`no such track: ${trackId}`)
  const nodes = project.nodes.filter(n => n.track === trackId)
  const on = new Set(nodes.map(n => n.id))
  const skipped = []
  for (const c of project.connections) {
    const inside = [c.from.node, c.to.node].filter(id => on.has(id)).length
    if (inside === 1) skipped.push(`connection ${c.id} joins this track to another, and is not copied`)
  }
  return {
    track: { op: 'addTrack', id: newTrackId, label: copyLabel(track), channel: { ...track.channel } },
    nodes: nodes.map(n => ({
      from: n.id,
      pluginIri: n.pluginIri,
      label: n.label,
      settings: Object.fromEntries(n.settings),
      state: n.state,
      bypassed: n.bypassed === true
    })),
    skipped
  }
}

/**
 * Everything that names the copied nodes, once they exist.
 *
 * @param idMap original node id => the id the copy was given. A node missing from it did not load,
 *   and whatever names it is left out rather than refused for a second reason.
 */
export function finishTrackCopy (project, trackId, newTrackId, idMap) {
  const track = project.track(trackId)
  if (!track) throw new Error(`no such track: ${trackId}`)
  const mapped = id => (id === null || id === undefined ? null : idMap.get(id) ?? null)
  const changes = []

  const setTrack = { op: 'setTrack', id: newTrackId }
  if (track.midiInput !== null) setTrack.midiInput = mapped(track.midiInput)
  if (track.audioInput !== null) setTrack.audioInput = mapped(track.audioInput)
  if (track.output) setTrack.output = track.output
  if (Object.keys(setTrack).length > 2) changes.push(setTrack)

  for (const c of project.connections) {
    const from = mapped(c.from.node)
    const to = mapped(c.to.node)
    if (from === null || to === null) continue
    const { id, ...rest } = c
    changes.push({ op: 'addConnection', ...rest, from: { ...c.from, node: from }, to: { ...c.to, node: to } })
  }

  for (const envelope of project.envelopes) {
    const node = envelope.target.node
    if (node === undefined || mapped(node) === null) continue
    changes.push({ op: 'addEnvelope', target: { ...envelope.target, node: mapped(node) }, points: envelope.points.map(p => ({ ...p })) })
  }

  for (const clip of project.clips) {
    if (clip.track !== trackId) continue
    const { id, track: _track, ...rest } = clip
    changes.push({ op: 'addClip', ...rest, track: newTrackId, notes: clip.notes.map(n => ({ ...n })) })
  }

  for (const send of project.sends) {
    if (send.from !== trackId) continue
    const { id, from, ...rest } = send
    changes.push({ op: 'addSend', ...rest, from: newTrackId })
  }
  return changes
}
