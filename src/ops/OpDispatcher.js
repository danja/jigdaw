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
import { Project, changesFor } from '../model/Project.js'
import { unroutableChange, failureResult } from './ChangesetChecks.js'
import { compileGraph } from '../compiler/GraphCompiler.js'
import { EventRouter } from '../engine/EventRouter.js'
import { EngineWiring } from './EngineWiring.js'
import { ParameterOps } from './ParameterOps.js'
import { PluginEdits } from './PluginEdits.js'
import { PluginLoading } from './PluginLoading.js'
import { EventDelivery } from './EventDelivery.js'
import { LatencyOps } from './LatencyOps.js'
import { expandComposites } from './CompositeExpansion.js'
import { Transport } from '../engine/Transport.js'
import { Inspections } from '../host/Inspections.js'
import { UndoHistory } from './UndoHistory.js'
import { stepLabel } from './StepLabel.js'

/** Whether two snapshots say the same, ignoring the revision, which counts edits and not content. */
const sameContent = (a, b) => JSON.stringify({ ...a, revision: 0 }) === JSON.stringify({ ...b, revision: 0 })

export class OpDispatcher {
  #project
  #engine
  #listeners = new Set()
  #nodeIds = new Map()
  // A composite plugin is one model node and several engine nodes (docs/nested-plugins.md). Its entry is held
  // here by node id, and each member's engine id by its flat id, which is the id the compiler and the engine
  // links use. `#nodeIds` keeps only plain nodes, so what read it before reads the same thing.
  #composites = new Map()
  #memberIds = new Map()
  #router = null
  #inspections

  #foreign

  // The stacks and the snapshot-to-snapshot reconciliation live in
  // UndoHistory. Nothing is recorded while #unrecorded is above zero, which is how
  // undo and redo call back into apply()/addPlugin() to do the actual work
  // without recording their own reversal as a new edit.
  #history = new UndoHistory()
  // A count and not a flag, so a group inside an undo, or an unrecorded firing during a group, ends only
  // its own suppression and never another's.
  #unrecorded = 0
  #wiringHeld = 0
  #wiring
  #latency
  #parameters
  #edits
  #loading
  #delivery

