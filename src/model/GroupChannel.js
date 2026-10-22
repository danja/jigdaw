// src/model/GroupChannel.js
//
// Moving the level or pan of several tracks together, by an amount relative to where each one is. Pure, and a plain
// changeset, so a bulk edit is one undo step.
//
// The rules, so the group keeps its balance:
// - Level is a change in decibels. Each gain is multiplied by the same ratio, so the tracks stay the same number of
//   decibels apart. A track at zero stays at zero, since no ratio lifts it.
// - Pan is a shift. Every pan moves by the same amount, limited to what the track nearest the edge can take, so a
//   shift never squashes tracks together at -1 or 1.

/** The changes that move the level of each of `trackIds` by `decibels`. Throws an Error saying why not. */
export function describeLevelShift (project, trackIds, decibels) {
  if (!Number.isFinite(decibels)) throw new Error(`decibels must be a number: ${decibels}`)
  const ratio = 10 ** (decibels / 20)
  return tracksOf(project, trackIds).map(track => ({ op: 'setTrackChannel', track: track.id, gain: track.channel.gain * ratio }))
}

/** The changes that shift the pan of each of `trackIds` by `amount` (-1 to 1), or by less if one would pass an edge. */
export function describePanShift (project, trackIds, amount) {
  if (!Number.isFinite(amount)) throw new Error(`pan shift must be a number: ${amount}`)
  const tracks = tracksOf(project, trackIds)
  const pans = tracks.map(track => track.channel.pan)
  const room = amount >= 0 ? 1 - Math.max(...pans) : -1 - Math.min(...pans)
  const shift = amount >= 0 ? Math.min(amount, room) : Math.max(amount, room)
  return tracks.map(track => ({ op: 'setTrackChannel', track: track.id, pan: Math.min(1, Math.max(-1, track.channel.pan + shift)) }))
}

/**
 * The tracks a bus or folder fader would move together: those that send their output to this track, and those that
 * share its folder. Ids, in the arrangement's order, never including the track itself.
 */
export function groupMembers (project, trackId) {
  const folder = project.trackLayout(trackId).folder
  return project.orderedTracks
    .filter(t => t.id !== trackId && (t.output === trackId || (folder !== null && project.trackLayout(t.id).folder === folder)))
    .map(t => t.id)
}

function tracksOf (project, trackIds) {
  const ids = [...new Set(trackIds)]
  if (ids.length === 0) throw new Error('no tracks to change')
  return ids.map(id => {
    const track = project.track(id)
    if (!track) throw new Error(`no such track: ${id}`)
    return track
  })
}
