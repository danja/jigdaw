// src/rdf/CompositeWriter.js
//
// A composite plugin's profile as Turtle. docs/nested-plugins.md.
//
// Deterministic, so the same composite produces the same bytes and a diff shows what changed. Every node is named as a fragment of
// the composite's own IRI, with no blank node, because a profile with one cannot be signed. The reader is the other half: what this
// writes, src/rdf/CompositeReader.js reads back, and the tests hold the two together.
//
// It writes what it is given and checks little. Whether the result is sound is the shapes' question and CompositeReader's, and a
// caller that wants to know asks them, as tests/rdf/CompositeWriter.test.js does.

const TRN = 'trn:'
const BOUNDARY = '<>'

const literal = text => `"${String(text).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r').replace(/\t/g, '\\t')}"`
const number = value => {
  if (!Number.isFinite(value)) throw new Error(`cannot write ${value} as a number`)
  return String(value)
}
const compact = iri => (String(iri).startsWith('http://purl.org/stuff/transmissions/') ? `${TRN}${String(iri).slice('http://purl.org/stuff/transmissions/'.length)}` : `<${iri}>`)

/**
 * @param spec
 *   iri, label, comment?, vendor?
 *   roles, accepts, produces: transmissions IRIs
 *   audioInputs, audioOutputs: counts; inputChannels?, outputChannels?
 *   requires?: capability IRIs
 *   members:     { id, plugin, pinnedDigest?, settings?: { symbol, value }[] }[]
 *   connections: { from, to, signalKind }[] where an end is { node: memberId | null, portIndex | portSymbol }, `null` meaning the composite itself
 *   ports:       { symbol, name, minimum, maximum, defaultValue, drives: { member, symbol }[] }[]
 */
export function writeComposite (spec) {
  const out = []
  const line = text => out.push(text)
  const frag = id => `<#${id}>`
  const end = e => (e.node === null ? BOUNDARY : frag(e.node))

  line(`@base <${spec.iri}> .`)
  line('')
  for (const [prefix, iri] of [['jig', 'http://purl.org/stuff/jigdaw/'], ['trn', 'http://purl.org/stuff/transmissions/'], ['lv2', 'http://lv2plug.in/ns/lv2core#'],
    ['rdfs', 'http://www.w3.org/2000/01/rdf-schema#'], ['foaf', 'http://xmlns.com/foaf/0.1/']]) {
    line(`@prefix ${`${prefix}:`.padEnd(6)} <${iri}> .`)
  }
  line('')

  const connectionIds = spec.connections.map((_, i) => `c${i + 1}`)
  const head = [
    'a jig:CompositePlugin , trn:PluginProfile',
    `rdfs:label ${literal(spec.label)}`,
    ...(spec.comment ? [`rdfs:comment ${literal(spec.comment)}`] : []),
    ...(spec.vendor ? [`trn:vendor ${literal(spec.vendor)}`] : []),
    'foaf:homepage <>',
    ...spec.roles.map(r => `trn:role ${compact(r)}`),
    ...spec.accepts.map(a => `trn:accepts ${compact(a)}`),
    ...spec.produces.map(p => `trn:produces ${compact(p)}`),
    'trn:format trn:Jig',
    ...((spec.requires ?? []).map(r => `trn:requires ${compact(r)}`)),
    `jig:audioInputs ${spec.audioInputs}`,
    ...(spec.inputChannels ? [`jig:inputChannels ${spec.inputChannels}`] : []),
    `jig:audioOutputs ${spec.audioOutputs}`,
    ...(spec.outputChannels ? [`jig:outputChannels ${spec.outputChannels}`] : []),
    `jig:member ${spec.members.map(m => frag(m.id)).join(' , ')}`,
    `jig:connection ${connectionIds.map(frag).join(' , ')}`,
    ...(spec.ports.length > 0 ? [`lv2:port ${spec.ports.map(p => frag(p.symbol)).join(' , ')}`] : [])
  ]
  line('<>')
  head.forEach((statement, i) => line(`    ${statement}${i === head.length - 1 ? ' .' : ' ;'}`))
  line('')

  for (const member of spec.members) {
    const statements = ['a jig:Member', `jig:plugin <${member.plugin}>`]
    if (member.pinnedDigest) statements.push(`jig:pinnedDigest ${literal(member.pinnedDigest)}`)
    const settings = member.settings ?? []
    if (settings.length > 0) statements.push(`jig:setting ${settings.map(s => frag(`${member.id}-${s.symbol}`)).join(' , ')}`)
    line(`${frag(member.id)} ${statements.join(' ;\n    ')} .`)
    for (const s of settings) {
      line(`${frag(`${member.id}-${s.symbol}`)} a jig:ParameterSetting ; jig:symbol ${literal(s.symbol)} ; jig:value ${number(s.value)} .`)
    }
    line('')
  }

  spec.connections.forEach((c, i) => {
    const id = connectionIds[i]
    const port = e => (e.portSymbol !== undefined ? `jig:portSymbol ${literal(e.portSymbol)}` : `jig:portIndex ${e.portIndex}`)
    line(`${frag(id)} a jig:Connection ; jig:from ${frag(`${id}-from`)} ; jig:to ${frag(`${id}-to`)} ; jig:signalKind ${compact(c.signalKind)} .`)
    line(`${frag(`${id}-from`)} a jig:Endpoint ; jig:endpointNode ${end(c.from)} ; ${port(c.from)} .`)
    line(`${frag(`${id}-to`)} a jig:Endpoint ; jig:endpointNode ${end(c.to)} ; ${port(c.to)} .`)
  })
  line('')

  for (const port of spec.ports) {
    line(`${frag(port.symbol)}`)
    line('    a lv2:InputPort , lv2:ControlPort ;')
    line(`    lv2:symbol ${literal(port.symbol)} ; lv2:name ${literal(port.name)} ;`)
    line(`    lv2:default ${number(port.defaultValue)} ; lv2:minimum ${number(port.minimum)} ; lv2:maximum ${number(port.maximum)} ;`)
    line(`    jig:drives ${port.drives.map((_, k) => frag(`${port.symbol}-target-${k + 1}`)).join(' , ')} .`)
    port.drives.forEach((d, k) => {
      line(`${frag(`${port.symbol}-target-${k + 1}`)} a jig:Endpoint ; jig:endpointNode ${frag(d.member)} ; jig:portSymbol ${literal(d.symbol)} .`)
    })
    line('')
  }

  return `${out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`
}
