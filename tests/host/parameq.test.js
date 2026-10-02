// tests/host/parameq.test.js
//
// The whole path, for real, headless, for the stereo parametric equalizer:
// profile, processor and module through the real PluginLoader/Engine path,
// in the same shape as tests/host/boost.test.js.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/parameq')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/parameq/'

const built = existsSync(resolve(pluginDir, 'parameq.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/parameq/build.sh first')

const BANDS = [1, 2, 3, 4, 5, 6]
const expectedSymbols = ['enabled', ...BANDS.flatMap(b => [`b${b}_on`, `b${b}_type`, `b${b}_freq`, `b${b}_gain`, `b${b}_q`])]

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'parameq-processor.js')).href
  })
}

suite('parameq, a stereo parametric equalizer', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares two-channel audio in and out with one master and six bands', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Parameq')
    expect(profile.audioInputs).toBe(1)
    expect(profile.inputChannels).toBe(2)
    expect(profile.audioOutputs).toBe(1)
    expect(profile.outputChannels).toBe(2)
    // Ports are a set, keyed by symbol with no order: compare as one.
    expect(profile.ports.map(p => p.symbol).sort()).toEqual([...expectedSymbols].sort())
  })

  it('loads and reports ready, through the real PluginLoader/Engine path', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(entry.node).toBeInstanceOf(OfflineWorkletNode)
  })

  it('registers every port as an AudioParam from the one declaration', async () => {
    // Contract 5.1: the profile is the declaration, and the host derives the
    // descriptors from it while the processor registers its own copy. Three
    // lists, one source of truth, bound here rather than reviewed, for all
    // thirty-one parameters rather than sampled.
    const { parameterDescriptors } = await import('../../src/host/Parameters.js')
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    const derived = parameterDescriptors(profile.ports)

    const context = new OfflineContext({ sampleRate: 48000 })
    await context.audioWorklet.addModule(pathToFileURL(resolve(pluginDir, 'parameq-processor.js')).href)
    const registered = context.registry.get('parameq').parameterDescriptors

    expect(registered.map(d => d.name).sort()).toEqual(derived.map(d => d.name).sort())
    for (const want of derived) {
      expect(registered.find(d => d.name === want.name)).toMatchObject(want)
    }
  })

  // A probe that loops seamlessly in a 128-frame quantum at 48 kHz: 1125 Hz
  // completes exactly three cycles, so re-rendering one snippet is a
  // continuous sine rather than a sine with a phase jump every quantum.
  const probe = () => Float32Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * 1125 * i / 48000) * 0.5)
  const rmsOf = channel => Math.sqrt(channel.reduce((s, v) => s + v * v, 0) / channel.length)

  it('passes a midrange signal nearly unchanged on the default patch', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)

    // Settled quanta: the high and low pass corners ring briefly from zero
    // state, and the assertion is about the settled filter.
    const signal = probe()
    let output
    for (let b = 0; b < 32; b++) output = entry.node.render([signal, signal])
    expect(rmsOf(output[0])).toBeCloseTo(0.5 / Math.SQRT2, 2)
    expect(output[0].every(Number.isFinite)).toBe(true)
  })

  it('answers a peak boost set through the dispatcher', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)

    // A ratio between two runs over the identical looped input, so the probe
    // cancels out and what is asserted is the boost itself.
    const signal = probe()
    let output
    for (let b = 0; b < 64; b++) output = entry.node.render([signal, signal])
    const flat = rmsOf(output[0])
    // The band corner moves onto the probe first, so the probe reads the
    // full boost rather than the skirt of a neighbouring one.
    engine.setParameter(entry.id, 'b3_freq', 1125)
    engine.setParameter(entry.id, 'b3_gain', 6)
    for (let b = 0; b < 64; b++) output = entry.node.render([signal, signal])
    expect(rmsOf(output[0]) / flat).toBeCloseTo(Math.pow(10, 6 / 20), 1)
  })

  it('is silent when fed silence, at high boost', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    engine.setParameter(entry.id, 'b3_gain', 24)

    const silence = new Float32Array(128)
    const output = entry.node.render([silence, silence])
    expect(Array.from(output[0]).every(v => v === 0)).toBe(true)
  })
})
