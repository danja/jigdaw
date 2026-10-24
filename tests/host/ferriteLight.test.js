// tests/host/ferriteLight.test.js
//
// Ferrite's Light switch picks the smallest network of a slimmable .nam. The model used is the one the
// Fender preset carries, which holds two networks (3 and 8 channels), so what is tested is the shipped case.
// A plain .nam has one network and must be unaffected: the switch is a quality dial, not a second model.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const wasmBytes = readFileSync(resolve(root, 'plugins/ferrite/ferrite.wasm'))
const PARAM_LIGHT = 4

/** The .nam the Fender preset carries, as its saved state holds it. */
function presetModel () {
  const ttl = readFileSync(resolve(root, 'web/presets/fender-into-the-ropery.ttl'), 'utf8')
  const literal = ttl.match(/jig:nodeState "((?:[^"\\]|\\.)*)"/)[1]
  const state = JSON.parse(JSON.parse(`"${literal}"`))
  return Buffer.from(state.nam.__jigdawArrayBuffer, 'base64')
}

function render (nam, light) {
  const { exports: e } = new WebAssembly.Instance(new WebAssembly.Module(wasmBytes), {})
  e.jig_init(48000)
  if (light !== null) e.jig_set_param(PARAM_LIGHT, light)
  new Uint8Array(e.memory.buffer, e.jig_nam_ptr(), nam.length).set(nam)
  expect(e.jig_load_nam(nam.length)).toBe(0)
  const n = e.jig_max_frames()
  const left = new Float32Array(e.memory.buffer, e.jig_input_ptr(0), n)
  const right = new Float32Array(e.memory.buffer, e.jig_input_ptr(1), n)
  const out = new Float32Array(e.memory.buffer, e.jig_output_ptr(0), n)
  const samples = []
  let phase = 0
  for (let b = 0; b < 100; b++) {
    for (let i = 0; i < n; i++) { left[i] = right[i] = 0.3 * Math.sin(phase); phase += 0.06 }
    e.jig_process(n)
    samples.push(...out)
  }
  return { samples, e }
}

const differs = (a, b) => a.some((v, i) => Math.abs(v - b[i]) > 1e-4)

describe('Ferrite Light', () => {
  const nam = presetModel()

  it('is a slimmable model with a smaller network, so the test means something', () => {
    const file = JSON.parse(nam.toString('utf8'))
    expect(file.architecture).toBe('SlimmableContainer')
    expect(file.config.submodels.length).toBeGreaterThan(1)
  })

  it('runs a different, smaller network when on, and the full one when off', () => {
    const full = render(nam, 0).samples
    const light = render(nam, 1).samples
    expect(full.every(Number.isFinite) && light.every(Number.isFinite)).toBe(true)
    expect(differs(full, light)).toBe(true)
    // Light is a quality trade, not a different amp: it stays in the same loudness range.
    const rms = v => Math.sqrt(v.reduce((s, x) => s + x * x, 0) / v.length)
    expect(rms(light) / rms(full)).toBeGreaterThan(0.7)
    expect(rms(light) / rms(full)).toBeLessThan(1.4)
  })

  it('is off by default: a plugin nobody touched runs the full network', () => {
    expect(Array.from(render(nam, null).samples)).toEqual(Array.from(render(nam, 0).samples))
  })

  it('applies when flipped after the model is loaded', () => {
    const { e } = render(nam, 0)
    const n = e.jig_max_frames()
    const left = new Float32Array(e.memory.buffer, e.jig_input_ptr(0), n)
    const out = new Float32Array(e.memory.buffer, e.jig_output_ptr(0), n)
    const block = () => { for (let i = 0; i < n; i++) left[i] = 0.3 * Math.sin(i * 0.06); e.jig_process(n); return Array.from(out) }
    e.jig_set_param(PARAM_LIGHT, 0)
    const before = block()
    e.jig_set_param(PARAM_LIGHT, 1)
    const after = block()
    expect(differs(before, after)).toBe(true)
    expect(after.every(Number.isFinite)).toBe(true)
  })

  it('does nothing to a model that is not slimmable', () => {
    const plain = readFileSync(resolve(root, 'plugins/ferrite/wavenet.nam'))
    expect(JSON.parse(plain.toString('utf8')).architecture).not.toBe('SlimmableContainer')
    expect(Array.from(render(plain, 1).samples)).toEqual(Array.from(render(plain, 0).samples))
  })

  it('the preset turns it on for the amp, which is the one that is heavy', () => {
    const ttl = readFileSync(resolve(root, 'web/presets/fender-into-the-ropery.ttl'), 'utf8')
    expect(ttl).toMatch(/jig:symbol "light"\s*;\s*jig:value 1\.0/)
  })
})
