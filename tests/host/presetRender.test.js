// tests/host/presetRender.test.js
//
// Every bundled preset, played for a few seconds through the offline host, must
// get sound to every track that has something on it that makes sound. This is
// the check that would have caught Dice never running in a browser: it opens
// the preset for real, plays the transport, routes MIDI between the plugins and
// audio to the tracks, and looks at what arrives.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { openProject } from '../../src/ops/OpenProject.js'
import { readProject } from '../../src/rdf/ProjectReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch, sitePlugins } from '../../src/testing/OfflineHost.js'
import { renderChain } from '../../src/testing/ChainRender.js'

const root = resolve(import.meta.dirname, '../..')
const presetsDir = resolve(root, 'web/presets')
const SITE = 'https://site.test/jigdaw/'
const onDisk = readdirSync(presetsDir).filter(f => f.endsWith('.ttl')).sort()
// Seconds of music: enough for a generator's first phrase at the slowest preset tempo.
const SECONDS = 6

async function open (file, validator) {
  const site = sitePlugins(SITE, resolve(root, 'plugins'))
  const loader = new PluginLoader({
    fetch: site.fetch, parse: parseText, validator,
    capabilities: detectCapabilities({ WebAssembly }), processorUrl: site.processorUrl
  })
  const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
  const dispatcher = new OpDispatcher({ engine })
  const url = `${SITE}presets/${file}`
  const read = readProject(await parseText(readFileSync(resolve(presetsDir, file), 'utf8'), url))
  const opened = await openProject(dispatcher, read)
  expect(opened.errors).toEqual([])
  return { dispatcher, engine }
}

describe('the bundled presets, played', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  for (const file of onDisk) {
    it(`${file}: every track with something that makes sound gets sound`, async () => {
      const { dispatcher, engine } = await open(file, validator)
      const peaks = await renderChain(dispatcher, engine, { quanta: Math.ceil(SECONDS * 48000 / 128) })
      const makesSound = track => dispatcher.project.nodes.some(n => n.track === track.id && (dispatcher.engineNode(n.id)?.profile.audioOutputs ?? 0) > 0)
      const expected = dispatcher.project.tracks.filter(makesSound)
      expect(expected.length, 'a preset with nothing that makes sound').toBeGreaterThan(0)
      for (const track of expected) {
        expect(peaks.get(track.id), `${track.label ?? track.id} in ${file}`).toBeGreaterThan(1e-4)
      }
    }, 120000)
  }
})

// What the offline context records of the audio graph: every node lists where it connects to.
function reaches (from, to, { avoiding = null } = {}, seen = new Set()) {
  if (from === to) return true
  if (!from || from === avoiding || seen.has(from)) return false
  seen.add(from)
  return (from.connections ?? []).some(c => reaches(c.destination, to, { avoiding }, seen))
}

