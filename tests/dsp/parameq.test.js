// tests/dsp/parameq.test.js
//
// Deterministic offline audio tests for the six-band parametric equalizer,
// in the same discipline as tests/dsp/dynamix.test.js: a plain wasm
// instance driven by fixed sines is reproducible and a live context is not.
//
// Expected figures are exact RBJ cookbook responses (computed independently
// with f64 trig), and tolerances are loose, at the dB-fraction level,
// because the module evaluates its coefficient update with polynomial
// approximations rather than libm. What is asserted is that each shape lands
// where the cookbook says, not the approximation's error bound.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'

const dir = resolve(import.meta.dirname, '../../plugins/parameq')
const wasmPath = resolve(dir, 'parameq.wasm')

const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/parameq/parameq.wasm not built; run plugins/parameq/build.sh')

const SAMPLE_RATE = 48000
// Param index of a band field: index 0 is the master enable, then five per
// band in on, type, freq, gain, q order, matching parameq.cpp jig_set_param.
const P = (band, field) => 1 + (band - 1) * 5 + ({ on: 0, type: 1, freq: 2, gain: 3, q: 4 })[field]
const TYPE = { peak: 0, lowShelf: 1, highShelf: 2, lowPass: 3, highPass: 4, bandPass: 5, notch: 6 }

async function load () {
  const bytes = await readFile(wasmPath)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const e = instance.exports
  e.jig_init(SAMPLE_RATE)
  const frames = e.jig_max_frames()
  return {
    e,
    frames,
    input: [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_input_ptr(c), frames)),
    output: [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))
  }
}

function solo (e, band) {
  for (let b = 1; b <= 6; b++) e.jig_set_param(P(b, 'on'), b === band ? 1 : 0)
}

function allOn (e) {
  for (let b = 1; b <= 6; b++) e.jig_set_param(P(b, 'on'), 1)
}

/** RMS of the settled output for a sine at freq, both channels driven. */
function drive ({ e, frames, input, output }, freq, amp = 0.5, blocks = 300) {
  let sum = 0
  let n = 0
  for (let b = 0; b < blocks; b++) {
    for (let i = 0; i < frames; i++) {
      const s = Math.sin(2 * Math.PI * freq * (b * frames + i) / SAMPLE_RATE) * amp
      input[0][i] = s
      input[1][i] = s
    }
    e.jig_process(frames)
    if (b > blocks - 100) {
      for (let i = 0; i < frames; i++) { sum += output[0][i] * output[0][i]; n++ }
    }
  }
  return Math.sqrt(sum / n)
}

const INPUT_RMS = 0.5 / Math.SQRT2

describeBuilt('parameq wasm', () => {
  it('exports the ABI its processor expects', async () => {
    const { e } = await load()
    for (const name of ['jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param', 'jig_max_frames', 'memory']) {
      expect(name in e, name).toBe(true)
    }
    expect(e.jig_max_frames()).toBe(128)
  })

  it('passes a midrange sine unchanged on the default patch', async () => {
    const h = await load()
    allOn(h.e)
    expect(drive(h, 1000)).toBeCloseTo(INPUT_RMS, 3)
  })

  it('boosts and cuts a peak band by its gain in dB', async () => {
    const h = await load()
    solo(h.e, 3)
    for (const gain of [6, 12, 24, -6, -12]) {
      h.e.jig_set_param(P(3, 'gain'), gain)
      expect(drive(h, 1000)).toBeCloseTo(INPUT_RMS * Math.pow(10, gain / 20), 3)
    }
  })

  it('shelves both directions', async () => {
    const h = await load()
    solo(h.e, 2)
    h.e.jig_set_param(P(2, 'gain'), 6)
    expect(drive(h, 60)).toBeCloseTo(INPUT_RMS * Math.pow(10, 6 / 20), 2)
    h.e.jig_set_param(P(2, 'gain'), 0)
    solo(h.e, 5)
    h.e.jig_set_param(P(5, 'gain'), -6)
    expect(drive(h, 18000)).toBeCloseTo(INPUT_RMS * Math.pow(10, -6 / 20), 2)
  })

  it('cuts below a high pass corner and passes above it', async () => {
    const h = await load()
    solo(h.e, 1)
    // Exact RBJ figures for a high pass at 80 Hz, Q 0.7.
    expect(drive(h, 20)).toBeCloseTo(0.02203, 3)
    expect(drive(h, 200)).toBeCloseTo(0.34800, 3)
  })

  it('passes below a low pass corner and cuts above it', async () => {
    const h = await load()
    solo(h.e, 6)
    expect(drive(h, 1000)).toBeCloseTo(INPUT_RMS, 3)
    // Exact RBJ figure for a low pass at 16 kHz, Q 0.7, probed at 18 kHz.
    expect(drive(h, 18000)).toBeCloseTo(0.16048, 3)
  })

  it('notches deeply at its corner and leaves an octave up alone', async () => {
    const h = await load()
    solo(h.e, 3)
    h.e.jig_set_param(P(3, 'type'), TYPE.notch)
    h.e.jig_set_param(P(3, 'q'), 4)
    expect(drive(h, 1000)).toBeLessThan(0.02)
    expect(drive(h, 2000)).toBeCloseTo(0.34879, 2)
  })

  it('passes a band pass at its corner', async () => {
    const h = await load()
    solo(h.e, 3)
    h.e.jig_set_param(P(3, 'type'), TYPE.bandPass)
    // The RBJ band pass variant holds 0 dB peak gain: unity at the corner.
    expect(drive(h, 1000)).toBeCloseTo(INPUT_RMS, 3)
  })

  it('is silent on silence and finite everywhere', async () => {
    const h = await load()
    solo(h.e, 3)
    h.e.jig_set_param(P(3, 'gain'), 24)
    h.e.jig_set_param(P(3, 'type'), TYPE.peak)
    h.input[0].fill(0)
    h.input[1].fill(0)
    for (let b = 0; b < 10; b++) {
      h.e.jig_process(h.frames)
      for (let i = 0; i < h.frames; i++) {
        expect(h.output[0][i]).toBe(0)
        expect(h.output[1][i]).toBe(0)
      }
    }
  })

  it('copies input to output untouched when the master enable is off', async () => {
    const h = await load()
    allOn(h.e)
    h.e.jig_set_param(P(3, 'gain'), 12)
    h.e.jig_set_param(0, 0)
    expect(drive(h, 1000)).toBeCloseTo(INPUT_RMS, 4)
  })

  it('processes both channels identically for a stereo-identical input', async () => {
    const h = await load()
    allOn(h.e)
    h.e.jig_set_param(P(3, 'gain'), 12)
    const { e, frames, input, output } = h
    for (let i = 0; i < frames; i++) {
      const s = Math.sin(i / 8) * 0.5
      input[0][i] = s
      input[1][i] = s
    }
    e.jig_process(frames)
    for (let i = 0; i < frames; i++) {
      expect(output[1][i]).toBe(output[0][i])
      expect(Number.isFinite(output[0][i])).toBe(true)
    }
  })
})
