// tests/host/ferrite.test.js
//
// The whole path, for real, headless: profile, integrity, wasm compile, the
// two jig:asset resources (the .nam model, the cabinet impulse response)
// fetched, verified and delivered the same way the module itself is.
// plugins/ferrite/src/lib.rs's own header explains why nam-rs is depended
// on rather than reimplemented; this test is what stands in for the "does
// it actually work" a from-scratch reimplementation would need a reference
// output to check itself against.
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
const pluginDir = resolve(root, 'plugins/ferrite')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/ferrite/'

const built = existsSync(resolve(pluginDir, 'ferrite.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/ferrite/build.sh first')

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'ferrite-processor.js')).href
  })
}

const finite = arr => Array.from(arr).every(Number.isFinite)

suite('ferrite, a neural amp model and a cabinet impulse response', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('dereferences the IRI and gets a profile declaring both jig:asset resources', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Ferrite')
    expect(profile.assets.map(a => a.iri.split('#').pop()).sort()).toEqual(['ir', 'nam'])
    expect(profile.ports.map(p => p.symbol)).toEqual(['input', 'output'])
  })

  it('loads and reports ready, both assets fetched and verified alongside the module', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(entry.node).toBeInstanceOf(OfflineWorkletNode)
  })

  it('produces finite output from a real signal through the whole chain', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)

    const tone = Float32Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / 48000) * 0.5)
    // Several blocks: the WaveNet's dilated history and the convolution's
    // shift buffer both carry state across calls, and a real chain is never
    // judged on one block alone.
    let output
    for (let block = 0; block < 10; block++) {
      output = entry.node.render([tone, tone])
      expect(finite(output[0]), `block ${block} produced a non-finite sample`).toBe(true)
    }
  })

  it('scales linearly with the output parameter, the one step after the model that must be exact', async () => {
    // Output level is applied after the nonlinear model and the
    // convolution, so for identical input and identical fresh state,
    // doubling it must exactly double every sample: this is the one
    // numeric claim about the chain simple enough to assert without a
    // reference render to compare against.
    const tone = Float32Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / 48000) * 0.5)

    const context1 = new OfflineContext({ sampleRate: 48000 })
    const engine1 = new Engine({ context: context1, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry1 = await engine1.addPlugin(CANONICAL)
    const outputAt1 = entry1.node.render([tone, tone])[0]

    const context2 = new OfflineContext({ sampleRate: 48000 })
    const engine2 = new Engine({ context: context2, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry2 = await engine2.addPlugin(CANONICAL)
    engine2.setParameter(entry2.id, 'output', 2)
    const outputAt2 = entry2.node.render([tone, tone])[0]

    for (let i = 0; i < outputAt1.length; i++) {
      expect(outputAt2[i]).toBeCloseTo(outputAt1[i] * 2, 4)
    }
  })
})
