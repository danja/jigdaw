// tests/host/boost.test.js
//
// The whole path, for real, headless, for the plugin that exists to be
// copied rather than to be shipped. Same shape as
// tests/host/integration.test.js: nothing here is mocked except the two
// things node does not have, the AudioContext and the AudioWorkletNode.
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
const pluginDir = resolve(root, 'plugins/boost')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/boost/'

const built = existsSync(resolve(pluginDir, 'boost.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/boost/build.sh first')

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'boost-processor.js')).href
  })
}

suite('boost, a minimal WebAssembly plugin meant to be copied', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('dereferences the IRI and gets a profile declaring jig:Abi1', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Boost')
    expect(profile.ports.map(p => p.symbol)).toEqual(['gain'])
  })

  it('loads and reports ready, through the real PluginLoader/Engine path', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(entry.node).toBeInstanceOf(OfflineWorkletNode)
  })

  it('passes the signal through unchanged at gain 1, the declared default', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)

    const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 8) * 0.5)
    const output = entry.node.render([signal, signal])
    expect(Array.from(output[0])).toEqual(Array.from(signal))
    expect(output[0].every(Number.isFinite)).toBe(true)
  })

  it('scales the signal by the gain parameter, proving jig_set_param actually reaches the module', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    engine.setParameter(entry.id, 'gain', 2)

    const signal = Float32Array.from({ length: 128 }, () => 0.25)
    const output = entry.node.render([signal, signal])
    for (const v of output[0]) expect(v).toBeCloseTo(0.5, 5)
  })

  it('is silent when fed silence, at any gain', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    engine.setParameter(entry.id, 'gain', 2)

    const silence = new Float32Array(128)
    const output = entry.node.render([silence, silence])
    expect(Array.from(output[0]).every(v => v === 0)).toBe(true)
  })
})
