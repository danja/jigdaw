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
import { compileGraph } from '../compiler/GraphCompiler.js'

export class OpDispatcher {
  #project
  #engine
  #listeners = new Set()
  #nodeIds = new Map()

  constructor ({ project = new Project(), engine = null } = {}) {
    this.#project = project
    this.#engine = engine
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

    const result = this.#project.apply(changes, { expectedRevision })
    this.#rebuildLinks(compiled)
    this.#emit({ type: 'changed', revision: result.revision, results: result.results, compiled })
    return { ok: true, applied: true, revision: result.revision, results: result.results, compiled }
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
  async addPlugin (iri, { position } = {}) {
    if (!this.#engine) throw new Error('no engine: this dispatcher can edit a project but not play it')

    let entry
    try {
      entry = await this.#engine.addPlugin(iri)
    } catch (error) {
      return { ok: false, kind: 'load', step: error.step ?? null, message: error.message }
    }

    const result = this.apply([{ op: 'addNode', pluginIri: iri, label: entry.profile.label }])
    if (!result.ok) {
      // The model refused it, so the engine must not keep it either.
      this.#engine.remove(entry.id)
      return result
    }

    const nodeId = result.results[0]
    this.#nodeIds.set(nodeId, entry.id)
    if (position) this.#project.moveNode(nodeId, position.x, position.y)

    this.#emit({ type: 'plugin-added', nodeId, entry })
    return { ...result, nodeId, entry }
  }

  /** Set a parameter. Goes to the model and the AudioParam, never a message. */
  setParameter (nodeId, symbol, value) {
    const result = this.apply([{ op: 'setSetting', node: nodeId, symbol, value }])
    if (!result.ok) return result

    let applied = value
    const engineId = this.#nodeIds.get(nodeId)
    if (engineId && this.#engine) applied = this.#engine.setParameter(engineId, symbol, value)

    // The engine clamps to the declared range, so the model records what was
    // actually applied rather than what was asked for. messaging.md 2.3: a
    // surface renders what it is told, not what it requested.
    if (applied !== value) this.#project.apply([{ op: 'setSetting', node: nodeId, symbol, value: applied }])

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
  #rebuildLinks (compiled) {
    if (!this.#engine) return

    const delayFor = new Map(compiled.compensation.map(c => [c.connection, c.delayFrames]))
    this.#engine.clearLinks()

    for (const connection of this.#project.connections) {
      const from = this.#nodeIds.get(connection.from.node)
      const to = this.#nodeIds.get(connection.to.node)
      // A connection between nodes that are not both loaded is in the model
      // but not yet in the audio graph, which is normal while loading.
      if (!from || !to) continue
      this.#engine.link(from, to, {
        fromOutput: connection.from.portIndex ?? 0,
        toInput: connection.to.portIndex ?? 0,
        delayFrames: delayFor.get(connection.id) ?? 0
      })
    }
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
