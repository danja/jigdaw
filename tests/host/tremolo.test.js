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
