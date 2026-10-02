// tests/ops/CompositePack.test.js
//
// Packing a selection into a composite plugin. The plan is checked on hand-built projects, where every case can be set up exactly. Then
// the whole thing is checked the only way that means anything: take a rack apart, pack what came out, load the result as a composite,
// and hear whether it is the rack again.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { planPack } from '../../src/ops/CompositePack.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { readComposite, checkComposite } from '../../src/rdf/CompositeReader.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { createTools } from '../../src/mcp/tools.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'
import { pinnedRack, servingAt, RACK_IRI } from '../../src/testing/CompositeFixtures.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const BOOST = `${ORIGIN}plugins/boost/`
const TREMOLO = `${ORIGIN}plugins/tremolo/`
const CASCADE = `${ORIGIN}plugins/cascade/`
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'
const PACKED = 'https://example.org/racks/packed/'

// A project reduced to what planPack reads.
const world = ({ nodes, connections = [], tracks = [{ id: 't', midiInput: null }], envelopes = [] }) => ({
  project: {
    node: id => nodes.find(n => n.id === id) ?? null,
    track: id => tracks.find(t => t.id === id) ?? null,
    connections,
    envelopes
  }
})
const node = (id, over = {}) => ({ id, label: id, track: 't', pluginIri: `https://p.example/${id}/`, settings: new Map(), bypassed: false, state: null, ...over })
const effect = { audioInputs: 1, audioOutputs: 1, ports: [{ symbol: 'gain', name: 'Gain', minimum: 0, maximum: 2 }] }
const synth = { audioInputs: 0, audioOutputs: 1, ports: [] }
const wire = (from, to, kind = AUDIO) => ({ from: { node: from, portIndex: 0 }, to: { node: to, portIndex: 0 }, signalKind: kind })

