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
import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { encodeState, decodeState } from '../../src/host/StateCodec.js'
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

  /** A minimal mono float32 WAV, built by hand rather than pulled from a
   * fixture, so a test asserting "this is a different impulse response from
   * the shipped one" can see exactly what is in it. */
  function wavOf (samples, sampleRate = 48000) {
    const dataBytes = samples.length * 4
    const buf = Buffer.alloc(44 + dataBytes)
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8)
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(3, 20)
    buf.writeUInt16LE(1, 22); buf.writeUInt32LE(sampleRate, 24); buf.writeUInt32LE(sampleRate * 4, 28)
    buf.writeUInt16LE(4, 32); buf.writeUInt16LE(32, 34); buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40)
    for (let i = 0; i < samples.length; i++) buf.writeFloatLE(samples[i], 44 + i * 4)
    return new Uint8Array(buf).buffer
  }

  describe('state and loadAsset: a person loading their own model or impulse response', () => {
    it('reports its currently loaded assets when the host asks, matching the shipped defaults byte for byte', async () => {
      const context = new OfflineContext({ sampleRate: 48000 })
      const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
      const entry = await engine.addPlugin(CANONICAL)

      const state = await engine.requestState(entry.id)
      expect(state).not.toBeNull()
      expect(state.nam).toBeInstanceOf(ArrayBuffer)
      expect(state.ir).toBeInstanceOf(ArrayBuffer)

      const shippedNam = readFileSync(resolve(pluginDir, 'wavenet.nam'))
      expect(new Uint8Array(state.nam)).toEqual(new Uint8Array(shippedNam))
    })

    it('loadAsset replaces the running impulse response, and requestState reflects the new bytes', async () => {
      const context = new OfflineContext({ sampleRate: 48000 })
      const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
      const entry = await engine.addPlugin(CANONICAL)

      // A pure single-sample impulse: convolving through it is the identity,
      // so the output should stop matching whatever the shipped multi-tap
      // synthetic cab IR was producing.
      const tone = Float32Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / 48000) * 0.5)
      const before = engine.get(entry.id).node.render([tone, tone])[0].slice()

      const identityIr = wavOf([1.0])
      engine.loadAsset(entry.id, 'ir', identityIr)
      // loadAsset is a fire-and-forget postMessage; give the microtask queue
      // a turn so the offline port's queued delivery actually runs before
      // the next render, the same reason every other async message in this
      // suite is awaited rather than assumed immediate.
      await new Promise(resolve => setTimeout(resolve, 0))

      const after = engine.get(entry.id).node.render([tone, tone])[0]
      expect(Array.from(after)).not.toEqual(Array.from(before))
      expect(Array.from(after).every(Number.isFinite)).toBe(true)

      const state = await engine.requestState(entry.id)
      expect(new Uint8Array(state.ir)).toEqual(new Uint8Array(wavOf([1.0])))
    })

    it('restores a saved state into a fresh node, loading what was captured rather than the shipped default', async () => {
      const contextA = new OfflineContext({ sampleRate: 48000 })
      const engineA = new Engine({ context: contextA, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
      const entryA = await engineA.addPlugin(CANONICAL)

      const identityIr = wavOf([1.0])
      engineA.loadAsset(entryA.id, 'ir', identityIr)
      await new Promise(resolve => setTimeout(resolve, 0))
      const savedState = await engineA.requestState(entryA.id)

      // Round-tripped through the codec, exactly as a real save and reopen
      // would, rather than handed the live object straight across.
      const encoded = encodeState(savedState)
      const restored = decodeState(encoded)

      const contextB = new OfflineContext({ sampleRate: 48000 })
      const engineB = new Engine({ context: contextB, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
      const entryB = await engineB.addPlugin(CANONICAL, { state: restored })

      const stateB = await engineB.requestState(entryB.id)
      expect(new Uint8Array(stateB.ir)).toEqual(new Uint8Array(wavOf([1.0])))

      // And behaviourally identical to the node that actually had loadAsset
      // called on it, not merely reporting the right bytes back.
      const tone = Float32Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / 48000) * 0.5)
      const outputA = engineA.get(entryA.id).node.render([tone, tone])[0]
      const outputB = engineB.get(entryB.id).node.render([tone, tone])[0]
      expect(Array.from(outputB)).toEqual(Array.from(outputA))
    })
  })
})
