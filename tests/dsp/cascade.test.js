// tests/dsp/cascade.test.js
//
// Deterministic offline audio tests. AGENTS.md prefers these over device-based
// ones because an OfflineAudioContext render, or a plain wasm instance driven
// by a seeded generator as here, is reproducible and a live context is not.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { digestOf } from '../../src/host/Integrity.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile as parseTurtle } from '../../src/validate/files.js'

const dir = resolve(import.meta.dirname, '../../plugins/cascade')
const wasmPath = resolve(dir, 'cascade.wasm')

// The plugin is a build artefact. Skipping rather than failing when it is
// absent keeps a fresh clone green, and the message says what to run.
const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/cascade/cascade.wasm not built; run plugins/cascade/build.sh')

/** A seeded generator, so a failure reproduces exactly. */
function noise (seed = 12345) {
  let state = seed
  return () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return (state / 0x3fffffff) - 1
  }
}

async function load (params = []) {
  const bytes = await readFile(wasmPath)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const e = instance.exports
  e.jig_init(48000)
  for (const [index, value] of params) e.jig_set_param(index, value)
  const frames = e.jig_max_frames()
  return {
    e,
    frames,
    input: [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_input_ptr(c), frames)),
    output: [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))
  }
}

const rms = view => Math.sqrt(view.reduce((s, v) => s + v * v, 0) / view.length)

const PARAM = { mix: 0, size: 1, damping: 2, freeze: 3, mode: 4 }

describeBuilt('cascade wasm', () => {
  it('exports the ABI its processor expects', async () => {
    const { e } = await load()
    for (const name of ['jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr',
      'jig_set_param', 'jig_max_frames', 'memory']) {
      expect(e[name], `missing export ${name}`).toBeDefined()
    }
    expect(e.jig_max_frames()).toBe(128)
  })

  it('passes the dry signal through untouched at mix 0', async () => {
    const { e, frames, input, output } = await load([[PARAM.mix, 0]])
    const gen = noise()
    const source = Float32Array.from({ length: frames }, gen)
    input[0].set(source)
    e.jig_process(frames)
    // Exactly, not approximately: at mix 0 the wet path is multiplied by zero
    // and the dry path by one, so anything else is a signal-path bug.
    expect(Array.from(output[0])).toEqual(Array.from(source))
  })

  it('produces a decaying tail from an impulse', async () => {
    const { e, frames, input, output } = await load([[PARAM.mix, 1], [PARAM.size, 24]])
    input[0][0] = 1
    const levels = []
    for (let block = 0; block < 200; block++) {
      e.jig_process(frames)
      levels.push(rms(output[0]))
      input[0].fill(0)
    }
    const onset = levels.findIndex(v => v > 1e-9)
    // A Schroeder topology has no early reflections, so the first output
    // appears after the shortest comb delay rather than immediately.
    expect(onset).toBeGreaterThan(0)
    expect(onset).toBeLessThan(30)
    expect(levels[199]).toBeLessThan(levels[onset + 4])
    expect(levels.every(Number.isFinite)).toBe(true)
  })

  it('makes the pre-delay longer as size grows', async () => {
    const onsetFor = async size => {
      const { e, frames, input, output } = await load([[PARAM.mix, 1], [PARAM.size, size]])
      input[0][0] = 1
      for (let block = 0; block < 200; block++) {
        e.jig_process(frames)
        if (rms(output[0]) > 1e-9) return block
        input[0].fill(0)
      }
      return -1
    }
    expect(await onsetFor(60)).toBeGreaterThan(await onsetFor(4))
  })

  it('holds the tail when frozen, bounded and finite', async () => {
    const { e, frames, input, output } = await load([[PARAM.mix, 1], [PARAM.size, 24]])
    const gen = noise()
    for (let block = 0; block < 60; block++) {
      for (let i = 0; i < frames; i++) input[0][i] = gen() * 0.3
      e.jig_process(frames)
    }
    input[0].fill(0)
    for (let block = 0; block < 20; block++) e.jig_process(frames)
    const before = rms(output[0])
    expect(before).toBeGreaterThan(0)

    e.jig_set_param(PARAM.freeze, 1)
    for (let block = 0; block < 2000; block++) e.jig_process(frames)
    const after = rms(output[0])

    // Unity feedback holds rather than decays or runs away. Both directions
    // matter: a freeze that fades is not a freeze, and one that grows is a
    // hazard behind a button labelled Freeze.
    expect(after).toBeGreaterThan(before * 0.2)
    expect(after).toBeLessThan(before * 4)
    expect(Number.isFinite(after)).toBe(true)
  })

  it('stays finite at every parameter extreme', async () => {
    for (const [index, value] of [
      [PARAM.size, 2], [PARAM.size, 60], [PARAM.damping, 200], [PARAM.damping, 18000],
      [PARAM.mode, 0], [PARAM.mode, 2], [PARAM.mix, 1]
    ]) {
      const { e, frames, input, output } = await load([[PARAM.mix, 1], [index, value]])
      const gen = noise()
      for (let block = 0; block < 300; block++) {
        for (let i = 0; i < frames; i++) input[0][i] = gen()
        e.jig_process(frames)
      }
      expect(output[0].every(Number.isFinite), `param ${index}=${value} produced a non-finite sample`).toBe(true)
    }
  })
})

describeBuilt('plugins/cascade/profile.ttl', () => {
  let profile
  beforeAll(async () => {
    profile = readProfile(await parseTurtle(resolve(dir, 'profile.ttl'), 'urn:cascade'))
  })

  it('declares the digest of the wasm that is actually on disk', async () => {
    // The binding that matters: rebuilding the plugin without regenerating the
    // profile leaves a digest describing a file that no longer exists, and the
    // host refuses the plugin with an integrity mismatch. Run build.sh.
    expect(profile.module.integrity).toBe(await digestOf(new Uint8Array(await readFile(wasmPath))))
  })

  it('declares the digest of the processor that is actually on disk', async () => {
    const bytes = new Uint8Array(await readFile(resolve(dir, 'cascade-processor.js')))
    expect(profile.processor.integrity).toBe(await digestOf(bytes))
  })

  it('agrees with the processor about its parameters', async () => {
    // The processor hand-writes its parameterDescriptors, because a worklet
    // cannot fetch its own profile. Nothing connects the two but this.
    const captured = {}
    globalThis.AudioWorkletProcessor = class { constructor () { this.port = { onmessage: null, postMessage () {} } } }
    globalThis.registerProcessor = (name, cls) => { captured.name = name; captured.cls = cls }
    globalThis.sampleRate = 48000
    await import(`file://${resolve(dir, 'cascade-processor.js')}`)

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