describe('planPack', () => {
  const plan = (nodes, profiles, extra = {}) => planPack({ ...world({ nodes, ...extra }), nodeIds: nodes.map(n => n.id), profileOf: id => profiles[id] ?? effect })

  it('gives an effect chain with nothing around it an input at its start and an output at its end', () => {
    const p = plan([node('a'), node('b')], {}, { connections: [wire('a', 'b')] })
    expect(p.audioInputs).toBe(1)
    expect(p.audioOutputs).toBe(1)
    expect(p.connections.filter(c => c.from.node === null).map(c => c.to.node)).toEqual(['a'])
    expect(p.connections.filter(c => c.to.node === null).map(c => c.from.node)).toEqual(['b'])
    expect(p.roles).toEqual(['http://purl.org/stuff/transmissions/AudioEffect'])
  })

  it('takes its boundary from what crosses the selection, so it is plugged in as it was', () => {
    const p = planPack({
      ...world({ nodes: [node('a'), node('b')], connections: [wire('outside', 'a'), wire('a', 'b'), wire('b', 'mixer')] }),
      nodeIds: ['a', 'b'], profileOf: () => effect
    })
    expect(p.connections.some(c => c.from.node === null && c.to.node === 'a')).toBe(true)
    expect(p.connections.some(c => c.from.node === 'b' && c.to.node === null)).toBe(true)
    expect(p.audioInputs).toBe(1)
    expect(p.audioOutputs).toBe(1)
  })

  it('counts one boundary port for each member port a crossing touches, and one wire for each', () => {
    const p = planPack({
      ...world({ nodes: [node('a'), node('b')], connections: [wire('x', 'a'), wire('y', 'a'), wire('x', 'b'), wire('a', 'z'), wire('b', 'z')] }),
      nodeIds: ['a', 'b'], profileOf: () => effect
    })
    // Two sources into a: one input, which sums. A third into b: another input. Two outputs, one each.
    expect(p.audioInputs).toBe(2)
    expect(p.audioOutputs).toBe(2)
    expect(p.connections.filter(c => c.from.node === null)).toHaveLength(2)
    expect(p.connections.filter(c => c.to.node === null)).toHaveLength(2)
  })

  it('makes a control of each parameter the person moved, in its own declared range, and fixes nothing it exposes', () => {
    const p = plan([node('boost', { label: 'Boost', settings: new Map([['gain', 0.7]]) })], {})
    expect(p.ports).toEqual([{ symbol: 'boost_gain', name: 'Boost Gain', minimum: 0, maximum: 2, defaultValue: 0.7, drives: [{ member: 'boost', symbol: 'gain' }] }])
    expect(p.members[0].settings).toEqual([])
  })

  it('fixes the moved parameters as voicing instead when asked, and offers no controls', () => {
    const p = planPack({ ...world({ nodes: [node('boost', { settings: new Map([['gain', 0.7]]) })] }), nodeIds: ['boost'], profileOf: () => effect, expose: 'none' })
    expect(p.ports).toEqual([])
    expect(p.members[0].settings).toEqual([{ symbol: 'gain', value: 0.7 }])
  })

  it('names two members of one plugin apart, and their controls too', () => {
    const p = plan([node('boost', { label: 'Boost', settings: new Map([['gain', 1]]) }), node('boost2', { label: 'Boost', settings: new Map([['gain', 0.5]]) })], {})
    expect(p.members.map(m => m.id)).toEqual(['boost', 'boost-2'])
    expect(p.ports.map(c => c.symbol)).toEqual(['boost_gain', 'boost_2_gain'])
  })

  it('gives an instrument a MIDI input when notes were played into its track, and says it needs MIDI', () => {
    const p = planPack({
      ...world({ nodes: [node('lead')], tracks: [{ id: 't', midiInput: 'lead' }] }),
      nodeIds: ['lead'], profileOf: () => synth
    })
    expect(p.connections.some(c => c.from.node === null && c.signalKind === MIDI && c.to.node === 'lead')).toBe(true)
    expect(p.accepts).toEqual([MIDI])
    expect(p.requires).toEqual(['http://purl.org/stuff/jigdaw/MidiEvents'])
    expect(p.roles).toContain('http://purl.org/stuff/transmissions/Instrument')
    expect(p.audioInputs).toBe(0)
  })

  it('says, rather than hides, what a composite cannot carry', () => {
    const p = planPack({
      ...world({
        nodes: [node('a', { state: 'eyJ4IjoxfQ==' }), node('b')],
        connections: [wire('a', 'b'), { from: { node: 'lfo', portIndex: 0 }, to: { node: 'b', portSymbol: 'gain' }, signalKind: AUDIO }],
        envelopes: [{ id: 'e', target: { node: 'a', symbol: 'gain' } }]
      }),
      nodeIds: ['a', 'b'], profileOf: () => effect
    })
    expect(p.warnings.join('\n')).toMatch(/a has saved state/)
    expect(p.warnings.join('\n')).toMatch(/automation on a is not carried/)
    expect(p.warnings.join('\n')).toMatch(/parameter "gain" is not carried/)
  })

  it('refuses an empty selection, a node twice, two tracks, a bypassed node, an unloaded one and a bad expose', () => {
    const base = { nodeIds: ['a'], profileOf: () => effect }
    expect(() => planPack({ ...world({ nodes: [node('a')] }), ...base, nodeIds: [] })).toThrow(/at least one/)
    expect(() => planPack({ ...world({ nodes: [node('a')] }), ...base, nodeIds: ['a', 'a'] })).toThrow(/twice/)
    expect(() => planPack({ ...world({ nodes: [node('a'), node('b', { track: 'u' })], tracks: [{ id: 't' }, { id: 'u' }] }), ...base, nodeIds: ['a', 'b'] })).toThrow(/more than one track/)
    expect(() => planPack({ ...world({ nodes: [node('a', { bypassed: true })] }), ...base })).toThrow(/bypassed/)
    expect(() => planPack({ ...world({ nodes: [node('a')] }), ...base, profileOf: () => null })).toThrow(/not loaded/)
    expect(() => planPack({ ...world({ nodes: [node('a')] }), ...base, nodeIds: ['ghost'] })).toThrow(/no such node/)
    expect(() => planPack({ ...world({ nodes: [node('a')] }), ...base, expose: 'all' })).toThrow(/"set" or "none"/)
  })
})

