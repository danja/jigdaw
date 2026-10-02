// tests/ops/CompositeExpansion.test.js
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { expandComposites } from '../../src/ops/CompositeExpansion.js'
import { compileGraph } from '../../src/compiler/GraphCompiler.js'
import { readComposite } from '../../src/rdf/CompositeReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { parseTurtleFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const RACK = 'https://example.org/racks/stomp/'

const ep = (node, portIndex) => ({ node, portIndex })
const wire = (id, from, to) => ({ id, from, to, signalKind: AUDIO })
const plugin = iri => ({ kind: 'plugin', iri, profile: {}, granted: [] })

/** A resolved tree built from a composite document, its members standing in as plugins. */
const treeOf = (composite, nested = {}) => ({
  kind: 'composite', iri: composite.iri, composite, granted: [],
  members: composite.members.map(m => ({ id: m.id, plugin: m.plugin, tree: nested[m.id] ?? plugin(m.plugin) }))
})

/** A composite from Turtle: `members` are fragment names, `wires` are [from, fromPort, to, toPort], boundary is `<>`. */
async function composite (iri, memberNames, wires, { ports = '', inputs = 1, outputs = 1 } = {}) {
  const ends = wires.map(([f, fp, t, tp], i) => `
    <#c${i}> a jig:Connection ; jig:from <#c${i}-f> ; jig:to <#c${i}-t> ; jig:signalKind trn:Audio .
    <#c${i}-f> a jig:Endpoint ; jig:endpointNode ${f} ; ${typeof fp === 'string' ? `jig:portSymbol "${fp}"` : `jig:portIndex ${fp}`} .
    <#c${i}-t> a jig:Endpoint ; jig:endpointNode ${t} ; ${typeof tp === 'string' ? `jig:portSymbol "${tp}"` : `jig:portIndex ${tp}`} .`).join('\n')
  return readComposite(await parseText(`@base <${iri}> .
    @prefix jig: <http://purl.org/stuff/jigdaw/> . @prefix trn: <http://purl.org/stuff/transmissions/> .
    @prefix lv2: <http://lv2plug.in/ns/lv2core#> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    <> a jig:CompositePlugin ; rdfs:label "C" ; jig:audioInputs ${inputs} ; jig:audioOutputs ${outputs} ;
       jig:member ${memberNames.map(n => `<#${n}>`).join(' , ')} ;
       jig:connection ${wires.map((_, i) => `<#c${i}>`).join(' , ')} ${ports ? `; lv2:port ${ports.ids}` : ''} .
    ${memberNames.map(n => `<#${n}> a jig:Member ; jig:plugin <https://p.example/${n}/> .`).join('\n')}
    ${ends}
    ${ports ? ports.turtle : ''}`, iri))
}

const flatId = (...ids) => ids.reduce((parent, id) => JSON.stringify([parent, id]))
const shape = c => `${c.from.node}:${c.from.portIndex ?? c.from.portSymbol} > ${c.to.node}:${c.to.portIndex ?? c.to.portSymbol}`

describe('expandComposites', () => {
  it('does nothing to a project with no composite', () => {
    const nodes = [{ id: 'a' }, { id: 'b' }]
    const connections = [wire('c', ep('a', 0), ep('b', 0))]
    const out = expandComposites({ nodes, connections })
    expect(out.nodes.map(n => n.id)).toEqual(['a', 'b'])
    expect(out.connections).toEqual(connections)
  })

  it('replaces the reference rack by its members and joins the outside to them', async () => {
    const rack = readComposite(await parseTurtleFile(resolve(root, 'examples/reference-composite.ttl')))
    const out = expandComposites({
      nodes: [{ id: 'synth' }, { id: 'rack', plugin: RACK }, { id: 'amp' }],
      connections: [wire('a', ep('synth', 0), ep('rack', 0)), wire('b', ep('rack', 0), ep('amp', 0))],
      treeOf: id => (id === 'rack' ? treeOf(rack) : null)
    })
    const boost = flatId('rack', `${RACK}#boost`)
    const trem = flatId('rack', `${RACK}#trem`)
    const verb = flatId('rack', `${RACK}#verb`)
    expect(out.nodes.map(n => n.id).sort()).toEqual(['amp', boost, 'synth', trem, verb].sort())
    expect(out.connections.map(shape).sort()).toEqual([
      `synth:0 > ${boost}:0`, `${boost}:0 > ${trem}:0`, `${trem}:0 > ${verb}:0`, `${verb}:0 > amp:0`
    ].sort())
    // The path says where a member sits, so nothing has to take an id apart.
    expect(out.nodes.find(n => n.id === trem).path).toEqual(['rack', `${RACK}#trem`])
    expect(out.nodes.find(n => n.id === trem).plugin).toBe('https://strandz.it/jigdaw/plugins/tremolo/')
  })

  it('sends a connection to an exposed parameter to every member parameter it drives', async () => {
    const rack = await composite('https://example.org/racks/two/', ['a', 'b'],
      [['<>', 0, '<#a>', 0], ['<#a>', 0, '<#b>', 0], ['<#b>', 0, '<>', 0]], {
        ports: {
          ids: '<#amount>',
          turtle: `<#amount> a lv2:InputPort , lv2:ControlPort ; lv2:symbol "amount" ; lv2:name "A" ; lv2:default 0 ; lv2:minimum 0 ; lv2:maximum 1 ; jig:drives <#t1> , <#t2> .
            <#t1> a jig:Endpoint ; jig:endpointNode <#a> ; jig:portSymbol "gain" .
            <#t2> a jig:Endpoint ; jig:endpointNode <#b> ; jig:portSymbol "mix" .`
        }
      })
    const out = expandComposites({
      nodes: [{ id: 'lfo' }, { id: 'rack' }],
      connections: [{ id: 'm', from: ep('lfo', 0), to: { node: 'rack', portSymbol: 'amount' }, signalKind: AUDIO }],
      treeOf: id => (id === 'rack' ? treeOf(rack) : null)
    })
    const a = flatId('rack', 'https://example.org/racks/two/#a')
    const b = flatId('rack', 'https://example.org/racks/two/#b')
    expect(out.connections.filter(c => c.from.node === 'lfo').map(shape).sort())
      .toEqual([`lfo:0 > ${a}:gain`, `lfo:0 > ${b}:mix`].sort())
  })

  it('joins an input wired straight to an output, so the composite is a wire', async () => {
    const rack = await composite('https://example.org/racks/wire/', ['unused'], [['<>', 0, '<>', 0], ['<>', 0, '<#unused>', 0]])
    const out = expandComposites({
      nodes: [{ id: 'a' }, { id: 'rack' }, { id: 'b' }],
      connections: [wire('1', ep('a', 0), ep('rack', 0)), wire('2', ep('rack', 0), ep('b', 0))],
      treeOf: id => (id === 'rack' ? treeOf(rack) : null)
    })
    expect(out.connections.map(shape)).toContain('a:0 > b:0')
  })

  it('expands a composite inside a composite, and gives the innermost a path of three', async () => {
    const inner = await composite('https://example.org/racks/inner/', ['x'], [['<>', 0, '<#x>', 0], ['<#x>', 0, '<>', 0]])
    const outer = await composite('https://example.org/racks/outer/', ['i', 'y'],
      [['<>', 0, '<#i>', 0], ['<#i>', 0, '<#y>', 0], ['<#y>', 0, '<>', 0]])
    const innerTree = treeOf(inner)
    const out = expandComposites({
      nodes: [{ id: 'src' }, { id: 'r' }, { id: 'dst' }],
      connections: [wire('1', ep('src', 0), ep('r', 0)), wire('2', ep('r', 0), ep('dst', 0))],
      treeOf: id => (id === 'r' ? treeOf(outer, { 'https://example.org/racks/outer/#i': innerTree }) : null)
    })
    expect(out.nodes.map(n => n.path.length).sort()).toEqual([1, 1, 2, 3])
    expect(out.nodes.find(n => n.path.length === 3).path).toEqual(['r', 'https://example.org/racks/outer/#i', 'https://example.org/racks/inner/#x'])
    // No composite is left and every connection ends at a node that exists.
    const ids = new Set(out.nodes.map(n => n.id))
    expect(out.connections.every(c => ids.has(c.from.node) && ids.has(c.to.node))).toBe(true)
    expect(out.connections).toHaveLength(3)
  })

  it('marks the members of a bypassed composite bypassed', async () => {
    const rack = readComposite(await parseTurtleFile(resolve(root, 'examples/reference-composite.ttl')))
    const out = expandComposites({
      nodes: [{ id: 'rack' }, { id: 'other' }], connections: [],
      treeOf: id => (id === 'rack' ? treeOf(rack) : null), bypassed: id => id === 'rack'
    })
    expect(out.nodes.filter(n => n.bypassed)).toHaveLength(3)
    expect(out.nodes.find(n => n.id === 'other').bypassed).toBe(false)
  })

  it('drops a connection to an input nothing inside is wired to', async () => {
    const rack = await composite('https://example.org/racks/deaf/', ['a'], [['<#a>', 0, '<>', 0]], { inputs: 2 })
    const out = expandComposites({
      nodes: [{ id: 's' }, { id: 'rack' }], connections: [wire('1', ep('s', 0), { node: 'rack', portIndex: 1 })],
      treeOf: id => (id === 'rack' ? treeOf(rack) : null)
    })
    expect(out.connections).toEqual([])
  })
})

