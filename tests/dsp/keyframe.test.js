// tests/dsp/keyframe.test.js
//
// The wasm driven directly, deterministically. docs/plugins/keyframe-design.md
// lists what each of these holds the plugin to. The figures in the comments are
// what the built plugin measured, and each threshold sits a little above them.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { digestOf } from '../../src/host/Integrity.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile as parseTurtle } from '../../src/validate/files.js'
import { vocabulary } from '../../src/rdf/Vocabulary.js'

const dir = resolve(import.meta.dirname, '../../plugins/keyframe')
const wasmPath = resolve(dir, 'keyframe.wasm')

const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/keyframe/keyframe.wasm not built; run plugins/keyframe/build.sh')

const PARAM = {
  time_rate: 0, pitch_shift: 1, splice_keyframes: 2, max_splice: 3, threshold: 4,
  mix: 5, output: 6, quality: 7, stereo: 8
}
const QUALITIES = [['Economy', 0], ['Balanced', 1], ['Full', 2]]
const STEREOS = [['Linked', 0], ['Independent', 1]]
const RATE = 48000
const LATENCY = 512

let bytes
async function load (params = {}, rate = RATE) {
  bytes ??= await readFile(wasmPath)
  const { instance } = await WebAssembly.instantiate(bytes, {})
  const e = instance.exports
  e.jig_init(rate)
  for (const [name, value] of Object.entries(params)) e.jig_set_param(PARAM[name], value)
  return e
}

/** Run two channels through the module; returns both outputs. */
function run (e, left, right = left) {
  const frames = e.jig_max_frames()
  const pages = e.memory.buffer.byteLength
  const input = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_input_ptr(c), frames))
  const output = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))
  const result = [new Float32Array(left.length), new Float32Array(left.length)]
  for (let at = 0; at < left.length; at += frames) {
    const n = Math.min(frames, left.length - at)
    input[0].set(left.subarray(at, at + n))
    input[1].set(right.subarray(at, at + n))
    e.jig_process(n)
    result[0].set(output[0].subarray(0, n), at)
    result[1].set(output[1].subarray(0, n), at)
  }
  // Growing memory would have detached every view taken above.
  expect(e.memory.buffer.byteLength).toBe(pages)
  return result
}

const sine = (hz, seconds, amplitude = 0.5) =>
  Float32Array.from({ length: Math.round(seconds * RATE) }, (_, i) => amplitude * Math.sin(2 * Math.PI * hz * i / RATE))

function noise (length, seed = 12345, amplitude = 1) {
  let state = seed
  return Float32Array.from({ length }, () => {
    state = (state * 1103515245 + 12345) & 0x7fffffff
    return amplitude * ((state / 0x3fffffff) - 1)
  })
}