describe('packing a rack that was taken apart', () => {
  let validator
  let rackText
  beforeAll(async () => {
    validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    rackText = await pinnedRack(root)
  })

  function host (documents = {}) {
    const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
    let fetch = servingAt(RACK_IRI, rackText, site.fetch)
    for (const [iri, text] of Object.entries(documents)) fetch = servingAt(iri, text, fetch)
    const loader = new PluginLoader({ fetch, parse: parseText, validator, capabilities: detectCapabilities({}), processorUrl: site.processorUrl })
    const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
    return { engine, dispatcher: new OpDispatcher({ engine }) }
  }
  const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 6) * 0.4)
  const through = (nodes, quanta = 8) => {
    let out
    for (let q = 0; q < quanta; q++) { out = [signal, signal]; for (const n of nodes) out = n.render(out) }
    return out.map(c => Array.from(c))
  }

  /** The reference rack, set as given, taken apart, and packed again: the document, plus what the original rack sounded like. */
  async function roundTrip (settings = { drive: 0.8, depth: 0.7, room: 0.4 }) {
    const first = host()
    const added = await first.dispatcher.addPlugin(RACK_IRI)
    for (const [symbol, value] of Object.entries(settings)) first.dispatcher.setParameter(added.nodeId, symbol, value)
    const members = ['boost', 'tremolo', 'cascade'].map(name => added.entry.members.find(m => m.entry.iri === `${ORIGIN}plugins/${name}/`).entry.node)
    const original = through(members)
    expect((await first.dispatcher.unpackComposite(added.nodeId)).ok).toBe(true)
    const nodeIds = first.dispatcher.project.nodes.map(n => n.id)
    const packed = await first.dispatcher.packSelection({ nodeIds, iri: PACKED, label: 'Packed rack', comment: 'Taken apart and put back.' })
    return { first, packed, original }
  }

  it('writes a composite that validates, is sound, pins every member and exposes what was moved', async () => {
    const { packed } = await roundTrip()
    expect(packed.ok, packed.message).toBe(true)
    const dataset = await parseText(packed.turtle, PACKED)
    const report = await validator.validate(dataset)
    expect(report.violations.map(v => `${v.focusNode} ${v.path ?? ''}: ${v.message}`)).toEqual([])
    const composite = readComposite(dataset)
    expect(checkComposite(composite)).toEqual([])
    expect(composite.members.map(m => m.plugin).sort()).toEqual([BOOST, CASCADE, TREMOLO].sort())
    expect(composite.members.every(m => /^sha384-/.test(m.pinnedDigest))).toBe(true)
    // Every parameter that had a value is a control: the two moved, the room's default, and the author's rate.
    expect(composite.ports.length).toBeGreaterThanOrEqual(4)
    expect(packed.summary).toMatchObject({ members: 3, audioInputs: 1, audioOutputs: 1, pinned: 3 })
  })

  it('loads as a composite and sounds the same as the rack it came from', async () => {
    const { packed, original } = await roundTrip()
    const second = host({ [PACKED]: packed.turtle })
    const added = await second.dispatcher.addPlugin(PACKED)
    expect(added.ok, added.message).toBe(true)
    expect(added.entry.composite).toBe(true)
    const members = ['boost', 'tremolo', 'cascade'].map(name => added.entry.members.find(m => m.entry.iri === `${ORIGIN}plugins/${name}/`).entry.node)
    expect(original[0].some(v => Math.abs(v) > 1e-4)).toBe(true)
    expect(through(members)).toEqual(original)
  })

  it('refuses a selection it cannot describe, and an address nobody could publish at', async () => {
    const { first } = await roundTrip()
    const nodeIds = first.dispatcher.project.nodes.map(n => n.id)
    expect((await first.dispatcher.packSelection({ nodeIds, iri: 'ftp://nowhere/x', label: 'X' })).message).toMatch(/https IRI/)
    expect((await first.dispatcher.packSelection({ nodeIds, iri: PACKED, label: '  ' })).message).toMatch(/needs a name/)
    expect((await first.dispatcher.packSelection({ nodeIds: [], iri: PACKED, label: 'X' })).message).toMatch(/at least one/)
    first.dispatcher.apply([{ op: 'setNode', id: nodeIds[0], bypassed: true }])
    expect((await first.dispatcher.packSelection({ nodeIds, iri: PACKED, label: 'X' })).message).toMatch(/bypassed/)
  })

  it('changes nothing in the project', async () => {
    const { first } = await roundTrip()
    const before = first.dispatcher.project.revision
    const nodeIds = first.dispatcher.project.nodes.map(n => n.id)
    expect((await first.dispatcher.packSelection({ nodeIds, iri: PACKED, label: 'X' })).ok).toBe(true)
    expect(first.dispatcher.project.revision).toBe(before)
  })

  it('is offered to an agent as composite_pack, returning the document and what it could not carry', async () => {
    const { first } = await roundTrip()
    const pack = createTools({ dispatcher: first.dispatcher }).find(t => t.name === 'composite_pack')
    const nodeIds = first.dispatcher.project.nodes.map(n => n.id)
    const done = await pack.handler({ nodeIds, iri: PACKED, label: 'Via the tool', expose: 'none' })
    expect(done.ok, done.error).toBe(true)
    expect(done.turtle).toContain('rdfs:label "Via the tool"')
    expect(done.summary.controls).toBe(0)
    expect(Array.isArray(done.warnings)).toBe(true)
    expect((await pack.handler({ nodeIds, label: 'No address' })).ok).toBe(false)
  })
})
