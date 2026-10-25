// src/ops/LatencyOps.js
//
// Latency in the running graph (docs/latency.md): what each node declares, how late each track is, the delay each track is given so that tracks
// arriving at the same place arrive together, and a processor reporting a new latency while the graph plays. It holds the delays the engine was
// last given (per track, and per connection for compensation) so the engine is asked only about a change. The dispatcher owns the model and the
// order of things; this is handed what it reads through `host`:
//
//   engine, project, composites     the running engine or null, the model, and the composites by node id (read each time)
//   engineIdOf(flatId), compile(), emit(event)
import { trackDelays } from './TrackAlignment.js'

export class LatencyOps {
  #host
  // The compensation delays the running graph holds, by project connection id. Rebuilt with the links, and moved by a latency message
  // without rebuilding them (docs/latency.md section 2).
  #compensation = new Map()
  #alignTracks
  // The delay last given to each track, in frames, so the engine is asked only about a change.
  #trackDelays = new Map()
  // Failed alignments already told to the person, so a rebuild that fails the same way says nothing more.
  #warned = new Set()

  constructor (host, { alignTracks = false } = {}) {
    this.#host = host
    this.#alignTracks = alignTracks
  }

  /** The delays the links were given, kept for latency messages. */
  setCompensation (map) { this.#compensation = map }

  /** Whether tracks are aligned to one another. */
  get alignTracks () { return this.#alignTracks }

  /** Turn alignment on or off, and give every track the delay that now applies. */
  setAlignTracks (on) {
    this.#alignTracks = Boolean(on)
    const compiled = this.#host.compile()
    if (compiled.ok) this.applyTrackDelays(compiled)
  }

  /**
   * How late each track's signal is, in frames: the longest declared latency
   * along its chain, counting what the compiler found ahead of each node.
   * `alignFrames` is the delay added to line it up with the others arriving at the same place, which
   * is zero when alignment is off, and `frames` is what the track itself has
   * (docs/latency.md, "Between tracks").
   */
  trackLatencies () {
    const compiled = this.#host.compile()
    const own = compiled.ok ? this.#trackFrames(compiled) : new Map(this.#host.project.tracks.map(t => [t.id, 0]))
    const delays = trackDelays(this.#host.project.tracks, own, this.#alignTracks)
    return this.#host.project.tracks.map(track => ({
      trackId: track.id,
      frames: own.get(track.id) ?? 0,
      alignFrames: delays.get(track.id) ?? 0
    }))
  }

  #trackFrames (compiled) {
    return new Map(this.#host.project.tracks.map(track => [
      track.id,
      this.#host.project.nodes
        .filter(n => n.track === track.id)
        .flatMap(n => this.#flatIdsOf(n.id))
        .reduce((most, id) => Math.max(most, (compiled.arrival.get(id) ?? 0) + this.latencyOf(id)), 0)
    ]))
  }

  /** The ids a model node has in the flat graph: its own, or its members'. */
  #flatIdsOf (nodeId) {
    return this.#host.composites.get(nodeId)?.flatIds ?? [nodeId]
  }

  /** Give each track the delay that lines it up, asking the engine only where it changed. */
  applyTrackDelays (compiled) {
    if (!this.#host.engine) return
    const delays = trackDelays(this.#host.project.tracks, this.#trackFrames(compiled), this.#alignTracks)
    for (const track of this.#host.project.tracks) {
      const wanted = delays.get(track.id) ?? 0
      if ((this.#trackDelays.get(track.id) ?? 0) === wanted) continue
      try {
        this.#host.engine.setTrackDelay(track.id, wanted)
        this.#trackDelays.set(track.id, wanted)
      } catch (error) {
        // Not refused as an edit: the graph is fine, only the alignment could not be done.
        const message = `could not align track ${track.id}: ${error.message}`
        console.error(message)
        // The console is not where a person looks: say it on the page too, once per track and delay.
        const key = `${track.id}:${wanted}`
        if (!this.#warned.has(key)) {
          this.#warned.add(key)
          this.#host.emit({ type: 'warning', message })
        }
      }
    }
    for (const id of [...this.#trackDelays.keys()]) if (!this.#host.project.track(id)) this.#trackDelays.delete(id)
  }

  /** The latency each node declares, from what the engine actually loaded. */
  latencyOf (nodeId) {
    const engineId = this.#host.engineIdOf(nodeId)
    if (!engineId || !this.#host.engine) return 0
    try { return this.#host.engine.get(engineId).ready?.latencyFrames ?? 0 } catch { return 0 }
  }

  /**
   * A processor reporting a new latency (docs/latency.md section 2).
   *
   * Not an operation: nothing the project records changed, so there is no
   * revision, no history entry, and nothing to undo. The node's figure is
   * updated, the unchanged project is recompiled, and each compensation delay
   * that moved is retimed against the message's fromFrame rather than against
   * this arrival. A handler that throws must not take down the fan-out, so a
   * connection that is not in the running graph yet (one end still loading)
   * is reported and skipped: the next full rebuild wires it with the current
   * figures.
   */
  onLatency (nodeId, engineId, message, outerNodeId = nodeId) {
    if (this.#host.engineIdOf(nodeId) !== engineId || !this.#host.engine) return
    let entry
    try {
      entry = this.#host.engine.get(engineId)
    } catch {
      return
    }
    const label = entry?.profile?.label ?? nodeId
    const { latencyFrames, fromFrame } = message ?? {}
    if (!Number.isFinite(latencyFrames) || latencyFrames < 0) {
      console.error(`${label} reported an unusable latency: ${JSON.stringify(latencyFrames)}. A latency message carries a non-negative latencyFrames in frames.`)
      return
    }
    if (!Number.isFinite(fromFrame) || fromFrame < 0) {
      console.error(`${label} reported an unusable fromFrame: ${JSON.stringify(fromFrame)}. A latency message carries the absolute stream position its figure applies from.`)
      return
    }

    entry.ready = { ...(entry.ready ?? {}), latencyFrames }
    const compiled = this.#host.compile()
    if (!compiled.ok) {
      console.error(`${label} changed its latency to ${latencyFrames} frames and the graph no longer compiles: ${compiled.errors[0].message}. Keeping the previous compensation.`)
      return
    }

    const atTime = this.#host.engine.frameTime(fromFrame)
    const after = new Map(compiled.compensation.map(c => [c.connection, c.delayFrames]))
    for (const [connection, delayFrames] of after) {
      if (this.#compensation.get(connection) === delayFrames) continue
      try {
        this.#host.engine.retime(connection, delayFrames, { atTime })
      } catch (error) {
        console.error(`${label}: cannot retime connection "${connection}": ${error.message}`)
      }
    }
    for (const connection of this.#compensation.keys()) {
      if (after.has(connection)) continue
      try {
        this.#host.engine.retime(connection, 0, { atTime })
      } catch (error) {
        console.error(`${label}: cannot retime connection "${connection}": ${error.message}`)
      }
    }
    this.#compensation = after
    this.applyTrackDelays(compiled)
    this.#host.emit({ type: 'latency', nodeId: outerNodeId, latencyFrames, fromFrame, compiled })
  }
}
