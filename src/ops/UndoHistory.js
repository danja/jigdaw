// src/ops/UndoHistory.js
//
// The undo/redo stacks and the reconciliation that steps a project between
// snapshots, split out of OpDispatcher along the seam its own doc comments
// already drew: everything from "A snapshot per undoable edit" to the end of
// #restoreTo touched only these two stacks and called back into the
// dispatcher's own public apply()/addPlugin()/setParameter(), never into its
// private state directly.
//
import { clipChange } from '../model/Project.js'

// Bounded so a long session's history is not an unbounded array of full
// project snapshots. 100 undoable edits is far past what anyone steps back
// through in one sitting, and the oldest is dropped rather than the newest.
const UNDO_LIMIT = 100

export class UndoHistory {
  #undoStack = []
  #redoStack = []
  #limit

  constructor (limit = UNDO_LIMIT) {
    this.#limit = limit
  }

  /** Whether there is an edit to step back from. */
  canUndo () { return this.#undoStack.length > 0 }

  /** Whether there is an edit undo last stepped back from to step forward to. */
  canRedo () { return this.#redoStack.length > 0 }

  /** Drop all undo and redo history. */
  clear () {
    this.#undoStack.length = 0
    this.#redoStack.length = 0
  }

  /**
   * Record a snapshot taken just before a committed edit. Called by
   * OpDispatcher.apply() itself, never from here, because only apply() knows
   * whether the edit it just committed should be undoable.
   */
  record (snapshot) {
    this.#undoStack.push(snapshot)
    if (this.#undoStack.length > this.#limit) this.#undoStack.shift()
    this.#redoStack.length = 0
  }

  /**
   * Step the project back to how it was before the last recorded edit.
   *
   * Async, unlike apply(): a node removed since the snapshot being restored to
   * is not data the model can conjure back, it is an instantiated plugin, and
   * bringing it back means reloading it, contract section 3.1 start to
   * finish. Most edits touch no such node and this still returns a promise,
   * so a caller does not need to know in advance which kind of edit it was
   * undoing.
   */
  async undo (dispatcher) {
    if (this.#undoStack.length === 0) return { ok: false, message: 'nothing to undo' }
    const target = this.#undoStack.pop()
    this.#redoStack.push(dispatcher.project.snapshot())
    await this.#restoreTo(dispatcher, target)
    return { ok: true, revision: dispatcher.project.revision }
  }

  /** The inverse of undo: step forward to whatever undo last stepped back from. */
  async redo (dispatcher) {
    if (this.#redoStack.length === 0) return { ok: false, message: 'nothing to redo' }
    const target = this.#redoStack.pop()
    this.#undoStack.push(dispatcher.project.snapshot())
    await this.#restoreTo(dispatcher, target)
    return { ok: true, revision: dispatcher.project.revision }
  }

  /**
   * Bring the live project to match a snapshot, reusing the same paths a
   * person or the WebMCP surface would use rather than writing the state in
   * directly, so the engine (AudioParams, the channel strip, the links) moves
   * with the model exactly as it does for any other edit. Recording is off
   * throughout, through dispatcher.withoutRecording(): every apply()/
   * addPlugin()/setParameter() call this makes is the mechanism of the undo
   * or redo, not a further edit to record one of.
   *
   * Tracks are added before any node is reloaded, because a node names its
   * track, and removed only after every node has moved off them or gone,
   * because the model refuses to remove a track with nodes on it.
   *
   * A node the target has and the present does not is reloaded from its
   * plugin IRI, the same as reopening a saved session, with its id, track,
   * settings and state preserved so the graph below still recognises it. A
   * node a reload could not restore is left out and reported nowhere further
   * than the console: its connections are skipped rather than left dangling,
   * which is one node's worth of undo history lost rather than the whole
   * step refused for a plugin that may no longer be reachable.
   */
  async #restoreTo (dispatcher, target) {
    await dispatcher.withoutRecording(async () => {
      const current = dispatcher.project.snapshot()
      const currentIds = new Set(current.nodes.map(n => n.id))
      const targetIds = new Set(target.nodes.map(n => n.id))
      const currentTrackIds = new Set(current.tracks.map(t => t.id))
      const targetTrackIds = new Set(target.tracks.map(t => t.id))

      const toAddTracks = target.tracks.filter(t => !currentTrackIds.has(t.id))
      if (toAddTracks.length > 0) {
        dispatcher.apply(toAddTracks.map(t => ({ op: 'addTrack', id: t.id, label: t.label, channel: t.channel })))
      }

      const toRemove = current.nodes.filter(n => !targetIds.has(n.id)).map(n => n.id)
      if (toRemove.length > 0) {
        dispatcher.apply(toRemove.map(id => ({ op: 'removeNode', id })))
      }

      for (const node of target.nodes) {
        if (currentIds.has(node.id)) continue
        const result = await dispatcher.addPlugin(node.pluginIri, {
          id: node.id, label: node.label, track: node.track, settings: node.settings, state: node.state
        })
        if (!result.ok) {
          console.warn(`undo/redo: could not reload ${node.pluginIri} as ${node.id}: ${result.message}`)
          continue
        }
        // addNode writes settings into the model; it does not push them to
        // the engine's AudioParams, the same reason openSession pushes each
        // one through setParameter after loading rather than trusting the op.
        for (const [symbol, value] of Object.entries(node.settings ?? {})) {
          dispatcher.setParameter(node.id, symbol, value)
        }
      }

      const reconcile = []
      for (const node of target.nodes) {
        if (!currentIds.has(node.id)) continue // handled by the reload above
        const live = dispatcher.project.node(node.id)
        if (!live) continue
        for (const [symbol, value] of Object.entries(node.settings ?? {})) {
          if (live.settings.get(symbol) !== value) dispatcher.setParameter(node.id, symbol, value)
        }
        // A setting the target does not have was not set then, so it goes
        // back to the default. Walking only the target's settings missed
        // exactly the first change ever made to a parameter.
        for (const symbol of [...live.settings.keys()]) {
          if (!(symbol in (node.settings ?? {}))) dispatcher.resetParameter(node.id, symbol)
        }
        if (live.track !== node.track) reconcile.push({ op: 'moveNodeToTrack', id: node.id, track: node.track })
      }

      // Every track the target has now exists. Its channel is always fully
      // populated: Project.js merges the default in on addTrack, so a field
      // compared here is never missing on one side only.
      const liveIdsAfterReload = new Set(dispatcher.project.nodes.map(n => n.id))
      for (const track of target.tracks) {
        const live = dispatcher.project.track(track.id)
        const c = track.channel
        const l = live.channel
        if (c.gain !== l.gain || c.pan !== l.pan || c.muted !== l.muted || c.soloed !== l.soloed) {
          reconcile.push({ op: 'setTrackChannel', track: track.id, ...c })
        }
        // An input naming a node a reload could not restore is dropped rather
        // than refusing the whole step, the same as a connection to one.
        const input = id => (id !== null && liveIdsAfterReload.has(id) ? id : null)
        if (live.label !== track.label || live.midiInput !== input(track.midiInput) ||
            live.audioInput !== input(track.audioInput)) {
          reconcile.push({
            op: 'setTrack', id: track.id, label: track.label,
            midiInput: input(track.midiInput), audioInput: input(track.audioInput)
          })
        }
      }

      // Connection identity is the connection's own id, stable across a
      // project's history whether or not the connection itself survives, so
      // diffing by id is exact rather than a comparison of shape.
      const liveIds = new Set(dispatcher.project.nodes.map(n => n.id))
      const currentConnIds = new Set(dispatcher.project.connections.map(c => c.id))
      const targetConnIds = new Set(target.connections.map(c => c.id))
      for (const id of currentConnIds) {
        if (!targetConnIds.has(id)) reconcile.push({ op: 'removeConnection', id })
      }
      for (const connection of target.connections) {
        if (currentConnIds.has(connection.id)) continue
        // Both ends must actually be loaded, the same guard openSession
        // applies: a connection to a node a reload could not restore would
        // refuse the whole reconciliation for the sake of one plugin.
        if (!liveIds.has(connection.from.node) || !liveIds.has(connection.to.node)) continue
        reconcile.push({
          op: 'addConnection',
          id: connection.id,
          from: connection.from,
          to: connection.to,
          signalKind: connection.signalKind,
          delayFrames: connection.delayFrames
        })
      }

      if (JSON.stringify(dispatcher.project.snapshot().transport) !== JSON.stringify(target.transport)) {
        reconcile.push({ op: 'setTransport', ...target.transport })
      }

      // Clips are data, so a clip that differs is replaced whole under its own
      // id: exact, and one rule rather than one per field. Before tracks are
      // removed, which would take their clips with them.
      const liveClips = new Map(dispatcher.project.snapshot().clips.map(c => [c.id, c]))
      const targetClips = new Map(target.clips.map(c => [c.id, c]))
      for (const [id, clip] of liveClips) {
        const wanted = targetClips.get(id)
        if (!wanted || JSON.stringify(wanted) !== JSON.stringify(clip)) reconcile.push({ op: 'removeClip', id })
      }
      for (const [id, clip] of targetClips) {
        const live = liveClips.get(id)
        if (!live || JSON.stringify(live) !== JSON.stringify(clip)) reconcile.push(clipChange(clip))
      }

      // Last, once every node has moved off or gone.
      for (const id of currentTrackIds) {
        if (!targetTrackIds.has(id)) reconcile.push({ op: 'removeTrack', id })
      }

      // Applied even when empty, so a step that changed nothing else (every
      // difference already handled by setParameter above) still commits,
      // recompiles and emits 'changed': the UI redraws from this, not from
      // undo()/redo() themselves.
      dispatcher.apply(reconcile)
    })
  }
}
