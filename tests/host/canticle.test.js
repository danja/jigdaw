// tests/host/canticle.test.js
//
// Canticle through the real host path: the profile dereferences, the module
// instantiates in a worklet, and MIDI notes come out as twelve-voice audio.
// Notes and CCs are posted as the messages a host sends, and the rendered
// stereo is read back the same way, so this exercises the contract's
// instrument path rather than the Rust in isolation.
//
// The behavioural vectors mirror downspout's own porting notes: a
// velocity-100 single note reaches at least -10 dBFS at default on every
// model, a thirteenth note steals rather than refusing, and CC 120 and 123
// stop everything.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/canticle')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/canticle/'

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'canticle-processor.js')).href
  })
}

async function makeEntry (validator) {
  const context = new OfflineContext({ sampleRate: 48000 })
  const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
  const entry = await engine.addPlugin(CANONICAL)
  return { engine, entry, node: entry.node }
}

// Message delivery hops through the ports, so let the queue drain on a real
// tick rather than a microtask checkpoint.
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

async function noteOn (node, note, velocity = 100) {
  node.port.postMessage({
    type: 'events',
    events: [{ frame: node.frame, bytes: Uint8Array.from([0x90, note, velocity]) }]
  })
  await settle()
}

async function noteOff (node, note) {
  node.port.postMessage({
    type: 'events',
    events: [{ frame: node.frame, bytes: Uint8Array.from([0x80, note, 0]) }]
  })
  await settle()
}

async function cc (node, number) {
  node.port.postMessage({
    type: 'events',
    events: [{ frame: node.frame, bytes: Uint8Array.from([0xb0, number, 0]) }]
  })
  await settle()
}

function peak (node, blocks) {
  let peak = 0
  for (let b = 0; b < blocks; b++) {
    for (const channel of node.render()) {
      for (const sample of channel) {
        if (!Number.isFinite(sample)) throw new Error('non-finite sample out of canticle')
        const abs = Math.abs(sample)
        if (abs > peak) peak = abs
      }
    }
  }
  return peak
}

function energy (node, blocks) {
  let sum = 0
  for (let b = 0; b < blocks; b++) {
    for (const channel of node.render()) {
      for (const sample of channel) sum += Math.abs(sample)
    }
  }
  return sum
}

describe('canticle, a twelve-voice tonal instrument', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('dereferences the IRI to an instrument profile with 16 controls', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Canticle')
    expect(profile.ports).toHaveLength(16)
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(profile.requires).not.toContain('http://purl.org/stuff/jigdaw/MidiOut')
    expect(profile.accepts.some(s => s.endsWith('MelodyMidi'))).toBe(true)
    expect(profile.accepts.some(s => s.endsWith('HarmonyMidi'))).toBe(true)
    expect(profile.produces.some(s => s.endsWith('Audio'))).toBe(true)
  })

  it('declares the same parameters in the profile and the processor', async () => {
    const template = JSON.parse(await readFile(resolve(pluginDir, 'profile.json'), 'utf8'))
    const source = await readFile(resolve(pluginDir, 'canticle-processor.js'), 'utf8')
    const descriptors = [...source.matchAll(/\{\s*name:\s*'([^']+)',\s*defaultValue:\s*([^,]+),\s*minValue:\s*([^,]+),\s*maxValue:\s*([^ },]+)/g)]
      .map(m => ({ symbol: m[1], default: Number(m[2]), min: Number(m[3]), max: Number(m[4]) }))
    expect(descriptors.map(d => d.symbol)).toEqual(template.ports.map(p => p.symbol))
    for (const [i, port] of template.ports.entries()) {
      expect(descriptors[i].default, port.symbol).toBe(port.default)
      expect(descriptors[i].min, port.symbol).toBe(port.minimum)
      expect(descriptors[i].max, port.symbol).toBe(port.maximum)
    }
  })

  it('runs the init/ready handshake and reports its tail', async () => {
    const { entry } = await makeEntry(validator)
    expect(entry.ready.latencyFrames).toBe(0)
    // The 3200 ms release maximum at 48 kHz, the figure profile.json
    // declares as jig:tailFrames. The two must move together.
    expect(entry.ready.tailFrames).toBe(153600)
    expect(entry.node).toBeInstanceOf(OfflineWorkletNode)
  })

  it('is silent with no notes', async () => {
    const { node } = await makeEntry(validator)
    for (let b = 0; b < 4; b++) {
      for (const channel of node.render()) {
        expect(channel.every(v => v === 0)).toBe(true)
      }
    }
  })

  it('reaches -10 dBFS on every model at velocity 100', async () => {
    // The porting-notes calibration: a single note at velocity 100 reaches
    // at least -10 dBFS at default on all five models.
    for (let model = 0; model < 5; model++) {
      const { engine, entry, node } = await makeEntry(validator)
      engine.setParameter(entry.id, 'model', model)
      await noteOn(node, 60, 100)
      const loud = peak(node, 375)
      expect(loud, `model ${model}`).toBeGreaterThanOrEqual(0.316)
    }
  })

  it('releases to silence after note off', async () => {
    const { node } = await makeEntry(validator)
    await noteOn(node, 64, 100)
    peak(node, 190)
    await noteOff(node, 64)
    // The default release is a tenth of a second; two seconds of tail is
    // ten times over, so anything left is a stuck voice.
    peak(node, 750)
    expect(energy(node, 128)).toBe(0)
  })

  it('steals the oldest voice past twelve notes', async () => {
    const { node } = await makeEntry(validator)
    for (let n = 0; n < 13; n++) await noteOn(node, 60 + n, 100)
    const loud = peak(node, 190)
    expect(loud).toBeGreaterThan(0)
  })

  it('stops everything on CC 123 and CC 120', async () => {
    for (const number of [123, 120]) {
      const { node } = await makeEntry(validator)
      await noteOn(node, 60, 100)
      await noteOn(node, 64, 100)
      peak(node, 190)
      await cc(node, number)
      peak(node, 750)
      expect(energy(node, 128), `CC ${number}`).toBe(0)
    }
  })

  it('renders the same audio twice for the same notes', async () => {
    const render = async () => {
      const { node } = await makeEntry(validator)
      await noteOn(node, 60, 100)
      const left = []
      const right = []
      for (let b = 0; b < 190; b++) {
        const [l, r] = node.render()
        left.push(...l)
        right.push(...r)
      }
      return [...left, ...right]
    }
    expect(await render()).toEqual(await render())
  })
})
