// tests/ops/SwapPlugin.test.js
//
// Replacing one plugin with another in place, through the real dispatcher, engine, loader and processors, headless. What matters is
// that the chain is still a chain afterwards, that nothing is dropped unseen, and that a failure leaves the old plugin as it was.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'
import { createTools } from '../../src/mcp/tools.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const BOOST = `${ORIGIN}plugins/boost/`
const TREMOLO = `${ORIGIN}plugins/tremolo/`
const CASCADE = `${ORIGIN}plugins/cascade/`
const PULSE = `${ORIGIN}plugins/pulse/`
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'

describe('swapping a plugin in place', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  function host () {
    const gate = { refuse: null }
    const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
    const loader = new PluginLoader({
      fetch: site.fetch,
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

  /** Boost > Tremolo > Cascade on one track. */
  async function chain (dispatcher) {
    const a = await dispatcher.addPlugin(BOOST)
    const b = await dispatcher.addPlugin(TREMOLO, { track: a.trackId })
    const c = await dispatcher.addPlugin(CASCADE, { track: a.trackId })
    const join = (from, to) => dispatcher.apply([{ op: 'addConnection', from: { node: from, portIndex: 0 }, to: { node: to, portIndex: 0 }, signalKind: AUDIO }])
    expect(join(a.nodeId, b.nodeId).ok).toBe(true)
    expect(join(b.nodeId, c.nodeId).ok).toBe(true)
    return { a: a.nodeId, b: b.nodeId, c: c.nodeId, track: a.trackId }
  }
  const wires = dispatcher => dispatcher.project.connections.map(c => `${c.from.node}>${c.to.node}`).sort()

  it('puts the new plugin where the old one was, joined the same way, and removes the old one, in one undo step', async () => {
    const { dispatcher, engine } = host()
    const { a, b, c, track } = await chain(dispatcher)
    const result = await dispatcher.swapPlugin(b, BOOST)
    expect(result.ok, result.message).toBe(true)

    expect(dispatcher.project.node(b)).toBeNull()
    const fresh = dispatcher.project.node(result.nodeId)
    expect(fresh.pluginIri).toBe(BOOST)
    expect(fresh.track).toBe(track)
    expect(wires(dispatcher)).toEqual([`${a}>${result.nodeId}`, `${result.nodeId}>${c}`].sort())
    expect(engine.nodes()).toHaveLength(3)

    await dispatcher.undo()
    expect(dispatcher.project.node(b)?.pluginIri).toBe(TREMOLO)
    expect(dispatcher.project.node(result.nodeId)).toBeNull()
    expect(wires(dispatcher)).toEqual([`${a}>${b}`, `${b}>${c}`].sort())
  })

  it('carries a setting whose parameter the new plugin has, and says in words which it could not carry', async () => {
    const { dispatcher } = host()
    const { b } = await chain(dispatcher)
    dispatcher.setParameter(b, 'depth', 0.6)
    const result = await dispatcher.swapPlugin(b, BOOST)
    expect(result.ok, result.message).toBe(true)
    // Boost has no depth, so the setting is reported rather than lost quietly.
    expect(result.dropped.join(' ')).toMatch(/setting depth was not carried/)
    expect(dispatcher.project.node(result.nodeId).settings.has('depth')).toBe(false)

    const again = await dispatcher.swapPlugin(result.nodeId, TREMOLO)
    expect(again.ok, again.message).toBe(true)
    dispatcher.setParameter(again.nodeId, 'depth', 0.3)
    const back = await dispatcher.swapPlugin(again.nodeId, `${ORIGIN}plugins/tremolo/`.replace('tremolo', 'cascade'))
    expect(back.ok, back.message).toBe(true)
  })

  it('keeps a label a person gave, drops the old plugin\'s own name, and keeps bypass', async () => {
    const { dispatcher } = host()
    const { b } = await chain(dispatcher)
    dispatcher.apply([{ op: 'setNode', id: b, bypassed: true }])
    const result = await dispatcher.swapPlugin(b, BOOST)
    expect(result.ok, result.message).toBe(true)
    const fresh = dispatcher.project.node(result.nodeId)
    expect(fresh.bypassed).toBe(true)
    expect(fresh.label).not.toBe(null)
    // The tremolo's own name is not carried to a boost.
    expect(fresh.label).not.toMatch(/tremolo/i)
  })

  it('does not carry a join the new plugin has no port for, and says so', async () => {
    const { dispatcher } = host()
    const { a, b, c } = await chain(dispatcher)
    // Pulse is an instrument: it gives audio and takes none.
    const result = await dispatcher.swapPlugin(b, PULSE)
    expect(result.ok, result.message).toBe(true)
    expect(wires(dispatcher)).toEqual([`${result.nodeId}>${c}`])
    expect(result.dropped.join(' ')).toMatch(/audio join from .* was not carried/)
    expect(dispatcher.project.node(a)).not.toBeNull()
  })

  it('moves the track\'s MIDI input to the new plugin when it takes MIDI, and says when it cannot', async () => {
    const { dispatcher } = host()
    const first = await dispatcher.addPlugin(PULSE)
    expect(dispatcher.project.track(first.trackId).midiInput).toBe(first.nodeId)
    const swapped = await dispatcher.swapPlugin(first.nodeId, `${ORIGIN}plugins/pulse/`)
    expect(swapped.ok).toBe(false)
    expect(swapped.message).toMatch(/already there/)

    const toBoost = await dispatcher.swapPlugin(first.nodeId, BOOST)
    expect(toBoost.ok, toBoost.message).toBe(true)
    expect(dispatcher.project.track(first.trackId).midiInput ?? null).toBe(null)
    expect(toBoost.dropped.join(' ')).toMatch(/takes no MIDI/)
  })

  it('refuses a node with automation on it, and a node that is not there, changing nothing', async () => {
    const { dispatcher, engine } = host()
    const { b } = await chain(dispatcher)
    const env = dispatcher.apply([{ op: 'addEnvelope', target: { node: b, symbol: 'depth' }, points: [{ atBeat: 0, value: 0.1, curve: 'linear' }, { atBeat: 4, value: 0.9, curve: 'linear' }] }])
    expect(env.ok, env.message).toBe(true)
    const before = dispatcher.project.revision
    const refused = await dispatcher.swapPlugin(b, BOOST)
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/automation/)
    expect(dispatcher.project.revision).toBe(before)
    expect(engine.nodes()).toHaveLength(3)
    expect((await dispatcher.swapPlugin('ghost', BOOST)).message).toMatch(/no such node/)
  })

  it('leaves the old plugin exactly as it was when the new one will not load', async () => {
    const { dispatcher, engine, gate } = host()
    const { a, b, c } = await chain(dispatcher)
    gate.refuse = 'boost'
    const before = dispatcher.project.revision
    const result = await dispatcher.swapPlugin(b, BOOST)
    expect(result.ok).toBe(false)
    expect(dispatcher.project.node(b)?.pluginIri).toBe(TREMOLO)
    expect(wires(dispatcher)).toEqual([`${a}>${b}`, `${b}>${c}`].sort())
    expect(engine.nodes()).toHaveLength(3)
    expect(dispatcher.project.revision).toBe(before)
  })

  it('is offered to an agent as node_swap, which asks for both arguments and reports what was dropped', async () => {
    const { dispatcher } = host()
    const swap = createTools({ dispatcher }).find(t => t.name === 'node_swap')
    const { b } = await chain(dispatcher)
    expect((await swap.handler({})).ok).toBe(false)
    expect((await swap.handler({ nodeId: b })).ok).toBe(false)
    dispatcher.setParameter(b, 'depth', 0.4)
    const done = await swap.handler({ nodeId: b, iri: BOOST })
    expect(done.ok, done.error).toBe(true)
    expect(done.replaced).toBe(b)
    expect(done.dropped.join(' ')).toMatch(/depth/)
  })
})

describe('the plan for a swap', () => {
  const profile = (over = {}) => ({ label: 'New', audioInputs: 1, audioOutputs: 1, accepts: [], produces: [], ports: [{ symbol: 'gain', name: 'Gain' }], ...over })
  const project = (over = {}) => ({
    node: id => (id === 'n1' ? { id: 'n1', track: 't1', label: null, bypassed: false, settings: new Map([['gain', 0.5], ['depth', 0.2]]) } : null),
    track: () => ({ midiInput: null, audioInput: null }),
    connections: [], envelopes: [], master: { audioInput: null }, ...over
  })

  it('carries only the settings the new profile has a parameter for, and names the rest', async () => {
    const { planSwap } = await import('../../src/ops/SwapPlugin.js')
    const plan = planSwap({ project: project(), nodeId: 'n1', oldProfile: profile({ label: 'Old' }), newProfile: profile() })
    expect(plan.settings).toEqual({ gain: 0.5 })
    expect(plan.dropped).toEqual([expect.stringMatching(/setting depth was not carried/)])
  })

  it('refuses a plugin with automation, naming it', async () => {
    const { planSwap } = await import('../../src/ops/SwapPlugin.js')
    const withEnvelope = project({ envelopes: [{ target: { node: 'n1', symbol: 'gain' } }] })
    expect(() => planSwap({ project: withEnvelope, nodeId: 'n1', oldProfile: profile(), newProfile: profile() })).toThrow(/automation/)
    expect(() => planSwap({ project: project(), nodeId: 'ghost', oldProfile: null, newProfile: profile() })).toThrow(/no such node/)
  })
})
