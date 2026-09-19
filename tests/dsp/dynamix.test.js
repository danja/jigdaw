// tests/dsp/dynamix.test.js
//
// Deterministic offline audio tests, the same discipline as
// tests/dsp/cascade.test.js: an OfflineAudioContext render, or here a plain
// wasm instance driven by a seeded generator or a fixed level, is
// reproducible and a live context is not.
//
// Tolerances throughout are deliberately loose, at the dB-fraction level
// rather than bit-exact, because plugins/dynamix/src/lib.rs computes gain in
// the dB domain using fast_log2/fast_exp2, a bit-manipulation approximation
// of at most about 0.03 dB error rather than a call to libm. A test that
// demanded exactness would be testing the approximation's error bound, not
// the compressor.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { digestOf } from '../../src/host/Integrity.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile as parseTurtle } from '../../src/validate/files.js'

const dir = resolve(import.meta.dirname, '../../plugins/dynamix')
const wasmPath = resolve(dir, 'dynamix.wasm')

const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/dynamix/dynamix.wasm not built; run plugins/dynamix/build.sh')

function noise (seed = 424242) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return (state / 0x3fffffff) - 1
  }
}

const dbOf = lin => 20 * Math.log10(Math.max(Math.abs(lin), 1e-9))

const PARAM = {
  compEnable: 0, compMode: 1, threshold: 2, ratio: 3, attack: 4, release: 5,
  knee: 6, makeup: 7, limitEnable: 8, ceiling: 9, limitRelease: 10,
  clipEnable: 11, drive: 12, shape: 13
}

async function load (params = {}, sampleRate = 48000) {
  const bytes = await readFile(wasmPath)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const e = instance.exports
  e.jig_init(sampleRate)
  // Everything defaults off except what a given test turns on, so one stage
  // can be examined without the others reshaping its output.
  for (const [symbol, index] of Object.entries(PARAM)) {
    if (symbol.endsWith('Enable')) e.jig_set_param(index, 0)
  }
  for (const [symbol, value] of Object.entries(params)) {
    e.jig_set_param(PARAM[symbol], value)
  }
  const frames = e.jig_max_frames()
  return {
    e,
    frames,
    // 0/1: main L/R. 2/3: side chain key L/R.
    input: [0, 1, 2, 3].map(c => new Float32Array(e.memory.buffer, e.jig_input_ptr(c), frames)),
    output: [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))
  }
}

/** Feed a constant level for `blocks` quanta, returning the settled output. */
function settle ({ e, frames, input, output }, level, blocks) {
  for (let block = 0; block < blocks; block++) {
    input[0].fill(level)
    input[1].fill(level)
    e.jig_process(frames)
  }
  return output[0][frames - 1]
}