/** Rising zero crossings per second, in [from, to). Enough to tell 1 kHz from 500 or 2000. */
function frequency (x, from, to) {
  let crossings = 0
  for (let i = from + 1; i < to; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++
  return crossings / ((to - from) / RATE)
}

/** Error of the output against the input delayed by the latency, in dB below the signal. */
function neutralErrorDb (x, y, from = 4000) {
  let error = 0
  let signal = 0
  for (let i = from; i < x.length; i++) {
    const d = y[i] - x[i - LATENCY]
    error += d * d
    signal += x[i] * x[i]
  }
  return 10 * Math.log10(error / signal)
}

describeBuilt('keyframe module', () => {
  it('exports the ABI its processor expects and imports nothing', async () => {
    bytes ??= await readFile(wasmPath)
    const module = new WebAssembly.Module(bytes)
    expect(WebAssembly.Module.imports(module)).toEqual([])
    const names = WebAssembly.Module.exports(module).map(x => x.name)
    for (const name of ['jig_init', 'jig_process', 'jig_input_ptr', 'jig_output_ptr', 'jig_set_param',
      'jig_max_frames', 'jig_latency_frames', 'memory']) expect(names, name).toContain(name)
  })

  it('reports a fixed latency of 512 frames at every sample rate', async () => {
    for (const rate of [44100, 48000, 96000]) expect((await load({}, rate)).jig_latency_frames()).toBe(LATENCY)
  })

  it('delays an impulse by exactly the latency, as a tent between its neighbouring keyframes', async () => {
    // Economy joins the extrema with straight lines: the forced keyframes at 255 and 511 and the
    // impulse's own at 300. So the peak is exact, and nothing is heard outside that span.
    const e = await load()
    const impulse = new Float32Array(4096)
    impulse[300] = 1
    const [y] = run(e, impulse)
    expect(y[300 + LATENCY]).toBeCloseTo(1, 5)
    let outside = 0
    for (let i = 0; i < y.length; i++) if (i < 255 + LATENCY || i > 511 + LATENCY) outside = Math.max(outside, Math.abs(y[i]))
    expect(outside).toBe(0)
  })

  it('aligns the dry path with the wet one at neutral settings, so a half mix does not comb', async () => {
    const x = sine(1000, 1)
    const wet = run(await load({ quality: 2 }), x)[0]
    const half = run(await load({ quality: 2, mix: 0.5 }), x)[0]
    const dry = run(await load({ mix: 0 }), x)[0]
    for (let i = 4000; i < x.length; i += 97) {
      expect(dry[i]).toBeCloseTo(x[i - LATENCY], 5)
      expect(half[i]).toBeCloseTo(0.5 * wet[i] + 0.5 * dry[i], 4)
    }
  })

  it('applies output gain to the whole signal', async () => {
    const x = sine(1000, 0.5)
    const flat = run(await load({ quality: 1 }), x)[0]
    const loud = run(await load({ quality: 1, output: 6.0206 }), x)[0]
    for (let i = 4000; i < x.length; i += 53) expect(loud[i]).toBeCloseTo(2 * flat[i], 4)
  })
})

describeBuilt('neutral settings', () => {
  // Measured: Economy -13.4 dB, Balanced -24.0 dB, Full -23.9 dB on a 1 kHz sine.
  // Without the forced keyframes Balanced and Full reach -34 dB: the rest is the flat
  // spot each forced keyframe puts into the curve, which the design names.
  const limits = { 0: -12, 1: -22, 2: -22 }
  for (const [name, quality] of QUALITIES) {
    for (const [stereoName, stereo] of STEREOS) {
      it(`reproduces a sine, delayed, within its stated error at ${name} and ${stereoName}`, async () => {
        const x = sine(1000, 2)
        const [y] = run(await load({ quality, stereo }), x)
        expect(neutralErrorDb(x, y)).toBeLessThan(limits[quality])
      })
    }
  }

  it('does not get worse by more than the reconstruction costs on a chord', async () => {
    const x = Float32Array.from({ length: RATE * 2 }, (_, i) =>
      0.2 * (Math.sin(2 * Math.PI * 220 * i / RATE) + Math.sin(2 * Math.PI * 277 * i / RATE) + Math.sin(2 * Math.PI * 330 * i / RATE)))
    const [y] = run(await load({ quality: 1 }), x)
    expect(neutralErrorDb(x, y)).toBeLessThan(-15)
  })
})

describeBuilt('time and pitch', () => {
  for (const [name, quality] of QUALITIES) {
    it(`keeps the pitch when only the time rate changes, at ${name}`, async () => {
      const x = sine(1000, 3)
      for (const timeRate of [50, 200]) {
        const [y] = run(await load({ quality, time_rate: timeRate }), x)
        // Measured within 2 percent at every setting; the bound allows for the splices.
        expect(Math.abs(frequency(y, 24000, 120000) / 1000 - 1), `time rate ${timeRate}`).toBeLessThan(0.05)
      }
    })

    it(`moves the pitch by the shift and keeps the time, at ${name}`, async () => {
      const x = sine(1000, 3)
      for (const [semitones, expected] of [[12, 2000], [-12, 500], [7, 1498.3]]) {
        const [y] = run(await load({ quality, pitch_shift: semitones }), x)
        // Measured within 4 percent at Economy and 2 at the others.
        expect(Math.abs(frequency(y, 24000, 120000) / expected - 1), `${semitones} semitones`).toBeLessThan(0.05)
      }
    })
  }

  it('stretches a burst to the length the time rate says', async () => {
    // Half a second of tone and then silence. Half speed should make it about a second.
    const x = new Float32Array(RATE * 5)
    x.set(sine(1000, 0.5))
    const span = y => {
      let first = -1
      let last = -1
      const window = 480
      for (let i = 0; i + window < y.length; i += window) {
        let energy = 0
        for (let j = 0; j < window; j++) energy += y[i + j] * y[i + j]
        if (Math.sqrt(energy / window) > 0.05) { if (first < 0) first = i; last = i + window }
      }
      return (last - first) / RATE
    }
    const slow = span(run(await load({ quality: 1, time_rate: 50 }), x)[0])
    const fast = span(run(await load({ quality: 1, time_rate: 200 }), x)[0])
    expect(slow).toBeGreaterThan(0.85)
    expect(slow).toBeLessThan(1.2)
    // A live input cannot be played faster than it arrives, so doubling the rate leaves the burst at
    // its own length. The design says so, and this is where it is held to it.
    expect(fast).toBeGreaterThan(0.4)
    expect(fast).toBeLessThan(0.7)
  })

  it('starts no splice at neutral settings, and some once the rates differ', async () => {
    const x = noise(RATE * 2, 7, 0.5)
    const neutral = await load({ quality: 1 })
    run(neutral, x)
    expect(neutral.keyframe_splices(0)).toBe(0)
    const shifted = await load({ quality: 1, pitch_shift: 5 })
    run(shifted, x)
    expect(shifted.keyframe_splices(0)).toBeGreaterThan(0)
  })

  it('splices less often with a longer leash', async () => {
    const x = noise(RATE * 3, 9, 0.5)
    const counts = []
    for (const leash of [8, 64]) {
      const e = await load({ quality: 1, pitch_shift: 5, splice_keyframes: leash })
      run(e, x)
      counts.push(e.keyframe_splices(0))
    }
    expect(counts[1]).toBeLessThan(counts[0])
  })
})

describeBuilt('analysis', () => {
  for (const [name, quality] of QUALITIES) {
    it(`keeps no keyframe beyond the forced ones for silence, at ${name}`, async () => {
      const e = await load({ quality })
      const [y] = run(e, new Float32Array(RATE))
      expect(y.every(v => v === 0)).toBe(true)
      // The anchor, then one forced keyframe every 256 samples.
      expect(e.keyframe_count(0)).toBeLessThanOrEqual(2 + Math.floor(RATE / 256))
    })

    it(`ignores a noise floor below the threshold, at ${name}`, async () => {
      // -80 dB noise against a -60 dB deadband: no natural extremum is kept.
      const quiet = await load({ quality, threshold: -60 })
      run(quiet, noise(RATE, 3, 1e-4))
      expect(quiet.keyframe_count(0)).toBeLessThanOrEqual(2 + Math.floor(RATE / 256))
      // The same noise with the deadband at its floor is dense.
      const open = await load({ quality, threshold: -90 })
      run(open, noise(RATE, 3, 1e-4))
      expect(open.keyframe_count(0)).toBeGreaterThan(5000)
    })
  }

  it('keeps more keyframes for a high note than a low one, which is the density the splice follows', async () => {
    const low = await load({ quality: 1 })
    run(low, sine(100, 1))
    const high = await load({ quality: 1 })
    run(high, sine(4000, 1))
    expect(high.keyframe_count(0)).toBeGreaterThan(20 * low.keyframe_count(0) / 2)
  })
})

describeBuilt('bounds', () => {
  const square = Float32Array.from({ length: RATE }, (_, i) => (Math.floor(i / 37) % 2 ? 1 : -1))
  const loud = noise(RATE, 5, 1)
  const extremes = [
    { time_rate: 25, pitch_shift: -24 }, { time_rate: 400, pitch_shift: 24 },
    { time_rate: 25, pitch_shift: 24 }, { time_rate: 400, pitch_shift: -24 },
    { splice_keyframes: 4, max_splice: 5 }, { splice_keyframes: 256, max_splice: 500 },
    { threshold: -90 }, { threshold: -30 }, { output: 12 }, { mix: 0.5 }
  ]
  for (const [name, quality] of QUALITIES) {
    for (const [stereoName, stereo] of STEREOS) {
      it(`gives finite, bounded output at every extreme, at ${name} and ${stereoName}`, async () => {
        for (const setting of extremes) {
          for (const input of [square, loud]) {
            const [l, r] = run(await load({ quality, stereo, ...setting }), input, input.map(v => -v))
            for (const y of [l, r]) {
              let peak = 0
              let finite = true
              for (const v of y) { if (!Number.isFinite(v)) finite = false; peak = Math.max(peak, Math.abs(v)) }
              expect(finite, JSON.stringify(setting)).toBe(true)
              // Input is at full scale and output gain at most +12 dB.
              expect(peak, JSON.stringify(setting)).toBeLessThan(4 * 1.5)
            }
          }
        }
      })
    }
  }

  it('keeps running when the keyframe ring wraps, and moves the reference when it must', async () => {
    // Dense material fills the 131072 keyframes in about three seconds, so twenty seconds wraps it
    // several times. A time rate below 100 percent falls behind and has to be brought forward.
    const e = await load({ quality: 1, time_rate: 80, pitch_shift: 3 })
    const [y] = run(e, noise(RATE * 20, 11, 0.5))
    expect(e.keyframe_count(0)).toBe(131072)
    expect(y.every(Number.isFinite)).toBe(true)
    let late = 0
    for (let i = RATE * 19; i < y.length; i++) late = Math.max(late, Math.abs(y[i]))
    expect(late).toBeGreaterThan(0.05)
  })

  it('does not run out of signal at four times speed on a live input, and plays at the input rate', async () => {
    const e = await load({ quality: 1, time_rate: 400 })
    const [y] = run(e, sine(300, 10))
    let peak = 0
    for (let i = RATE * 9; i < y.length; i++) peak = Math.max(peak, Math.abs(y[i]))
    expect(peak).toBeGreaterThan(0.4)
    expect(Math.abs(frequency(y, RATE * 5, RATE * 10) / 300 - 1)).toBeLessThan(0.03)
    // With the play rate at 1 the reference is brought back onto it, so there is nothing to splice.
    expect(e.keyframe_splices(0)).toBe(0)
  })

  it('splices repeatedly at four times speed when the pitch is also moved', async () => {
    const e = await load({ quality: 1, time_rate: 400, pitch_shift: 5 })
    const [y] = run(e, sine(300, 10))
    expect(y.every(Number.isFinite)).toBe(true)
    expect(e.keyframe_splices(0)).toBeGreaterThan(10)
  })

  it('ignores a non-finite input and a non-finite parameter', async () => {
    const e = await load()
    e.jig_set_param(PARAM.time_rate, NaN)
    e.jig_set_param(PARAM.pitch_shift, Infinity)
    expect(e.keyframe_param(PARAM.time_rate)).toBe(100)
    expect(e.keyframe_param(PARAM.pitch_shift)).toBe(0)
    const x = sine(1000, 0.2)
    x[500] = NaN
    x[900] = Infinity
    const [y] = run(e, x)
    expect(y.every(Number.isFinite)).toBe(true)
  })

  it('processes a block shorter than the quantum, and an index outside the table', async () => {
    const e = await load()
    e.jig_set_param(99, 1)
    const [y] = run(e, sine(1000, 0.01))
    expect(y.every(Number.isFinite)).toBe(true)
  })
})

describeBuilt('stereo', () => {
  for (const [name, stereo] of STEREOS) {
    it(`keeps one channel silent when only the other is driven, at ${name}`, async () => {
      const e = await load({ quality: 1, stereo, pitch_shift: 4 })
      const [l, r] = run(e, sine(700, 1), new Float32Array(RATE))
      expect(l.some(v => Math.abs(v) > 0.05)).toBe(true)
      expect(r.every(v => v === 0)).toBe(true)
    })
  }

  it('gives identical channels for identical input when linked', async () => {
    const [l, r] = run(await load({ quality: 2, pitch_shift: 4, time_rate: 70 }), noise(RATE, 4, 0.4))
    let differ = 0
    for (let i = 0; i < l.length; i++) if (l[i] !== r[i]) differ++
    expect(differ).toBe(0)
  })

  it('keeps the level balance of a panned source when linked', async () => {
    // Left twice as loud as right. Linked reads both channels at the same keyframe times, so
    // the ratio holds through a pitch shift.
    const left = sine(500, 2, 0.5)
    const right = sine(500, 2, 0.25)
    const [l, r] = run(await load({ quality: 2, pitch_shift: 3 }), left, right)
    const rms = (x) => { let s = 0; for (let i = 48000; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length - 48000)) }
    expect(Math.abs(20 * Math.log10(rms(l) / rms(r)) - 6.02)).toBeLessThan(1)
  })
})

