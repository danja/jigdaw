// tests/dsp/quefrency.test.js
//
// The wasm driven directly, deterministically. docs/plugins/quefrency-design.md
// lists what each of these holds the plugin to. The spectral claims are
// measured on additive signals, whose partials and envelope are known exactly.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { digestOf } from '../../src/host/Integrity.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile as parseTurtle } from '../../src/validate/files.js'
import { vocabulary } from '../../src/rdf/Vocabulary.js'

const dir = resolve(import.meta.dirname, '../../plugins/quefrency')
const wasmPath = resolve(dir, 'quefrency.wasm')

const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/quefrency/quefrency.wasm not built; run plugins/quefrency/build.sh')

const PARAM = {
  formant_shift: 0, formant_depth: 1, formant_tilt: 2, pitch_shift: 3, pitch_fine: 4,
  freq_shift: 5, harmonic_depth: 6, lifter: 7, estimator: 8, mix: 9, output: 10
}

let bytes
async function load (rate = 48000, params = {}) {
  bytes ??= await readFile(wasmPath)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const e = instance.exports
  e.jig_init(rate)
  for (const [name, value] of Object.entries(params)) e.jig_set_param(PARAM[name], value)
  return e
}

/** Run a mono signal through both channels; returns channel 0. */
function run (e, signal) {
  const frames = e.jig_max_frames()
  const pages = e.memory.buffer.byteLength
  const input = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_input_ptr(c), frames))
  const output = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))
  const result = new Float32Array(signal.length)
  for (let at = 0; at < signal.length; at += frames) {
    const block = signal.subarray(at, at + frames)
    for (const view of input) { view.fill(0); view.set(block) }
    e.jig_process(frames)
    result.set(output[0].subarray(0, block.length), at)
  }
  // Growing memory would have detached every view taken above.
  expect(e.memory.buffer.byteLength).toBe(pages)
  return result
}

function noise (length, seed = 12345) {
  let state = seed
  return Float32Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return (state / 0x3fffffff) - 1
  })
}

/** A sum of harmonics of f0, each weighted by `envelope(frequency)`. */
function additive (f0, rate, length, envelope = () => 1) {
  const signal = new Float32Array(length)
  for (let h = 1; h * f0 < rate / 2 - 500; h++) {
    const amplitude = envelope(h * f0) * 0.05
    const w = 2 * Math.PI * h * f0 / rate
    for (let i = 0; i < length; i++) signal[i] += amplitude * Math.sin(w * i + h)
  }
  return signal
}

/** Magnitude spectrum of a Hann-windowed segment, by radix 2 FFT. */
function spectrum (signal, start, size) {
  const re = new Float64Array(size)
  const im = new Float64Array(size)
  for (let i = 0; i < size; i++) re[i] = signal[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / size))
  for (let i = 1, j = 0; i < size; i++) {
    let bit = size >> 1
    for (; j & bit; bit >>= 1) j ^= bit
    j ^= bit
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]] }
  }
  for (let len = 2; len <= size; len <<= 1) {
    const angle = -2 * Math.PI / len
    for (let i = 0; i < size; i += len) {
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(angle * k); const wi = Math.sin(angle * k)
        const a = i + k; const b = a + len / 2
        const tr = re[b] * wr - im[b] * wi; const ti = re[b] * wi + im[b] * wr
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti
      }
    }
  }
  return Float64Array.from({ length: size / 2 }, (_, k) => Math.hypot(re[k], im[k]))
}

/** Peak magnitude within `width` Hz of `hz`. */
const around = (mags, hz, rate, size, width = 6) => {
  let most = 0
  const lo = Math.floor((hz - width) * size / rate)
  const hi = Math.ceil((hz + width) * size / rate)
  for (let k = Math.max(lo, 0); k <= hi; k++) most = Math.max(most, mags[k])
  return most
}

/** The frequency of the loudest bin. */
const loudest = (mags, rate, size) => {
  let best = 0
  for (let k = 1; k < mags.length; k++) if (mags[k] > mags[best]) best = k
  return best * rate / size
}

