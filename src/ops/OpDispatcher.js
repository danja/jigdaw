// src/ops/OpDispatcher.js
//
// Every operation, once.
//
// The editor and the WebMCP surface are thin adapters over this. Neither
// implements an operation of its own, because two implementations of "add a
// connection" diverge, and the first sign is usually an undo that half works.
// The rule comes from valis, where the GTK UI and the MCP server sit on one
// OpDispatcher.
//
// The dispatcher owns the order: model first, then compile, then engine. The
// UI never reaches the engine, so a change that the compiler refuses never
// reaches the audio graph at all, and the graph that is playing is always one
// the model describes.
import { Project, RevisionConflict, ChangeError } from '../model/Project.js'
import { findPort } from '../model/Endpoints.js'
import { compileGraph } from '../compiler/GraphCompiler.js'
import { EventRouter, isMidi } from '../engine/EventRouter.js'
import { Transport } from '../engine/Transport.js'

// Bounded so a long session's history is not an unbounded array of full
// project snapshots. 100 undoable edits is far past what anyone steps back
// through in one sitting, and the oldest is dropped rather than the newest.
const UNDO_LIMIT = 100

export class OpDispatcher {
  #project
  #engine
  #listeners = new Set()
  #nodeIds = new Map()
  #router = null

  #foreign

  // A snapshot per undoable edit, taken before the edit and pushed after it
  // commits, so the top of the stack is always "what to go back to". Nothing
  // is recorded while #recording is false, which is how undo and redo call
  // back into apply()/addPlugin() to do the actual work without recording
  // their own reversal as a new edit.
  #undoStack = []
  #redoStack = []
  #recording = true