describe('audio arriving at a track or the master, through the real engine', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  async function make () {
    const site = sitePlugins(SITE, resolve(root, 'plugins'))
    const loader = new PluginLoader({
      fetch: site.fetch, parse: parseText, validator,
      capabilities: detectCapabilities({ WebAssembly }), processorUrl: site.processorUrl
    })
    const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
    const dispatcher = new OpDispatcher({ engine })
    const plugin = async (name, track) => {
      const added = await dispatcher.addPlugin(`${SITE}plugins/${name}/`, { track })
      return { id: added.nodeId, node: dispatcher.engineNode(added.nodeId).node }
    }
    return { engine, dispatcher, plugin }
  }

  it('puts the plugin on a bus between the tracks that feed it and the master', async () => {
    const { engine, dispatcher, plugin } = await make()
    dispatcher.apply([{ op: 'addTrack', id: 'line' }, { op: 'addTrack', id: 'bus' }])
    const source = await plugin('pulse', 'line')
    const verb = await plugin('cascade', 'bus')
    dispatcher.apply([{ op: 'setTrack', id: 'line', output: 'bus' }])
    // Before it is named the audio input, the bus carries the line to the master past the reverb.
    expect(reaches(source.node, engine.master, { avoiding: verb.node })).toBe(true)
    dispatcher.apply([{ op: 'setTrack', id: 'bus', audioInput: verb.id }])
    expect(reaches(source.node, verb.node)).toBe(true)
    expect(reaches(source.node, engine.master, { avoiding: verb.node })).toBe(false)
    expect(reaches(verb.node, engine.master)).toBe(true)
  })

  it('does the same for a send, leaving the line itself on its own way to the master', async () => {
    const { engine, dispatcher, plugin } = await make()
    dispatcher.apply([{ op: 'addTrack', id: 'line' }, { op: 'addTrack', id: 'bus' }])
    const source = await plugin('pulse', 'line')
    const verb = await plugin('cascade', 'bus')
    dispatcher.apply([{ op: 'setTrack', id: 'bus', audioInput: verb.id }, { op: 'addSend', id: 's1', from: 'line', to: 'bus', level: 0.5 }])
    expect(reaches(source.node, verb.node)).toBe(true)
    // The dry line still reaches the master by its own strip, which is what a send is.
    expect(reaches(source.node, engine.master, { avoiding: verb.node })).toBe(true)
  })

  it('puts the plugin on the master between the sum of the tracks and the master level', async () => {
    const { engine, dispatcher, plugin } = await make()
    dispatcher.apply([{ op: 'addTrack', id: 'one' }, { op: 'addTrack', id: 'two' }])
    const a = await plugin('pulse', 'one')
    const b = await plugin('pulse', 'two')
    const verb = await plugin('cascade', 'master')
    expect(reaches(verb.node, engine.master)).toBe(true)
    // Until the master names it, the tracks go straight past it.
    expect(reaches(a.node, engine.master, { avoiding: verb.node })).toBe(true)
    dispatcher.apply([{ op: 'setMaster', audioInput: verb.id }])
    for (const source of [a, b]) {
      expect(reaches(source.node, verb.node)).toBe(true)
      expect(reaches(source.node, engine.master, { avoiding: verb.node })).toBe(false)
    }
    // And back, when the master stops naming it.
    dispatcher.apply([{ op: 'setMaster', audioInput: null }])
    expect(reaches(a.node, engine.master, { avoiding: verb.node })).toBe(true)
  })

  it('is what the Generative Gamelan preset does: both lines through the one reverb on the master', async () => {
    const { engine, dispatcher } = await open('generative-gamelan.ttl', validator)
    const node = id => dispatcher.engineNode(id).node
    for (const moka of ['moka-1', 'moka-2']) {
      expect(reaches(node(moka), node('verb'))).toBe(true)
      expect(reaches(node(moka), engine.master, { avoiding: node('verb') })).toBe(false)
    }
    expect(reaches(node('verb'), engine.master)).toBe(true)
    expect(dispatcher.project.master.audioInput).toBe('verb')
  })
})

describe('MIDI between tracks, through the real router', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('has the Conductor drive both generators of Generative Gamelan by MIDI sends, with no connection between them', async () => {
    const { engine, dispatcher } = await open('generative-gamelan.ttl', validator)
    expect(dispatcher.project.connections.filter(c => [c.from.node, c.to.node].includes('conductor'))).toEqual([])
    expect(dispatcher.project.sends.map(x => [x.from, x.to, x.kind])).toEqual([['track-4', 'track-1', 'midi'], ['track-4', 'track-2', 'midi']])
    const id = node => dispatcher.engineNode(node).id
    expect(dispatcher.router.routes).toEqual(expect.arrayContaining([
      { from: id('conductor'), to: id('sprout') }, { from: id('conductor'), to: id('markov') }
    ]))
    // And what it says arrives: each generator holds a parameter the Conductor moved, until the panel moves it back.
    await renderChain(dispatcher, engine, { quanta: Math.ceil(10 * 48000 / 128) })
    for (const generator of ['sprout', 'markov']) {
      const moved = Array.from(dispatcher.engineNode(generator).node.processor.override).some(v => !Number.isNaN(v))
      expect(moved, `${generator} was moved by the Conductor`).toBe(true)
    }
  })
})
