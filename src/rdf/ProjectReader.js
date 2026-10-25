// src/rdf/ProjectReader.js
//
// A project from Turtle, per docs/project-format.md.
//
// The counterpart of ProjectWriter, and the half that makes a project portable:
// a file opened on a machine that has never seen these plugins carries every IRI
// needed to fetch them.
//
// This returns a changeset rather than a Project. The model has exactly one way
// in, `Project.apply`, and a reader that built state directly would be a second
// implementation of every rule that lives there: which IRIs are loadable, that
// an endpoint names its port exactly one way, that a connection is not a
// duplicate. Those rules would then be enforced on a project a person built and
// not on one they opened, which is the wrong way round.
import { vocabulary as v } from './Vocabulary.js'
import { objects, one, value, number, idOf } from './ReaderKit.js'

const { jig, trn } = v
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

/** An xsd:boolean, or null for none. Anything else is refused rather than read as false. */
function readBoolean (term, what = 'alignTracks') {
  if (term === null) return null
  if (term.value === 'true' || term.value === '1') return true
  if (term.value === 'false' || term.value === '0') return false
  throw new Error(`${what} is true or false, not "${term.value}"`)
}

/** The one subject typed jig:Project. */
export function findProject (dataset) {
  const found = []
  for (const quad of dataset) {
    if (quad.predicate.value === RDF_TYPE && quad.object.value === jig.Project) {
      found.push(quad.subject.value)
    }
  }
  if (found.length === 0) throw new Error('this document declares no jig:Project')
  if (found.length > 1) {
    // Two projects in one document have no defined relationship and picking one
    // would be arbitrary.
    throw new Error(`this document declares ${found.length} projects, and a project file holds one`)
  }
  return found[0]
}

function readEndpoint (dataset, iri, projectIri, what) {
  if (!iri) throw new Error(`${what} is missing`)
  const node = value(one(dataset, iri, jig.endpointNode))
  if (!node) throw new Error(`${what} names no jig:endpointNode`)

  const index = one(dataset, iri, jig.portIndex)
  const symbol = one(dataset, iri, jig.portSymbol)
  if ((index === null) === (symbol === null)) {
    // The specification and the shapes both refuse this, with sh:xone. Carrying
    // both is ambiguous in a way nothing downstream can resolve.
    throw new Error(`${what} must give exactly one of jig:portIndex or jig:portSymbol`)
  }

  const endpoint = { node: idOf(node, projectIri, `${what} endpointNode`) }
  if (index !== null) endpoint.portIndex = number(index, `${what} portIndex`)
  else endpoint.portSymbol = symbol.value
  return endpoint
}

/**
 * Ids in the order they were minted: track-2 before track-10. A track's place
 * in the arrangement is the order tracks were made, and a plain string sort
 * would reorder a session with ten tracks every time it was opened.
 */
function mintedOrder (a, b) {
  const split = id => { const m = /^(.*?)(\d+)$/.exec(id); return m ? [m[1], Number(m[2])] : [id, -1] }
  const [pa, na] = split(a)
  const [pb, nb] = split(b)
  return pa < pb ? -1 : pa > pb ? 1 : na - nb
}

/** The channel strip stated on a subject. Absent means the default. */
function readChannel (dataset, subject, id) {
  const channel = {}
  const gain = number(one(dataset, subject, jig.gain), `gain on ${id}`)
  const pan = number(one(dataset, subject, jig.pan), `pan on ${id}`)
  const muted = one(dataset, subject, jig.muted)
  const soloed = one(dataset, subject, jig.soloed)
  if (gain !== null) channel.gain = gain
  if (pan !== null) channel.pan = pan
  if (muted !== null) channel.muted = muted.value === 'true'
  if (soloed !== null) channel.soloed = soloed.value === 'true'
  return channel
}

/**
 * Tracks for a session saved before tracks existed, per project-format.md
 * "Opening a session saved before tracks".
 *
 * Nodes joined by any connection are one group, and each group is one track.
 * The track takes its label and channel strip from the group's first node
 * that is the source of no connection: the end of the chain, which is the
 * only node whose strip anyone was ever hearing the whole chain through.
 *
 * Returns { tracks: [{ id, label, channel }], trackOf: Map nodeId -> trackId }.
 */
