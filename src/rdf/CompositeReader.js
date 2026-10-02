// src/rdf/CompositeReader.js
//
// Turns a parsed composite plugin into the plain object a host works with, and
// checks the rules vocabs/shapes.ttl cannot say. docs/nested-plugins.md.
//
// Reading is total, as ProfileReader and CollectionReader are: it reports what
// the document says. checkComposite is separate, so a caller can show a
// composite the shapes accepted and these rules refuse. It looks only inside
// one document: whether a member's own profile exists, validates, matches its
// pin or contains the composite again needs the member, and is the loader's.
import rdf from '@zazuko/env'
import { vocabulary as v } from './Vocabulary.js'
import { readPort } from './ProfileReader.js'

const { jig, lv2, rdf: rdfTerms, trn } = v

const iri = value => rdf.namedNode(value)
const objects = (dataset, subject, predicate) =>
  [...dataset.match(typeof subject === 'string' ? iri(subject) : subject, iri(predicate), null)].map(q => q.object)
const first = (dataset, subject, predicate) => objects(dataset, subject, predicate)[0]?.value ?? null
const number = value => (value === null ? null : Number(value))

function readEndpoint (dataset, node) {
  const index = number(first(dataset, node, jig.portIndex))
  const symbol = first(dataset, node, jig.portSymbol)
  return { node: first(dataset, node, jig.endpointNode), ...(index !== null ? { portIndex: index } : {}), ...(symbol !== null ? { portSymbol: symbol } : {}) }
}

/** Whether a parsed profile declares a composite, which is read by readComposite and not readProfile. */
export const isComposite = dataset => dataset.match(null, iri(rdfTerms.type), iri(jig.CompositePlugin)).size > 0

/**
 * @returns {{ iri, label, audioInputs, audioOutputs, requires, members, connections, ports }}
 *   members: { id, plugin, pinnedDigest, settings: { symbol, value }[] }
 *   connections: { id, from, to, signalKind }, endpoints as { node, portIndex | portSymbol }
 *   ports: { symbol, drives: { node, portSymbol }[] }
 *   all sorted by IRI, since a composite states no order
 */
export function readComposite (dataset, { iri: wanted = null } = {}) {
  // `iri` picks one composite out of a document holding several plugins, as a flattened bundle does.
  const subjects = [...dataset.match(null, iri(rdfTerms.type), iri(jig.CompositePlugin))].map(q => q.subject)
    .filter(subject => wanted === null || subject.value === wanted)
  if (subjects.length === 0) throw new Error('the document declares no jig:CompositePlugin')
  if (subjects.length > 1) {
    throw new Error(`the document declares ${subjects.length} composites (${subjects.map(s => s.value).join(', ')}); a composite document holds one`)
  }
  const subject = subjects[0]
  const byId = (a, b) => a.id.localeCompare(b.id)

  const members = objects(dataset, subject, jig.member).map(m => ({
    id: m.value,
    plugin: first(dataset, m, jig.plugin),
    pinnedDigest: first(dataset, m, jig.pinnedDigest),
    settings: objects(dataset, m, jig.setting)
      .map(s => ({ symbol: first(dataset, s, jig.symbol), value: number(first(dataset, s, jig.value)) }))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
  })).sort(byId)

  const connections = objects(dataset, subject, jig.connection).map(c => ({
    id: c.value,
    from: readEndpoint(dataset, objects(dataset, c, jig.from)[0]),
    to: readEndpoint(dataset, objects(dataset, c, jig.to)[0]),
    signalKind: first(dataset, c, jig.signalKind)
  })).sort(byId)

  // A port is read as a plugin's is, so a panel, an envelope and a clamp treat a composite's controls
  // exactly as they treat any plugin's, and `drives` says which member parameters it moves.
  const ports = objects(dataset, subject, lv2.port).map(p => ({
    ...readPort(dataset, p),
    drives: objects(dataset, p, jig.drives).map(d => readEndpoint(dataset, d))
  })).sort((a, b) => a.symbol.localeCompare(b.symbol))

  return {
    iri: subject.value,
    label: first(dataset, subject, v.rdfs.label),
    comment: first(dataset, subject, v.rdfs.comment),
    vendor: first(dataset, subject, trn.vendor),
    homepage: first(dataset, subject, v.foaf.homepage),
    roles: objects(dataset, subject, trn.role).map(o => o.value),
    accepts: objects(dataset, subject, trn.accepts).map(o => o.value),
    produces: objects(dataset, subject, trn.produces).map(o => o.value),
    formats: objects(dataset, subject, trn.format).map(o => o.value),
    genres: objects(dataset, subject, trn.genre).map(o => o.value),
    cautions: objects(dataset, subject, trn.caution).map(o => o.value),
    inputChannels: number(first(dataset, subject, jig.inputChannels)) ?? 2,
    outputChannels: number(first(dataset, subject, jig.outputChannels)) ?? 2,
    audioInputs: number(first(dataset, subject, jig.audioInputs)),
    audioOutputs: number(first(dataset, subject, jig.audioOutputs)),
    requires: objects(dataset, subject, trn.requires).map(o => o.value),
    members,
    connections,
    ports
  }
}

