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
// No blank nodes: every track, node, connection, endpoint, setting and tempo
// point is skolemised as a fragment of the project IRI, so a project is diffable, can be
// re-ingested without duplicating itself, and is queryable in one triple pattern.
//
// Deterministic: the same project produces byte-identical output. Everything is
// emitted in sorted order, never in Map insertion order, so a diff shows what
// changed rather than how it happened to be written.
//
// Editor metadata is not here. `jig:x` and `jig:y` belong to a different graph,
// because dragging a node on screen must not invalidate a compiled audio graph.
// `writeEditor` serialises that second graph separately.
import { vocabulary as v, JIG, TRN } from './Vocabulary.js'

const { jig, trn } = v

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

/**
 * A source under the project's own IRI, written relative to it, so a session
 * saved beside its media folder resolves wherever the folder is opened
 * (project-format.md "Clips"). Anything else is written as it is.
 */
function relativeTo (source, base) {
  if (!source.startsWith(base)) return source
  const rest = source.slice(base.length)
  // A first segment with a colon in it would read as a scheme.
  return rest === '' || rest.split('/')[0].includes(':') ? source : rest
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

  const tracks = [...project.tracks].sort(byId)
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
  if (tracks.length > 0) {
    lines.push(`    ${term(jig.track)} ${tracks.map(t => `<#${t.id}>`).join(' , ')} ;`)
  }
  if (nodes.length > 0) {
    lines.push(`    ${term(jig.node)} ${nodes.map(n => `<#${n.id}>`).join(' , ')} ;`)
  }
  if (connections.length > 0) {
    lines.push(`    ${term(jig.connection)} ${connections.map(c => `<#${c.id}>`).join(' , ')} ;`)
  }
  const master = project.master
  const masterIsDefault = master.gain === 1 && master.pan === 0 && !master.muted
  if (!masterIsDefault) lines.push(`    ${term(jig.master)} <#master> ;`)
  for (const [property, items] of [
    [jig.send, project.sends], [jig.marker, project.markers],
    [jig.region, project.regions], [jig.envelope, project.envelopes]
  ]) {
    if (items.length > 0) lines.push(`    ${term(property)} ${[...items].sort(byId).map(x => `<#${x.id}>`).join(' , ')} ;`)
  }
  lines.push(`    ${term(jig.transport)} <#transport> .`)

  for (const track of tracks) {
    lines.push('')
    lines.push(`<#${track.id}>`)
    const statements = [`a ${term(jig.Track)}`]
    if (track.label) statements.push(`rdfs:label ${string(track.label)}`)
    // The channel strip, written only where it differs from the default. A
    // project full of "gain 1.0, pan 0.0, not muted" says nothing and makes
    // every diff longer, and a reader supplies the defaults anyway.
    const channel = track.channel
    if (channel.gain !== 1) statements.push(`${term(jig.gain)} ${decimal(channel.gain)}`)
    if (channel.pan !== 0) statements.push(`${term(jig.pan)} ${decimal(channel.pan)}`)
    if (channel.muted) statements.push(`${term(jig.muted)} true`)
    if (channel.soloed) statements.push(`${term(jig.soloed)} true`)
    if (track.midiInput) statements.push(`${term(jig.midiInput)} <#${track.midiInput}>`)
    if (track.audioInput) statements.push(`${term(jig.audioInput)} <#${track.audioInput}>`)
    if (track.output) statements.push(`${term(jig.output)} <#${track.output}>`)
    const clips = (project.clips ?? []).filter(c => c.track === track.id).sort(byId)
    if (clips.length > 0) statements.push(`${term(jig.clip)} ${clips.map(c => `<#${c.id}>`).join(' , ')}`)
    lines.push(statements.map(st => `    ${st}`).join(' ;\n') + ' .')
  }

  // Clips, keyed by beat and never listed in order (project-format.md
  // "Clips"). A note is named by its place in the clip's notes, which the
  // model keeps sorted by start and pitch, so the same notes always write the
  // same names.
  for (const clip of [...(project.clips ?? [])].sort(byId)) {
    lines.push('')
    lines.push(`<#${clip.id}>`)
    const statements = [
      `a ${term(clip.kind === 'midi' ? jig.MidiClip : jig.AudioClip)}`,
      `${term(trn.startBeat)} ${decimal(clip.startBeat)} ; ${term(trn.lengthBeats)} ${decimal(clip.lengthBeats)}`
    ]
    if (clip.muted) statements.push(`${term(jig.muted)} true`)
    if (clip.locked) statements.push(`${term(jig.locked)} true`)
    if (clip.kind === 'audio') {
      statements.push(`${term(jig.source)} <${relativeTo(clip.source, iri)}>`)
      if (clip.offsetSeconds !== 0) statements.push(`${term(jig.offsetSeconds)} ${decimal(clip.offsetSeconds)}`)
      if (clip.fadeInBeats > 0) statements.push(`${term(jig.fadeInBeats)} ${decimal(clip.fadeInBeats)}`)
      if (clip.fadeOutBeats > 0) statements.push(`${term(jig.fadeOutBeats)} ${decimal(clip.fadeOutBeats)}`)
    } else if (clip.notes.length > 0) {
      statements.push(`${term(jig.note)} ${clip.notes.map((_, i) => `<#${clip.id}-n${i + 1}>`).join(' , ')}`)
    }
    lines.push(statements.map(st => `    ${st}`).join(' ;\n') + ' .')
    clip.notes.forEach((note, i) => {
      lines.push(`<#${clip.id}-n${i + 1}> a ${term(jig.Note)} ; ` +
        `${term(trn.startBeat)} ${decimal(note.startBeat)} ; ${term(trn.lengthBeats)} ${decimal(note.lengthBeats)} ; ` +
        `${term(trn.pitch)} ${integer(note.pitch)} ; ${term(trn.velocity)} ${integer(note.velocity)} .`)
    })
  }

  for (const node of nodes) {
    lines.push('')
    lines.push(`<#${node.id}>`)
    lines.push(`    a ${term(jig.Node)} ;`)
    if (node.label) lines.push(`    rdfs:label ${string(node.label)} ;`)
    lines.push(`    ${term(jig.onTrack)} <#${node.track}> ;`)
    const settings = [...node.settings.keys()].sort()
    if (settings.length > 0) {
      lines.push(`    ${term(jig.setting)} ` +
        settings.map(s => `<#${node.id}-${s}>`).join(' , ') + ' ;')
    }
    // Opaque to the host: whatever the plugin returned when asked. Parameter
    // values are settings and are deliberately not in here, because storing them
    // in both places means the two disagree on restore.
    if (node.bypassed) lines.push(`    ${term(jig.bypassed)} true ;`)
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

  writeArrangement(lines, project)

  const points = [...(transport.tempoPoints ?? [])]
    .sort((a, b) => a.atBeat - b.atBeat)
  lines.push('')
  lines.push('<#transport>')
  lines.push(`    a ${term(jig.Transport)} ;`)
  lines.push(`    ${term(jig.beatsPerBar)} ${integer(transport.beatsPerBar)} ; ` +
    `${term(jig.beatUnit)} ${integer(transport.beatUnit)} ;`)
  // The loop's bounds only when they describe a loop. A new project's are both
  // zero, which the shapes reject (a loop must start before it ends), so every
  // session saved before a loop was set was written invalid.
  const loop = transport.loopEnd > transport.loopStart
    ? `${term(jig.loopStart)} ${decimal(transport.loopStart)} ; ` +
      `${term(jig.loopEnd)} ${decimal(transport.loopEnd)} ; `
    : ''
  lines.push(`    ${loop}${term(jig.loopEnabled)} ${transport.loopEnabled ? 'true' : 'false'} ;`)
  const signatures = [...(transport.signaturePoints ?? [])].sort((a, b) => a.atBeat - b.atBeat)
  if (signatures.length > 0) {
    lines.push(`    ${term(jig.signaturePoint)} ${signatures.map((_, i) => `<#s${i}>`).join(' , ')} ;`)
  }
  lines.push(`    ${term(jig.tempoPoint)} ` +
    points.map((_, i) => `<#t${i}>`).join(' , ') + ' .')
  signatures.forEach((point, i) => {
    lines.push(`<#s${i}> a ${term(jig.SignaturePoint)} ; ` +
      `${term(jig.atBeat)} ${decimal(point.atBeat)} ; ${term(jig.beatsPerBar)} ${integer(point.beatsPerBar)} ; ` +
      `${term(jig.beatUnit)} ${integer(point.beatUnit)} .`)
  })
  points.forEach((point, i) => {
    lines.push(`<#t${i}> a ${term(jig.TempoPoint)} ; ` +
      `${term(jig.atBeat)} ${decimal(point.atBeat)} ; ${term(jig.bpm)} ${decimal(point.bpm)} .`)
  })

  return lines.join('\n') + '\n'
}

const TAP_TERM = { pre: 'PreFader', post: 'PostFader' }
const CURVE_TERM = { step: 'Step', linear: 'Linear', smooth: 'Smooth' }
const KIND_TERM = { masterGain: 'MasterGain', masterPan: 'MasterPan', tempo: 'Tempo' }

/** The master, sends, markers, regions and envelopes: docs/track-view-terms.md. */
function writeArrangement (lines, project) {
  const master = project.master
  if (master.gain !== 1 || master.pan !== 0 || master.muted) {
    const st = [`a ${term(jig.Master)}`]
    if (master.gain !== 1) st.push(`${term(jig.gain)} ${decimal(master.gain)}`)
    if (master.pan !== 0) st.push(`${term(jig.pan)} ${decimal(master.pan)}`)
    if (master.muted) st.push(`${term(jig.muted)} true`)
    lines.push('', `<#master> ${st.join(' ; ')} .`)
  }
  for (const s of [...project.sends].sort(byId)) {
    lines.push('', `<#${s.id}> a ${term(jig.Send)} ; ${term(jig.sendFrom)} <#${s.from}> ; ${term(jig.sendTo)} <#${s.to}> ; ` +
      `${term(jig.level)} ${decimal(s.level)} ; ${term(jig.tap)} ${term(jig[TAP_TERM[s.tap]])} .`)
  }
  for (const m of [...project.markers].sort(byId)) {
    lines.push('', `<#${m.id}> a ${term(jig.Marker)} ; ${term(jig.atBeat)} ${decimal(m.atBeat)}` +
      `${m.label ? ` ; rdfs:label ${string(m.label)}` : ''} .`)
  }
  for (const r of [...project.regions].sort(byId)) {
    lines.push('', `<#${r.id}> a ${term(jig.Region)} ; ${term(trn.startBeat)} ${decimal(r.startBeat)} ; ` +
      `${term(trn.lengthBeats)} ${decimal(r.lengthBeats)}${r.label ? ` ; rdfs:label ${string(r.label)}` : ''} .`)
  }
  for (const e of [...project.envelopes].sort(byId)) {
    const target = e.target.kind
      ? `${term(jig.targetKind)} ${term(jig[KIND_TERM[e.target.kind]])}`
      : `${term(jig.targetNode)} <#${e.target.node}> ; ${term(jig.targetSymbol)} ${string(e.target.symbol)}`
    const points = e.points
    lines.push('', `<#${e.id}> a ${term(jig.Envelope)} ; ${target}` +
      `${points.length > 0 ? ` ; ${term(jig.envelopePoint)} ${points.map((_, i) => `<#${e.id}-p${i}>`).join(' , ')}` : ''} .`)
    points.forEach((p, i) => {
      lines.push(`<#${e.id}-p${i}> a ${term(jig.EnvelopePoint)} ; ${term(jig.atBeat)} ${decimal(p.atBeat)} ; ` +
        `${term(jig.pointValue)} ${decimal(p.value)} ; ${term(jig.curve)} ${term(jig[CURVE_TERM[p.curve]])} .`)
    })
  }
}

/**
 * The editor's own graph: where nodes sit on screen, and how tracks are laid
 * out.
 *
 * A separate document because it is a separate graph. Moving a node or
 * reordering a track must not bump the project's revision or invalidate
 * anything compiled from it.
 */
export function writeEditor (project, { iri } = {}) {
  if (!iri) throw new Error('writeEditor needs the project IRI')
  const editor = project.editor
  const lines = [`@base <${iri}> .`, '', `@prefix jig: <${JIG}> .`, '']
  for (const node of [...project.nodes].sort(byId)) {
    const { x, y } = editor.position(node.id)
    if (x === 0 && y === 0) continue
    lines.push(`<#${node.id}> ${term(jig.x)} ${decimal(x)} ; ${term(jig.y)} ${decimal(y)} .`)
  }
  for (const track of [...project.tracks].sort(byId)) {
    const { order, color, laneSize } = editor.track(track.id)
    const parts = []
    if (order !== null) parts.push(`${term(jig.order)} ${integer(order)}`)
    if (color !== null) parts.push(`${term(jig.color)} ${string(color)}`)
    if (laneSize !== 'medium') parts.push(`${term(jig.laneSize)} ${string(laneSize)}`)
    if (parts.length > 0) lines.push(`<#${track.id}> ${parts.join(' ; ')} .`)
  }
  for (const clip of [...project.clips].sort(byId)) {
    const { color } = editor.clip(clip.id)
    if (color !== null) lines.push(`<#${clip.id}> ${term(jig.color)} ${string(color)} .`)
  }
  return lines.join('\n') + '\n'
}
