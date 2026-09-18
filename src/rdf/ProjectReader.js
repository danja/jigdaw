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

const { jig } = v
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
const RDFS_LABEL = 'http://www.w3.org/2000/01/rdf-schema#label'

/** Every object of subject/predicate, as plain strings. */
function objects (dataset, subject, predicate) {
  const out = []
  for (const quad of dataset) {
    if (quad.subject.value === subject && quad.predicate.value === predicate) {
      out.push(quad.object)
    }
  }
  return out
}

const one = (dataset, subject, predicate) => objects(dataset, subject, predicate)[0] ?? null
const value = term => (term ? term.value : null)

function number (term, what) {
  if (!term) return null
  const n = Number(term.value)
  if (!Number.isFinite(n)) throw new Error(`${what} is not a number: ${term.value}`)
  return n
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

/** The fragment of an IRI under the project, which is the id the model uses. */
function idOf (iri, projectIri, what) {
  if (!iri) throw new Error(`${what} is missing`)
  const hash = iri.indexOf('#')
  if (hash < 0 || !iri.startsWith(projectIri.split('#')[0])) {
    // Skolemised as a fragment of the project IRI is the format's rule, and an
    // id from somewhere else would not round trip.
    throw new Error(`${what} is not a fragment of the project: ${iri}`)
  }
  return iri.slice(hash + 1)
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
 * Read a project into the changeset that rebuilds it.
 *
 * Returns `{ iri, label, revision, changes }`. Apply the changes to a fresh
 * `Project` and it is the project that was written, ids and all: every change
 * carries its explicit id, which is why the model tracks ids it did not mint.
 */
export function readProject (dataset) {
  const iri = findProject(dataset)
  const changes = []

  // Nodes before connections, because a connection names nodes that must exist.
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

    // The channel strip. Absent means the default, which is what the writer
    // relies on when it leaves an unchanged strip out.
    const channel = {}
    const gain = number(one(dataset, nodeIri, jig.gain), `gain on ${id}`)
    const pan = number(one(dataset, nodeIri, jig.pan), `pan on ${id}`)
    const muted = one(dataset, nodeIri, jig.muted)
    const soloed = one(dataset, nodeIri, jig.soloed)
    if (gain !== null) channel.gain = gain
    if (pan !== null) channel.pan = pan
    if (muted !== null) channel.muted = muted.value === 'true'
    if (soloed !== null) channel.soloed = soloed.value === 'true'

    changes.push({
      op: 'addNode',
      id,
      pluginIri,
      label: value(one(dataset, nodeIri, RDFS_LABEL)),
      settings,
      state: value(one(dataset, nodeIri, jig.nodeState)),
      ...(Object.keys(channel).length > 0 ? { channel } : {})
    })
  }

  for (const connIri of objects(dataset, iri, jig.connection).map(t => t.value).sort()) {
    const id = idOf(connIri, iri, 'connection')
    const signalKind = value(one(dataset, connIri, jig.signalKind))
    if (!signalKind) {
      throw new Error(`connection ${id} names no jig:signalKind, and it cannot be inferred ` +
        'from the endpoints: an audio edge and a host-routed MIDI edge look identical here')
    }
    changes.push({
      op: 'addConnection',
      id,
      from: readEndpoint(dataset, value(one(dataset, connIri, jig.from)), iri, `connection ${id} from`),
      to: readEndpoint(dataset, value(one(dataset, connIri, jig.to)), iri, `connection ${id} to`),
      signalKind
    })
  }

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
    if (points.length > 0) transport.tempoPoints = points
    if (Object.keys(transport).length > 0) changes.push({ op: 'setTransport', ...transport })
  }

  return {
    iri,
    label: value(one(dataset, iri, RDFS_LABEL)),
    revision: number(one(dataset, iri, jig.revision), 'revision') ?? 0,
    changes
  }
}

/** Editor positions, from the second graph. Never part of the project itself. */
export function readPositions (dataset, projectIri) {
  const positions = new Map()
  for (const quad of dataset) {
    if (quad.predicate.value !== jig.x && quad.predicate.value !== jig.y) continue
    const id = idOf(quad.subject.value, projectIri, 'position')
    const at = positions.get(id) ?? { x: 0, y: 0 }
    at[quad.predicate.value === jig.x ? 'x' : 'y'] = Number(quad.object.value)
    positions.set(id, at)
  }
  return positions
}
