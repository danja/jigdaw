// src/ops/PluginLoading.js
//
// Loading a plugin into the project: fetch and instantiate it through the engine (or its foreign adapter), add the model node and its track in
// one changeset, then let the dispatcher's maps and links know about it. A composite is adopted under one model node with its members keyed by
// flat id (docs/nested-plugins.md). Loading reaches the network and can fail slowly, which does not sit well inside an atomic changeset, so it
// happens first and the node id joins the two halves. The dispatcher owns the model, the engine and the order; this is handed what it needs:
//
//   engine, project, router, foreign, inspections      read each time (an engine or a router may not exist)
//   nodeIds, memberIds, composites                     the dispatcher's maps from model nodes to engine nodes
//   apply(changes), emit(event), rebuildLinks()        the one way to change the model, the event stream, and compile then wire
//   onLatency(nodeId, engineId, message, outerNodeId)  a processor reporting a new latency
import { carriesNotes } from '../engine/EventRouter.js'
import { flatIdOf } from './CompositeExpansion.js'
import { decodeState } from '../host/StateCodec.js'

export class PluginLoading {
  #host

  constructor (host) { this.#host = host }

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
   *
   * Without a `track` the plugin gets a new track of its own, named after it,
   * in the same changeset, so dropping an instrument in makes a sound without a
   * second step. A plugin that accepts MIDI becomes that new track's MIDI
   * input, since it is the only node there for notes to go to. On an existing
   * track nothing is guessed: which node takes the notes is a person's call.
   */
  async addPlugin (iri, { position, foreign = false, ...node } = {}) {
    if (!this.#host.engine) throw new Error('no engine: this dispatcher can edit a project but not play it')

    let entry
    try {
      // One dispatcher, two load paths, and the branch is here rather than in
      // two callers. A foreign plugin is instantiated by its own adapter and
      // handed to the engine already built; everything after that, including
      // the model edit and the links below, is identical.
      // node.state, if this node came from a reopened session, is the
      // string jig:nodeState holds; the engine wants the real
      // structured-cloneable value a stateful plugin's own processor reads,
      // which is what it was before saveSession stringified it for RDF.
      // The model, just below, keeps the string form: writing it back out
      // unchanged is what makes a session that is never touched again save
      // byte for byte the same.
      entry = foreign
        ? await this.addForeign(iri)
        : await this.#host.engine.addPlugin(iri, { state: decodeState(node.state ?? null) })
    } catch (error) {
      // A ConsentRequired carries what a person has to be asked, so it travels
      // out intact rather than being flattened into a message. Contract section
      // 12.4: the asking happens where a person is, not in here.
      if (error.name === 'ConsentRequired') {
        return { ok: false, kind: 'consent', request: error.request, message: error.message }
      }
      // Contract section 10.3: a failed load is a recorded result, not only a
      // rejected promise. Not for ConsentRequired above: nothing was actually
      // attempted yet, so there is nothing to have observed.
      this.#host.inspections.record({ iri, outcome: `failed: ${error.message}` })
      return { ok: false, kind: 'load', step: error.step ?? null, message: error.message }
    }
    this.#host.inspections.record({ iri, outcome: 'loaded' })

    const label = node.label ?? entry.profile.label
    const changes = []
    let newTrack = null
    if (node.track === undefined || node.track === null) {
      newTrack = this.#host.project.nextId('track')
      changes.push({ op: 'addTrack', id: newTrack, label })
    }
    const nodeId = node.id ?? this.#host.project.nextId('node')
    changes.push({ op: 'addNode', ...node, id: nodeId, track: node.track ?? newTrack, pluginIri: iri, label })
    if (newTrack && (entry.profile.accepts ?? []).some(carriesNotes)) {
      changes.push({ op: 'setTrack', id: newTrack, midiInput: nodeId })
    }

    const result = this.#host.apply(changes)
    if (!result.ok) {
      // The model refused it, so the engine must not keep it either.
      for (const id of entry.composite ? entry.members.map(m => m.entry.id) : [entry.id]) this.#host.engine.remove(id)
      return result
    }

    if (entry.composite) return this.adoptComposite(nodeId, entry, { result, track: node.track ?? newTrack, position })
    this.#host.nodeIds.set(nodeId, entry.id)
    // The links were rebuilt inside that apply, when this node was in the model
    // and not yet in #nodeIds, so nothing could be wired to it. For a connection
    // that is harmless and expected, because the other end arrives later anyway.
    // For the path to the speakers it is not: a plugin loaded on its own would
    // be silent until some unrelated edit happened to rebuild the links.
    this.#host.rebuildLinks()
    // Listen from the moment it is loaded, not from the moment it is wired.
    this.#host.router?.observe(entry.id)
    // Hear latency changes the same way. Foreign nodes are excluded: a WAM
    // speaks its own latency protocol over the same port (no fromFrame), and
    // WamModule already consumes it.
    if (!foreign) {
      this.#host.engine.onMessage(entry.id, message => {
        if (message?.type === 'latency') this.#host.onLatency(nodeId, entry.id, message)
      })
    }
    if (position) this.#host.project.moveNode(nodeId, position.x, position.y)

    this.#host.emit({ type: 'plugin-added', nodeId, trackId: node.track ?? newTrack, entry })
    return { ...result, nodeId, trackId: node.track ?? newTrack, entry }
  }

  /**
   * Take a loaded composite into the graph under one model node. Its members are engine nodes keyed by flat id,
   * and everything the model says about the node (settings, bypass, track) is read through the composite's
   * exposed ports and boundary, never by reaching a member directly.
   */
  adoptComposite (nodeId, entry, { result, track, position }) {
    const flatIds = []
    for (const { path, entry: member } of entry.members) {
      const flat = flatIdOf(nodeId, path)
      flatIds.push(flat)
      this.#host.memberIds.set(flat, member.id)
    }
    this.#host.composites.set(nodeId, { entry, flatIds })
    this.#host.rebuildLinks()
    for (const [i, { entry: member }] of entry.members.entries()) {
      this.#host.router?.observe(member.id)
      this.#host.engine.onMessage(member.id, message => {
        if (message?.type === 'latency') this.#host.onLatency(flatIds[i], member.id, message, nodeId)
      })
    }
    if (position) this.#host.project.moveNode(nodeId, position.x, position.y)
    this.#host.emit({ type: 'plugin-added', nodeId, trackId: track, entry })
    return { ...result, nodeId, trackId: track, entry }
  }

  /**
   * Fetch a foreign profile, load it through its adapter, and adopt it.
   *
   * Private because there must be exactly one way into running foreign code,
   * and it is the branch in addPlugin above.
   */
  async addForeign (iri) {
    if (!this.#host.foreign) {
      throw new Error(
        'this host does not load foreign plugins. Contract section 12 is optional and ' +
        'supporting none of it conforms.')
    }
    const loaded = await this.#host.foreign.add(iri, this.#host.engine.context)
    return this.#host.engine.adopt({
      iri,
      profile: loaded.profile,
      node: loaded.node,
      ready: loaded.ready
    })
  }
}