describeBuilt('dynamix wasm', () => {
  it('exports the ABI its processor expects', async () => {
    const { e } = await load()
    for (const name of [
      'jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param',
      'jig_set_sidechain_active', 'jig_max_frames', 'memory'
    ]) {
      expect(e[name], `missing export ${name}`).toBeDefined()
    }
    expect(e.jig_max_frames()).toBe(128)
  })

  it('passes the signal through untouched with every stage off', async () => {
    const { e, frames, input, output } = await load()
    const gen = noise()
    const source = Float32Array.from({ length: frames }, gen)
    input[0].set(source)
    input[1].set(source)
    e.jig_process(frames)
    expect(Array.from(output[0])).toEqual(Array.from(source))
    expect(Array.from(output[1])).toEqual(Array.from(source))
  })

  describe('compressor', () => {
    it('leaves a level well below threshold alone', async () => {
      const rig = await load({ compEnable: 1, compMode: 0, threshold: -18, ratio: 4, knee: 0, attack: 1, release: 50 })
      const out = settle(rig, 0.05, 400) // -26 dBFS, 8 dB under threshold
      expect(out).toBeCloseTo(0.05, 3)
    })

    it('reduces a level above threshold by the declared ratio', async () => {
      const rig = await load({ compEnable: 1, compMode: 0, threshold: -18, ratio: 4, knee: 0, attack: 1, release: 50 })
      const level = 0.5 // -6.02 dBFS, 12 dB over threshold
      const out = settle(rig, level, 500)
      // 12 dB over, ratio 4:1, hard knee: 9 dB of reduction expected.
      const reductionDb = dbOf(level) - dbOf(out)
      expect(reductionDb).toBeGreaterThan(8.7)
      expect(reductionDb).toBeLessThan(9.3)
    })

    it('applies makeup gain after the reduction', async () => {
      const withoutMakeup = await load({ compEnable: 1, compMode: 0, threshold: -18, ratio: 4, knee: 0, attack: 1, release: 50, makeup: 0 })
      const withMakeup = await load({ compEnable: 1, compMode: 0, threshold: -18, ratio: 4, knee: 0, attack: 1, release: 50, makeup: 6 })
      const level = 0.5
      const plain = settle(withoutMakeup, level, 500)
      const boosted = settle(withMakeup, level, 500)
      const makeupDb = dbOf(boosted) - dbOf(plain)
      expect(makeupDb).toBeGreaterThan(5.7)
      expect(makeupDb).toBeLessThan(6.3)
    })

    it('in expander mode pushes a level below threshold down further', async () => {
      const rig = await load({ compEnable: 1, compMode: 1, threshold: -18, ratio: 4, knee: 0, attack: 1, release: 50 })
      const level = 0.05 // -26 dBFS, 8 dB under threshold
      const out = settle(rig, level, 500)
      // 8 dB under, expander ratio 4, slope (ratio - 1) = 3: 24 dB of extra
      // attenuation expected.
      const reductionDb = dbOf(level) - dbOf(out)
      expect(reductionDb).toBeGreaterThan(23.3)
      expect(reductionDb).toBeLessThan(24.7)
    })

    it('detects on the side chain key when one is connected', async () => {
      const rig = await load({ compEnable: 1, compMode: 0, threshold: -18, ratio: 4, knee: 0, attack: 1, release: 50 })
      rig.e.jig_set_sidechain_active(1)
      const mainLevel = 0.5 // -6 dB, already over threshold on its own
      for (let block = 0; block < 500; block++) {
        rig.input[0].fill(mainLevel)
        rig.input[1].fill(mainLevel)
        rig.input[2].fill(0.9) // the key: louder still, so it drives the reduction
        rig.input[3].fill(0.9)
        rig.e.jig_process(rig.frames)
      }
      const out = rig.output[0][rig.frames - 1]
      // Detecting 0.9's level (about 17 dB over threshold at ratio 4) reduces
      // the *main* signal well below what its own -6 dB level alone would
      // call for (which is 9 dB of reduction, to about -15 dB).
      expect(dbOf(out)).toBeLessThan(dbOf(mainLevel) - 5)
    })

    it('ignores the key input when the host reports it is not connected', async () => {
      const rig = await load({ compEnable: 1, compMode: 0, threshold: -18, ratio: 4, knee: 0, attack: 1, release: 50 })
      rig.e.jig_set_sidechain_active(0) // matches a disconnected second input
      const level = 0.05 // well under threshold on the main signal
      for (let block = 0; block < 500; block++) {
        rig.input[0].fill(level)
        rig.input[1].fill(level)
        rig.input[2].fill(0.9) // present in the scratch buffer but must be ignored
        rig.input[3].fill(0.9)
        rig.e.jig_process(rig.frames)
      }
      const out = rig.output[0][rig.frames - 1]
      expect(out).toBeCloseTo(level, 3)
    })
  })

  describe('limiter', () => {
    it('leaves a level under the ceiling alone', async () => {
      const rig = await load({ limitEnable: 1, ceiling: -0.3, limitRelease: 20 })
      const out = settle(rig, 0.3, 200)
      expect(out).toBeCloseTo(0.3, 3)
    })

    it('holds a level over the ceiling at or below it', async () => {
      const rig = await load({ limitEnable: 1, ceiling: -0.3, limitRelease: 20 })
      const out = settle(rig, 0.98, 200)
      const ceilingLin = Math.pow(10, -0.3 / 20)
      expect(Math.abs(out)).toBeLessThanOrEqual(ceilingLin * 1.01)
      expect(Math.abs(out)).toBeGreaterThan(ceilingLin * 0.9)
    })
  })

  describe('clipper', () => {
    it('bounds a hard-clipped signal to +-1 before drive', async () => {
      const rig = await load({ clipEnable: 1, drive: 24, shape: 1 })
      const out = settle(rig, 0.9, 5)
      expect(Math.abs(out)).toBeLessThanOrEqual(1.0)
    })

    it('bounds a soft-clipped signal to the cubic shaper\'s +-2/3 ceiling', async () => {
      const rig = await load({ clipEnable: 1, drive: 24, shape: 0 })
      const out = settle(rig, 0.9, 5)
      expect(Math.abs(out)).toBeLessThanOrEqual(2 / 3 + 0.01)
    })

    it('leaves a quiet signal close to untouched at zero drive', async () => {
      const rig = await load({ clipEnable: 1, drive: 0, shape: 0 })
      const out = settle(rig, 0.1, 5)
      expect(out).toBeCloseTo(0.1, 2)
    })
  })

  it('stays finite at every parameter extreme run in series', async () => {
    const rig = await load({
      compEnable: 1, compMode: 0, threshold: -60, ratio: 20, knee: 24, attack: 0.1, release: 5,
      limitEnable: 1, ceiling: -12, limitRelease: 5,
      clipEnable: 1, drive: 24, shape: 1
    })
    const gen = noise()
    for (let block = 0; block < 300; block++) {
      for (let i = 0; i < rig.frames; i++) {
        rig.input[0][i] = gen()
        rig.input[1][i] = gen()
        rig.input[2][i] = gen()
        rig.input[3][i] = gen()
      }
      rig.e.jig_process(rig.frames)
    }
    expect(rig.output[0].every(Number.isFinite)).toBe(true)
    expect(rig.output[1].every(Number.isFinite)).toBe(true)
  })
})

