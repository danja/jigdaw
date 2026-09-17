// src/rdf/ProjectWriter.js
//
// A project as Turtle, per docs/project-format.md.
//
// The format has been normative since phase 0 and nothing wrote it, which made
// every claim in that document a claim about a file nobody produced. It is also
// the reason a session could not survive closing the tab.
//
// Three rules from the specification shape this file and each is load bearing.
//
// No blank nodes: every node, connection, endpoint, setting and tempo point is
// skolemised as a fragment of the project IRI, so a project is diffable, can be
// re-ingested without duplicating itself, and is queryable in one triple pattern.
//
// Deterministic: the same project produces byte-identical output. Everything is
// emitted in sorted order, never in Map insertion order, so a diff shows what
// changed rather than how it happened to be written.
//
// Editor metadata is not here. `jig:x` and `jig:y` belong to a different graph,
// because dragging a node on screen must not invalidate a compiled audio graph.
// `writePositions` serialises that second graph separately.
import { vocabulary as v, JIG, TRN } from './Vocabulary.js'

const { jig } = v

const PREFIXES = [
  ['jig', JIG],
  ['trn', TRN],
  ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'],
  ['dcterms', 'http://purl.org/dc/terms/'],
  ['xsd', 'http://www.w3.org/2001/XMLSchema#']
]

/** A term as `prefix:local` when a prefix covers it, or as an absolute IRI. */
function term (iri) {
  for (const [prefix, namespace] of PREFIXES) {
    if (iri.startsWith(namespace)) return `${prefix}:${iri.slice(namespace.length)}`
  }
  return `<${iri}>`
}

function string (value) {
  return JSON.stringify(String(value))
}

/**
 * A decimal that survives a round trip.
 *
 * Turtle's bare number syntax makes 1 an integer and 1.0 a decimal, and a
 * parameter that went in as a float must not come back as an integer: the two
 * are different in the graph and a diff between runs would show a change that
 * did not happen.
 */
function decimal (value) {
  const n = Number(value)
  if (!Number.isFinite(n)) throw new Error(`not a finite number: ${value}`)
  return Number.isInteger(n) ? `${n}.0` : String(n)
}

function integer (value) {
  const n = Number(value)
  if (!Number.isInteger(n)) throw new Error(`not an integer: ${value}`)
  return String(n)
}

/** Sorted, because determinism is a rule of the format and not a nicety. */
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

function endpoint (lines, base, id, e) {
  // The specification: exactly one of portIndex or portSymbol, never both and
  // never neither. The model enforces it on the way in; this refuses to write
  // something the shapes would reject.
  const hasIndex = e.portIndex !== undefined && e.portIndex !== null
  const hasSymbol = e.portSymbol !== undefined && e.portSymbol !== null
  if (hasIndex === hasSymbol) {
    throw new Error(`endpoint ${id} must give exactly one of portIndex or portSymbol`)
  }
  const port = hasIndex
    ? `${term(jig.portIndex)} ${integer(e.portIndex)}`
    : `${term(jig.portSymbol)} ${string(e.portSymbol)}`
  lines.push(`<#${id}> a ${term(jig.Endpoint)} ; ` +
    `${term(jig.endpointNode)} <#${e.node}> ; ${port} .`)
}

/**
 * Serialise a project.
 *
 * `iri` is the project's own IRI and becomes the `@base`. Every fragment is
 * relative to it, so the same project written under a different IRI differs only
 * in that one line.
 */