/** Write ABI version 2 event records and announce them for the next block. */
function sendMidi (e, events) {
  const view = new DataView(e.memory.buffer, e.jig_midi_in_ptr(), e.jig_midi_in_capacity() * 8)
  events.forEach(({ frame = 0, bytes }, i) => {
    view.setUint32(i * 8, frame, true)
    view.setUint8(i * 8 + 4, bytes.length)
    bytes.forEach((b, j) => view.setUint8(i * 8 + 5 + j, b))
  })
  e.jig_midi_in(events.length)
}

/** Process one silent block, so pending events are applied. */
function tick (e) {
  e.jig_process(e.jig_max_frames())
}

const FIRST_CC = 70

const rms = xs => Math.sqrt(xs.reduce((s, v) => s + v * v, 0) / xs.length)

describeBuilt('quefrency wasm', () => {
  it('exports the ABI its processor expects and imports nothing', async () => {
    bytes ??= await readFile(wasmPath)
    const compiled = new WebAssembly.Module(bytes)
    expect(WebAssembly.Module.imports(compiled)).toEqual([])
    const e = await load()
    for (const name of ['jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr',
      'jig_set_param', 'jig_max_frames', 'jig_latency_frames', 'jig_midi_in_ptr',
      'jig_midi_in_capacity', 'jig_midi_in', 'memory']) {
      expect(e[name], `missing export ${name}`).toBeDefined()
    }
    expect(e.jig_max_frames()).toBe(128)
  })

  // The design's central claim: at neutral settings every change is exp(0),
  // so the output is the input delayed by exactly the reported latency. This
  // is also what binds the declared latency to the real one.
  for (const [rate, latency] of [[44100, 2047], [48000, 2047], [88200, 4095], [96000, 4095]]) {
    it(`delays an impulse by exactly its reported latency at ${rate} Hz, and adds nothing else`, async () => {
      const e = await load(rate)
      expect(e.jig_latency_frames()).toBe(latency)
      const impulse = new Float32Array(latency + 8192)
      impulse[1000] = 1
      const out = run(e, impulse)
      expect(out[1000 + latency]).toBeCloseTo(1, 4)
      const stray = out.reduce((most, v, i) => i === 1000 + latency ? most : Math.max(most, Math.abs(v)), 0)
      expect(stray).toBeLessThan(1e-4)
    })
  }

  it('reconstructs noise at neutral settings with an error below -90 dB', async () => {
    for (const estimator of [0, 1]) {
      const e = await load(48000, { estimator })
      const input = noise(48000)
      const out = run(e, input)
      const latency = e.jig_latency_frames()
      let error = 0; let power = 0
      for (let i = latency; i < input.length; i++) {
        error += (out[i] - input[i - latency]) ** 2
        power += input[i - latency] ** 2
      }
      expect(10 * Math.log10(error / power), `estimator ${estimator}`).toBeLessThan(-90)
    }
  })

  it('aligns the dry path with the wet one, so a half mix does not comb filter', async () => {
    const e = await load(48000, { mix: 0.5 })
    const input = noise(24000, 7)
    const out = run(e, input)
    const latency = e.jig_latency_frames()
    for (let i = latency; i < input.length; i += 97) expect(out[i]).toBeCloseTo(input[i - latency], 4)
  })

  it('applies output gain to the whole signal', async () => {
    const e = await load(48000, { output: -6.0206 })
    const input = noise(12000, 3)
    const out = run(e, input)
    const latency = e.jig_latency_frames()
    for (let i = latency; i < input.length; i += 101) expect(out[i]).toBeCloseTo(input[i - latency] * 0.5, 4)
  })

  it('stays silent on silence under every transformation', async () => {
    const settings = { formant_shift: 7, formant_depth: 200, formant_tilt: 6, pitch_shift: -5, freq_shift: 300, harmonic_depth: 0 }
    for (const estimator of [0, 1]) {
      const e = await load(48000, { ...settings, estimator })
      const out = run(e, new Float32Array(16384))
      expect(out.every(v => v === 0), `estimator ${estimator}`).toBe(true)
    }
  })

  it('produces finite, bounded output at every extreme of every parameter', async () => {
    const extremes = [
      { formant_shift: -12, formant_depth: 0, pitch_shift: -24, harmonic_depth: 200, lifter: 0.5 },
      { formant_shift: 12, formant_depth: 200, formant_tilt: 6, pitch_shift: 24, harmonic_depth: 0, lifter: 5 },
      { formant_tilt: -6, freq_shift: -1000, pitch_fine: -100 },
      { freq_shift: 1000, pitch_fine: 100, output: 12 }
    ]
    const hiss = noise(24000)
    const input = additive(110, 48000, 24000).map((v, i) => v + hiss[i] * 0.01)
    for (const settings of extremes) {
      for (const estimator of [0, 1]) {
        const out = run(await load(48000, { ...settings, estimator }), input)
        expect(out.every(Number.isFinite), JSON.stringify(settings)).toBe(true)
        expect(out.reduce((most, v) => Math.max(most, Math.abs(v)), 0), JSON.stringify(settings)).toBeLessThan(100)
      }
    }
  })
})

