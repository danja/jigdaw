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
    capabilities: detectCapabilities({ WebAssembly }),
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
    expect(profile.ports.map(p => p.symbol).sort()).toEqual(['amp', 'input', 'mix', 'output'])
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

  /** A PCM WAV of any channel count, 16 or 24 bit, interleaved `frames` of
   * arrays, one value per channel. */
  function pcmWav (frames, bits) {
    const channels = frames[0].length
    const width = bits / 8
    const dataBytes = frames.length * channels * width
    const buf = Buffer.alloc(44 + dataBytes)
    buf.write('RIFF', 0); buf.writeUInt32LE(36 + dataBytes, 4); buf.write('WAVE', 8)
    buf.write('fmt ', 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20)
    buf.writeUInt16LE(channels, 22); buf.writeUInt32LE(48000, 24); buf.writeUInt32LE(48000 * channels * width, 28)
    buf.writeUInt16LE(channels * width, 32); buf.writeUInt16LE(bits, 34); buf.write('data', 36); buf.writeUInt32LE(dataBytes, 40)
    let at = 44
    for (const frame of frames) {
      for (const v of frame) { buf.writeIntLE(Math.round(v * (2 ** (bits - 1) - 1)), at, width); at += width }
    }
    return new Uint8Array(buf).buffer
  }

  /** A deterministic generator, so a failure reproduces. */
  function noise (seed) {
    let s = seed
    return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 2 ** 31 - 1 }
  }

  describe('convolution: a cabinet or a room, up to 2.7 seconds', () => {
    async function convolverOnly (settings = {}) {
      const context = new OfflineContext({ sampleRate: 48000 })
      const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
      const entry = await engine.addPlugin(CANONICAL)
      const errors = []
      engine.onMessage(entry.id, m => { if (m?.type === 'error') errors.push(m.message) })
      for (const [symbol, value] of Object.entries({ amp: 0, ...settings })) engine.setParameter(entry.id, symbol, value)
      const load = async ir => { engine.loadAsset(entry.id, 'ir', ir); await new Promise(r => setTimeout(r, 0)) }
      return { entry, errors, load }
    }

    it('matches a direct convolution sample for sample, across many partitions, both channels independently', async () => {
      // 5000 taps: the 256 convolved directly and nineteen FFT partitions,
      // the last one short. Left and right carry different noise, so a
      // mix-up of the two halves of the packed transform shows.
      const next = noise(7)
      const raw = Array.from({ length: 5000 }, (_, i) => next() * Math.exp(-i / 1200))
      const energy = Math.sqrt(raw.reduce((s, v) => s + v * v, 0))
      const ir = raw.map(v => Math.fround(v) / energy)
      const { entry, errors, load } = await convolverOnly()
      await load(wavOf(raw))

      const blocks = 80
      const left = Float32Array.from({ length: blocks * 128 }, () => next() * 0.5)
      const right = Float32Array.from({ length: blocks * 128 }, () => next() * 0.5)
      const got = [new Float32Array(blocks * 128), new Float32Array(blocks * 128)]
      for (let b = 0; b < blocks; b++) {
        const out = entry.node.render([left.subarray(b * 128, b * 128 + 128), right.subarray(b * 128, b * 128 + 128)])
        got[0].set(out[0], b * 128)
        got[1].set(out[1], b * 128)
      }

      let worst = 0
      for (const [channel, input] of [[0, left], [1, right]]) {
        for (let t = 0; t < input.length; t++) {
          let want = 0
          for (let k = 0; k <= Math.min(t, ir.length - 1); k++) want += ir[k] * input[t - k]
          worst = Math.max(worst, Math.abs(got[channel][t] - want))
        }
      }
      expect(errors).toEqual([])
      expect(worst).toBeLessThan(1e-4)
    })

    it('reads 24 bit stereo, the format room libraries ship in, and normalises it to unit energy', async () => {
      // One tap per channel, 0.5 and 0.3: mixed to mono that is 0.4, and
      // normalised it is 1, so the output is the input.
      const { entry, errors, load } = await convolverOnly()
      await load(pcmWav([[0.5, 0.3]], 24))
      const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 5) * 0.5)
      const out = entry.node.render([signal, signal])
      expect(errors).toEqual([])
      for (let i = 0; i < 128; i++) expect(out[0][i]).toBeCloseTo(signal[i], 5)
    })

    it('loads a response of the full 131072 samples and refuses one sample more, by name, keeping the last one', async () => {
      const { entry, errors, load } = await convolverOnly()
      await load(pcmWav(Array.from({ length: 131072 }, (_, i) => [i === 0 ? 1 : 0]), 16))
      expect(errors).toEqual([])
      await load(pcmWav(Array.from({ length: 131073 }, (_, i) => [i === 0 ? 1 : 0]), 16))
      expect(errors).toEqual(['the impulse response is longer than 131072 samples, 2.7 seconds at 48 kHz'])
      const signal = Float32Array.from({ length: 128 }, (_, i) => Math.cos(i / 3) * 0.5)
      const out = entry.node.render([signal, signal])
      for (let i = 0; i < 128; i++) expect(out[0][i]).toBeCloseTo(signal[i], 5)
    })

    it('with the amp off and Mix at 0, passes the input through untouched', async () => {
      const { entry, load } = await convolverOnly({ mix: 0 })
      await load(wavOf([0.2, 0.9, -0.4]))
      const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 7) * 0.5)
      expect(Array.from(entry.node.render([signal, signal])[0])).toEqual(Array.from(signal))
    })

    it('Mix blends linearly between the dry signal and the convolved one', async () => {
      const ir = wavOf([0.2, 0.9, -0.4])
      const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 7) * 0.5)
      const render = async mix => {
        const { entry, load } = await convolverOnly({ mix })
        await load(ir)
        return entry.node.render([signal, signal])[0]
      }
      const [dry, wet, half] = [await render(0), await render(1), await render(0.5)]
      for (let i = 0; i < 128; i++) expect(half[i]).toBeCloseTo((dry[i] + wet[i]) / 2, 5)
    })

    it('with the amp on, the model changes the sound; with it off, it does not', async () => {
      const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * 220 * i / 48000) * 0.5)
      const on = await convolverOnly({ amp: 1, mix: 0 })
      const off = await convolverOnly({ amp: 0, mix: 0 })
      expect(Array.from(off.entry.node.render([signal, signal])[0])).toEqual(Array.from(signal))
      expect(Array.from(on.entry.node.render([signal, signal])[0])).not.toEqual(Array.from(signal))
    })
  })

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