/**
 * What the rest of the host reads in place of a plugin's profile: the same fields, from the
 * composite. It has no module or processor, declares no latency (it is derived from its members), and
 * is never `stateless`, because its members may not be.
 */
export const compositeProfile = composite => ({
  iri: composite.iri,
  label: composite.label,
  comment: composite.comment,
  vendor: composite.vendor,
  homepage: composite.homepage,
  roles: composite.roles,
  accepts: composite.accepts,
  produces: composite.produces,
  formats: composite.formats,
  genres: composite.genres,
  cautions: composite.cautions,
  recommendedBefore: [],
  recommendedAfter: [],
  requires: composite.requires,
  prefers: [],
  audioInputs: composite.audioInputs ?? 0,
  sidechainInput: null,
  audioOutputs: composite.audioOutputs ?? 0,
  inputChannels: composite.inputChannels,
  outputChannels: composite.outputChannels,
  renderQuantum: null,
  latencyFrames: 0,
  tailFrames: null,
  stateless: false,
  composite: true,
  // No code of its own: its members carry it.
  module: null,
  processor: null,
  ui: null,
  assets: [],
  ports: composite.ports
})

/**
 * The four rules the shapes cannot say. Returns a list of problems, each
 * `{ rule, message }`, empty when the composite is sound inside its own document.
 */
export function checkComposite (composite) {
  const problems = []
  const problem = (rule, message) => problems.push({ rule, message })
  const memberIds = new Set(composite.members.map(m => m.id))
  const known = id => id === composite.iri || memberIds.has(id)
  const AUDIO = trn.Audio

  if (memberIds.has(composite.iri)) {
    problem('member-is-composite', `${composite.iri} lists itself as a member`)
  }

  const exposed = new Set(composite.ports.map(p => p.symbol))
  const endpoints = composite.connections.flatMap(c => [['from', c], ['to', c]].map(([end, conn]) => ({ conn, end, ...conn[end] })))
  for (const e of endpoints) {
    if (!known(e.node)) problem('unknown-node', `${e.conn.id} ${e.end} names ${e.node}, which is neither a member nor the composite`)
    // A connection to the boundary by symbol is a connection to an exposed parameter.
    if (e.node === composite.iri && e.portSymbol !== undefined && !exposed.has(e.portSymbol)) {
      problem('unknown-port', `${e.conn.id} targets the composite's parameter "${e.portSymbol}", which it does not expose`)
    }
  }

  // Boundary audio. Direction says which side of the boundary a connection is on:
  // from the composite is an input, to the composite is an output.
  const audio = composite.connections.filter(c => c.signalKind === AUDIO)
  const inputIndices = audio.filter(c => c.from.node === composite.iri && c.from.portIndex !== undefined).map(c => c.from.portIndex)
  const outputIndices = audio.filter(c => c.to.node === composite.iri && c.to.portIndex !== undefined).map(c => c.to.portIndex)
  for (const index of inputIndices) {
    if (index >= composite.audioInputs) problem('boundary-count', `a connection leaves input ${index}, but the composite declares ${composite.audioInputs} audio input(s)`)
  }
  for (const index of outputIndices) {
    if (index >= composite.audioOutputs) problem('boundary-count', `a connection arrives at output ${index}, but the composite declares ${composite.audioOutputs} audio output(s)`)
  }
  for (let index = 0; index < composite.audioOutputs; index++) {
    if (!outputIndices.includes(index)) problem('boundary-count', `audio output ${index} has nothing connected to it`)
  }

  // Two answers to one question: contract 8.2's reason for not saving a value twice.
  for (const port of composite.ports) {
    for (const target of port.drives) {
      if (!memberIds.has(target.node)) {
        problem('unknown-node', `port "${port.symbol}" drives ${target.node}, which is not a member`)
        continue
      }
      const member = composite.members.find(m => m.id === target.node)
      if (member.settings.some(s => s.symbol === target.portSymbol)) {
        problem('setting-on-driven', `${member.id} sets "${target.portSymbol}", which port "${port.symbol}" drives`)
      }
    }
  }
  return problems
}