// A harmonic series on 110 Hz under a single resonance at 1 kHz, so where the
// harmonics are and where the envelope peaks are both known.
describeBuilt('quefrency transformations', () => {
  const rate = 48000
  const size = 16384
  const formant = hz => Math.exp(-(((hz - 1000) / 250) ** 2)) + 0.02
  const source = additive(110, rate, 3 * size, formant)
  const start = 2 * size

  async function measure (params) {
    return spectrum(run(await load(rate, params), source), start, size)
  }

  it('moves the formant and not the pitch under formant shift', async () => {
    const mags = await measure({ formant_shift: 7 })
    // Still harmonics of 110: more energy on 1650 Hz (harmonic 15) than
    // anywhere between harmonics.
    expect(around(mags, 1650, rate, size)).toBeGreaterThan(20 * around(mags, 1705, rate, size, 3))
    // The resonance has moved up by 7 semitones, to about 1500 Hz.
    expect(Math.abs(loudest(mags, rate, size) - 1000 * 2 ** (7 / 12))).toBeLessThan(120)
  })

  it('moves every partial by the ratio under pitch shift', async () => {
    const mags = await measure({ pitch_shift: 12 })
    // An octave up: partials on 220 Hz, so 990 Hz (an odd harmonic of 110)
    // is gone and 880 Hz and 1100 Hz remain.
    expect(around(mags, 880, rate, size)).toBeGreaterThan(30 * around(mags, 990, rate, size))
    expect(around(mags, 1100, rate, size)).toBeGreaterThan(30 * around(mags, 990, rate, size))
  })

  it('keeps the formant in place under pitch shift', async () => {
    const mags = await measure({ pitch_shift: 7 })
    // Partials on 164.8 Hz, the loudest still within one partial of 1 kHz
    // rather than dragged to 1.5 kHz with the harmonics.
    expect(Math.abs(loudest(mags, rate, size) - 1000)).toBeLessThan(110 * 2 ** (7 / 12))
  })

  it('offsets every partial by the same number of hertz under frequency shift', async () => {
    const mags = await measure({ freq_shift: 50 })
    // 1000 Hz is not a harmonic of 110, but 990 + 50 = 1040 is where one lands.
    expect(around(mags, 1040, rate, size)).toBeGreaterThan(30 * around(mags, 990, rate, size))
  })

  it('flattens the harmonic structure at harmonic depth 0', async () => {
    const neutral = await measure({})
    const flat = await measure({ harmonic_depth: 0 })
    // The contrast between a harmonic and the gap beside it collapses.
    const contrast = mags => around(mags, 990, rate, size) / around(mags, 1045, rate, size, 3)
    expect(contrast(flat)).toBeLessThan(contrast(neutral) / 10)
  })

  it('deepens the formant at depth 200 and flattens it at 0', async () => {
    const level = mags => rms(Array.from(mags.slice(0, Math.round(5000 * size / rate))))
    const peakOverFloor = mags => around(mags, 990, rate, size) / around(mags, 3960, rate, size)
    const neutral = await measure({})
    expect(peakOverFloor(await measure({ formant_depth: 200 }))).toBeGreaterThan(2 * peakOverFloor(neutral))
    expect(peakOverFloor(await measure({ formant_depth: 0 }))).toBeLessThan(peakOverFloor(neutral) / 2)
    expect(level(neutral)).toBeGreaterThan(0)
  })
})