export function writeProject (project, { iri, created = null } = {}) {
  if (!iri) throw new Error('writeProject needs the project IRI, which becomes the @base')

  const nodes = [...project.nodes].sort(byId)
  const connections = [...project.connections].sort(byId)
  const transport = project.transport

  const lines = []
  lines.push(`@base <${iri}> .`)
  lines.push('')
  for (const [prefix, namespace] of PREFIXES) lines.push(`@prefix ${prefix}: <${namespace}> .`)
  lines.push('')

  lines.push('<>')
  lines.push(`    a ${term(jig.Project)} ;`)
  if (project.label) lines.push(`    rdfs:label ${string(project.label)} ;`)
  if (created) lines.push(`    dcterms:created ${string(created)}^^xsd:dateTime ;`)
  lines.push(`    ${term(jig.revision)} ${integer(project.revision)} ;`)
  if (nodes.length > 0) {
    lines.push(`    ${term(jig.node)} ${nodes.map(n => `<#${n.id}>`).join(' , ')} ;`)
  }
  if (connections.length > 0) {
    lines.push(`    ${term(jig.connection)} ${connections.map(c => `<#${c.id}>`).join(' , ')} ;`)
  }
  lines.push(`    ${term(jig.transport)} <#transport> .`)

  for (const node of nodes) {
    lines.push('')
    lines.push(`<#${node.id}>`)
    lines.push(`    a ${term(jig.Node)} ;`)
    if (node.label) lines.push(`    rdfs:label ${string(node.label)} ;`)
    const settings = [...node.settings.keys()].sort()
    if (settings.length > 0) {
      lines.push(`    ${term(jig.setting)} ` +
        settings.map(s => `<#${node.id}-${s}>`).join(' , ') + ' ;')
    }
    // Opaque to the host: whatever the plugin returned when asked. Parameter
    // values are settings and are deliberately not in here, because storing them
    // in both places means the two disagree on restore.
    if (node.state) lines.push(`    ${term(jig.nodeState)} ${string(node.state)} ;`)
    lines.push(`    ${term(jig.plugin)} <${node.pluginIri}> .`)

    for (const symbol of settings) {
      lines.push(`<#${node.id}-${symbol}> a ${term(jig.ParameterSetting)} ; ` +
        `${term(jig.symbol)} ${string(symbol)} ; ` +
        `${term(jig.value)} ${decimal(node.settings.get(symbol))} .`)
    }
  }

  for (const c of connections) {
    lines.push('')
    lines.push(`<#${c.id}>`)
    lines.push(`    a ${term(jig.Connection)} ;`)
    lines.push(`    ${term(jig.from)} <#${c.id}-from> ; ${term(jig.to)} <#${c.id}-to> ;`)
    // Required. An audio edge and a host-routed MIDI edge look identical in the
    // graph and are handled by entirely different machinery, so the kind cannot
    // be inferred from the endpoints.
    lines.push(`    ${term(jig.signalKind)} ${term(c.signalKind)} .`)
    endpoint(lines, iri, `${c.id}-from`, c.from)
    endpoint(lines, iri, `${c.id}-to`, c.to)
  }

  const points = [...(transport.tempoPoints ?? [])]
    .sort((a, b) => a.atBeat - b.atBeat)
  lines.push('')
  lines.push('<#transport>')
  lines.push(`    a ${term(jig.Transport)} ;`)
  lines.push(`    ${term(jig.beatsPerBar)} ${integer(transport.beatsPerBar)} ; ` +
    `${term(jig.beatUnit)} ${integer(transport.beatUnit)} ;`)
  lines.push(`    ${term(jig.loopStart)} ${decimal(transport.loopStart)} ; ` +
    `${term(jig.loopEnd)} ${decimal(transport.loopEnd)} ; ` +
    `${term(jig.loopEnabled)} ${transport.loopEnabled ? 'true' : 'false'} ;`)
  lines.push(`    ${term(jig.tempoPoint)} ` +
    points.map((_, i) => `<#t${i}>`).join(' , ') + ' .')
  points.forEach((point, i) => {
    lines.push(`<#t${i}> a ${term(jig.TempoPoint)} ; ` +
      `${term(jig.atBeat)} ${decimal(point.atBeat)} ; ${term(jig.bpm)} ${decimal(point.bpm)} .`)
  })

  return lines.join('\n') + '\n'
}

/**
 * The editor's own graph: where the nodes sit on screen.
 *
 * A separate document because it is a separate graph. Moving a node must not
 * bump the project's revision or invalidate anything compiled from it.
 */
export function writePositions (project, { iri } = {}) {
  if (!iri) throw new Error('writePositions needs the project IRI')
  const lines = [`@base <${iri}> .`, '', `@prefix jig: <${JIG}> .`, '']
  for (const node of [...project.nodes].sort(byId)) {
    const { x, y } = project.position(node.id)
    lines.push(`<#${node.id}> ${term(jig.x)} ${decimal(x)} ; ${term(jig.y)} ${decimal(y)} .`)
  }
  return lines.join('\n') + '\n'
}