describeBuilt('plugins/dynamix/profile.ttl', () => {
  let profile
  beforeAll(async () => {
    profile = readProfile(await parseTurtle(resolve(dir, 'profile.ttl'), 'urn:dynamix'))
  })

  it('declares the digest of the wasm that is actually on disk', async () => {
    expect(profile.module.integrity).toBe(await digestOf(new Uint8Array(await readFile(wasmPath))))
  })

  it('declares the digest of the processor that is actually on disk', async () => {
    const bytes = new Uint8Array(await readFile(resolve(dir, 'dynamix-processor.js')))
    expect(profile.processor.integrity).toBe(await digestOf(bytes))
  })

  it('declares two stereo audio inputs, for the main signal and the side chain key', () => {
    expect(profile.audioInputs).toBe(2)
    expect(profile.inputChannels).toBe(2)
    expect(profile.audioOutputs).toBe(1)
    expect(profile.outputChannels).toBe(2)
  })

  it('agrees with the processor about its parameters', async () => {
    // The processor hand-writes its parameterDescriptors, because a worklet
    // cannot fetch its own profile. Nothing connects the two but this.
    const captured = {}
    globalThis.AudioWorkletProcessor = class { constructor () { this.port = { onmessage: null, postMessage () {} } } }
    globalThis.registerProcessor = (name, cls) => { captured.name = name; captured.cls = cls }
    globalThis.sampleRate = 48000
    await import(`file://${resolve(dir, 'dynamix-processor.js')}`)

    expect(captured.name).toBe(profile.processor.registeredName)

    const declared = captured.cls.parameterDescriptors
    expect(declared.map(d => d.name).sort()).toEqual(profile.ports.map(p => p.symbol).sort())

    for (const descriptor of declared) {
      const port = profile.ports.find(p => p.symbol === descriptor.name)
      expect(descriptor.defaultValue, `${descriptor.name} default`).toBe(port.defaultValue)
      expect(descriptor.minValue, `${descriptor.name} min`).toBe(port.minimum)
      expect(descriptor.maxValue, `${descriptor.name} max`).toBe(port.maximum)
    }
  })
})