describeBuilt('plugins/quefrency/profile.ttl', () => {
  let profile
  // jig:paramIndex by port IRI. ProfileReader does not read it, because only
  // a host loading the module without its processor needs it.
  const indices = new Map()
  beforeAll(async () => {
    const dataset = await parseTurtle(resolve(dir, 'profile.ttl'), 'urn:quefrency')
    profile = readProfile(dataset)
    for (const quad of dataset.match(null, null, null)) {
      if (quad.predicate.value === vocabulary.jig.paramIndex) indices.set(quad.subject.value, Number(quad.object.value))
    }
  })

  it('carries the digests of the files on disk', async () => {
    expect(profile.module.integrity).toBe(await digestOf(new Uint8Array(await readFile(wasmPath))))
    const processor = new Uint8Array(await readFile(resolve(dir, 'quefrency-processor.js')))
    expect(profile.processor.integrity).toBe(await digestOf(processor))
  })

  it('declares the latency the module reports at 48 kHz', async () => {
    const e = await load(48000)
    expect(profile.latencyFrames).toBe(e.jig_latency_frames())
  })

  it('declares the parameter indices the module reads, in the order its processor writes them', async () => {
    // The processor hand-writes its parameterDescriptors, because a worklet
    // cannot fetch its own profile. Nothing connects the two but this.
    const captured = {}
    globalThis.AudioWorkletProcessor = class { constructor () { this.port = { onmessage: null, postMessage () {} } } }
    globalThis.registerProcessor = (name, cls) => { captured.name = name; captured.cls = cls }
    globalThis.sampleRate = 48000
    await import(`file://${resolve(dir, 'quefrency-processor.js')}`)

    expect(captured.name).toBe(profile.processor.registeredName)
    const declared = captured.cls.parameterDescriptors
    expect(declared.map(d => d.name).sort()).toEqual(profile.ports.map(p => p.symbol).sort())
    declared.forEach((descriptor, index) => {
      const port = profile.ports.find(p => p.symbol === descriptor.name)
      expect(indices.get(port.iri), `${descriptor.name} index`).toBe(index)
      expect(PARAM[descriptor.name], `${descriptor.name} index in this test`).toBe(index)
      expect(descriptor.defaultValue, `${descriptor.name} default`).toBe(port.defaultValue)
      expect(descriptor.minValue, `${descriptor.name} min`).toBe(port.minimum)
      expect(descriptor.maxValue, `${descriptor.name} max`).toBe(port.maximum)
    })
  })
})

