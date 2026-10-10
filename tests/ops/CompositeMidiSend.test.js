// tests/ops/CompositeMidiSend.test.js
//
// A MIDI send to and from a composite plugin, through the real dispatcher, engine, loader and router. A
// composite has no engine node of its own, so a send reads its MIDI boundary: what leaves it is the member
// its MIDI output is wired to, and what arrives goes to the member its MIDI input is wired to. A member
// whose MIDI goes on to another member inside is not the end of anything, and gets no route.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'
import { pinnedMidiRack, servingAt, MIDI_RACK_IRI } from '../../src/testing/CompositeFixtures.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const DICE = `${ORIGIN}plugins/dice/`
const FILTER = `${ORIGIN}plugins/midifilter/`

describe('a MIDI send with a composite plugin on either end', () => {
  let validator
  let rackText
  beforeAll(async () => {
    validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    rackText = await pinnedMidiRack(root)
  })

  function host () {
    const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
    const loader = new PluginLoader({
      fetch: servingAt(MIDI_RACK_IRI, rackText, site.fetch),
      parse: parseText,
      validator,
      capabilities: detectCapabilities({}),
      processorUrl: site.processorUrl
    })
    const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
    return new OpDispatcher({ engine })
  }

  /** The engine id of the member of a composite node that is an instance of `iri`. */
  const memberId = (dispatcher, nodeId, iri) => dispatcher.engineNode(nodeId).members.find(m => m.entry.iri === iri).entry.id
  const routes = d => d.router.routes

  async function setup () {
    const d = host()
    d.apply([{ op: 'addTrack', id: 'src' }, { op: 'addTrack', id: 'dst' }])
    return d
  }

  it('is one node in the project and a gate and a filter in the engine', async () => {
    const d = await setup()
    const added = await d.addPlugin(MIDI_RACK_IRI, { track: 'src' })
    expect(added.ok, added.message).toBe(true)
    expect(d.project.nodes).toHaveLength(1)
    expect(d.engineNode(added.nodeId).members).toHaveLength(2)
  })

  it('sends from a composite by the member its MIDI output is wired to, and not from the one feeding it', async () => {
    const d = await setup()
    const rack = (await d.addPlugin(MIDI_RACK_IRI, { track: 'src' })).nodeId
    const target = (await d.addPlugin(FILTER, { track: 'dst' })).nodeId
    d.apply([{ op: 'setTrack', id: 'dst', midiInput: target }, { op: 'addSend', id: 's1', from: 'src', to: 'dst', kind: 'midi' }])
    expect(routes(d).filter(r => r.to === d.engineNode(target).id)).toEqual([{ from: memberId(d, rack, FILTER), to: d.engineNode(target).id }])
  })

  it('sends into a composite by the member its MIDI input is wired to', async () => {
    const d = await setup()
    const source = (await d.addPlugin(DICE, { track: 'src' })).nodeId
    const rack = (await d.addPlugin(MIDI_RACK_IRI, { track: 'dst' })).nodeId
    d.apply([{ op: 'setTrack', id: 'dst', midiInput: rack }, { op: 'addSend', id: 's1', from: 'src', to: 'dst', kind: 'midi' }])
    expect(routes(d).filter(r => r.from === d.engineNode(source).id)).toEqual([{ from: d.engineNode(source).id, to: memberId(d, rack, DICE) }])
  })

  it('sends from one composite to another', async () => {
    const d = await setup()
    const a = (await d.addPlugin(MIDI_RACK_IRI, { track: 'src' })).nodeId
    const b = (await d.addPlugin(MIDI_RACK_IRI, { track: 'dst' })).nodeId
    d.apply([{ op: 'setTrack', id: 'dst', midiInput: b }, { op: 'addSend', id: 's1', from: 'src', to: 'dst', kind: 'midi' }])
    const wanted = { from: memberId(d, a, FILTER), to: memberId(d, b, DICE) }
    expect(routes(d)).toContainEqual(wanted)
    // The members inside each composite stay joined to one another and to nothing else.
    expect(routes(d).filter(r => r.from === memberId(d, a, DICE)).every(r => r.to === memberId(d, a, FILTER))).toBe(true)
  })

  it('does not route from a bypassed composite, and sees the track\'s other MIDI end instead', async () => {
    const d = await setup()
    const rack = (await d.addPlugin(MIDI_RACK_IRI, { track: 'src' })).nodeId
    const target = (await d.addPlugin(FILTER, { track: 'dst' })).nodeId
    d.apply([{ op: 'setTrack', id: 'dst', midiInput: target }, { op: 'addSend', id: 's1', from: 'src', to: 'dst', kind: 'midi' }])
    expect(routes(d).filter(r => r.to === d.engineNode(target).id)).toHaveLength(1)
    d.apply([{ op: 'setNode', id: rack, bypassed: true }])
    expect(routes(d).filter(r => r.to === d.engineNode(target).id)).toEqual([])
  })
})

describe('MIDI delivered into a composite', () => {
  it('reaches only the member its MIDI input is wired to, not the members behind it', async () => {
    const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const loader = new PluginLoader({
      fetch: servingAt(MIDI_RACK_IRI, await pinnedMidiRack(root), site.fetch),
      parse: parseText, validator, capabilities: detectCapabilities({}), processorUrl: site.processorUrl
    })
    const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'one' }])
    const rack = (await d.addPlugin(MIDI_RACK_IRI, { track: 'one' })).nodeId
    const gate = d.engineNode(rack).members.find(m => m.entry.iri === DICE).entry.id
    const filter = d.engineNode(rack).members.find(m => m.entry.iri === FILTER).entry.id
    const seen = []
    const original = d.router.send.bind(d.router)
    d.router.send = (id, events) => { seen.push(id); return original(id, events) }
    expect(d.sendEvents(rack, [{ frame: 0, bytes: Uint8Array.of(0x90, 60, 100) }])).toBe(true)
    expect(seen).toEqual([gate])
    expect(seen).not.toContain(filter)
  })
})
