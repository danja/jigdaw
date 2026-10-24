// src/ops/EventDelivery.js
//
// Getting events to and from a plugin outside the audio graph's own links: MIDI delivered into a node as if from outside (a keyboard, the
// scheduler), what went over a MIDI connection (for a monitor), and the opaque payloads between a plugin's interface and its processor
// (docs/messaging.md 2.4). A composite is read at its boundary: MIDI into it goes to whatever its MIDI input is wired to inside. None of it is
// an operation: nothing the project records changes. Handed what it reads through `host`:
//
//   router, engine, project            read each time (a router or an engine may not exist)
//   nodeIds, memberIds, composites     the dispatcher's maps from model nodes to engine nodes
//   expand(nodes, connections)         composites replaced by their members
import { isMidi } from '../engine/EventRouter.js'

export class EventDelivery {
  #host

  constructor (host) { this.#host = host }

  /**
   * The last few MIDI events that went over one connection, oldest first, as `{ frame, bytes }`: what
   * a monitor shows. Empty for an audio connection, one not wired (a bypassed end, a plugin not
   * loaded), or one nothing has gone over.
   */
  midiActivity (connectionId) {
    const connection = this.#host.project.connection(connectionId)
    if (!connection || !isMidi(connection.signalKind) || !this.#host.router) return []
    const from = this.#host.nodeIds.get(connection.from.node)
    const to = this.#host.nodeIds.get(connection.to.node)
    return from && to ? this.#host.router.recent(from, to) : []
  }

  /**
   * The engine nodes a composite's MIDI boundary is wired to inside: where MIDI delivered into it goes
   * (`'in'`), or what makes the MIDI that leaves it (`'out'`). Found by expanding a connection between the
   * composite and nowhere, so the boundary is read by the same code that wires the engine. Empty when the
   * composite has no MIDI boundary in that direction.
   */
  compositeMidiEnds (nodeId, direction) {
    const composite = this.#host.composites.get(nodeId)
    const own = composite.entry.iri
    const boundary = composite.entry.tree.composite.connections
      .find(c => (direction === 'in' ? c.from.node === own : c.to.node === own) && isMidi(c.signalKind))
    if (!boundary) return []
    const probe = '\u0000outside'
    const edge = direction === 'in'
      ? { from: { node: probe, portIndex: 0 }, to: { node: nodeId, portIndex: 0 } }
      : { from: { node: nodeId, portIndex: 0 }, to: { node: probe, portIndex: 0 } }
    const { connections } = this.#host.expand([{ id: probe }, { id: nodeId }], [{ id: probe, ...edge, signalKind: boundary.signalKind }])
    // Only the connection to or from nowhere: the expansion also returns the composite's own wiring, whose ends are
    // members that are not the boundary, and MIDI delivered to those would skip the plugins in front of them.
    const crossing = connections.filter(c => (direction === 'in' ? c.from.node === probe : c.to.node === probe))
    return crossing.map(c => this.#host.memberIds.get(direction === 'in' ? c.to.node : c.from.node)).filter(Boolean)
  }

  /** Deliver MIDI into a node, as if from outside the graph. */
  sendEvents (nodeId, events) {
    if (!this.#host.router) return false
    if (this.#host.composites.has(nodeId)) {
      // Into a composite is into whatever its MIDI input is wired to inside.
      const targets = this.compositeMidiEnds(nodeId, 'in')
      for (const target of targets) this.#host.router.send(target, events)
      return targets.length > 0
    }
    const engineId = this.#host.nodeIds.get(nodeId)
    if (!engineId) return false
    this.#host.router.send(engineId, events)
    return true
  }

  /**
   * Relay an opaque payload from a plugin's own interface to its processor,
   * docs/messaging.md 2.4. Not an operation: it changes nothing the project
   * records, and the host does not read it. Throttling is the caller's, which
   * is where the interface's messages arrive.
   */
  relayToPlugin (nodeId, payload) {
    const engineId = this.#host.nodeIds.get(nodeId)
    if (!engineId || !this.#host.engine) return false
    this.#host.engine.post(engineId, { type: 'plugin', payload })
    return true
  }

  /**
   * Hear a processor's opaque payloads for its own interface. Returns an
   * unsubscribe function, or null for a node the engine has not loaded. Only
   * this node's payloads: 2.4 forbids one plugin's reaching another.
   */
  onPluginMessage (nodeId, handler) {
    const engineId = this.#host.nodeIds.get(nodeId)
    if (!engineId || !this.#host.engine) return null
    return this.#host.engine.onMessage(engineId, message => {
      if (message?.type === 'plugin') handler(message.payload)
    })
  }
}
