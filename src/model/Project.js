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

import { EditorState } from './EditorState.js'
import { ScriptState } from './ScriptState.js'
import { EMPTY_INFO, patchInfo } from './ProjectInfo.js'
import { EMPTY_SETTINGS, patchSettings } from './ProjectSettings.js'
import {
  MASTER_TRACK, emptyArrangement, arrangementChanges, arrangementReconcile
} from './ArrangementOps.js'
import { DEFAULT_TRANSPORT, cloneClip, cloneState } from './ProjectRules.js'
import { OPERATIONS } from './ProjectOperations.js'

export { arrangementReconcile, MASTER_TRACK }
// Re-exported so callers keep importing them from here.
export { isLoadableIRI, PITCH_BEND, BEND_RANGE } from './ProjectRules.js'

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


/** The addClip that recreates a clip from a snapshot. */
export function clipChange (c) {
  return c.kind === 'midi'
    ? { op: 'addClip', id: c.id, track: c.track, kind: 'midi', startBeat: c.startBeat, lengthBeats: c.lengthBeats, muted: c.muted, locked: c.locked, notes: c.notes, controllers: c.controllers ?? [], ...(c.loopBeats ? { loopBeats: c.loopBeats } : {}), ...(c.scene === undefined ? {} : { scene: c.scene }) }
    : { op: 'addClip', id: c.id, track: c.track, kind: 'audio', startBeat: c.startBeat, lengthBeats: c.lengthBeats, muted: c.muted, locked: c.locked, source: c.source, offsetSeconds: c.offsetSeconds, fadeInBeats: c.fadeInBeats, fadeOutBeats: c.fadeOutBeats }
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
      op: 'addNode', id: n.id, pluginIri: n.pluginIri, label: n.label, track: n.track, settings: n.settings, state: n.state, bypassed: n.bypassed
    })),
    ...snapshot.tracks
      .filter(t => t.midiInput !== null || t.audioInput !== null)
      .map(t => ({ op: 'setTrack', id: t.id, midiInput: t.midiInput, audioInput: t.audioInput })),
    ...snapshot.connections.map(c => ({
      op: 'addConnection', id: c.id, from: c.from, to: c.to, signalKind: c.signalKind, delayFrames: c.delayFrames,
      ...(c.lowNote === undefined ? {} : { lowNote: c.lowNote }), ...(c.highNote === undefined ? {} : { highNote: c.highNote })
    })),
    ...snapshot.clips.map(clipChange),
    { op: 'setTransport', ...snapshot.transport },
    ...arrangementChanges(snapshot)
  ]
}

export class Project {
  #revision = 0
  #state = { tracks: new Map(), nodes: new Map(), connections: new Map(), clips: new Map(), transport: { ...DEFAULT_TRANSPORT, signaturePoints: [] }, ...emptyArrangement() }
  #counters = { track: 0, node: 0, connection: 0, clip: 0, send: 0, marker: 0, region: 0, envelope: 0 }
  // Editor metadata, deliberately outside the state a revision covers.
  #editor = new EditorState()
  // Scripts saved with the session: text, outside the revision for the same reason.
  #scripts = new ScriptState()
  // Title, author and notes: words about the session, outside the revision.
  #info = { ...EMPTY_INFO }
  // How the session wants to be played (track alignment), outside the revision for the same reason.
  #settings = { ...EMPTY_SETTINGS }