function foldIntoTracks (nodes, connections) {
  const group = new Map(nodes.map(n => [n.id, n.id]))
  const find = id => { while (group.get(id) !== id) id = group.get(id); return id }
  for (const c of connections) {
    if (!group.has(c.from.node) || !group.has(c.to.node)) continue
    const a = find(c.from.node)
    const b = find(c.to.node)
    if (a !== b) group.set(b, a)
  }
  const feeds = new Set(connections.map(c => c.from.node))

  const members = new Map()
  for (const node of nodes) {
    const root = find(node.id)
    if (!members.has(root)) members.set(root, [])
    members.get(root).push(node)
  }

  const tracks = []
  const trackOf = new Map()
  for (const list of members.values()) {
    const id = `track-${tracks.length + 1}`
    const end = list.find(n => !feeds.has(n.id)) ?? list[0]
    tracks.push({ id, label: end.label, channel: end.channel })
    for (const node of list) trackOf.set(node.id, id)
  }
  return { tracks, trackOf }
}

const TAP_OF = { [jig.PreFader]: 'pre', [jig.PostFader]: 'post' }
const CURVE_OF = { [jig.Step]: 'step', [jig.Linear]: 'linear', [jig.Smooth]: 'smooth' }
const KIND_OF = { [jig.MasterGain]: 'masterGain', [jig.MasterPan]: 'masterPan', [jig.Tempo]: 'tempo' }

/** A named individual as the model's word for it. An IRI nobody defined is refused, not guessed at. */
function named (table, iri, what) {
  if (iri === null) throw new Error(`${what} is missing`)
  if (!(iri in table)) throw new Error(`${what} is not one this format defines: ${iri}`)
  return table[iri]
}

/** The ends of a note range a MIDI connection or send states, as the model's `lowNote` and `highNote`. */
function readNoteRange (dataset, subject, id) {
  const end = (property, name) => {
    const term = one(dataset, subject, property)
    return term === null ? {} : { [name]: number(term, `${name} of ${id}`) }
  }
  return { ...end(jig.lowNote, 'lowNote'), ...end(jig.highNote, 'highNote') }
}

/**
 * The master, bus outputs, sends, markers, regions and envelopes, as changes.
 * Everything here is keyed by its own id or by beat and never by position.
 */
function readArrangement (dataset, iri, tracks) {
  const changes = []
  const masterIri = value(one(dataset, iri, jig.master))
  if (masterIri) {
    const channel = readChannel(dataset, masterIri, 'master')
    const input = value(one(dataset, masterIri, jig.audioInput))
    changes.push({ op: 'setMaster', ...(channel.gain !== undefined ? { gain: channel.gain } : {}),
      ...(channel.pan !== undefined ? { pan: channel.pan } : {}), ...(channel.muted !== undefined ? { muted: channel.muted } : {}),
      ...(input !== null ? { audioInput: idOf(input, iri, 'audioInput of the master') } : {}) })
  }
  for (const t of tracks) {
    if (t.output) changes.push({ op: 'setTrack', id: t.id, output: idOf(t.output, iri, `output of track ${t.id}`) })
  }
  const each = (property, what) => objects(dataset, iri, property).map(x => x.value)
    .map(subject => ({ subject, id: idOf(subject, iri, what) })).sort((a, b) => mintedOrder(a.id, b.id))
  for (const { subject, id } of each(jig.send, 'send')) {
    const from = idOf(value(one(dataset, subject, jig.sendFrom)), iri, `sendFrom of ${id}`)
    const to = idOf(value(one(dataset, subject, jig.sendTo)), iri, `sendTo of ${id}`)
    const kind = value(one(dataset, subject, jig.signalKind))
    if (kind === trn.Midi) {
      // A MIDI send has no level and no tap, so none is read: the model refuses one that is given.
      changes.push({ op: 'addSend', id, from, to, kind: 'midi', ...readNoteRange(dataset, subject, id) })
      continue
    }
    changes.push({
      op: 'addSend', id, from, to,
      level: number(one(dataset, subject, jig.level), `level of ${id}`) ?? 1,
      tap: named(TAP_OF, value(one(dataset, subject, jig.tap)), `tap of ${id}`)
    })
  }
  for (const { subject, id } of each(jig.marker, 'marker')) {
    changes.push({ op: 'addMarker', id, atBeat: number(one(dataset, subject, jig.atBeat), `atBeat of ${id}`), label: value(one(dataset, subject, RDFS_LABEL)) })
  }
  for (const { subject, id } of each(jig.region, 'region')) {
    changes.push({
      op: 'addRegion', id,
      startBeat: number(one(dataset, subject, trn.startBeat), `startBeat of ${id}`),
      lengthBeats: number(one(dataset, subject, trn.lengthBeats), `lengthBeats of ${id}`),
      label: value(one(dataset, subject, RDFS_LABEL))
    })
  }
  for (const { subject, id } of each(jig.envelope, 'envelope')) {
    const kind = value(one(dataset, subject, jig.targetKind))
    const targetNode = value(one(dataset, subject, jig.targetNode))
    const target = kind !== null
      ? { kind: named(KIND_OF, kind, `targetKind of ${id}`) }
      : { node: idOf(targetNode, iri, `targetNode of ${id}`), symbol: value(one(dataset, subject, jig.targetSymbol)) }
    const points = objects(dataset, subject, jig.envelopePoint).map(x => x.value).map(pointIri => ({
      atBeat: number(one(dataset, pointIri, jig.atBeat), `atBeat of a point in ${id}`),
      value: number(one(dataset, pointIri, jig.pointValue), `pointValue of a point in ${id}`),
      curve: named(CURVE_OF, value(one(dataset, pointIri, jig.curve)), `curve of a point in ${id}`)
    })).sort((a, b) => a.atBeat - b.atBeat)
    changes.push({ op: 'addEnvelope', id, target, points })
  }
  return changes
}

