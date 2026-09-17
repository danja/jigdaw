// src/model/Project.js
//
// The session: nodes, connections, parameter settings and transport, as
// docs/project-format.md describes them.
//
// Two rules from that document are structural here rather than advisory.
//
// A changeset is atomic. Every operation is validated against a copy and the
// copy is swapped in only if all of them succeed, so a graph is never left
// half-edited. webmcp.md requires this and the reason is that a chain that
// failed halfway is worse than one that was never touched.
//
// Editor metadata is held apart from execution metadata and does not bump the
// revision. Dragging a node must not invalidate a compiled audio graph: if
// position and topology share a revision, every layout change looks like a
// project change, conflicts with concurrent edits and invalidates caches, and
// the cost is paid continuously.

export class RevisionConflict extends Error {
  constructor (expected, actual) {
    super(`project has moved on: expected revision ${expected}, current is ${actual}`)
    this.name = 'RevisionConflict'
    this.expected = expected
    this.actual = actual
  }
}

export class ChangeError extends Error {
  constructor (index, op, message) {
    super(`change ${index} (${op}): ${message}`)
    this.name = 'ChangeError'
    this.index = index
    this.op = op
  }
}

const DEFAULT_TRANSPORT = Object.freeze({
  playing: false,
  beatsPerBar: 4,
  beatUnit: 4,
  loopStart: 0,
  loopEnd: 0,
  loopEnabled: false,
  tempoPoints: [{ atBeat: 0, bpm: 120 }]
})

/** An endpoint names its port exactly one way. project-format.md, sh:xone. */
function checkEndpoint (state, endpoint, what) {
  if (!endpoint || typeof endpoint !== 'object') throw new Error(`${what} is missing`)
  if (!state.nodes.has(endpoint.node)) throw new Error(`${what} names no such node: ${endpoint.node}`)

  const hasIndex = endpoint.portIndex !== undefined && endpoint.portIndex !== null
  const hasSymbol = endpoint.portSymbol !== undefined && endpoint.portSymbol !== null
  if (hasIndex === hasSymbol) {
    throw new Error(`${what} must give exactly one of portIndex, for an audio or MIDI port, or portSymbol, for a parameter`)
  }
  if (hasIndex && (!Number.isInteger(endpoint.portIndex) || endpoint.portIndex < 0)) {
    throw new Error(`${what} has a portIndex that is not a non-negative integer`)
  }
}

/**
 * Keep the id counter ahead of ids it did not mint.
 *
 * A project loaded from a file, or replayed into a copy, arrives carrying ids
 * of the same shape the counter produces. Without this, the next minted id
 * collides with one already there, and the failure appears on an unrelated
 * later edit rather than at the load.
 */
function noteExplicitId (counters, prefix, counterKey, id) {
  const minted = new RegExp(`^${prefix}-(\\d+)$`).exec(id)
  if (minted) counters[counterKey] = Math.max(counters[counterKey], Number(minted[1]))
}

const connectionKey = c =>
  `${c.from.node}:${c.from.portIndex ?? c.from.portSymbol}->${c.to.node}:${c.to.portIndex ?? c.to.portSymbol}`

const cloneState = state => ({
  nodes: new Map([...state.nodes].map(([id, n]) => [id, { ...n, settings: new Map(n.settings) }])),
  connections: new Map([...state.connections].map(([id, c]) => [id, { ...c, from: { ...c.from }, to: { ...c.to } }])),
  transport: { ...state.transport, tempoPoints: state.transport.tempoPoints.map(p => ({ ...p })) }
})