  constructor ({ project = new Project(), engine = null, foreign = null } = {}) {
    this.#project = project
    this.#engine = engine
    // Contract section 12. Absent by default: a host that supports no foreign
    // plugins conforms, and refusing is the safe default, so this has to be
    // handed in rather than assumed.
    this.#foreign = foreign
    if (engine) {
      this.#router = new EventRouter({
        engine,
        onDropped: report => this.#emit({ type: 'dropped', ...report })
      })
    }
  }

  get router () { return this.#router }

  /**
   * Where consent for foreign plugins is recorded, or null on a host that
   * loads none. Exposed because contract section 12.4 requires a person to be
   * asked, and the asking happens in a surface rather than in here.
   */
  get foreignTrust () { return this.#foreign?.trust ?? null }

  /** The foreign side, or null on a host that loads none. */
  get foreignSupport () { return this.#foreign ?? null }

  /** The musical clock, built from the project so the two cannot disagree. */
  transport (sampleRate = this.#engine?.context?.sampleRate ?? 48000) {
    return Transport.fromProject(this.#project, sampleRate)
  }

  /**
   * Send the transport position to every plugin.
   *
   * Contract section 7: a plugin derives musical timing from this and never by
   * counting process() calls, so the host has to supply it rather than leave a
   * plugin to infer it.
   */
  sendTransport (elapsedFrames, { frame, playing = true, startBeat = 0 } = {}) {
    if (!this.#router) return null
    const message = this.transport().messageAt(elapsedFrames, { frame, playing, startBeat })
    this.#router.broadcastTransport(message)
    return message
  }

  /** Deliver MIDI into a node, as if from outside the graph. */
  sendEvents (nodeId, events) {
    const engineId = this.#nodeIds.get(nodeId)
    if (!engineId || !this.#router) return false
    this.#router.send(engineId, events)
    return true
  }

  get project () { return this.#project }
  get revision () { return this.#project.revision }

  /** Subscribe to what happened. Returns an unsubscribe function. */
  subscribe (listener) {
    this.#listeners.add(listener)
    return () => this.#listeners.delete(listener)
  }

  #emit (event) {
    for (const listener of this.#listeners) {
      // A listener that throws must not stop the others, or one broken panel
      // takes down the whole surface.
      try { listener(event) } catch (error) { console.error('listener failed', error) }
    }
  }

  /** The latency each node declares, from what the engine actually loaded. */
  #latencyOf (nodeId) {
    const engineId = this.#nodeIds.get(nodeId)
    if (!engineId || !this.#engine) return 0
    try { return this.#engine.get(engineId).ready?.latencyFrames ?? 0 } catch { return 0 }
  }

  /**
   * Apply a changeset.
   *
   * Compilation happens against the result before it is committed, so a
   * changeset that would produce an uncompilable graph is refused whole. That
   * is why this is the only way in.
   */
  apply (changes, { expectedRevision, dryRun = false } = {}) {
    // Does every end of every new edge name a port that is there.
    //
    // The model checks the shape of an endpoint and cannot check more: it has
    // no profiles, deliberately, because a project is loadable before its
    // plugins are. The engine has the profiles and finds out too late, by
    // throwing IndexSizeError out of AudioNode.connect in the middle of
    // rebuilding the links, after the change was committed. So the check
    // belongs here, which is the one layer holding both.
    const unroutable = this.#unroutable(changes)
    if (unroutable) {
      return { ok: false, kind: 'change', revision: this.#project.revision, message: unroutable }
    }

    try {
      // Validate the changes, without committing, so a bad change is reported
      // before anything is compiled.
      this.#project.apply(changes, { expectedRevision, dryRun: true })
    } catch (error) {
      return this.#failure(error)
    }

    // Commit to a scratch project to see what the graph would become.
    const trial = this.#clone()
    trial.apply(changes)
    const compiled = compileGraph(trial, { latencyOf: id => this.#latencyOf(id) })

    if (!compiled.ok) {
      return {
        ok: false,
        kind: 'compile',
        revision: this.#project.revision,
        errors: compiled.errors,
        message: compiled.errors[0].message
      }
    }

    if (dryRun) {
      return { ok: true, applied: false, revision: this.#project.revision, compiled }
    }

    // Taken before the commit, so it is what undo restores to. Not taken for a
    // dry run, which never reaches here, and not recorded at all while
    // #recording is false: undo and redo call back into this same apply()
    // through #restoreTo, and their own reversal is not a new edit.
    const before = this.#recording ? this.#project.snapshot() : null

    const result = this.#project.apply(changes, { expectedRevision })
    this.#releaseRemoved()
    this.#rebuildLinks(compiled)

    if (before) {
      this.#undoStack.push(before)
      if (this.#undoStack.length > UNDO_LIMIT) this.#undoStack.shift()
      this.#redoStack.length = 0
    }

    this.#emit({ type: 'changed', revision: result.revision, results: result.results, compiled })
    return { ok: true, applied: true, revision: result.revision, results: result.results, compiled }
  }

  /** Whether there is an edit to step back from. */
  canUndo () { return this.#undoStack.length > 0 }

  /** Whether there is an edit undo last stepped back from to step forward to. */
  canRedo () { return this.#redoStack.length > 0 }

  /**
   * Drop all undo and redo history.
   *
   * For a caller opening a different session into this dispatcher, such as
   * web/app.js's openSession, which loads a project by clearing every node
   * and adding back what the file says. Without this, undoing straight after
   * opening a file would try to step back into whatever session was open
   * before it, node by node, restoring plugins the person just replaced.
   */
  clearHistory () {
    this.#undoStack.length = 0
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
  async undo () {
    if (this.#undoStack.length === 0) return { ok: false, message: 'nothing to undo' }
    const target = this.#undoStack.pop()
    this.#redoStack.push(this.#project.snapshot())
    await this.#restoreTo(target)
    return { ok: true, revision: this.#project.revision }
  }

  /** The inverse of undo: step forward to whatever undo last stepped back from. */
  async redo () {
    if (this.#redoStack.length === 0) return { ok: false, message: 'nothing to redo' }
    const target = this.#redoStack.pop()
    this.#undoStack.push(this.#project.snapshot())
    await this.#restoreTo(target)
    return { ok: true, revision: this.#project.revision }
  }

  /**
   * Bring the live project to match a snapshot, reusing the same paths a
   * person or the WebMCP surface would use rather than writing the state in
   * directly, so the engine (AudioParams, the channel strip, the links) moves
   * with the model exactly as it does for any other edit. #recording is off
   * throughout: every apply()/addPlugin()/setParameter() call this makes is
   * the mechanism of the undo or redo, not a further edit to record one of.
   *
   * A node the target has and the present does not is reloaded from its
   * plugin IRI, the same as reopening a saved session, with its id, settings,
   * channel and state preserved so the graph below still recognises it. A
   * node a reload could not restore is left out and reported nowhere further
   * than the console: its connections are skipped rather than left dangling,
   * which is one node's worth of undo history lost rather than the whole
   * step refused for a plugin that may no longer be reachable.
   */
  async #restoreTo (target) {
    this.#recording = false
    try {
      const current = this.#project.snapshot()
      const currentIds = new Set(current.nodes.map(n => n.id))
      const targetIds = new Set(target.nodes.map(n => n.id))

      const toRemove = current.nodes.filter(n => !targetIds.has(n.id)).map(n => n.id)
      if (toRemove.length > 0) {
        this.apply(toRemove.map(id => ({ op: 'removeNode', id })))
      }

      for (const node of target.nodes) {
        if (currentIds.has(node.id)) continue
        const result = await this.addPlugin(node.pluginIri, {
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
          this.setParameter(node.id, symbol, value)
        }
      }

      const reconcile = []
      for (const node of target.nodes) {
        if (!currentIds.has(node.id)) continue // handled by the reload above
        const live = this.#project.node(node.id)
        if (!live) continue
        for (const [symbol, value] of Object.entries(node.settings ?? {})) {
          if (live.settings.get(symbol) !== value) this.setParameter(node.id, symbol, value)
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
      const liveIds = new Set(this.#project.nodes.map(n => n.id))
      const currentConnIds = new Set(this.#project.connections.map(c => c.id))
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

      if (JSON.stringify(this.#project.snapshot().transport) !== JSON.stringify(target.transport)) {
        reconcile.push({ op: 'setTransport', ...target.transport })
      }

      // Applied even when empty, so a step that changed nothing else (every
      // difference already handled by setParameter above) still commits,
      // recompiles and emits 'changed': the UI redraws from this, not from
      // undo()/redo() themselves.
      this.apply(reconcile)
    } finally {
      this.#recording = true
    }
  }

  /** The first end of a new connection that names a port its node has not got. */
  #unroutable (changes) {
    for (const change of changes ?? []) {
      if (change?.op !== 'addConnection') continue
      for (const direction of ['from', 'to']) {
        const endpoint = change[direction]
        if (!endpoint?.node) continue
        const found = findPort(
          this.engineNode(endpoint.node)?.profile, endpoint, direction, change.signalKind)
        if (!found.ok) return found.message
      }
    }
    return null
  }

  #failure (error) {
    if (error instanceof RevisionConflict) {
      return {
        ok: false,
        kind: 'conflict',
        revision: this.#project.revision,
        expected: error.expected,
        message: error.message
      }
    }
    if (error instanceof ChangeError) {
      return { ok: false, kind: 'change', revision: this.#project.revision, index: error.index, message: error.message }
    }
    throw error
  }

  /** A copy of the project, for trying a changeset without committing it. */
  #clone () {
    const copy = new Project()
    const snapshot = this.#project.snapshot()
    copy.apply([
      ...snapshot.nodes.map(n => ({ op: 'addNode', id: n.id, pluginIri: n.pluginIri, label: n.label, settings: n.settings, state: n.state })),
      ...snapshot.connections.map(c => ({ op: 'addConnection', id: c.id, from: c.from, to: c.to, signalKind: c.signalKind, delayFrames: c.delayFrames })),
      { op: 'setTransport', ...snapshot.transport }
    ])
    return copy
  }

  /**
   * Load a plugin and add it as a node.
   *
   * Loading reaches the network and can fail slowly, which does not sit well
   * inside an atomic changeset, so it happens first and the node id joins the
   * two halves. webmcp.md raises this as open; this is the answer.
   */
  /**
   * Load a plugin and add a node for it.
   *
   * `id` names the node rather than letting one be minted, which is what
   * reopening a saved project needs: the connections in the file name the nodes
   * they join, so a node that came back under a different name would be joined
   * to nothing. The model tracks ids it did not mint, so a later minted id
   * cannot collide with one restored here.
   *
   * Everything else is passed through to addNode rather than enumerated here.
   * It used to list the fields it forwarded, and the day a node gained a channel
   * strip that list was silently one field short: a saved mix was written
   * correctly, read correctly, and dropped on the way back in.
   */
  async addPlugin (iri, { position, foreign = false, ...node } = {}) {
    if (!this.#engine) throw new Error('no engine: this dispatcher can edit a project but not play it')

    let entry
    try {
      // One dispatcher, two load paths, and the branch is here rather than in
      // two callers. A foreign plugin is instantiated by its own adapter and
      // handed to the engine already built; everything after that, including
      // the model edit and the links below, is identical.
      entry = foreign
        ? await this.#addForeign(iri)
        : await this.#engine.addPlugin(iri)
    } catch (error) {
      // A ConsentRequired carries what a person has to be asked, so it travels
      // out intact rather than being flattened into a message. Contract section
      // 12.4: the asking happens where a person is, not in here.
      if (error.name === 'ConsentRequired') {
        return { ok: false, kind: 'consent', request: error.request, message: error.message }
      }
      return { ok: false, kind: 'load', step: error.step ?? null, message: error.message }
    }

    const result = this.apply([{
      op: 'addNode',
      ...node,
      pluginIri: iri,
      label: node.label ?? entry.profile.label
    }])
    if (!result.ok) {
      // The model refused it, so the engine must not keep it either.
      this.#engine.remove(entry.id)
      return result
    }

    const nodeId = result.results[0]
    this.#nodeIds.set(nodeId, entry.id)
    // The links were rebuilt inside that apply, when this node was in the model
    // and not yet in #nodeIds, so nothing could be wired to it. For a connection
    // that is harmless and expected, because the other end arrives later anyway.
    // For the path to the speakers it is not: a plugin loaded on its own would
    // be silent until some unrelated edit happened to rebuild the links.
    this.#rebuildLinks(this.compile())
    // Listen from the moment it is loaded, not from the moment it is wired.
    this.#router?.observe(entry.id)
    if (position) this.#project.moveNode(nodeId, position.x, position.y)

    this.#emit({ type: 'plugin-added', nodeId, entry })
    return { ...result, nodeId, entry }
  }

  /**
   * Fetch a foreign profile, load it through its adapter, and adopt it.
   *
   * Private because there must be exactly one way into running foreign code,
   * and it is the branch in addPlugin above.
   */
  async #addForeign (iri) {
    if (!this.#foreign) {
      throw new Error(
        'this host does not load foreign plugins. Contract section 12 is optional and ' +
        'supporting none of it conforms.')
    }
    const loaded = await this.#foreign.add(iri, this.#engine.context)
    return this.#engine.adopt({
      iri,
      profile: loaded.profile,
      node: loaded.node,
      ready: loaded.ready
    })
  }

  /**
   * Set a parameter. Goes to the model and the AudioParam, never a message.
   *
   * The clamp is asked for before the write rather than corrected after it. The
   * engine clamps to the declared range and the model must record what was
   * actually applied, not what was asked for, per messaging.md 2.3: a surface
   * renders what it is told, not what it requested. Writing the asked-for value
   * and then writing the clamped one was two revisions for one edit, and the
   * second went straight to the project, around this dispatcher's own gate.
   */
  setParameter (nodeId, symbol, value) {
    const engineId = this.#nodeIds.get(nodeId)
    let applied = value
    if (engineId && this.#engine) {
      try {
        applied = this.#engine.clampParameter(engineId, symbol, value)
      } catch (error) {
        return { ok: false, kind: 'change', message: error.message }
      }
    }

    const result = this.apply([{ op: 'setSetting', node: nodeId, symbol, value: applied }])
    if (!result.ok) return result

    if (engineId && this.#engine) this.#engine.setParameter(engineId, symbol, applied)

    this.#emit({ type: 'parameter', nodeId, symbol, value: applied })
    return { ...result, value: applied }
  }

  /**
   * Rebuild the audio links to match the compiled graph.
   *
   * The whole set is torn down and rebuilt rather than diffed. A diff is an
   * optimisation and this is the correctness-first version: after any edit the
   * links are exactly what the compiler said, with no stale delay node left
   * feeding silence into a mix because an edge moved.
   */
  /**
   * Let go of the engine nodes whose model nodes are gone.
   *
   * Removing a node from the model does not remove the AudioWorkletNode behind
   * it, and until this existed nothing did: a removed plugin kept running and
   * kept whatever the page had connected it to. Rebuilding links does not cover
   * it, because a node with no links is exactly the case.
   *
   * Driven by the model rather than by the change list, so it is right for any
   * route that removes a node, including a changeset that removes one as a side
   * effect of removing something else.
   */
  #releaseRemoved () {
    if (!this.#engine) return
    for (const [nodeId, engineId] of [...this.#nodeIds]) {
      if (this.#project.node(nodeId)) continue
      try { this.#engine.remove(engineId) } catch { /* already gone */ }
      this.#nodeIds.delete(nodeId)
    }
  }

  /**
   * Push every node's channel strip to the engine.
   *
   * Solo is resolved here because it cannot be resolved anywhere else. Whether
   * a node is heard depends on whether *any other* node is soloed, so it is a
   * property of the graph rather than of the node, and the node is the only
   * thing the engine can see one at a time.
   *
   * The rule is the one every mixer uses: if nothing is soloed, a node is heard
   * unless it is muted. If anything is soloed, only soloed nodes are heard, and
   * muting a soloed node still silences it, because a person who pressed mute
   * meant it.
   */
  #applyChannels () {
    if (!this.#engine) return
    const anySoloed = this.#project.nodes.some(n => n.channel?.soloed)

    for (const node of this.#project.nodes) {
      const engineId = this.#nodeIds.get(node.id)
      if (!engineId) continue
      const channel = node.channel ?? {}
      const silent = channel.muted === true || (anySoloed && channel.soloed !== true)
      try {
        this.#engine.setChannel(engineId, {
          gain: channel.gain ?? 1,
          pan: channel.pan ?? 0,
          silent
        })
      } catch {
        // A node quarantined or already gone is not a reason to stop setting
        // the levels of the ones that are still playing.
      }
    }
  }

  /** What a listener actually hears, node by node, after solo is resolved. */
  audibility () {
    const anySoloed = this.#project.nodes.some(n => n.channel?.soloed)
    return this.#project.nodes.map(node => {
      const channel = node.channel ?? {}
      return {
        nodeId: node.id,
        gain: channel.gain ?? 1,
        pan: channel.pan ?? 0,
        silent: channel.muted === true || (anySoloed && channel.soloed !== true)
      }
    })
  }

  /**
   * Connect everything that produces audio and feeds nothing to the speakers.
   *
   * A sink is where the signal has arrived, so it is what a person expects to
   * hear. Deriving it from the connections rather than declaring it keeps the
   * rule the project format already states for processing order: the graph
   * answers the question, and a second answer written down beside it would have
   * no rule for which wins.
   *
   * A node with no audio outputs is not a sink for this purpose even when
   * nothing follows it. A MIDI generator ends a path and produces nothing to
   * hear, and connecting it throws.
   */
  #linkSinksToMaster () {
    if (!this.#engine) return

    const feedsSomething = new Set()
    for (const connection of this.#project.connections) {
      if (isMidi(connection.signalKind)) continue
      feedsSomething.add(connection.from.node)
    }

    for (const node of this.#project.nodes) {
      if (feedsSomething.has(node.id)) continue
      const engineId = this.#nodeIds.get(node.id)
      if (!engineId) continue
      const entry = this.#engine.get(engineId)
      if (!(entry?.node?.numberOfOutputs > 0)) continue
      this.#engine.link(engineId, 'output', {})
    }
  }

  #rebuildLinks (compiled) {
    if (!this.#engine) return

    const delayFor = new Map(compiled.compensation.map(c => [c.connection, c.delayFrames]))
    this.#engine.clearLinks()

    const midiRoutes = []

    for (const connection of this.#project.connections) {
      const from = this.#nodeIds.get(connection.from.node)
      const to = this.#nodeIds.get(connection.to.node)
      // A connection between nodes that are not both loaded is in the model
      // but not yet in the audio graph, which is normal while loading.
      if (!from || !to) continue

      // A MIDI connection is not an audio edge. It is the host carrying
      // messages between two ports, so it must not reach connect().
      if (isMidi(connection.signalKind)) {
        midiRoutes.push({ from, to })
        continue
      }

      // An endpoint names its port exactly one way, and a symbol names a
      // parameter rather than an input. Passing portIndex ?? 0 for one of those
      // wired it to audio input zero, which the model allows, the shapes
      // enforce, connection_add exposes as toParameter, and nothing delivered.
      this.#engine.link(from, to, {
        fromOutput: connection.from.portIndex ?? 0,
        toInput: connection.to.portIndex ?? 0,
        toParameter: connection.to.portSymbol ?? null,
        delayFrames: delayFor.get(connection.id) ?? 0
      })
    }

    this.#linkSinksToMaster()
    this.#applyChannels()
    this.#router?.setRoutes(midiRoutes)
  }

  /**
   * Set several parameters as one edit.
   *
   * Not a loop over setParameter, which would be one revision and one compile
   * per value: a preset of thirty parameters would arrive as thirty edits, be
   * thirty entries in an undo stack, and be audible as a sweep through
   * intermediate states. Clamped first, for the same reason as the single
   * value, then written once, then pushed to the AudioParams.
   */
  setParameters (settings, { expectedRevision } = {}) {
    if (!Array.isArray(settings) || settings.length === 0) {
      return { ok: false, kind: 'change', message: 'needs a non-empty list of settings' }
    }

    const applied = []
    for (const { nodeId, symbol, value } of settings) {
      const engineId = this.#nodeIds.get(nodeId)
      let clamped = value
      if (engineId && this.#engine) {
        try {
          clamped = this.#engine.clampParameter(engineId, symbol, value)
        } catch (error) {
          return { ok: false, kind: 'change', message: error.message }
        }
      }
      applied.push({ nodeId, symbol, value: clamped, engineId })
    }

    const result = this.apply(
      applied.map(a => ({ op: 'setSetting', node: a.nodeId, symbol: a.symbol, value: a.value })),
      { expectedRevision }
    )
    if (!result.ok) return result

    for (const a of applied) {
      if (a.engineId && this.#engine) this.#engine.setParameter(a.engineId, a.symbol, a.value)
      this.#emit({ type: 'parameter', nodeId: a.nodeId, symbol: a.symbol, value: a.value })
    }

    return { ...result, applied: applied.map(({ nodeId, symbol, value }) => ({ nodeId, symbol, value })) }
  }

  /** Set any of a node's channel strip: gain, pan, mute, solo. */
  setChannel (nodeId, change, { expectedRevision } = {}) {
    return this.apply([{ op: 'setChannel', node: nodeId, ...change }], { expectedRevision })
  }

  /** The engine node behind a model node, if it has been loaded. */
  engineNode (nodeId) {
    const engineId = this.#nodeIds.get(nodeId)
    return engineId && this.#engine ? this.#engine.get(engineId) : null
  }

  /** Compile without changing anything, for diagnostics. */
  compile () {
    return compileGraph(this.#project, { latencyOf: id => this.#latencyOf(id) })
  }
}