/**
 * Read a project into the changeset that rebuilds it.
 *
 * Returns `{ iri, label, revision, changes }`. Apply the changes to a fresh
 * `Project` and it is the project that was written, ids and all: every change
 * carries its explicit id, which is why the model tracks ids it did not mint.
 */
export function readProject (dataset) {
  const iri = findProject(dataset)
  const changes = []

  const trackIris = objects(dataset, iri, jig.track).map(t => t.value)
  const tracks = trackIris
    .map(trackIri => ({ trackIri, id: idOf(trackIri, iri, 'track') }))
    .sort((a, b) => mintedOrder(a.id, b.id))
    .map(({ trackIri, id }) => ({
      id,
      label: value(one(dataset, trackIri, RDFS_LABEL)),
      channel: readChannel(dataset, trackIri, id),
      midiInput: value(one(dataset, trackIri, jig.midiInput)),
      audioInput: value(one(dataset, trackIri, jig.audioInput)),
      output: value(one(dataset, trackIri, jig.output))
    }))

  // Clips, on the tracks that hold them. The kind is the clip's type, which
  // the writer always states.
  const clips = []
  for (const trackIri of trackIris) {
    const track = idOf(trackIri, iri, 'track')
    for (const clipIri of objects(dataset, trackIri, jig.clip).map(t => t.value)) {
      const id = idOf(clipIri, iri, `clip of track ${track}`)
      const types = objects(dataset, clipIri, RDF_TYPE).map(t => t.value)
      const kind = types.includes(jig.MidiClip) ? 'midi' : types.includes(jig.AudioClip) ? 'audio' : null
      if (!kind) throw new Error(`clip ${id} is neither a jig:MidiClip nor a jig:AudioClip`)
      const clip = {
        op: 'addClip',
        id,
        track,
        kind,
        startBeat: number(one(dataset, clipIri, trn.startBeat), `startBeat of clip ${id}`),
        lengthBeats: number(one(dataset, clipIri, trn.lengthBeats), `lengthBeats of clip ${id}`)
      }
      const muted = one(dataset, clipIri, jig.muted)
      if (muted !== null) clip.muted = muted.value === 'true'
      const locked = one(dataset, clipIri, jig.locked)
      if (locked !== null) clip.locked = locked.value === 'true'
      if (kind === 'midi') {
        const loopBeats = number(one(dataset, clipIri, jig.loopBeats), `loopBeats of clip ${id}`)
        if (loopBeats !== null) clip.loopBeats = loopBeats
        const scene = number(one(dataset, clipIri, jig.scene), `scene of clip ${id}`)
        if (scene !== null) clip.scene = scene
        clip.notes = objects(dataset, clipIri, jig.note).map(t => t.value).map(noteIri => ({
          ...(one(dataset, noteIri, jig.chance) ? { chance: number(one(dataset, noteIri, jig.chance), `chance of a note in ${id}`) } : {}),
          startBeat: number(one(dataset, noteIri, trn.startBeat), `startBeat of a note in ${id}`),
          lengthBeats: number(one(dataset, noteIri, trn.lengthBeats), `lengthBeats of a note in ${id}`),
          pitch: number(one(dataset, noteIri, trn.pitch), `pitch of a note in ${id}`),
          velocity: number(one(dataset, noteIri, trn.velocity), `velocity of a note in ${id}`)
        }))
        clip.controllers = objects(dataset, clipIri, jig.controllerEvent).map(t => t.value).map(eventIri => {
          const atBeat = number(one(dataset, eventIri, trn.startBeat), `startBeat of an event in ${id}`)
          return objects(dataset, eventIri, RDF_TYPE).some(t => t.value === jig.PitchBendEvent)
            ? { atBeat, controller: 'pitchBend', value: number(one(dataset, eventIri, jig.bend), `bend of an event in ${id}`) }
            : { atBeat, controller: number(one(dataset, eventIri, jig.controller), `controller of an event in ${id}`), value: number(one(dataset, eventIri, jig.value), `value of an event in ${id}`) }
        })
      } else {
        const source = value(one(dataset, clipIri, jig.source))
        if (!source) throw new Error(`audio clip ${id} names no jig:source, so there is nothing to play`)
        clip.source = source
        clip.offsetSeconds = number(one(dataset, clipIri, jig.offsetSeconds), `offsetSeconds of clip ${id}`) ?? 0
        clip.fadeInBeats = number(one(dataset, clipIri, jig.fadeInBeats), `fadeInBeats of clip ${id}`) ?? 0
        clip.fadeOutBeats = number(one(dataset, clipIri, jig.fadeOutBeats), `fadeOutBeats of clip ${id}`) ?? 0
      }
      clips.push(clip)
    }
  }
  clips.sort((a, b) => mintedOrder(a.id, b.id))

  const nodes = []
  const nodeIris = objects(dataset, iri, jig.node).map(t => t.value).sort()
  for (const nodeIri of nodeIris) {
    const id = idOf(nodeIri, iri, 'node')
    const pluginIri = value(one(dataset, nodeIri, jig.plugin))
    if (!pluginIri) throw new Error(`node ${id} names no jig:plugin, so nothing says what to load`)

    const settings = {}
    for (const settingIri of objects(dataset, nodeIri, jig.setting).map(t => t.value).sort()) {
      const symbol = value(one(dataset, settingIri, jig.symbol))
      const setting = one(dataset, settingIri, jig.value)
      if (!symbol) throw new Error(`a setting on ${id} names no jig:symbol`)
      if (setting === null) throw new Error(`setting ${symbol} on ${id} has no jig:value`)
      settings[symbol] = number(setting, `setting ${symbol} on ${id}`)
    }

    const onTrack = value(one(dataset, nodeIri, jig.onTrack))
    nodes.push({
      id,
      pluginIri,
      label: value(one(dataset, nodeIri, RDFS_LABEL)),
      track: onTrack === null ? null : idOf(onTrack, iri, `track of node ${id}`),
      settings,
      state: value(one(dataset, nodeIri, jig.nodeState)),
      ...(one(dataset, nodeIri, jig.bypassed)?.value === 'true' ? { bypassed: true } : {}),
      // Only read to fold a session from before tracks, below.
      channel: readChannel(dataset, nodeIri, id)
    })
  }

  const connections = []
  for (const connIri of objects(dataset, iri, jig.connection).map(t => t.value).sort()) {
    const id = idOf(connIri, iri, 'connection')
    const signalKind = value(one(dataset, connIri, jig.signalKind))
    if (!signalKind) {
      throw new Error(`connection ${id} names no jig:signalKind, and it cannot be inferred ` +
        'from the endpoints: an audio edge and a host-routed MIDI edge look identical here')
    }
    connections.push({
      op: 'addConnection',
      ...readNoteRange(dataset, connIri, id),
      id,
      from: readEndpoint(dataset, value(one(dataset, connIri, jig.from)), iri, `connection ${id} from`),
      to: readEndpoint(dataset, value(one(dataset, connIri, jig.to)), iri, `connection ${id} to`),
      signalKind
    })
  }

  if (tracks.length === 0 && nodes.length > 0 && nodes.every(n => n.track === null)) {
    // A session from before tracks. Folded, never refused: project-format.md.
    const folded = foldIntoTracks(nodes, connections)
    for (const t of folded.tracks) tracks.push({ ...t, midiInput: null, audioInput: null })
    for (const node of nodes) node.track = folded.trackOf.get(node.id)
  } else {
    for (const node of nodes) {
      if (node.track === null) throw new Error(`node ${node.id} names no jig:onTrack, so nothing says where its sound goes`)
    }
  }

  // Tracks, then nodes, which name them, then the tracks' inputs, which name
  // nodes, then connections: the order changesFor in the model uses.
  for (const t of tracks) {
    changes.push({ op: 'addTrack', id: t.id, label: t.label, ...(Object.keys(t.channel).length > 0 ? { channel: t.channel } : {}) })
  }
  for (const { channel, ...node } of nodes) changes.push({ op: 'addNode', ...node })
  for (const t of tracks) {
    if (t.midiInput === null && t.audioInput === null) continue
    const input = (nodeIri, what) => (nodeIri === null ? null : idOf(nodeIri, iri, `${what} of track ${t.id}`))
    changes.push({ op: 'setTrack', id: t.id, midiInput: input(t.midiInput, 'midiInput'), audioInput: input(t.audioInput, 'audioInput') })
  }
  changes.push(...connections)
  changes.push(...clips)
  changes.push(...readArrangement(dataset, iri, tracks))

  const transportIri = value(one(dataset, iri, jig.transport))
  if (transportIri) {
    const points = objects(dataset, transportIri, jig.tempoPoint)
      .map(t => t.value)
      .map(pointIri => ({
        atBeat: number(one(dataset, pointIri, jig.atBeat), 'atBeat') ?? 0,
        bpm: number(one(dataset, pointIri, jig.bpm), 'bpm') ?? 120
      }))
      // Keyed by the beat it takes effect at, never by position in the file.
      // That is what survives an insertion in the middle.
      .sort((a, b) => a.atBeat - b.atBeat)

    const transport = {}
    const beatsPerBar = number(one(dataset, transportIri, jig.beatsPerBar), 'beatsPerBar')
    const beatUnit = number(one(dataset, transportIri, jig.beatUnit), 'beatUnit')
    const loopStart = number(one(dataset, transportIri, jig.loopStart), 'loopStart')
    const loopEnd = number(one(dataset, transportIri, jig.loopEnd), 'loopEnd')
    const loopEnabled = one(dataset, transportIri, jig.loopEnabled)
    if (beatsPerBar !== null) transport.beatsPerBar = beatsPerBar
    if (beatUnit !== null) transport.beatUnit = beatUnit
    if (loopStart !== null) transport.loopStart = loopStart
    if (loopEnd !== null) transport.loopEnd = loopEnd
    if (loopEnabled !== null) transport.loopEnabled = loopEnabled.value === 'true'
    const launchQuantise = one(dataset, transportIri, jig.launchQuantise)
    if (launchQuantise !== null) transport.launchQuantise = launchQuantise.value
    if (points.length > 0) transport.tempoPoints = points
    const signatures = objects(dataset, transportIri, jig.signaturePoint).map(t => t.value).map(pointIri => ({
      atBeat: number(one(dataset, pointIri, jig.atBeat), 'atBeat of a signature point'),
      beatsPerBar: number(one(dataset, pointIri, jig.beatsPerBar), 'beatsPerBar of a signature point'),
      beatUnit: number(one(dataset, pointIri, jig.beatUnit), 'beatUnit of a signature point')
    }))
    if (signatures.length > 0) transport.signaturePoints = signatures.sort((a, b) => a.atBeat - b.atBeat)
    if (Object.keys(transport).length > 0) changes.push({ op: 'setTransport', ...transport })
  }

  return {
    iri,
    label: value(one(dataset, iri, RDFS_LABEL)),
    info: {
      title: value(one(dataset, iri, RDFS_LABEL)),
      author: value(one(dataset, iri, v.dcterms.creator)),
      notes: value(one(dataset, iri, v.rdfs.comment))
    },
    settings: { alignTracks: readBoolean(one(dataset, iri, jig.alignTracks)) },
    revision: number(one(dataset, iri, jig.revision), 'revision') ?? 0,
    changes
  }
}

// Read beside the project, and re-exported so callers keep importing them from here.
export { readEditor, readScripts } from './ProjectSidecarReader.js'
