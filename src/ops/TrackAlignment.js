// src/ops/TrackAlignment.js
//
// The delay each track is given so that tracks arriving at the same place arrive together (docs/latency.md, "Between tracks"). A pure
// function of the tracks and how late each one is, so it is tested without an engine.

/**
 * The delay each track is given, in frames, as a Map by track id.
 *
 * A place is the master or a bus. Tracks feeding it are lined up with the slowest of them, and what a
 * track arrives with is its own chain plus the slowest of the tracks that feed it, so a bus that is itself
 * a track with latency passes that on to everything it takes to the master. Aligning everything to one
 * slowest figure, as before, left a bus's latency out of the sum, and so a track through a bus arrived
 * late by exactly what the bus adds. A send is a parallel copy and is not aligned here (docs/latency.md).
 *
 * `own` is each track's own latency by id. With `enabled` false every delay is zero.
 */
export function trackDelays (tracks, own, enabled) {
  const arrival = new Map()
  const arrivalOf = id => {
    if (!arrival.has(id)) {
      const before = Math.max(0, ...tracks.filter(t => t.output === id).map(t => arrivalOf(t.id)))
      arrival.set(id, (own.get(id) ?? 0) + before)
    }
    return arrival.get(id)
  }
  const slowest = new Map()
  for (const t of tracks) {
    const place = t.output ?? null
    slowest.set(place, Math.max(slowest.get(place) ?? 0, arrivalOf(t.id)))
  }
  return new Map(tracks.map(t => [t.id, enabled ? slowest.get(t.output ?? null) - arrivalOf(t.id) : 0]))
}
