// src/ops/UndoHistory.js
//
// The undo/redo stacks and the reconciliation that steps a project between
// snapshots, split out of OpDispatcher along the seam its own doc comments
// already drew: everything from "A snapshot per undoable edit" to the end of
// #restoreTo touched only these two stacks and called back into the
// dispatcher's own public apply()/addPlugin()/setParameter(), never into its
// private state directly.
//
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
   * A node the target has and the present does not is reloaded from its
   * plugin IRI, the same as reopening a saved session, with its id, settings,
   * channel and state preserved so the graph below still recognises it. A
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

      const toRemove = current.nodes.filter(n => !targetIds.has(n.id)).map(n => n.id)
      if (toRemove.length > 0) {
        dispatcher.apply(toRemove.map(id => ({ op: 'removeNode', id })))
      }

      for (const node of target.nodes) {
        if (currentIds.has(node.id)) continue
        const result = await dispatcher.addPlugin(node.pluginIri, {
          id: node.id, label: node.label, settings: node.settings,
          channel: node.channel, state: node.state
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
        // Always fully populated: Project.snapshot() copies a node's channel
        // whole, and a node's channel is never partial from the moment it is
        // created (Project.js merges DEFAULT_CHANNEL in on addNode).
        const channel = node.channel ?? {}
        const liveChannel = live.channel ?? {}
        if (channel.gain !== liveChannel.gain || channel.pan !== liveChannel.pan ||
            channel.muted !== liveChannel.muted || channel.soloed !== liveChannel.soloed) {
          reconcile.push({ op: 'setChannel', node: node.id, ...channel })
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

      // Applied even when empty, so a step that changed nothing else (every
      // difference already handled by setParameter above) still commits,
      // recompiles and emits 'changed': the UI redraws from this, not from
      // undo()/redo() themselves.
      dispatcher.apply(reconcile)
    })
  }
}
