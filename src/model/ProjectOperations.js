// src/model/ProjectOperations.js
//
// Every operation a changeset can contain, as one function over the state a trial copy holds: `(state, change, counters) => the id it made or
// changed`. Project.apply runs them in order against a copy and swaps the copy in only if all succeed. Each checks its own change and throws with
// a message that names what was wrong; nothing here knows about revisions or listeners.
import { ARRANGEMENT_OPERATIONS, MASTER_TRACK, checkNoteRange, checkTrackOutput, dropForTrack, dropForNode, checkSignaturePoints } from './ArrangementOps.js'
import { QUANTISE_NAMES } from './LauncherState.js'
import { isMidiSignal } from './Endpoints.js'
import { CLIP_OPERATIONS } from './ProjectClipOperations.js'
import { DEFAULT_CHANNEL, checkEndpoint, noteExplicitId, isLoadableIRI, connectionKey, checkScene, nextChannel, checkTrackInput, checkFlag, releaseInputs, checkPlace } from './ProjectRules.js'

export const OPERATIONS = {
  ...ARRANGEMENT_OPERATIONS,
  ...CLIP_OPERATIONS,
  addTrack (state, change, counters) {
    const id = change.id ?? `track-${++counters.track}`
    if (id === MASTER_TRACK) throw new Error(`${MASTER_TRACK} is the master's id and cannot be a track's`)
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
      audioInput: null,
      // Whether this track is armed to record MIDI or audio. A UI toggle sets it;
      // the recorder honours it when the transport runs.
      armed: false,
      // The source feeding a recorded take on this track: 'midi', 'audio' or null.
      recordSource: null,
      // The bus this track's output goes to instead of the master, or null.
      output: null
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
    if (change.output !== undefined) {
      checkTrackOutput(state, change.id, change.output)
      track.output = change.output
    }
    if (change.armed !== undefined) track.armed = Boolean(change.armed)
    if (change.recordSource !== undefined) track.recordSource = change.recordSource
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
        if (clip.scene !== undefined) checkScene(state, change.moveNodesTo, clip.scene, clip.id)
        clip.track = change.moveNodesTo
      } else {
        state.clips.delete(id)
      }
    }
    state.tracks.delete(change.id)
    dropForTrack(state, change.id)
    return change.id
  },

  moveNodeToTrack (state, change) {
    const node = state.nodes.get(change.id)
    if (!node) throw new Error(`no such node: ${change.id}`)
    checkPlace(state, change.track)
    if (node.track === change.track) return change.id
    releaseInputs(state, change.id)
    node.track = change.track
    return change.id
  },

  /**
   * Add a clip to a track. A MIDI clip holds notes; an audio clip names the
   * file it plays by `source`, never its bytes (project-format.md "Clips").
   */
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
    checkPlace(state, change.track)
    const id = change.id ?? `node-${++counters.node}`
    if (state.nodes.has(id)) throw new Error(`node already exists: ${id}`)
    noteExplicitId(counters, 'node', 'node', id)
    state.nodes.set(id, {
      id,
      pluginIri: change.pluginIri,
      label: change.label ?? null,
      track: change.track,
      settings: new Map(Object.entries(change.settings ?? {})),
      state: change.state ?? null,
      bypassed: checkFlag('bypassed', change.bypassed ?? false)
    })
    return id
  },

  /**
   * Change a node's own properties. Bypass passes what arrives at its input straight to where
   * its output goes, and keeps its state, so turning it back on is instant and exact.
   */
  setNode (state, change) {
    const node = state.nodes.get(change.id)
    if (!node) throw new Error(`no such node: ${change.id}`)
    if (change.bypassed !== undefined) node.bypassed = checkFlag('bypassed', change.bypassed)
    return change.id
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
    dropForNode(state, change.id)
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
    if ((change.lowNote != null || change.highNote != null) && !isMidiSignal(change.signalKind)) throw new Error('a note range is for a MIDI connection')
    state.connections.set(id, {
      id,
      from: { ...change.from },
      to: { ...change.to },
      signalKind: change.signalKind,
      delayFrames: change.delayFrames ?? 0,
      ...checkNoteRange(change, 'a MIDI connection')
    })
    return id
  },

  /**
   * Change the notes a MIDI connection lets through: only those from `lowNote` to `highNote`. An end not
   * mentioned stays as it was and null takes it away, so a connection with neither passes everything, which
   * is what one that never had a range does.
   */
  setConnection (state, change) {
    const connection = state.connections.get(change.id)
    if (!connection) throw new Error(`no such connection: ${change.id}`)
    if (!isMidiSignal(connection.signalKind)) throw new Error('a note range is for a MIDI connection')
    const next = checkNoteRange({
      lowNote: change.lowNote === undefined ? connection.lowNote : change.lowNote,
      highNote: change.highNote === undefined ? connection.highNote : change.highNote
    }, 'a MIDI connection')
    delete connection.lowNote
    delete connection.highNote
    Object.assign(connection, next)
    return change.id
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
    for (const key of ['beatsPerBar', 'beatUnit', 'loopStart', 'loopEnd', 'loopEnabled', 'playing', 'launchQuantise']) {
      if (change[key] !== undefined) next[key] = change[key]
    }
    if (!QUANTISE_NAMES.includes(next.launchQuantise)) throw new Error(`launchQuantise is one of ${QUANTISE_NAMES.join(', ')}: ${next.launchQuantise}`)
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
    if (change.signaturePoints !== undefined) next.signaturePoints = change.signaturePoints
    // Checked whenever either half changes: a new beatsPerBar can move a bar line
    // from under a signature point that was fine before.
    next.signaturePoints = checkSignaturePoints(next.beatsPerBar, next.signaturePoints ?? [])
    if (next.loopEnabled && !(next.loopEnd > next.loopStart)) {
      throw new Error('a loop must start before it ends')
    }
    state.transport = next
    return 'transport'
  }
}