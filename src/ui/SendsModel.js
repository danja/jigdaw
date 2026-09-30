// src/ui/SendsModel.js
//
// Where a track's signal can go besides the master, and what already goes
// there. Pure: it reads the project's tracks, sends and bus outputs.
//
// A destination is offered only if it would not make a track feed itself, the
// same rule the model enforces (src/model/ArrangementOps.js), so the page does
// not offer what would be refused.

/** Tracks reachable from `from` by outputs and sends, including itself. */
function reachable (project, from) {
  const seen = new Set()
  const stack = [from]
  while (stack.length > 0) {
    const id = stack.pop()
    if (seen.has(id)) continue
    seen.add(id)
    const output = project.track(id)?.output
    if (output) stack.push(output)
    for (const send of project.sends) if (send.from === id) stack.push(send.to)
  }
  return seen
}

/** Whether a route from `from` to `to` (send or output) would make a loop of tracks. */
export function wouldLoop (project, from, to) {
  return from === to || reachable(project, to).has(from)
}

/** Tracks a new send from `trackId` may go to: not itself, not one it already sends to, no loops. */
export function sendTargets (project, trackId) {
  const already = new Set(project.sends.filter(s => s.from === trackId).map(s => s.to))
  return project.orderedTracks.filter(t => t.id !== trackId && !already.has(t.id) && !wouldLoop(project, trackId, t.id))
}

/** Tracks this one's output may be sent to instead of the master: no loops. */
export function outputTargets (project, trackId) {
  return project.orderedTracks.filter(t => t.id !== trackId && !wouldLoop(project, trackId, t.id))
}

/** What the header says about a track's routing, or null when it is plain: straight to the master, sending and receiving nothing. */
export function describeRouting (project, trackId, labelOf) {
  const parts = []
  const track = project.track(trackId)
  if (track?.output) parts.push(`Output to ${labelOf(track.output)}`)
  const sends = project.sends.filter(s => s.from === trackId)
  if (sends.length > 0) {
    parts.push(`Sends to ${sends.map(s => `${labelOf(s.to)} (${s.tap === 'pre' ? 'pre' : 'post'})`).join(', ')}`)
  }
  const buses = [...project.tracks.filter(t => t.output === trackId).map(t => t.id), ...project.sends.filter(s => s.to === trackId).map(s => s.from)]
  const from = [...new Set(buses)]
  if (from.length > 0) parts.push(`Receives from ${from.map(labelOf).join(', ')}`)
  return parts.length > 0 ? `${parts.join('. ')}.` : null
}