describe('a composite compensates like its members wired by hand', () => {
  // Dry through nothing and wet through a 256-frame member, both into one mix. Inside a rack the
  // dry path and the wet path are the rack's own business, and the compiler must still align them.
  it('gives the same arrival, total and delays as the flat graph', async () => {
    const rack = await composite('https://example.org/racks/par/', ['dry', 'wet'], [
      ['<>', 0, '<#dry>', 0], ['<>', 0, '<#wet>', 0], ['<#dry>', 0, '<>', 0], ['<#wet>', 0, '<>', 0]])
    const dry = flatId('rack', 'https://example.org/racks/par/#dry')
    const wet = flatId('rack', 'https://example.org/racks/par/#wet')
    const expanded = expandComposites({
      nodes: [{ id: 'src' }, { id: 'rack' }, { id: 'out' }],
      connections: [wire('1', ep('src', 0), ep('rack', 0)), wire('2', ep('rack', 0), ep('out', 0))],
      treeOf: id => (id === 'rack' ? treeOf(rack) : null)
    })
    const latency = { [wet]: 256, wet: 256 }

    const viaRack = compileGraph({ nodes: expanded.nodes, connections: expanded.connections }, { latencyOf: id => latency[id] ?? 0 })
    const byHand = compileGraph({
      nodes: ['src', 'dry', 'wet', 'out'].map(id => ({ id })),
      connections: [
        wire('h1', ep('src', 0), ep('dry', 0)), wire('h2', ep('src', 0), ep('wet', 0)),
        wire('h3', ep('dry', 0), ep('out', 0)), wire('h4', ep('wet', 0), ep('out', 0))
      ]
    }, { latencyOf: id => latency[id] ?? 0 })

    expect(viaRack.ok).toBe(true)
    expect(viaRack.totalLatency).toBe(256)
    expect(viaRack.totalLatency).toBe(byHand.totalLatency)
    expect(viaRack.arrival.get('out')).toBe(byHand.arrival.get('out'))
    // The dry path is held back by the wet member's latency, by the same amount either way.
    expect(viaRack.compensation.map(c => c.delayFrames)).toEqual([256])
    expect(viaRack.compensation.map(c => c.delayFrames)).toEqual(byHand.compensation.map(c => c.delayFrames))
    const delayed = viaRack.compensation[0].connection
    expect(expanded.connections.find(c => c.id === delayed).from.node).toBe(dry)
  })
})