describeBuilt('switching a setting', () => {
  for (const [name, setting, from, to] of [['quality', 'quality', 0, 2], ['stereo', 'stereo', 0, 1]]) {
    it(`empties the capture when ${name} changes, and recovers`, async () => {
      const e = await load({ quality: 0 })
      const x = sine(800, 2)
      run(e, x.subarray(0, RATE))
      const before = e.keyframe_count(0)
      expect(before).toBeGreaterThan(100)
      e.jig_set_param(PARAM[setting], to)
      expect(e.keyframe_count(0)).toBeLessThan(5)
      const [y] = run(e, x.subarray(RATE))
      expect(y.every(Number.isFinite)).toBe(true)
      let tail = 0
      for (let i = RATE / 2; i < y.length; i++) tail = Math.max(tail, Math.abs(y[i]))
      expect(tail).toBeGreaterThan(0.2)
      void from
    })
  }

  it('does not empty the capture when the value written is the one already held', async () => {
    const e = await load({ quality: 1 })
    run(e, sine(800, 1))
    const before = e.keyframe_count(0)
    e.jig_set_param(PARAM.quality, 1)
    e.jig_set_param(PARAM.stereo, 0)
    expect(e.keyframe_count(0)).toBe(before)
  })
})

describeBuilt('the profile and the processor', () => {
  let profile
  const indices = new Map()
  beforeAll(async () => {
    const dataset = await parseTurtle(resolve(dir, 'profile.ttl'), 'urn:keyframe')
    profile = readProfile(dataset)
    for (const quad of dataset.match(null, null, null)) {
      if (quad.predicate.value === vocabulary.jig.paramIndex) indices.set(quad.subject.value, Number(quad.object.value))
    }
  })

  it('carries the digests of the files on disk', async () => {
    expect(profile.module.integrity).toBe(await digestOf(new Uint8Array(await readFile(wasmPath))))
    const processor = new Uint8Array(await readFile(resolve(dir, 'keyframe-processor.js')))
    expect(profile.processor.integrity).toBe(await digestOf(processor))
  })

  it('declares the latency the module reports', async () => {
    expect(profile.latencyFrames).toBe((await load()).jig_latency_frames())
  })

  it('declares the parameter indices the module reads, in the order its processor writes them', async () => {
    // The processor hand-writes its parameterDescriptors, because a worklet
    // cannot fetch its own profile. Nothing connects the two but this.
    const captured = {}
    globalThis.AudioWorkletProcessor = class { constructor () { this.port = { onmessage: null, postMessage () {} } } }
    globalThis.registerProcessor = (name, cls) => { captured.name = name; captured.cls = cls }
    globalThis.sampleRate = RATE
    await import(`file://${resolve(dir, 'keyframe-processor.js')}`)

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

  it('starts every parameter at the default the profile declares', async () => {
    const e = await load()
    for (const port of profile.ports) expect(e.keyframe_param(indices.get(port.iri)), port.symbol).toBeCloseTo(port.defaultValue, 5)
  })

  it('clamps each parameter to the range the profile declares', async () => {
    // The module's range table is its own copy of the profile's ports.
    const e = await load()
    for (const port of profile.ports) {
      const index = indices.get(port.iri)
      e.jig_set_param(index, -1e9)
      expect(e.keyframe_param(index), `${port.symbol} minimum`).toBeCloseTo(port.minimum, 5)
      e.jig_set_param(index, 1e9)
      expect(e.keyframe_param(index), `${port.symbol} maximum`).toBeCloseTo(port.maximum, 5)
    }
  })

  it('defaults to the cheapest setting of each switch, and says what each setting is', () => {
    const quality = profile.ports.find(p => p.symbol === 'quality')
    const stereo = profile.ports.find(p => p.symbol === 'stereo')
    expect(quality.defaultValue).toBe(0)
    expect(stereo.defaultValue).toBe(0)
    expect(quality.scalePoints.map(s => [s.label, s.value])).toEqual(QUALITIES)
    expect(stereo.scalePoints.map(s => [s.label, s.value])).toEqual(STEREOS)
  })
})
