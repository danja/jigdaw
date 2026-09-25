// src/model/Project.js
//
// The session: tracks, nodes, connections, parameter settings and transport,
// as docs/project-format.md describes them.
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
  clips: new Map([...state.clips].map(([id, c]) => [id, { ...c, notes: c.notes.map(n => ({ ...n })) }])),
  tracks: new Map([...state.tracks].map(([id, t]) => [id, { ...t, channel: { ...t.channel } }])),
  nodes: new Map([...state.nodes].map(([id, n]) => [id, { ...n, settings: new Map(n.settings) }])),
  connections: new Map([...state.connections].map(([id, c]) => [id, { ...c, from: { ...c.from }, to: { ...c.to } }])),
  transport: { ...state.transport, tempoPoints: state.transport.tempoPoints.map(p => ({ ...p })) }
})

/** A channel strip with `change` applied, refusing values no mixer means. */
function nextChannel (channel, change) {
  const next = { ...channel }
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
  return next
}

/**
 * Check a track input names a node on that track, or is null to clear it.
 * project-format.md: the node a track's clips play into MUST be on it, or the
 * clips would sound on some other track's fader.
 */
function checkTrackInput (state, trackId, nodeId, what) {
  if (nodeId === null) return
  const node = state.nodes.get(nodeId)
  if (!node) throw new Error(`${what} names no such node: ${nodeId}`)
  if (node.track !== trackId) throw new Error(`${what} ${nodeId} is not on track ${trackId}`)
}

/**
 * Check a list of notes, project-format.md "Clips": a start at or after the
 * clip's own start, a length above zero, a MIDI pitch and a velocity MIDI
 * does not read as a note off. Returns copies, sorted by start and pitch, so
 * two lists of the same notes compare equal whatever order they came in.
 */
function checkNotes (notes) {
  if (!Array.isArray(notes)) throw new Error('notes must be an array')
  return notes.map((note, i) => {
    const { startBeat, lengthBeats, pitch, velocity } = note ?? {}
    if (!(Number.isFinite(startBeat) && startBeat >= 0)) throw new Error(`note ${i} needs a startBeat at or after zero`)
    if (!(Number.isFinite(lengthBeats) && lengthBeats > 0)) throw new Error(`note ${i} needs a lengthBeats above zero`)
    if (!(Number.isInteger(pitch) && pitch >= 0 && pitch <= 127)) throw new Error(`note ${i} needs a pitch from 0 to 127`)
    if (!(Number.isInteger(velocity) && velocity >= 1 && velocity <= 127)) {
      throw new Error(`note ${i} needs a velocity from 1 to 127; MIDI reads 0 as a note off`)
    }
    return { startBeat, lengthBeats, pitch, velocity }
  }).sort((a, b) => a.startBeat - b.startBeat || a.pitch - b.pitch)
}

/** Check a clip's placement. */
function checkPlacement (startBeat, lengthBeats) {
  if (!(Number.isFinite(startBeat) && startBeat >= 0)) throw new Error('a clip needs a startBeat at or after zero')
  if (!(Number.isFinite(lengthBeats) && lengthBeats > 0)) throw new Error('a clip needs a lengthBeats above zero')
}

/** Forget a node as any track's input. Called wherever a node leaves a track. */
function releaseInputs (state, nodeId) {
  for (const track of state.tracks.values()) {
    if (track.midiInput === nodeId) track.midiInput = null
    if (track.audioInput === nodeId) track.audioInput = null
  }
}

