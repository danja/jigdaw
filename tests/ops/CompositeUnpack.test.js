// tests/ops/CompositeUnpack.test.js
//
// Unpacking a composite plugin's node into its members, through the real dispatcher, engine, loader and processors, headless. What
// matters is the sound: the unpacked chain has to make what the rack made, and a failure has to leave the rack exactly as it was.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'
import { pinnedRack, servingAt, RACK_IRI } from '../../src/testing/CompositeFixtures.js'
import { createTools } from '../../src/mcp/tools.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const BOOST = `${ORIGIN}plugins/boost/`
const TREMOLO = `${ORIGIN}plugins/tremolo/`
const CASCADE = `${ORIGIN}plugins/cascade/`
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'

describe('unpacking a composite plugin', () => {
  let validator
  let rack
  beforeAll(async () => {
    validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    rack = await pinnedRack(root)
  })

  /** A dispatcher over a fresh engine. `gate.refuse` names a processor URL fragment the loader fails on, settable after the rack loads. */
  function host () {
    const gate = { refuse: null }
    const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
    const loader = new PluginLoader({
      fetch: servingAt(RACK_IRI, rack, site.fetch),
      parse: parseText,
      validator,
      capabilities: detectCapabilities({}),
      processorUrl: async (bytes, url) => {
        if (gate.refuse && url.includes(gate.refuse)) throw new Error(`refused ${url}`)
        return site.processorUrl(bytes, url)
      }
    })
    const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
    return { gate, engine, dispatcher: new OpDispatcher({ engine }) }
  }

  const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 6) * 0.4)
  const through = (nodes, quanta = 8) => {
    let out
    for (let q = 0; q < quanta; q++) { out = [signal, signal]; for (const node of nodes) out = node.render(out) }
    return out.map(channel => Array.from(channel))
  }
  const byPlugin = (dispatcher, iri) => dispatcher.project.nodes.find(n => n.pluginIri === iri)
  const memberOf = (entry, iri) => entry.members.find(m => m.entry.iri === iri).entry

  it('replaces the rack with its three members, on the same track, wired in order', async () => {
    const { engine, dispatcher } = host()
    const { nodeId, trackId } = await dispatcher.addPlugin(RACK_IRI)
    const result = await dispatcher.unpackComposite(nodeId)
    expect(result.ok, result.message).toBe(true)

    expect(dispatcher.project.node(nodeId)).toBeNull()
    expect(dispatcher.project.nodes.map(n => n.pluginIri).sort()).toEqual([BOOST, CASCADE, TREMOLO].sort())
    expect(dispatcher.project.nodes.every(n => n.track === trackId)).toBe(true)
    expect(engine.nodes()).toHaveLength(3)

    const [boost, trem, verb] = [BOOST, TREMOLO, CASCADE].map(iri => byPlugin(dispatcher, iri).id)
    const wires = dispatcher.project.connections.map(c => `${c.from.node}>${c.to.node}`).sort()
    expect(wires).toEqual([`${boost}>${trem}`, `${trem}>${verb}`].sort())
  })

  it('gives each member the value it had inside: the person\'s settings, the port defaults and the author\'s voicing', async () => {
    const { dispatcher } = host()
    const { nodeId } = await dispatcher.addPlugin(RACK_IRI)
    dispatcher.setParameter(nodeId, 'drive', 0.7)
    dispatcher.setParameter(nodeId, 'depth', 0.2)
    expect((await dispatcher.unpackComposite(nodeId)).ok).toBe(true)

    const setting = (iri, symbol) => dispatcher.project.node(byPlugin(dispatcher, iri).id).settings.get(symbol)
    expect(setting(BOOST, 'gain')).toBe(0.7)
    expect(setting(TREMOLO, 'depth')).toBe(0.2)
    expect(setting(TREMOLO, 'rate')).toBe(4.5)
    expect(setting(CASCADE, 'mix')).toBe(0.3)
    // And in the engine, not only in the model.
    expect(dispatcher.engineNode(byPlugin(dispatcher, BOOST).id).node.parameters.get('gain').value).toBe(0.7)
    expect(dispatcher.engineNode(byPlugin(dispatcher, TREMOLO).id).node.parameters.get('rate').value).toBe(4.5)
  })

  it('sounds the same as the rack did', async () => {
    const { dispatcher } = host()
    const { nodeId, entry } = await dispatcher.addPlugin(RACK_IRI)
    dispatcher.setParameters([{ nodeId, symbol: 'drive', value: 0.8 }, { nodeId, symbol: 'depth', value: 0.7 }, { nodeId, symbol: 'room', value: 0.4 }])
    const asRack = through([memberOf(entry, BOOST).node, memberOf(entry, TREMOLO).node, memberOf(entry, CASCADE).node])

    expect((await dispatcher.unpackComposite(nodeId)).ok).toBe(true)
    const unpacked = through([BOOST, TREMOLO, CASCADE].map(iri => dispatcher.engineNode(byPlugin(dispatcher, iri).id).node))
    expect(asRack[0].some(v => Math.abs(v) > 1e-4)).toBe(true)
    expect(unpacked).toEqual(asRack)
  })

  it('joins what fed the rack to its first member, and keeps it joined', async () => {
    const { dispatcher } = host()
    const rackAdded = await dispatcher.addPlugin(RACK_IRI)
    const pulse = await dispatcher.addPlugin(`${ORIGIN}plugins/pulse/`, { track: rackAdded.trackId })
    expect(dispatcher.apply([{ op: 'addConnection', from: { node: pulse.nodeId, portIndex: 0 }, to: { node: rackAdded.nodeId, portIndex: 0 }, signalKind: AUDIO }]).ok).toBe(true)

    expect((await dispatcher.unpackComposite(rackAdded.nodeId)).ok).toBe(true)
    const boost = byPlugin(dispatcher, BOOST).id
    expect(dispatcher.project.connections.some(c => c.from.node === pulse.nodeId && c.to.node === boost)).toBe(true)
    expect(dispatcher.project.connections.every(c => c.from.node !== rackAdded.nodeId && c.to.node !== rackAdded.nodeId)).toBe(true)
    expect(dispatcher.compile().ok).toBe(true)
  })

  it('is one undoable edit, and undo brings the rack back with its members', async () => {
    const { engine, dispatcher } = host()
    const { nodeId } = await dispatcher.addPlugin(RACK_IRI)
    dispatcher.setParameter(nodeId, 'drive', 0.6)
    expect((await dispatcher.unpackComposite(nodeId)).ok).toBe(true)
    expect(dispatcher.project.nodes).toHaveLength(3)

    await dispatcher.undo()
    expect(dispatcher.project.nodes.map(n => n.pluginIri)).toEqual([RACK_IRI])
    expect(engine.nodes()).toHaveLength(3)
    expect(dispatcher.project.node(dispatcher.project.nodes[0].id).settings.get('drive')).toBe(0.6)
  })

  it('keeps a bypassed rack bypassed, member by member', async () => {
    const { dispatcher } = host()
    const { nodeId } = await dispatcher.addPlugin(RACK_IRI)
    dispatcher.apply([{ op: 'setNode', id: nodeId, bypassed: true }])
    expect((await dispatcher.unpackComposite(nodeId)).ok).toBe(true)
    expect(dispatcher.project.nodes.every(n => n.bypassed === true)).toBe(true)
  })

  it('leaves the rack exactly as it was when a member will not load, with no stray nodes', async () => {
    const { gate, engine, dispatcher } = host()
    const { nodeId } = await dispatcher.addPlugin(RACK_IRI)
    gate.refuse = 'cascade'
    const result = await dispatcher.unpackComposite(nodeId)
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/could not unpack Stomp rack: Cascade/)
    expect(dispatcher.project.nodes.map(n => n.pluginIri)).toEqual([RACK_IRI])
    expect(engine.nodes()).toHaveLength(3)
    expect(dispatcher.compile().ok).toBe(true)
  })

  it('refuses a node that is not a composite, and a composite with automation on it', async () => {
    const { dispatcher } = host()
    const plain = await dispatcher.addPlugin(BOOST)
    const refusedPlain = await dispatcher.unpackComposite(plain.nodeId)
    expect(refusedPlain.ok).toBe(false)
    expect(refusedPlain.message).toMatch(/not a composite plugin/)

    const rackAdded = await dispatcher.addPlugin(RACK_IRI)
    const env = dispatcher.apply([{ op: 'addEnvelope', target: { node: rackAdded.nodeId, symbol: 'drive' }, points: [{ atBeat: 0, value: 0.5, curve: 'linear' }] }])
    // The envelope this test needs, built or the test fails: a refusal checked against nothing would pass quietly.
    expect(env.ok, env.message).toBe(true)
    const refused = await dispatcher.unpackComposite(rackAdded.nodeId)
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/automation/)
    expect(dispatcher.project.node(rackAdded.nodeId)).not.toBeNull()
  })

  it('is offered to an agent as node_unpack, which says what became of the rack and refuses what it cannot do', async () => {
    const { dispatcher } = host()
    const tools = createTools({ dispatcher })
    const unpack = tools.find(t => t.name === 'node_unpack')
    const { nodeId } = await dispatcher.addPlugin(RACK_IRI)

    expect((await unpack.handler({})).ok).toBe(false)
    const refused = await unpack.handler({ nodeId: 'ghost' })
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/not a composite plugin/)

    const done = await unpack.handler({ nodeId })
    expect(done.ok, done.error).toBe(true)
    expect(done.unpacked).toBe(nodeId)
    expect(done.nodeIds).toHaveLength(3)
    expect(dispatcher.project.nodes.map(n => n.id).sort()).toEqual([...done.nodeIds].sort())
  })
})
