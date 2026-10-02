// tests/ops/CompositeDispatcher.test.js
//
// A composite plugin through the real dispatcher, engine, loader and the plugins' own processors,
// headless. The test suite cannot see wiring mistakes by reasoning about them, so this renders: the
// rack must make the same sound as the same three plugins wired by hand, and what it does to the model
// (one node, one setting per exposed port) must be what the model says.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { openProject } from '../../src/ops/OpenProject.js'
import { writeProject } from '../../src/rdf/ProjectWriter.js'
import { readProject } from '../../src/rdf/ProjectReader.js'
import { encodeState } from '../../src/host/StateCodec.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'
import { pinnedRack, servingAt, RACK_IRI } from '../../src/testing/CompositeFixtures.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const BOOST = `${ORIGIN}plugins/boost/`
const TREMOLO = `${ORIGIN}plugins/tremolo/`
const CASCADE = `${ORIGIN}plugins/cascade/`

describe('a composite plugin in a dispatcher', () => {
  let validator
  let rackText
  beforeAll(async () => {
    validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    rackText = await pinnedRack(root)
  })

  /** A dispatcher over a fresh engine. `refuse` names a processor URL fragment the loader must fail on. */
  function host ({ refuse = null, rack = rackText } = {}) {
    const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
    const loader = new PluginLoader({
      fetch: servingAt(RACK_IRI, rack, site.fetch),
      parse: parseText,
      validator,
      capabilities: detectCapabilities({}),
      processorUrl: async (bytes, url) => {
        if (refuse && url.includes(refuse)) throw new Error(`refused ${url}`)
        return site.processorUrl(bytes, url)
      }
    })
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader, AudioWorkletNode: OfflineWorkletNode })
    return { engine, loader, dispatcher: new OpDispatcher({ engine }) }
  }

  const memberOf = (entry, iri) => entry.members.find(m => m.entry.iri === iri).entry
  const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 6) * 0.4)
  /** Push one signal through nodes in order for several quanta, returning the last output. */
  const through = (nodes, quanta = 8) => {
    let out
    for (let q = 0; q < quanta; q++) {
      out = [signal, signal]
      for (const node of nodes) out = node.render(out)
    }
    return out.map(channel => Array.from(channel))
  }

  it('is one node in the project and three in the engine', async () => {
    const { engine, dispatcher } = host()
    const result = await dispatcher.addPlugin(RACK_IRI)
    expect(result.ok, result.message).toBe(true)

    expect(dispatcher.project.nodes).toHaveLength(1)
    expect(dispatcher.project.node(result.nodeId).pluginIri).toBe(RACK_IRI)
    expect(engine.nodes()).toHaveLength(3)
    const node = dispatcher.engineNode(result.nodeId)
    expect(node.profile.label).toBe('Stomp rack')
    expect(node.profile.ports.map(p => p.symbol).sort()).toEqual(['depth', 'drive', 'room'])
  })

  it('wires the members in order and the last one to the track', async () => {
    const { engine, dispatcher } = host()
    const { entry, trackId } = await dispatcher.addPlugin(RACK_IRI)
    const boost = memberOf(entry, BOOST).node
    const trem = memberOf(entry, TREMOLO).node
    const verb = memberOf(entry, CASCADE).node

    expect(boost.connections.map(c => c.destination)).toEqual([trem])
    expect(trem.connections.map(c => c.destination)).toEqual([verb])
    expect(verb.connections.map(c => c.destination)).toEqual([engine.trackInput(trackId)])
  })

  it('compiles the flat graph, so no composite appears in it', async () => {
    const { dispatcher } = host()
    const { nodeId } = await dispatcher.addPlugin(RACK_IRI)
    const compiled = dispatcher.compile()
    expect(compiled.ok).toBe(true)
    expect(compiled.order).toHaveLength(3)
    expect(compiled.order).not.toContain(nodeId)
  })

  it('applies the author\'s voicing at load: member settings and each exposed port\'s default', async () => {
    const { dispatcher } = host()
    const { entry } = await dispatcher.addPlugin(RACK_IRI)
    // The rack fixes tremolo's rate at 4.5, which no control reaches.
    expect(memberOf(entry, TREMOLO).node.parameters.get('rate').value).toBe(4.5)
    // Each port's default goes to what it drives.
    expect(memberOf(entry, BOOST).node.parameters.get('gain').value).toBe(1)
    expect(memberOf(entry, TREMOLO).node.parameters.get('depth').value).toBe(0.5)
    expect(memberOf(entry, CASCADE).node.parameters.get('mix').value).toBe(0.3)
  })

  it('sets an exposed port on the model and on the member it drives', async () => {
    const { dispatcher } = host()
    const { nodeId, entry } = await dispatcher.addPlugin(RACK_IRI)
    const result = dispatcher.setParameter(nodeId, 'drive', 0.5)
    expect(result.ok).toBe(true)
    expect(dispatcher.project.node(nodeId).settings.get('drive')).toBe(0.5)
    expect(memberOf(entry, BOOST).node.parameters.get('gain').value).toBe(0.5)
    // The member's own parameter is not a setting of the node, which has only what it exposes.
    expect(dispatcher.project.node(nodeId).settings.has('gain')).toBe(false)
  })

  it('clamps to the range the port declares, and refuses a parameter it does not expose', async () => {
    const { dispatcher } = host()
    const { nodeId, entry } = await dispatcher.addPlugin(RACK_IRI)
    expect(dispatcher.setParameter(nodeId, 'drive', 99).value).toBe(2)
    expect(memberOf(entry, BOOST).node.parameters.get('gain').value).toBe(2)
    const refused = dispatcher.setParameter(nodeId, 'rate', 9)
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/no parameter "rate"/)
    // Nothing moved: the tremolo is still at the rack author's rate.
    expect(memberOf(entry, TREMOLO).node.parameters.get('rate').value).toBe(4.5)
  })

  it('resets an exposed port to its declared default', async () => {
    const { dispatcher } = host()
    const { nodeId, entry } = await dispatcher.addPlugin(RACK_IRI)
    dispatcher.setParameter(nodeId, 'room', 0.9)
    const reset = dispatcher.resetParameter(nodeId, 'room')
    expect(reset.ok).toBe(true)
    expect(reset.value).toBe(0.3)
    expect(dispatcher.project.node(nodeId).settings.has('room')).toBe(false)
    expect(memberOf(entry, CASCADE).node.parameters.get('mix').value).toBe(0.3)
  })

  it('makes the same sound as the same three plugins wired by hand', async () => {
    const rack = host()
    const { nodeId, entry } = await rack.dispatcher.addPlugin(RACK_IRI)
    rack.dispatcher.setParameters([
      { nodeId, symbol: 'drive', value: 0.8 },
      { nodeId, symbol: 'depth', value: 0.7 },
      { nodeId, symbol: 'room', value: 0.4 }
    ])

    const hand = host()
    const boost = (await hand.dispatcher.addPlugin(BOOST)).entry
    const trem = (await hand.dispatcher.addPlugin(TREMOLO)).entry
    const verb = (await hand.dispatcher.addPlugin(CASCADE)).entry
    hand.engine.setParameter(boost.id, 'gain', 0.8)
    hand.engine.setParameter(trem.id, 'depth', 0.7)
    hand.engine.setParameter(trem.id, 'rate', 4.5)
    hand.engine.setParameter(verb.id, 'mix', 0.4)

    const viaRack = through([memberOf(entry, BOOST).node, memberOf(entry, TREMOLO).node, memberOf(entry, CASCADE).node])
    const byHand = through([boost.node, trem.node, verb.node])

    expect(viaRack[0].some(v => Math.abs(v) > 1e-4)).toBe(true)
    expect(viaRack).toEqual(byHand)
  })

  it('loads whole or not at all: a member that fails to start leaves nothing behind', async () => {
    const { engine, dispatcher } = host({ refuse: 'cascade' })
    const result = await dispatcher.addPlugin(RACK_IRI)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('load')
    expect(result.message).toContain(RACK_IRI)
    expect(result.message).toContain('#verb')
    // Boost and tremolo were instantiated before cascade failed, and are gone.
    expect(engine.nodes()).toHaveLength(0)
    expect(dispatcher.project.nodes).toHaveLength(0)
  })

  it('removes every member with the node', async () => {
    const { engine, dispatcher } = host()
    const { nodeId } = await dispatcher.addPlugin(RACK_IRI)
    expect(dispatcher.apply([{ op: 'removeNode', id: nodeId }]).ok).toBe(true)
    expect(engine.nodes()).toHaveLength(0)
    expect(dispatcher.engineNode(nodeId)).toBeNull()
  })

  it('undoes and redoes the add as one edit', async () => {
    const { engine, dispatcher } = host()
    await dispatcher.addPlugin(RACK_IRI)
    await dispatcher.undo()
    expect(dispatcher.project.nodes).toHaveLength(0)
    expect(engine.nodes()).toHaveLength(0)
    await dispatcher.redo()
    expect(dispatcher.project.nodes).toHaveLength(1)
    expect(engine.nodes()).toHaveLength(3)
  })

  it('takes a bypassed rack out of the signal as one node', async () => {
    const { engine, dispatcher } = host()
    const { nodeId, entry, trackId } = await dispatcher.addPlugin(RACK_IRI)
    const verb = memberOf(entry, CASCADE).node
    expect(verb.connections.map(c => c.destination)).toContain(engine.trackInput(trackId))

    expect(dispatcher.apply([{ op: 'setNode', id: nodeId, bypassed: true }]).ok).toBe(true)
    // The members are still loaded, and none of them is heard.
    expect(engine.nodes()).toHaveLength(3)
    expect(verb.connections.map(c => c.destination)).not.toContain(engine.trackInput(trackId))
  })

  it('assembles saved state from its members, which here have none to save', async () => {
    const { dispatcher } = host()
    const { nodeId } = await dispatcher.addPlugin(RACK_IRI)
    // Boost is stateless, and nothing else here keeps state, so a rack of these saves nothing.
    expect(await dispatcher.getNodeState(nodeId)).toBeNull()
  })

  it('refuses a composite that asks a member for a value it cannot take, before loading any code', async () => {
    const wide = rackText.replace('lv2:default 1 ; lv2:minimum 0 ; lv2:maximum 2', 'lv2:default 1 ; lv2:minimum 0 ; lv2:maximum 20')
    expect(wide).not.toBe(rackText)
    const { engine, dispatcher } = host({ rack: wide })
    const result = await dispatcher.addPlugin(RACK_IRI)
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/must lie within the range/)
    expect(engine.nodes()).toHaveLength(0)
  })

  it('saves and reopens as one node whose settings are its exposed ports', async () => {
    const first = host()
    const { nodeId } = await first.dispatcher.addPlugin(RACK_IRI)
    first.dispatcher.setParameter(nodeId, 'drive', 0.7)
    first.dispatcher.setParameter(nodeId, 'depth', 0.2)

    const text = writeProject(first.dispatcher.project, { iri: 'https://example.org/sessions/one' })
    // The file names the rack once, and none of its members: they are the rack's business.
    expect(text).toContain(RACK_IRI)
    expect(text).not.toContain('plugins/boost/')

    const second = host()
    const opened = await openProject(second.dispatcher, readProject(await parseText(text, 'https://example.org/sessions/one')))
    expect(opened.errors).toEqual([])
    expect(second.dispatcher.project.nodes).toHaveLength(1)
    const entry = second.dispatcher.engineNode(second.dispatcher.project.nodes[0].id)
    expect(memberOf(entry, BOOST).node.parameters.get('gain').value).toBe(0.7)
    expect(memberOf(entry, TREMOLO).node.parameters.get('depth').value).toBe(0.2)
    // Not set by the person, so still the author's.
    expect(memberOf(entry, CASCADE).node.parameters.get('mix').value).toBe(0.3)
  })

  it('hands each member its own saved state when the composite is reloaded, and ignores a key that fits no member', async () => {
    const { loader, dispatcher } = host()
    const given = new Map()
    const instantiate = loader.instantiate.bind(loader)
    loader.instantiate = (profile, granted, context, options) => {
      given.set(profile.label, options.state)
      return instantiate(profile, granted, context, options)
    }
    const saved = encodeState({ members: { [`${RACK_IRI}#trem`]: { held: 3 }, [`${RACK_IRI}#gone`]: { ignored: true } } })
    const result = await dispatcher.addPlugin(RACK_IRI, { state: saved })
    expect(result.ok, result.message).toBe(true)
    expect(Object.fromEntries(given)).toEqual({ Boost: null, Tremolo: { held: 3 }, Cascade: null })
  })

  it('collects saved state from every stateful member, keyed by its IRI', async () => {
    const { engine, dispatcher } = host()
    const { nodeId, entry } = await dispatcher.addPlugin(RACK_IRI)
    const trem = memberOf(entry, TREMOLO)
    trem.profile.stateless = false
    engine.requestState = async id => (id === trem.id ? { held: 3 } : undefined)
    expect(await dispatcher.getNodeState(nodeId)).toEqual({ members: { [`${RACK_IRI}#trem`]: { held: 3 } } })
  })

  it('gives automation the AudioParam an exposed port is, so an envelope plays on the member it drives', async () => {
    const { dispatcher } = host()
    const { nodeId, entry } = await dispatcher.addPlugin(RACK_IRI)
    expect(dispatcher.audioParams(nodeId, 'drive')).toEqual([memberOf(entry, BOOST).node.parameters.get('gain')])
    expect(dispatcher.audioParams(nodeId, 'depth')).toEqual([memberOf(entry, TREMOLO).node.parameters.get('depth')])
    // A member's own parameter is not the rack's to automate.
    expect(dispatcher.audioParams(nodeId, 'rate')).toEqual([])
  })
})