  get revision () { return this.#revision }
  /** The title, or null. */
  get label () { return this.#info.title }
  set label (value) { this.setInfo({ title: value }) }
  get info () { return { ...this.#info } }
  setInfo (patch) { this.#info = patchInfo(this.#info, patch) }
  get settings () { return { ...this.#settings } }
  setSettings (patch) { this.#settings = patchSettings(this.#settings, patch) }

  get tracks () { return [...this.#state.tracks.values()] }
  get nodes () { return [...this.#state.nodes.values()] }
  get connections () { return [...this.#state.connections.values()] }
  get clips () { return [...this.#state.clips.values()] }
  /** The clips on the timeline: every clip except those in the clip launcher. */
  get arrangementClips () { return this.clips.filter(c => c.scene === undefined) }
  /** The clips in the clip launcher, by scene and then track. */
  get launcherClips () { return this.clips.filter(c => c.scene !== undefined).sort((a, b) => a.scene - b.scene || a.track.localeCompare(b.track)) }
  get transport () { return this.#state.transport }
  get master () { return this.#state.master }
  get sends () { return [...this.#state.sends.values()] }
  get markers () { return [...this.#state.markers.values()] }
  get regions () { return [...this.#state.regions.values()] }
  get envelopes () { return [...this.#state.envelopes.values()] }

  track (id) { return this.#state.tracks.get(id) ?? null }
  node (id) { return this.#state.nodes.get(id) ?? null }

  /**
   * The id the next minted track, node or connection would get, without
   * minting it. For a caller building one changeset whose later changes name
   * something an earlier one creates: a new track and the first node on it.
   */
  nextId (kind) {
    const key = { track: 'track', node: 'node', conn: 'connection', clip: 'clip', send: 'send', marker: 'marker', region: 'region', envelope: 'envelope' }[kind]
    if (!key) throw new Error(`no ids are minted for ${kind}`)
    return `${kind}-${this.#counters[key] + 1}`
  }
  connection (id) { return this.#state.connections.get(id) ?? null }
  clip (id) { return this.#state.clips.get(id) ?? null }

  /** Whether saving the editor graph would say anything, ignoring what belongs to things that are gone. */
  get hasEditorState () {
    return !this.#editor.isDefaultFor(new Set(this.#state.nodes.keys()), new Set(this.#state.tracks.keys()), new Set(this.#state.clips.keys()))
  }

  /** Editor metadata never bumps the revision. */
  get editor () { return this.#editor }

  /** The scripts saved with this session. Text only, never run by opening a session, and not part of the revision. */
  get scripts () { return this.#scripts }
  position (id) { return this.#editor.position(id) }
  moveNode (id, x, y) {
    if (!this.#state.nodes.has(id)) throw new Error(`no such node: ${id}`)
    this.#editor.setPosition(id, x, y)
  }

  /** Tracks as the arrangement shows them: placed ones by order, then the rest as made. */
  get orderedTracks () {
    return this.#editor.orderTracks(this.tracks.map(t => t.id)).map(id => this.#state.tracks.get(id))
  }

  /** Take editor metadata read from an editor.ttl; whatever names nothing here is dropped. */
  loadEditor (read) {
    // The reader cannot tell a clip's colour from a track's: both are a fragment with jig:color.
    // What names a clip and not a track is a clip's.
    const tracks = new Map()
    const clips = new Map()
    for (const [id, layout] of read.tracks) {
      if (this.#state.tracks.has(id) || !this.#state.clips.has(id)) tracks.set(id, layout)
      else clips.set(id, { color: layout.color })
    }
    this.#editor.load({ positions: read.positions, tracks, clips })
    this.#editor.prune(new Set(this.#state.nodes.keys()), new Set(this.#state.tracks.keys()), new Set(this.#state.clips.keys()))
  }

  /** Move a track up (-1) or down (+1) in the arrangement. Editor metadata: no revision, no undo. */
  moveTrack (id, delta) {
    if (!this.#state.tracks.has(id)) throw new Error(`no such track: ${id}`)
    return this.#editor.moveTrack(this.tracks.map(t => t.id), id, delta)
  }

  /** A clip's colour, or null for the track's own. Editor metadata: no revision, no undo. */
  clipColor (id) {
    if (!this.#state.clips.has(id)) throw new Error(`no such clip: ${id}`)
    return this.#editor.clip(id).color
  }
  setClipColor (id, color) {
    if (!this.#state.clips.has(id)) throw new Error(`no such clip: ${id}`)
    this.#editor.setClip(id, { color })
  }

  trackLayout (id) {
    if (!this.#state.tracks.has(id)) throw new Error(`no such track: ${id}`)
    return this.#editor.track(id)
  }
  setTrackLayout (id, patch) {
    if (!this.#state.tracks.has(id)) throw new Error(`no such track: ${id}`)
    this.#editor.setTrack(id, patch)
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

    // Editor metadata of a node or track that has gone is kept, not pruned: undo
    // brings the thing back under its own id and should bring its place back too.
    // Nothing stale is saved (writeEditor walks what exists) or loaded (loadEditor prunes).

    return { revision: this.#revision, results, applied: true }
  }

  /** A plain snapshot, for serialisation or for handing to an agent. */
  snapshot () {
    return {
      label: this.#info.title,
      revision: this.#revision,
      tracks: this.tracks.map(t => ({ ...t, channel: { ...t.channel } })),
      nodes: this.nodes.map(n => ({
        id: n.id,
        pluginIri: n.pluginIri,
        label: n.label,
        track: n.track,
        settings: Object.fromEntries(n.settings),
        state: n.state,
        bypassed: n.bypassed === true,
        position: this.position(n.id)
      })),
      connections: this.connections.map(c => ({ ...c, from: { ...c.from }, to: { ...c.to } })),
      clips: this.clips.map(cloneClip),
      transport: {
        ...this.#state.transport,
        tempoPoints: this.#state.transport.tempoPoints.map(p => ({ ...p })),
        signaturePoints: this.#state.transport.signaturePoints.map(p => ({ ...p }))
      },
      master: { ...this.#state.master },
      sends: [...this.#state.sends.values()].map(x => ({ ...x })),
      markers: [...this.#state.markers.values()].map(x => ({ ...x })),
      regions: [...this.#state.regions.values()].map(x => ({ ...x })),
      envelopes: [...this.#state.envelopes.values()].map(e => ({ id: e.id, target: { ...e.target }, points: e.points.map(p => ({ ...p })) }))
    }
  }
}