const OPERATIONS = {
  addNode (state, change, counters) {
    if (!change.pluginIri) throw new Error('needs a pluginIri')
    if (!/^https:\/\//.test(change.pluginIri)) {
      // project-format.md: what lets a project be reopened on a machine that
      // has never seen the plugin.
      throw new Error(`pluginIri must be a dereferenceable https IRI: ${change.pluginIri}`)
    }
    const id = change.id ?? `node-${++counters.node}`
    if (state.nodes.has(id)) throw new Error(`node already exists: ${id}`)
    noteExplicitId(counters, 'node', 'node', id)
    state.nodes.set(id, {
      id,
      pluginIri: change.pluginIri,
      label: change.label ?? null,
      settings: new Map(Object.entries(change.settings ?? {})),
      state: change.state ?? null
    })
    return id
  },

  removeNode (state, change) {
    if (!state.nodes.has(change.id)) throw new Error(`no such node: ${change.id}`)
    state.nodes.delete(change.id)
    // A connection to a node that is gone is not a connection. Removing them
    // here rather than leaving them dangling means the graph is always
    // compilable, which is the property the compiler is allowed to assume.
    for (const [key, connection] of [...state.connections]) {
      if (connection.from.node === change.id || connection.to.node === change.id) {
        state.connections.delete(key)
      }
    }
    return change.id
  },

  addConnection (state, change, counters) {
    checkEndpoint(state, change.from, 'from')
    checkEndpoint(state, change.to, 'to')
    if (!change.signalKind) {
      // An audio edge and a host-routed MIDI edge look identical in the graph
      // and are handled by different machinery.
      throw new Error('needs a signalKind')
    }
    const key = connectionKey(change)
    for (const existing of state.connections.values()) {
      if (connectionKey(existing) === key) throw new Error('that connection already exists')
    }
    const id = change.id ?? `conn-${++counters.connection}`
    noteExplicitId(counters, 'conn', 'connection', id)
    state.connections.set(id, {
      id,
      from: { ...change.from },
      to: { ...change.to },
      signalKind: change.signalKind,
      delayFrames: change.delayFrames ?? 0
    })
    return id
  },

  removeConnection (state, change) {
    if (!state.connections.has(change.id)) throw new Error(`no such connection: ${change.id}`)
    state.connections.delete(change.id)
    return change.id
  },

  setSetting (state, change) {
    const node = state.nodes.get(change.node)
    if (!node) throw new Error(`no such node: ${change.node}`)
    if (!change.symbol) throw new Error('needs a symbol')
    if (!Number.isFinite(change.value)) throw new Error(`value is not a number: ${change.value}`)
    node.settings.set(change.symbol, change.value)
    return change.symbol
  },

  setNodeState (state, change) {
    const node = state.nodes.get(change.node)
    if (!node) throw new Error(`no such node: ${change.node}`)
    node.state = change.state ?? null
    return change.node
  },

  setTransport (state, change) {
    const next = { ...state.transport }
    for (const key of ['beatsPerBar', 'beatUnit', 'loopStart', 'loopEnd', 'loopEnabled', 'playing']) {
      if (change[key] !== undefined) next[key] = change[key]
    }
    if (change.tempoPoints) {
      if (!Array.isArray(change.tempoPoints) || change.tempoPoints.length === 0) {
        throw new Error('tempoPoints must be a non-empty array')
      }
      for (const point of change.tempoPoints) {
        if (!(point.bpm > 0)) throw new Error(`a tempo point needs a bpm greater than zero: ${point.bpm}`)
        if (!(point.atBeat >= 0)) throw new Error(`a tempo point needs atBeat at or after zero: ${point.atBeat}`)
      }
      // Keyed by beat, which is what orders the map. No list to keep in order.
      next.tempoPoints = [...change.tempoPoints].sort((a, b) => a.atBeat - b.atBeat)
    }
    if (next.loopEnabled && !(next.loopEnd > next.loopStart)) {
      throw new Error('a loop must start before it ends')
    }
    state.transport = next
    return 'transport'
  }
}

export class Project {
  #revision = 0
  #state = { nodes: new Map(), connections: new Map(), transport: { ...DEFAULT_TRANSPORT } }
  #counters = { node: 0, connection: 0 }
  // Editor metadata, deliberately outside the state a revision covers.
  #positions = new Map()
  #label = null

  get revision () { return this.#revision }
  get label () { return this.#label }
  set label (value) { this.#label = value }

  get nodes () { return [...this.#state.nodes.values()] }
  get connections () { return [...this.#state.connections.values()] }
  get transport () { return this.#state.transport }

  node (id) { return this.#state.nodes.get(id) ?? null }
  connection (id) { return this.#state.connections.get(id) ?? null }

  /** Position is editor metadata and never bumps the revision. */
  position (id) { return this.#positions.get(id) ?? { x: 0, y: 0 } }
  moveNode (id, x, y) {
    if (!this.#state.nodes.has(id)) throw new Error(`no such node: ${id}`)
    this.#positions.set(id, { x, y })
  }

  /**
   * Apply a changeset atomically.
   *
   * Returns { revision, results, applied }. With dryRun the project is
   * untouched and `applied` is false, which is how an agent checks a chain
   * before committing it.
   */
  apply (changes, { expectedRevision, dryRun = false } = {}) {
    if (!Array.isArray(changes)) throw new TypeError('changes must be an array')
    if (expectedRevision !== undefined && expectedRevision !== this.#revision) {
      throw new RevisionConflict(expectedRevision, this.#revision)
    }

    const draft = cloneState(this.#state)
    const counters = { ...this.#counters }
    const results = []

    changes.forEach((change, index) => {
      const operation = OPERATIONS[change.op]
      if (!operation) throw new ChangeError(index, change.op ?? 'undefined', 'unknown operation')
      try {
        results.push(operation(draft, change, counters))
      } catch (error) {
        throw new ChangeError(index, change.op, error.message)
      }
    })

    if (dryRun) return { revision: this.#revision, results, applied: false }

    this.#state = draft
    this.#counters = counters
    this.#revision += 1

    // A node that has gone takes its editor metadata with it.
    for (const id of [...this.#positions.keys()]) {
      if (!this.#state.nodes.has(id)) this.#positions.delete(id)
    }

    return { revision: this.#revision, results, applied: true }
  }

  /** A plain snapshot, for serialisation or for handing to an agent. */
  snapshot () {
    return {
      label: this.#label,
      revision: this.#revision,
      nodes: this.nodes.map(n => ({
        id: n.id,
        pluginIri: n.pluginIri,
        label: n.label,
        settings: Object.fromEntries(n.settings),
        state: n.state,
        position: this.position(n.id)
      })),
      connections: this.connections.map(c => ({ ...c, from: { ...c.from }, to: { ...c.to } })),
      transport: { ...this.#state.transport, tempoPoints: this.#state.transport.tempoPoints.map(p => ({ ...p })) }
    }
  }
}
