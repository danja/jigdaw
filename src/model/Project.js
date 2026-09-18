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

const DEFAULT_CHANNEL = Object.freeze({ gain: 1, pan: 0, muted: false, soloed: false })

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

/**
 * Whether a plugin IRI can be loaded.
 *
 * https everywhere, and http on loopback.
 *
 * The loopback exception is not a relaxation of the rule. A browser treats
 * http://localhost as a secure context precisely because it cannot be
 * intercepted, and every other secure-context feature is available there for
 * the same reason. Without it the only way to develop a plugin is to deploy it,
 * which is the opposite of what a local host is for.
 */
export function isLoadableIRI (value) {
  let url
  try { url = new URL(String(value)) } catch { return false }
  if (url.protocol === 'https:') return true
  if (url.protocol !== 'http:') return false
  return url.hostname === 'localhost' ||
    url.hostname === '127.0.0.1' ||
    url.hostname === '[::1]' ||
    url.hostname === '::1' ||
    url.hostname.endsWith('.localhost')
}

// What makes two connections the same connection.
//
// The signal kind is part of the identity, not decoration. An audio edge and a
// host-routed MIDI edge between the same two port coordinates are different
// edges handled by entirely different machinery, one by Web Audio and one by the
// event router, and a plugin that both takes MIDI and takes audio on port 0 is
// ordinary. Leaving the kind out made the second of the two a duplicate.
const connectionKey = c =>
  `${c.signalKind}|${c.from.node}:${c.from.portIndex ?? c.from.portSymbol}` +
  `->${c.to.node}:${c.to.portIndex ?? c.to.portSymbol}`

const cloneState = state => ({
  nodes: new Map([...state.nodes].map(([id, n]) => [id, { ...n, settings: new Map(n.settings), channel: { ...n.channel } }])),
  connections: new Map([...state.connections].map(([id, c]) => [id, { ...c, from: { ...c.from }, to: { ...c.to } }])),
  transport: { ...state.transport, tempoPoints: state.transport.tempoPoints.map(p => ({ ...p })) }
})

const OPERATIONS = {
  addNode (state, change, counters) {
    if (!change.pluginIri) throw new Error('needs a pluginIri')
    if (!isLoadableIRI(change.pluginIri)) {
      // project-format.md: what lets a project be reopened on a machine that
      // has never seen the plugin.
      throw new Error(`pluginIri must be an https IRI, or http on localhost: ${change.pluginIri}`)
    }
    const id = change.id ?? `node-${++counters.node}`
    if (state.nodes.has(id)) throw new Error(`node already exists: ${id}`)
    noteExplicitId(counters, 'node', 'node', id)
    state.nodes.set(id, {
      id,
      pluginIri: change.pluginIri,
      label: change.label ?? null,
      settings: new Map(Object.entries(change.settings ?? {})),
      state: change.state ?? null,
      // The channel strip. Host services rather than plugin parameters: no
      // lv2:port declares them, and solo is a property of the graph rather
      // than of one node. Defaults are unity, centre, heard.
      channel: { ...DEFAULT_CHANNEL, ...(change.channel ?? {}) }
    })
    return id
  },

  /**
   * Remove a node, and optionally rejoin what it stood between.
   *
   * `heal` is off by default, so a changeset means what it says. With it on, a
   * node removed from the middle of a path is rejoined rather than leaving two
   * fragments and no way in the interface to put them back together.
   *
   * It heals only where there is one obvious answer: exactly one incoming and
   * exactly one outgoing edge of the same signal kind. That covers a chain,
   * which is the case a person is looking at when they press Remove. Anything
   * else, a node with several inputs or several outputs, has no single right
   * answer and guessing at one would silently rewire a graph somebody built.
   */
  removeNode (state, change, counters) {
    if (!state.nodes.has(change.id)) throw new Error(`no such node: ${change.id}`)

    const rejoined = []
    if (change.heal) {
      const incoming = new Map()
      const outgoing = new Map()
      for (const connection of state.connections.values()) {
        if (connection.to.node === change.id) {
          const list = incoming.get(connection.signalKind) ?? []
          list.push(connection)
          incoming.set(connection.signalKind, list)
        }
        if (connection.from.node === change.id) {
          const list = outgoing.get(connection.signalKind) ?? []
          list.push(connection)
          outgoing.set(connection.signalKind, list)
        }
      }
      for (const [signalKind, before] of incoming) {
        const after = outgoing.get(signalKind) ?? []
        if (before.length !== 1 || after.length !== 1) continue
        rejoined.push({
          from: { ...before[0].from },
          to: { ...after[0].to },
          signalKind
        })
      }
    }

    state.nodes.delete(change.id)
    // A connection to a node that is gone is not a connection. Removing them
    // here rather than leaving them dangling means the graph is always
    // compilable, which is the property the compiler is allowed to assume.
    for (const [key, connection] of [...state.connections]) {
      if (connection.from.node === change.id || connection.to.node === change.id) {
        state.connections.delete(key)
      }
    }

    // After the deletion, so a rejoin cannot collide with an edge that is on its
    // way out, and through addConnection so it is subject to the same checks as
    // any other edge rather than written straight into the map.
    for (const join of rejoined) {
      try { OPERATIONS.addConnection(state, join, counters) } catch {
        // The two ends were already joined directly, which is not a failure:
        // the path is intact, which is all healing was for.
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

  /**
   * Set any of a node's channel strip.
   *
   * One operation for the four rather than one each, because a person moving a
   * fader and a person pressing mute are the same kind of edit and a preset
   * setting all four is one edit rather than four.
   */
  setChannel (state, change) {
    const node = state.nodes.get(change.node)
    if (!node) throw new Error(`no such node: ${change.node}`)

    const next = { ...node.channel }
    if (change.gain !== undefined) {
      if (!Number.isFinite(change.gain) || change.gain < 0) {
        // A negative gain is an inverted signal, which is a plugin's job.
        throw new Error(`gain must be a number at or above zero: ${change.gain}`)
      }
      next.gain = change.gain
    }
    if (change.pan !== undefined) {
      if (!Number.isFinite(change.pan) || change.pan < -1 || change.pan > 1) {
        throw new Error(`pan must be between -1 and 1: ${change.pan}`)
      }
      next.pan = change.pan
    }
    if (change.muted !== undefined) next.muted = Boolean(change.muted)
    if (change.soloed !== undefined) next.soloed = Boolean(change.soloed)

    node.channel = next
    return change.node
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
        channel: { ...n.channel },
        position: this.position(n.id)
      })),
      connections: this.connections.map(c => ({ ...c, from: { ...c.from }, to: { ...c.to } })),
      transport: { ...this.#state.transport, tempoPoints: this.#state.transport.tempoPoints.map(p => ({ ...p })) }
    }
  }
}