  constructor ({ project = new Project(), engine = null, foreign = null, inspections = new Inspections(), alignTracks = false } = {}) {
    this.#project = project
    // Whether tracks with less latency are delayed to line up with the slowest.
    // False here so a caller that says nothing changes nothing; the page passes
    // what web/host.json and the person's own choice say.
    this.#engine = engine
    // Contract section 12. Absent by default: a host that supports no foreign
    // plugins conforms, and refusing is the safe default, so this has to be
    // handed in rather than assumed.
    this.#foreign = foreign
    // Contract section 10.3: a host SHOULD record load outcomes. Present by
    // default, unlike #foreign, because recording is what the section asks
    // for rather than an optional capability; Inspections itself no-ops
    // where there is no storage to write to (a test, a worker).
    this.#inspections = inspections
    const self = this
    this.#latency = new LatencyOps({
      get engine () { return self.#engine },
      get project () { return self.#project },
      composites: this.#composites,
      engineIdOf: id => self.#engineIdOf(id),
      compile: () => self.compile(),
      emit: event => self.#emit(event)
    }, { alignTracks })
    this.#wiring = new EngineWiring({
      get engine () { return self.#engine },
      get project () { return self.#project },
      get router () { return self.#router },
      engineIdOf: id => self.#engineIdOf(id),
      engineNode: id => self.engineNode(id),
      isComposite: id => self.#composites.has(id),
      compositeMidiEnds: (id, direction) => self.#delivery.compositeMidiEnds(id, direction),
      expand: (nodes, connections, options) => self.#expand(nodes, connections, options),
      applyTrackDelays: compiled => self.#latency.applyTrackDelays(compiled),
      audibility: () => self.audibility(),
      setCompensation: map => self.#latency.setCompensation(map)
    })
    this.#parameters = new ParameterOps({
      get engine () { return self.#engine },
      nodeIds: this.#nodeIds,
      memberIds: this.#memberIds,
      composites: this.#composites,
      apply: (changes, options) => self.apply(changes, options),
      emit: event => self.#emit(event),
      engineNode: id => self.engineNode(id)
    })
    this.#edits = new PluginEdits({
      get project () { return self.#project },
      get engine () { return self.#engine },
      composites: this.#composites,
      grouped: (fn, options) => self.grouped(fn, options),
      apply: (changes, options) => self.apply(changes, options),
      addPlugin: (iri, node) => self.addPlugin(iri, node),
      setParameter: (id, symbol, value) => self.setParameter(id, symbol, value),
      getNodeState: id => self.getNodeState(id),
      engineNode: id => self.engineNode(id)
    })
    this.#delivery = new EventDelivery({
      get router () { return self.#router },
      get engine () { return self.#engine },
      get project () { return self.#project },
      nodeIds: this.#nodeIds,
      memberIds: this.#memberIds,
      composites: this.#composites,
      expand: (nodes, connections, options) => self.#expand(nodes, connections, options)
    })
    this.#loading = new PluginLoading({
      get engine () { return self.#engine },
      get project () { return self.#project },
      get router () { return self.#router },
      get foreign () { return self.#foreign },
      get inspections () { return self.#inspections },
      nodeIds: this.#nodeIds,
      memberIds: this.#memberIds,
      composites: this.#composites,
      apply: (changes, options) => self.apply(changes, options),
      emit: event => self.#emit(event),
      rebuildLinks: () => self.#rebuildLinks(self.compile()),
      onLatency: (nodeId, engineId, message, outerNodeId) => self.#latency.onLatency(nodeId, engineId, message, outerNodeId)
    })
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

  // MIDI delivery and plugin messages are in EventDelivery.js; the dispatcher keeps the names callers use.
  midiActivity (connectionId) { return this.#delivery.midiActivity(connectionId) }
  sendEvents (nodeId, events) { return this.#delivery.sendEvents(nodeId, events) }
  relayToPlugin (nodeId, payload) { return this.#delivery.relayToPlugin(nodeId, payload) }
  onPluginMessage (nodeId, handler) { return this.#delivery.onPluginMessage(nodeId, handler) }

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

  // Latency and track alignment are in LatencyOps.js; the dispatcher keeps the names callers use.
  /** Whether tracks are aligned to one another. */
  get alignTracks () { return this.#latency.alignTracks }
  setAlignTracks (on) { this.#latency.setAlignTracks(on) }
  trackLatencies () { return this.#latency.trackLatencies() }

  /** The engine node behind a flat id: a plain node, or a member of a composite. */
  #engineIdOf (flatId) {
    return this.#nodeIds.get(flatId) ?? this.#memberIds.get(flatId)
  }

  /** The nodes and connections the compiler and the engine see: composites replaced by their members. */
  #expand (nodes, connections, { bypassed = () => false } = {}) {
    return expandComposites({
      nodes: nodes.map(n => ({ id: n.id })),
      connections,
      treeOf: id => this.#composites.get(id)?.entry.tree ?? null,
      bypassed
    })
  }

  /** compileGraph over a project, after expansion. `project` may be a trial copy. */
  #compileProject (project) {
    const flat = this.#expand(project.nodes, project.connections)
    return compileGraph({ nodes: flat.nodes, connections: flat.connections }, { latencyOf: id => this.#latency.latencyOf(id) })
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
    const unroutable = unroutableChange(changes, id => this.engineNode(id)?.profile)
    if (unroutable) {
      return { ok: false, kind: 'change', revision: this.#project.revision, message: unroutable }
    }

    try {
      // Validate the changes, without committing, so a bad change is reported
      // before anything is compiled.
      this.#project.apply(changes, { expectedRevision, dryRun: true })
    } catch (error) {
      return failureResult(error, this.#project.revision)
    }

    // Commit to a scratch project to see what the graph would become.
    const trial = this.#clone()
    trial.apply(changes)
    const compiled = this.#compileProject(trial)

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
    // #unrecorded is above zero: undo and redo call back into this same apply()
    // through #restoreTo, and their own reversal is not a new edit.
    const before = this.#unrecorded === 0 ? this.#project.snapshot() : null

    const result = this.#project.apply(changes, { expectedRevision })
    this.#releaseRemoved()
    this.#rebuildLinks(compiled)

    if (before) this.#history.record(before, stepLabel(changes))

    this.#emit({ type: 'changed', revision: result.revision, results: result.results, compiled })
    return { ok: true, applied: true, revision: result.revision, results: result.results, compiled }
  }

  /** What the history holds in words, for a list of steps: see UndoHistory.labels(). */
  history () { return this.#history.labels() }

  /** Whether there is an edit to step back from. */
  canUndo () { return this.#history.canUndo() }

  /** Whether there is an edit undo last stepped back from to step forward to. */
  canRedo () { return this.#history.canRedo() }

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
    this.#history.clear()
  }

  /**
   * Step the project back to how it was before the last recorded edit.
   *
   * Async, unlike apply(): a node removed since the snapshot being restored to
   * is not data the model can conjure back, it is an instantiated plugin, and
   * bringing it back means reloading it, contract section 3.1 start to
   * finish. Most edits touch no such node and this still returns a promise,
   * so a caller does not need to know in advance which kind of edit it was
   * undoing. The stack bookkeeping and the snapshot-to-snapshot reconciliation
   * are UndoHistory's; this dispatcher is the host it calls back into.
   */
  async undo () {
    return this.#history.undo(this)
  }

  /** The inverse of undo: step forward to whatever undo last stepped back from. */
  async redo () {
    return this.#history.redo(this)
  }

  /**
   * Run fn as one undoable edit: however many edits it makes, one undo reverses them all. The snapshot is
   * taken before it starts and recorded once after it ends, and nothing inside is recorded on its own.
   * Nothing is recorded if fn changed nothing, so an empty run leaves no step to undo. A group inside a
   * group, or inside an undo, joins the one already open.
   *
   * For a script (docs/livecoding.md): the run is one group. What it schedules for later is done through
   * withoutRecording, because a performance is not a series of edits to step back over.
   */
  async grouped (fn, { label = 'Several changes' } = {}) {
    if (this.#unrecorded > 0) return fn()
    const before = this.#project.snapshot()
    const revision = this.#project.revision
    this.#unrecorded++
    try {
      return await fn()
    } finally {
      this.#unrecorded--
      // A run that ends where it began (a copy taken back after a failed load) leaves nothing to undo.
      if (this.#project.revision !== revision && !sameContent(before, this.#project.snapshot())) this.#history.record(before, label)
    }
  }

  /**
   * Run fn with recording off, so the apply()/addPlugin()/setParameter()
   * calls it makes are not themselves recorded as further undoable edits.
   * Called by UndoHistory while it reconciles the project to a snapshot; nothing
   * else needs it, but it stays on the public dispatcher rather than a private
   * field so UndoHistory can drive it without reaching into private state.
   */
  async withoutRecording (fn) {
    this.#unrecorded++
    try {
      return await fn()
    } finally {
      this.#unrecorded--
    }
  }

  /** A copy of the project, for trying a changeset without committing it. */
  #clone () {
    const copy = new Project()
    copy.apply(changesFor(this.#project.snapshot()))
    return copy
  }

  /** Load a plugin and add it as a node, on a track of its own unless `track` is given; PluginLoading.js has the detail. */
  addPlugin (iri, options) { return this.#loading.addPlugin(iri, options) }

  // Unpacking, swapping and packing are in PluginEdits.js; the dispatcher keeps the names callers use.
  unpackComposite (nodeId) { return this.#edits.unpackComposite(nodeId) }
  swapPlugin (nodeId, iri) { return this.#edits.swapPlugin(nodeId, iri) }
  packSelection (options) { return this.#edits.packSelection(options) }

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
    for (const [nodeId, composite] of [...this.#composites]) {
      if (this.#project.node(nodeId)) continue
      for (const flat of composite.flatIds) {
        try { this.#engine.remove(this.#memberIds.get(flat)) } catch { /* already gone */ }
        this.#memberIds.delete(flat)
      }
      this.#composites.delete(nodeId)
    }
  }

  /**
   * Whether each track is heard, after solo is resolved.
   *
   * Solo is resolved here because it cannot be resolved anywhere else. Whether
   * a track is heard depends on whether *any other* track is soloed, so it is a
   * property of the mix rather than of the track, and the track is the only
   * thing the engine can see one at a time.
   *
   * The rule is the one every mixer uses: if nothing is soloed, a track is heard
   * unless it is muted. If anything is soloed, only soloed tracks are heard, and
   * muting a soloed track still silences it, because a person who pressed mute
   * meant it.
   */
  audibility () {
    const tracks = this.#project.tracks
    const anySoloed = tracks.some(t => t.channel.soloed)
    return tracks.map(track => ({
      trackId: track.id,
      gain: track.channel.gain,
      pan: track.channel.pan,
      silent: track.channel.muted || (anySoloed && !track.channel.soloed)
    }))
  }
  /** Make the engine's links, strips, sends, master and routes match the model; EngineWiring has the detail. */
  #rebuildLinks (compiled) {
    // While held, nothing is connected: the single rebuild on release does it, from the model as it then stands.
    if (this.#wiringHeld > 0) return
    this.#wiring.rebuildLinks(compiled)
  }

  /**
   * Run `work` with the audio graph left unconnected, then connect everything once. Opening a session loads its
   * plugins one after another, and a plugin that is connected starts running at once, so a heavy one (a neural amp)
   * was already using the audio thread while the next plugin was still being initialised, which on a slow device
   * starved that init until it timed out. Loading first and connecting after means nothing runs until everything
   * is there. The model still changes as usual; only the engine's links wait.
   */
  async withWiringHeld (work) {
    this.#wiringHeld += 1
    try {
      return await work()
    } finally {
      this.#wiringHeld -= 1
      this.#rebuildLinks(this.compile())   // a no-op while an outer hold is still on
    }
  }



  // The parameter operations are in ParameterOps.js; the dispatcher keeps the names callers use.
  setParameter (nodeId, symbol, value) { return this.#parameters.setParameter(nodeId, symbol, value) }
  setParameters (settings, options) { return this.#parameters.setParameters(settings, options) }
  resetParameter (nodeId, symbol) { return this.#parameters.resetParameter(nodeId, symbol) }
  getNodeState (nodeId) { return this.#parameters.getNodeState(nodeId) }
  loadAsset (nodeId, key, bytes) { return this.#parameters.loadAsset(nodeId, key, bytes) }
  audioParams (nodeId, symbol) { return this.#parameters.audioParams(nodeId, symbol) }

  /** Set any of a track's channel strip: gain, pan, mute, solo. */
  setTrackChannel (trackId, change, { expectedRevision } = {}) {
    return this.apply([{ op: 'setTrackChannel', track: trackId, ...change }], { expectedRevision })
  }

  /** The engine node behind a model node, if it has been loaded. */
  engineNode (nodeId) {
    // A composite has no engine node of its own: its entry carries the profile the rest of the host reads.
    const composite = this.#composites.get(nodeId)
    if (composite) return composite.entry
    const engineId = this.#nodeIds.get(nodeId)
    return engineId && this.#engine ? this.#engine.get(engineId) : null
  }

  /** Compile without changing anything, for diagnostics. */
  compile () {
    return this.#compileProject(this.#project)
  }
}