describeBuilt('quefrency under MIDI control', () => {
  let ports
  beforeAll(async () => {
    const profile = readProfile(await parseTurtle(resolve(dir, 'profile.ttl'), 'urn:quefrency'))
    const indices = new Map()
    const dataset = await parseTurtle(resolve(dir, 'profile.ttl'), 'urn:quefrency')
    for (const quad of dataset.match(null, null, null)) {
      if (quad.predicate.value === vocabulary.jig.paramIndex) indices.set(quad.subject.value, Number(quad.object.value))
    }
    ports = profile.ports.map(port => ({ ...port, index: indices.get(port.iri) })).sort((a, b) => a.index - b.index)
  })

  it('starts every parameter at the default the profile declares', async () => {
    const e = await load()
    for (const port of ports) expect(e.quefrency_param(port.index), port.symbol).toBeCloseTo(port.defaultValue, 5)
  })

  // The module's range table is its own copy of the profile's ports. This is
  // what binds the two: CC 0 and 127 must land on the declared ends.
  it('maps CC 0 and 127 onto each port\'s declared minimum and maximum', async () => {
    for (const port of ports) {
      const e = await load()
      sendMidi(e, [{ bytes: [0xb0, FIRST_CC + port.index, 0] }]); tick(e)
      expect(e.quefrency_param(port.index), `${port.symbol} at 0`).toBeCloseTo(port.minimum, 4)
      sendMidi(e, [{ bytes: [0xb0, FIRST_CC + port.index, 127] }]); tick(e)
      expect(e.quefrency_param(port.index), `${port.symbol} at 127`).toBeCloseTo(port.maximum, 4)
    }
  })

  it('puts CC 64 on the default wherever the default is inside the range', async () => {
    for (const port of ports.filter(p => p.minimum < p.defaultValue && p.defaultValue < p.maximum)) {
      const e = await load(48000, { [port.symbol]: port.maximum })
      sendMidi(e, [{ bytes: [0xb0, FIRST_CC + port.index, 64] }]); tick(e)
      expect(e.quefrency_param(port.index), port.symbol).toBeCloseTo(port.defaultValue, 4)
    }
  })

  it('selects the true envelope from CC 64 upward', async () => {
    const e = await load()
    const estimator = ports.find(p => p.symbol === 'estimator')
    sendMidi(e, [{ bytes: [0xb0, FIRST_CC + estimator.index, 63] }]); tick(e)
    expect(e.quefrency_param(estimator.index)).toBeLessThan(0.5)
    sendMidi(e, [{ bytes: [0xb0, FIRST_CC + estimator.index, 64] }]); tick(e)
    expect(e.quefrency_param(estimator.index)).toBeGreaterThanOrEqual(0.5)
  })

  it('answers on every channel', async () => {
    const e = await load()
    sendMidi(e, [{ bytes: [0xbf, FIRST_CC + 3, 127] }]); tick(e)
    expect(e.quefrency_param(3)).toBe(24)
  })

  it('ignores other controllers, notes and malformed records', async () => {
    const e = await load()
    sendMidi(e, [
      { bytes: [0xb0, FIRST_CC - 1, 127] },
      { bytes: [0xb0, FIRST_CC + ports.length, 127] },
      { bytes: [0x90, FIRST_CC + 3, 127] },
      { bytes: [0xb0, FIRST_CC + 3] }
    ])
    tick(e)
    for (const port of ports) expect(e.quefrency_param(port.index), port.symbol).toBeCloseTo(port.defaultValue, 5)
  })

  it('changes the signal from the event\'s own frame, not the start of the block', async () => {
    const e = await load(48000, { mix: 0 })
    const frames = e.jig_max_frames()
    const input = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_input_ptr(c), frames))
    const output = new Float32Array(e.memory.buffer, e.jig_output_ptr(0), frames)
    const dc = 0.5
    // Mix 0 is the dry path alone; after the latency it is a steady 0.5.
    for (const view of input) view.fill(dc)
    for (let i = 0; i < 20; i++) e.jig_process(frames)
    sendMidi(e, [{ frame: 50, bytes: [0xb0, FIRST_CC + 10, 0] }])
    e.jig_process(frames)
    expect(output[49]).toBeCloseTo(dc, 5)
    expect(output[50]).toBeCloseTo(dc * 10 ** (-24 / 20), 5)
  })

  it('applies events to one block only, so a later host value is not overwritten', async () => {
    const e = await load()
    sendMidi(e, [{ bytes: [0xb0, FIRST_CC + 10, 0] }]); tick(e)
    expect(e.quefrency_param(10)).toBe(-24)
    e.jig_set_param(10, 0)
    tick(e)
    expect(e.quefrency_param(10)).toBe(0)
  })

  // The profile tells a person and a host which controller drives what. A
  // sentence nothing checks drifts, so each port declares its controller and
  // the declarations are checked against the module: the controller a port
  // names must be the one the module answers to for that port's own index.
  it('binds one controller per port, in order, and the module answers to those bindings', async () => {
    ports.forEach((port, i) => expect(port.controller, port.symbol).toBe(FIRST_CC + i))
    const e = await load()
    for (const port of ports) {
      sendMidi(e, [{ bytes: [0xb0, port.controller, 0] }]); tick(e)
      expect(e.quefrency_param(port.index), port.symbol).toBeCloseTo(port.minimum, 4)
    }
  })
})
