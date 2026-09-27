// tests/host/tremolo.test.js
//
// The whole path, for real, headless, for the plugin that has no
// WebAssembly module at all. Same shape as tests/host/integration.test.js,
// scoped to the one thing that is different here: jig:module is absent, and
// the init/ready handshake and the real-time rules apply exactly the same
// without it.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/tremolo')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/tremolo/'

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'tremolo-processor.js')).href
  })
}

const rms = channel => Math.sqrt(channel.reduce((s, v) => s + v * v, 0) / channel.length)

describe('tremolo, a plugin with no WebAssembly module', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('dereferences the IRI and gets a profile that declares no module', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Tremolo')
    expect(profile.module).toBeNull()
    expect(profile.ports.map(p => p.symbol).sort()).toEqual(['depth', 'rate'])
  })

  it('still runs the init/ready handshake and reports ready', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(entry.node).toBeInstanceOf(OfflineWorkletNode)
  })

  it('passes the signal unchanged at depth 0, proving the audio path is really connected', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    engine.setParameter(entry.id, 'depth', 0)

    const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 8) * 0.5)
    const output = entry.node.render([signal, signal])
    expect(Array.from(output[0])).toEqual(Array.from(signal))
    expect(output[0].every(Number.isFinite)).toBe(true)
  })

  it('modulates the envelope at depth 1, and never inverts it', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    engine.setParameter(entry.id, 'depth', 1)
    engine.setParameter(entry.id, 'rate', 5)

    // A steady tone, held at constant level: any level variation coming out
    // is the tremolo, not the input.
    const tone = new Float32Array(128).fill(0.5)

    let min = Infinity
    let max = 0
    for (let block = 0; block < 400; block++) {
      const output = entry.node.render([tone, tone])
      expect(output[0].every(Number.isFinite)).toBe(true)
      // A gain never below 0 or above the input, at any single sample.
      for (const v of output[0]) {
        expect(v).toBeGreaterThanOrEqual(-1e-9)
        expect(v).toBeLessThanOrEqual(0.5 + 1e-9)
      }
      const level = rms(output[0])
      min = Math.min(min, level)
      max = Math.max(max, level)
    }

    expect(min, 'the trough never got close to silent').toBeLessThan(0.05)
    expect(max, 'the peak never reached the input level').toBeGreaterThan(0.4)
  })

  it('is silent when fed silence, at any depth', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    engine.setParameter(entry.id, 'depth', 1)

    const silence = new Float32Array(128)
    for (let block = 0; block < 10; block++) {
      expect(rms(entry.node.render([silence, silence])[0])).toBe(0)
    }
  })
})

describe('tremolo rate is an audio-rate parameter', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('is declared a-rate in the profile and k-rate nowhere it matters', async () => {
    // Contract 5.2: a-rate only for parameters meant to be audio-modulated.
    // Rate is the LFO speed; depth is a plain level.
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.ports.find(p => p.symbol === 'rate').automationRate).toBe('a-rate')
    expect(profile.ports.find(p => p.symbol === 'depth').automationRate).toBe('k-rate')
  })

  it('reaches the processor as an a-rate AudioParam from the one declaration', async () => {
    // Contract 5.1: the profile is the declaration, and the host derives the
    // descriptors from it while the processor registers its own copy. Three
    // lists, one source of truth, bound here rather than reviewed.
    const { parameterDescriptors } = await import('../../src/host/Parameters.js')
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    const derived = parameterDescriptors(profile.ports)

    const context = new OfflineContext({ sampleRate: 48000 })
    await context.audioWorklet.addModule(pathToFileURL(resolve(pluginDir, 'tremolo-processor.js')).href)
    const registered = context.registry.get('tremolo').parameterDescriptors

    expect(derived.find(d => d.name === 'rate')).toMatchObject(
      registered.find(d => d.name === 'rate'))
    expect(registered.find(d => d.name === 'rate').automationRate).toBe('a-rate')
    expect(registered.find(d => d.name === 'depth').automationRate).toBe('k-rate')
  })

  it('reads the rate per sample, not once per quantum', async () => {
    // Contract 5.2: a processor takes a length-1 array for a steady value and
    // a length-128 one for a modulated one. A processor that read only the
    // first element would sound identical under both; the ramp must differ.
    const context = new OfflineContext({ sampleRate: 48000 })
    await context.audioWorklet.addModule(pathToFileURL(resolve(pluginDir, 'tremolo-processor.js')).href)
    const run = (rate, depth) => {
      const processor = new (context.registry.get('tremolo').ctor)({
        port: { postMessage () {}, onmessage: null }
      })
      processor.port.onmessage({ data: { type: 'init', sampleRate: 48000 } })
      // One input and one output of one channel each, the nesting a real
      // worklet calls process with: outputs[0] is the channel list, not a
      // channel.
      const input = [[new Float32Array(128).fill(0.5)]]
      const output = [[new Float32Array(128)]]
      processor.process(input, output, { rate, depth })
      expect(output[0][0].every(Number.isFinite)).toBe(true)
      return output[0][0]
    }
    const steady = run(new Float32Array([5]), new Float32Array([1]))
    const constant128 = run(new Float32Array(128).fill(5), new Float32Array([1]))
    expect(Array.from(constant128)).toEqual(Array.from(steady))
    // Starting at the steady value, so a processor that read only the first
    // element would render exactly steady and fail below.
    const ramp = Float32Array.from({ length: 128 }, (_, i) => 5 + (20 - 5) * i / 127)
    const swept = run(ramp, new Float32Array([1]))
    let difference = 0
    for (let i = 0; i < 128; i++) difference = Math.max(difference, Math.abs(swept[i] - steady[i]))
    expect(difference).toBeGreaterThan(0.01)
  })
})