const OPERATIONS = {
  addTrack (state, change, counters) {
    const id = change.id ?? `track-${++counters.track}`
    if (state.tracks.has(id)) throw new Error(`track already exists: ${id}`)
    noteExplicitId(counters, 'track', 'track', id)
    // Inputs are set with setTrack once the nodes exist, never here: a new
    // track has no nodes on it for an input to name.
    state.tracks.set(id, {
      id,
      label: change.label ?? null,
      // The channel strip. Host services rather than plugin parameters: no
      // lv2:port declares them, and solo is a property of the mix rather
      // than of one track. Defaults are unity, centre, heard.
      channel: nextChannel(DEFAULT_CHANNEL, change.channel ?? {}),
      midiInput: null,
      audioInput: null
    })
    return id
  },

  /** Rename a track, or name the nodes its clips play into. */
  setTrack (state, change) {
    const track = state.tracks.get(change.id)
    if (!track) throw new Error(`no such track: ${change.id}`)
    if (change.label !== undefined) track.label = change.label
    for (const key of ['midiInput', 'audioInput']) {
      if (change[key] === undefined) continue
      checkTrackInput(state, change.id, change[key], key)
      track[key] = change[key]
    }
    return change.id
  },

  /**
   * Remove a track.
   *
   * Refused while any node is still on it, unless `moveNodesTo` names the
   * track they go to instead. Removing the nodes along with the track would be
   * one click destroying a chain somebody built, and the undo of it would have
   * to reload every plugin; a person who wants that removes the nodes first.
   *
   * Its clips go with it, or to `moveNodesTo` when that is given. A clip is
   * data rather than an instantiated plugin, so taking it away costs undo
   * nothing to restore.
   */
  removeTrack (state, change) {
    if (!state.tracks.has(change.id)) throw new Error(`no such track: ${change.id}`)
    const onIt = [...state.nodes.values()].filter(n => n.track === change.id)
    if (onIt.length > 0) {
      if (change.moveNodesTo === undefined) {
        throw new Error(`track ${change.id} still has ${onIt.length} node(s) on it; remove them or give moveNodesTo`)
      }
      if (change.moveNodesTo === change.id || !state.tracks.has(change.moveNodesTo)) {
        throw new Error(`moveNodesTo names no other track: ${change.moveNodesTo}`)
      }
      for (const node of onIt) node.track = change.moveNodesTo
    }
    for (const [id, clip] of [...state.clips]) {
      if (clip.track !== change.id) continue
      if (change.moveNodesTo !== undefined && state.tracks.has(change.moveNodesTo) && change.moveNodesTo !== change.id) {
        clip.track = change.moveNodesTo
      } else {
        state.clips.delete(id)
      }
    }
    state.tracks.delete(change.id)
    return change.id
  },

  moveNodeToTrack (state, change) {
    const node = state.nodes.get(change.id)
    if (!node) throw new Error(`no such node: ${change.id}`)
    if (!state.tracks.has(change.track)) throw new Error(`no such track: ${change.track}`)
    if (node.track === change.track) return change.id
    releaseInputs(state, change.id)
    node.track = change.track
    return change.id
  },

  /**
   * Add a clip to a track. A MIDI clip holds notes; an audio clip names the
   * file it plays by `source`, never its bytes (project-format.md "Clips").
   */
  addClip (state, change, counters) {
    if (!state.tracks.has(change.track)) throw new Error(`no such track: ${change.track}`)
    if (change.kind !== 'midi' && change.kind !== 'audio') throw new Error('kind must be midi or audio')
    checkPlacement(change.startBeat, change.lengthBeats)
    const id = change.id ?? `clip-${++counters.clip}`
    if (state.clips.has(id)) throw new Error(`clip already exists: ${id}`)
    noteExplicitId(counters, 'clip', 'clip', id)
    const clip = { id, track: change.track, kind: change.kind, startBeat: change.startBeat, lengthBeats: change.lengthBeats }
    if (change.kind === 'midi') {
      clip.notes = checkNotes(change.notes ?? [])
    } else {
      // Absolute: a reader resolves a relative jig:source against the session
      // document before it gets here, so anything relative is a mistake.
      if (typeof change.source !== 'string' || !URL.canParse(change.source)) {
        throw new Error('an audio clip needs a source, the absolute IRI of the file it plays')
      }
      const offset = change.offsetSeconds ?? 0
      if (!(Number.isFinite(offset) && offset >= 0)) throw new Error('offsetSeconds must be at or after zero')
      clip.source = change.source
      clip.offsetSeconds = offset
      clip.notes = []
    }
    state.clips.set(id, clip)
    return id
  },

  /** Move a clip in time or to another track, resize it, or change its offset. */
  setClip (state, change) {
    const clip = state.clips.get(change.id)
    if (!clip) throw new Error(`no such clip: ${change.id}`)
    const startBeat = change.startBeat ?? clip.startBeat
    const lengthBeats = change.lengthBeats ?? clip.lengthBeats
    checkPlacement(startBeat, lengthBeats)
    if (change.track !== undefined && !state.tracks.has(change.track)) throw new Error(`no such track: ${change.track}`)
    if (change.offsetSeconds !== undefined) {
      if (clip.kind !== 'audio') throw new Error('only an audio clip has an offset')
      if (!(Number.isFinite(change.offsetSeconds) && change.offsetSeconds >= 0)) throw new Error('offsetSeconds must be at or after zero')
      clip.offsetSeconds = change.offsetSeconds
    }
    clip.startBeat = startBeat
    clip.lengthBeats = lengthBeats
    if (change.track !== undefined) clip.track = change.track
    return change.id
  },

  /**
   * Replace a MIDI clip's notes. The whole list at once, so one gesture in a
   * piano roll, or one agent's phrase, is one edit and one undo.
   */
  setClipNotes (state, change) {
    const clip = state.clips.get(change.id)
    if (!clip) throw new Error(`no such clip: ${change.id}`)
    if (clip.kind !== 'midi') throw new Error(`clip ${change.id} is audio and holds no notes`)
    clip.notes = checkNotes(change.notes)
    return change.id
  },

  removeClip (state, change) {
    if (!state.clips.has(change.id)) throw new Error(`no such clip: ${change.id}`)
    state.clips.delete(change.id)
    return change.id
  },

  addNode (state, change, counters) {
    if (!change.pluginIri) throw new Error('needs a pluginIri')
    if (!isLoadableIRI(change.pluginIri)) {
      // project-format.md: what lets a project be reopened on a machine that
      // has never seen the plugin.
      throw new Error(`pluginIri must be an https IRI, or http on localhost: ${change.pluginIri}`)
    }
    // project-format.md: every node is on exactly one track, which is where
    // its sound goes. A node on none would be heard by nobody.
    if (!change.track) throw new Error('needs a track')
    if (!state.tracks.has(change.track)) throw new Error(`no such track: ${change.track}`)
    const id = change.id ?? `node-${++counters.node}`
    if (state.nodes.has(id)) throw new Error(`node already exists: ${id}`)
    noteExplicitId(counters, 'node', 'node', id)
    state.nodes.set(id, {
      id,
      pluginIri: change.pluginIri,
      label: change.label ?? null,
      track: change.track,
      settings: new Map(Object.entries(change.settings ?? {})),
      state: change.state ?? null
    })
    return id
  },

  /**
   * Move a node to a new position among the others, healing the direct
   * link(s) it stood between the same way `removeNode`'s heal does. Node
   * order is otherwise display only (the compiler reads connections, never
   * this order), so this is the one place order and topology change
   * together, on purpose: TODO.md decided a drag in the rack means the
   * signal path moves, not only the drawing.
   *
   * Healing acts only on a direct link between exactly the two nodes
   * involved, the same "one obvious answer" restriction `removeNode`'s heal
   * uses, and for the same reason: a node with several inputs or outputs at
   * that point has no single right rewiring and guessing at one would
   * silently rewire a graph somebody built.
   *
   * Deliberately not attempted: splicing the node into whatever direct link
   * joins its new neighbours. A first version guessed port 0 on the moved
   * node for that, which is exactly the kind of guess this file otherwise
   * refuses to make, and it broke on the first plugin with no such port: an
   * uncaught IndexSizeError out of the real Web Audio graph, past every
   * check `addConnection` normally goes through, because the model has no
   * profile to check a guessed port against
   * (OpDispatcher.apply's own comment says why: "the model checks the shape
   * of an endpoint and cannot check more"). A node landing in a new
   * position is simply unwired there, exactly like a freshly added one,
   * for a person to connect deliberately.
   */
  reorderNode (state, change, counters) {
    if (!state.nodes.has(change.id)) throw new Error(`no such node: ${change.id}`)
    if (!Number.isInteger(change.index) || change.index < 0) throw new Error('needs a non-negative integer index')

    const order = [...state.nodes.keys()]
    const from = order.indexOf(change.id)
    const oldPrev = order[from - 1] ?? null
    const oldNext = order[from + 1] ?? null

    const to = Math.min(change.index, order.length - 1)
    order.splice(from, 1)
    order.splice(to, 0, change.id)

    state.nodes = new Map(order.map(id => [id, state.nodes.get(id)]))
    if (from === to) return change.id

    const linksBetween = (a, b) => a && b
      ? [...state.connections.values()].filter(c => c.from.node === a && c.to.node === b)
      : []
    // Grouped by signal kind, and only acted on where a side has exactly
    // one: the same restriction removeNode's heal uses, and for the same
    // reason. A second connection of the same kind between the same two
    // nodes (a stereo pair sent as two mono edges, say) has no single right
    // rewiring to guess, so it is left exactly as it was instead.
    const bySignalKind = links => {
      const grouped = new Map()
      for (const link of links) {
        const list = grouped.get(link.signalKind) ?? []
        list.push(link)
        grouped.set(link.signalKind, list)
      }
      return grouped
    }
    const tryReconnect = join => { try { OPERATIONS.addConnection(state, join, counters) } catch { /* already joined */ } }

    // Heal the gap this node leaves.
    const oldIn = bySignalKind(linksBetween(oldPrev, change.id))
    const oldOut = bySignalKind(linksBetween(change.id, oldNext))
    for (const [signalKind, before] of oldIn) {
      const after = oldOut.get(signalKind) ?? []
      if (before.length === 1 && after.length === 1) {
        tryReconnect({ from: { ...before[0].from }, to: { ...after[0].to }, signalKind })
      }
    }
    for (const link of [...oldIn.values(), ...oldOut.values()].flat()) state.connections.delete(link.id)

    return change.id
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
    releaseInputs(state, change.id)
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
   * Forget a parameter's setting, so it is at its plugin's default again. The
   * model has no profiles and so no defaults; the setting is simply absent,
   * which is what a node that was never touched has.
   */
  clearSetting (state, change) {
    const node = state.nodes.get(change.node)
    if (!node) throw new Error(`no such node: ${change.node}`)
    if (!change.symbol) throw new Error('needs a symbol')
    node.settings.delete(change.symbol)
    return change.symbol
  },

  /**
   * Set any of a track's channel strip.
   *
   * One operation for the four rather than one each, because a person moving a
   * fader and a person pressing mute are the same kind of edit and a preset
   * setting all four is one edit rather than four.
   */
  setTrackChannel (state, change) {
    const track = state.tracks.get(change.track)
    if (!track) throw new Error(`no such track: ${change.track}`)
    track.channel = nextChannel(track.channel, change)
    return change.track
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

/** The addClip that recreates a clip from a snapshot. */
export function clipChange (c) {
  return c.kind === 'midi'
    ? { op: 'addClip', id: c.id, track: c.track, kind: 'midi', startBeat: c.startBeat, lengthBeats: c.lengthBeats, notes: c.notes }
    : { op: 'addClip', id: c.id, track: c.track, kind: 'audio', startBeat: c.startBeat, lengthBeats: c.lengthBeats, source: c.source, offsetSeconds: c.offsetSeconds }
}

/**
 * The changeset that rebuilds a snapshot in an empty project, ids and all.
 *
 * One list, used wherever a project is copied, so a field added to the model
 * is copied everywhere or nowhere. The copy used for trial compiles once
 * listed its own fields and was one short the day nodes gained a channel.
 * Tracks first, because nodes name them; inputs after nodes, because inputs
 * name nodes; connections after both.
 */
export function changesFor (snapshot) {
  return [
    ...snapshot.tracks.map(t => ({ op: 'addTrack', id: t.id, label: t.label, channel: t.channel })),
    ...snapshot.nodes.map(n => ({
      op: 'addNode', id: n.id, pluginIri: n.pluginIri, label: n.label, track: n.track, settings: n.settings, state: n.state
    })),
    ...snapshot.tracks
      .filter(t => t.midiInput !== null || t.audioInput !== null)
      .map(t => ({ op: 'setTrack', id: t.id, midiInput: t.midiInput, audioInput: t.audioInput })),
    ...snapshot.connections.map(c => ({
      op: 'addConnection', id: c.id, from: c.from, to: c.to, signalKind: c.signalKind, delayFrames: c.delayFrames
    })),
    ...snapshot.clips.map(clipChange),
    { op: 'setTransport', ...snapshot.transport }
  ]
}

export class Project {
  #revision = 0
  #state = { tracks: new Map(), nodes: new Map(), connections: new Map(), clips: new Map(), transport: { ...DEFAULT_TRANSPORT } }
  #counters = { track: 0, node: 0, connection: 0, clip: 0 }
  // Editor metadata, deliberately outside the state a revision covers.
  #positions = new Map()
  #label = null

  get revision () { return this.#revision }
  get label () { return this.#label }
  set label (value) { this.#label = value }

  get tracks () { return [...this.#state.tracks.values()] }
  get nodes () { return [...this.#state.nodes.values()] }
  get connections () { return [...this.#state.connections.values()] }
  get clips () { return [...this.#state.clips.values()] }
  get transport () { return this.#state.transport }

  track (id) { return this.#state.tracks.get(id) ?? null }
  node (id) { return this.#state.nodes.get(id) ?? null }

  /**
   * The id the next minted track, node or connection would get, without
   * minting it. For a caller building one changeset whose later changes name
   * something an earlier one creates: a new track and the first node on it.
   */
  nextId (kind) {
    const key = { track: 'track', node: 'node', conn: 'connection', clip: 'clip' }[kind]
    if (!key) throw new Error(`no ids are minted for ${kind}`)
    return `${kind}-${this.#counters[key] + 1}`
  }
  connection (id) { return this.#state.connections.get(id) ?? null }
  clip (id) { return this.#state.clips.get(id) ?? null }

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
      tracks: this.tracks.map(t => ({ ...t, channel: { ...t.channel } })),
      nodes: this.nodes.map(n => ({
        id: n.id,
        pluginIri: n.pluginIri,
        label: n.label,
        track: n.track,
        settings: Object.fromEntries(n.settings),
        state: n.state,
        position: this.position(n.id)
      })),
      connections: this.connections.map(c => ({ ...c, from: { ...c.from }, to: { ...c.to } })),
      clips: this.clips.map(c => ({ ...c, notes: c.notes.map(n => ({ ...n })) })),
      transport: { ...this.#state.transport, tempoPoints: this.#state.transport.tempoPoints.map(p => ({ ...p })) }
    }
  }
}
