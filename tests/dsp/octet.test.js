// tests/dsp/octet.test.js
//
// Octet is a port of a native plugin with an editor of its own, and most of the ways it can break are files
// disagreeing rather than one being wrong. The parameters are declared in profile.json, registered again in
// octet-processor.js, addressed a third time by index and range in octet.cpp, and written a fourth time into the editor's
// own defaults; the first half of this file binds the lists together. The second half drives the compiled module directly
// and offline: the maths it had to write for itself, the original's renders (a fixture made by compiling the Downspout core
// natively), the response the editor plots against the audio the module actually makes, the Drift controllers and the
// spectrum analyser.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../plugins/octet')
const read = name => readFileSync(resolve(dir, name), 'utf8')
const profile = JSON.parse(read('profile.json'))
const processorSource = read('octet-processor.js')
const editor = read('ui/index.html')

describe('the processor registers the parameters the profile declares', () => {
  const descriptors = [...processorSource.matchAll(
    /\{ name: '([a-z0-9_]+)', defaultValue: (-?[\d.]+), minValue: (-?[\d.]+), maxValue: (-?[\d.]+), automationRate: '([a-z-]+)' \}/g
  )].map(m => ({ name: m[1], defaultValue: Number(m[2]), minValue: Number(m[3]), maxValue: Number(m[4]) }))

  it('found the descriptor list, so the rest of this is not vacuous', () => {
    expect(descriptors.length).toBe(53)
    expect(profile.ports.length).toBe(53)
  })

  it('registers one per port, with the name, range and default the port declares', () => {
    expect(descriptors.map(d => [d.name, d.minValue, d.maxValue, d.defaultValue]))
      .toEqual(profile.ports.map(p => [p.symbol, p.minimum, p.maximum, p.default]))
  })

  it('maps each symbol to the index the module addresses it by', () => {
    const map = [...processorSource.matchAll(/^ {2}([a-z0-9_]+): (\d+),?$/gm)].map(m => [m[1], Number(m[2])])
    expect(map).toEqual(profile.ports.map(p => [p.symbol, p.paramIndex]))
  })

  it('registers under the name the profile says it does', () => {
    expect(processorSource).toContain(`registerProcessor('${profile.registeredName}'`)
  })

  it('declares the version 2 ABI, takes audio and MIDI controllers, and has an editor and nothing to save', () => {
    expect(profile.abi).toBe('jig:Abi2')
    expect(profile.requires).toEqual(['jig:MidiEvents'])
    // Controllers alone, as Quefrency's: nothing here plays a note, so nothing offers it a keyboard or a clip to play into.
    expect(profile.accepts).toEqual(['trn:Audio', 'trn:MidiCC'])
    expect(profile.resources.ui).toBe('ui/index.html')
    expect(profile.shape.stateless).toBe(true)
    expect(profile.assets).toBeUndefined()
  })

  it('keeps the original\'s indices: mode 0, output 1, six per band, then the three appended controls', () => {
    const index = symbol => profile.ports.find(p => p.symbol === symbol).paramIndex
    expect([index('mode'), index('output')]).toEqual([0, 1])
    for (let b = 1; b <= 8; b++) {
      const base = 2 + (b - 1) * 6
      expect(['on', 'type', 'freq', 'gain', 'q', 'channel'].map(n => index(`band${b}_${n}`))).toEqual([0, 1, 2, 3, 4, 5].map(i => base + i))
    }
    expect([index('cc_channel'), index('cc_band'), index('spectrum_source')]).toEqual([50, 51, 52])
  })
})

describe('the editor agrees with the profile', () => {
  const port = symbol => profile.ports.find(p => p.symbol === symbol)
  const literal = name => Function(`'use strict'; return ${editor.match(new RegExp(`const ${name} = (\\[[^\\]]*\\])`))[1]}`)()

  it('names the band types as the profile does, in the same order', () => {
    expect(literal('TYPE_NAMES')).toEqual(port('band1_type').scalePoints.map(s => s.label))
  })

  it('starts each band as the profile does: type, frequency and whether it is on', () => {
    const types = literal('DEFAULT_TYPE'), freqs = literal('DEFAULT_FREQ'), on = literal('DEFAULT_ON')
    for (let b = 1; b <= 8; b++) {
      expect([types[b - 1], freqs[b - 1], on[b - 1]]).toEqual([port(`band${b}_type`).default, port(`band${b}_freq`).default, port(`band${b}_on`).default])
    }
  })

  it('uses the profile\'s ranges for frequency, gain and Q, and the plot\'s own range is wider than gain', () => {
    expect(editor).toContain(`const FMIN = ${port('band1_freq').minimum}, FMAX = ${port('band1_freq').maximum}`)
    expect(editor).toContain(`const GAIN_MAX = ${port('band1_gain').maximum}`)
    expect(port('band1_gain').minimum).toBe(-port('band1_gain').maximum)
    expect(editor).toContain(`const QMIN = ${port('band1_q').minimum}, QMAX = ${port('band1_q').maximum}`)
  })

  it('asks the host only for symbols the profile declares', () => {
    const declared = new Set(profile.ports.map(p => p.symbol))
    const symbols = new Set()
    for (const m of editor.matchAll(/'((?:mode|output|cc_channel|cc_band|spectrum_source))'/g)) symbols.add(m[1])
    for (const m of editor.matchAll(/`(band\$\{[^}]+\}_[a-z]+)`/g)) symbols.add(m[1].replace(/\$\{[^}]+\}/, '1'))
    expect(symbols.size).toBeGreaterThan(8)
    for (const symbol of symbols) expect(declared.has(symbol), symbol).toBe(true)
  })

  it('offers the generated panel the same four choices with the same names', () => {
    expect(port('mode').scalePoints.map(s => s.label)).toEqual(['Stereo', 'Left/Right', 'Mid/Side'])
    expect(port('spectrum_source').scalePoints.map(s => s.label)).toEqual(['Off', 'Pre', 'Post'])
    expect(port('band1_channel').scalePoints).toHaveLength(3)
  })
})

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------
const wasmPath = resolve(dir, 'octet.wasm')
const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/octet/octet.wasm not built; run plugins/octet/build.sh')

const RATE = 48000
const EVENT_BYTES = 8
const P = Object.fromEntries(profile.ports.map(p => [p.symbol, p.paramIndex]))
const bandSymbol = (b, n) => `band${b}_${n}`

/** A module, initialised, with the views the ABI says to take once. */
async function load (rate = RATE) {
  const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {})
  const e = instance.exports
  e.jig_init(rate)
  const frames = e.jig_max_frames()
  const midi = new DataView(e.memory.buffer, e.jig_midi_in_ptr(), e.jig_midi_in_capacity() * EVENT_BYTES)
  const input = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_input_ptr(c), frames))
  const output = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))
  const spectrum = new Float32Array(e.memory.buffer, e.jig_spectrum_ptr(), 64)
  const set = (symbol, value) => e.jig_set_param(P[symbol], value)
  const setBand = (b, values) => { for (const [name, value] of Object.entries(values)) set(bandSymbol(b, name), value) }

  const cc = (channel, controller, value) => {
    midi.setUint32(0, 0, true)
    midi.setUint8(4, 3)
    midi.setUint8(5, 0xb0 | (channel - 1))
    midi.setUint8(6, controller)
    midi.setUint8(7, value)
    e.jig_midi_in(1)
  }

  /** Run `blocks` blocks of the same left and right functions of the running sample index, returning both outputs. */
  const run = (blocks, left, right = left) => {
    const out = [new Float32Array(blocks * frames), new Float32Array(blocks * frames)]
    for (let b = 0; b < blocks; b++) {
      for (let i = 0; i < frames; i++) { input[0][i] = left(b * frames + i); input[1][i] = right(b * frames + i) }
      e.jig_process(frames)
      out[0].set(output[0], b * frames)
      out[1].set(output[1], b * frames)
    }
    return out
  }

  return { e, frames, set, setBand, cc, run, input, output, spectrum }
}

const rms = view => Math.sqrt(view.reduce((s, v) => s + v * v, 0) / view.length)
const dB = x => 20 * Math.log10(x)
const sine = (hz, amplitude = 0.5, rate = RATE) => n => amplitude * Math.sin(2 * Math.PI * hz * n / rate)

// The editor's response maths, taken out of the page so it is the code that runs there that is tested.
const response = (() => {
  const body = editor.match(/\/\/ BEGIN response\n([\s\S]*?)\/\/ END response/)[1]
  return new Function(`${body}; return { bandResponseDb, totalResponseDb, sectionsFor, isActive, usesGain, usesQ }`)()
})()

describeBuilt('the module agrees with the profile about every range', () => {
  it('has the minimum, maximum and default of every port, in index order', async () => {
    const { e } = await load()
    const ports = [...profile.ports].sort((a, b) => a.paramIndex - b.paramIndex)
    const f = Math.fround
    expect(ports.map(p => e.jig_param_min(p.paramIndex))).toEqual(ports.map(p => f(p.minimum)))
    expect(ports.map(p => e.jig_param_max(p.paramIndex))).toEqual(ports.map(p => f(p.maximum)))
    expect(ports.map(p => e.jig_param_default(p.paramIndex))).toEqual(ports.map(p => f(p.default)))
    expect(ports.map(p => e.jig_param(p.paramIndex))).toEqual(ports.map(p => f(p.default)))
  })

  it('clamps a value out of range and rounds a choice to a whole number', async () => {
    const { e, set } = await load()
    set('output', 99)
    expect(e.jig_param(P.output)).toBe(12)
    set(bandSymbol(3, 'freq'), 5)
    expect(e.jig_param(P[bandSymbol(3, 'freq')])).toBe(20)
    set('mode', 1.6)
    expect(e.jig_param(P.mode)).toBe(2)
    set('cc_band', NaN)
    expect(e.jig_param(P.cc_band)).toBe(1)
  })

  it('ignores an index it has no parameter for', async () => {
    const { e } = await load()
    expect(() => e.jig_set_param(53, 1)).not.toThrow()
    expect(e.jig_param(53)).toBe(0)
  })
})

describeBuilt('the freestanding maths agrees with Math.*', () => {
  it('sin, cos, log2, exp2 and 10^x are within 1e-12 over the range the equalizer uses', async () => {
    const { e } = await load()
    let worst = 0
    for (let x = -12; x <= 12; x += 0.037) worst = Math.max(worst, Math.abs(e.jig_math(0, x, 0) - Math.sin(x)), Math.abs(e.jig_math(1, x, 0) - Math.cos(x)))
    for (let x = 1e-4; x < 1e5; x *= 1.37) worst = Math.max(worst, Math.abs(e.jig_math(2, x, 0) - Math.log2(x)) / Math.max(1, Math.abs(Math.log2(x))))
    for (let x = -12; x <= 12; x += 0.071) worst = Math.max(worst, Math.abs(e.jig_math(3, x, 0) - 2 ** x) / 2 ** x)
    for (let x = -2; x <= 2; x += 0.011) worst = Math.max(worst, Math.abs(e.jig_math(4, x, 0) - 10 ** x) / 10 ** x)
    expect(worst).toBeLessThan(1e-12)
  })
})

// The original's renders, so a port that is merely plausible fails. The fixture is made by compiling the Downspout core
// natively and running the same scripts at 48 kHz; the largest difference when it was made was 1.2e-7 of full scale in the
// audio and 4e-6 dB in the spectrum.
describeBuilt('the module renders what the original renders', () => {
  const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/octet-reference.json'), 'utf8'))
  const names = [
    'the transparent defaults',
    'a typical curve in stereo, with 48 dB cuts, shelves, a bell and a notch',
    'Mid/Side with a band on each channel, all eight shapes and the spectrum before the EQ',
    'Left/Right with automation, a type change, a band switched off and the output moved',
    'Drift controllers on channel 3 driving band 2, then released by the panel'
  ]

  fixture.scenarios.forEach((script, index) => {
    it(`matches for ${names[index]}`, async () => {
      const { e, set, input, output, spectrum, frames } = await load()
      const midi = new DataView(e.memory.buffer, e.jig_midi_in_ptr(), 256 * EVENT_BYTES)
      let s = 12345
      let n = 0
      const next = () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296 }
      const left = [], right = []
      const snaps = []
      for (let block = 0; block < 256; block++) {
        let events = 0
        for (const [kind, at, ...args] of script) {
          if (at !== block) continue
          if (kind === 'p') e.jig_set_param(args[0], args[1])
          else {
            midi.setUint32(events * EVENT_BYTES, 0, true)
            midi.setUint8(events * EVENT_BYTES + 4, 3)
            midi.setUint8(events * EVENT_BYTES + 5, 0xb0 | ((args[0] - 1) & 15))
            midi.setUint8(events * EVENT_BYTES + 6, args[1])
            midi.setUint8(events * EVENT_BYTES + 7, args[2])
            events += 1
          }
        }
        for (let i = 0; i < frames; i++, n++) {
          input[0][i] = (next() * 2 - 1) * 0.3 + ((n * 29) % 500) / 500 * 0.4 - 0.2
          input[1][i] = (next() * 2 - 1) * 0.3 + ((n * 41) % 700) / 700 * 0.4 - 0.2
        }
        e.jig_midi_in(events)
        e.jig_process(frames)
        for (let i = 0; i < frames; i++) {
          if ((block * frames + i) % fixture.every === 0) { left.push(output[0][i]); right.push(output[1][i]) }
        }
        if (fixture.snaps.includes(block)) snaps.push([...spectrum])
      }
      const worst = (a, b) => a.reduce((m, v, i) => Math.max(m, Math.abs(v - b[i])), 0)
      expect(worst(left, fixture.renders[index].L)).toBeLessThan(1e-5)
      expect(worst(right, fixture.renders[index].R)).toBeLessThan(1e-5)
      snaps.forEach((levels, i) => expect(worst(levels, fixture.spectra[index][i])).toBeLessThan(0.01))
      expect(Math.max(...fixture.renders[index].L.map(Math.abs))).toBeGreaterThan(0.1)
      void set
    })
  })
})

describeBuilt('the response the editor plots is the response the audio has', () => {
  // A sine at each test frequency through the band, measured once the band has settled, against the plot's own number.
  async function measured (setup, hz, rate = RATE) {
    const { run, setBand, set } = await load(rate)
    setup({ set, setBand })
    const blocks = Math.ceil(rate * 0.6 / 128)
    const [out] = run(blocks, sine(hz, 0.25, rate))
    const tail = out.subarray(out.length - Math.floor(rate * 0.1))
    return dB(rms(tail) / (0.25 / Math.SQRT2))
  }

  const cases = [
    ['a bell boost', { on: 1, type: 3, freq: 1000, gain: 9, q: 1.5 }, [200, 700, 1000, 1400, 5000]],
    ['a bell cut', { on: 1, type: 3, freq: 2500, gain: -12, q: 0.8 }, [300, 1800, 2500, 3500, 9000]],
    ['a low shelf', { on: 1, type: 2, freq: 400, gain: 8, q: 0.71 }, [50, 200, 400, 800, 4000]],
    ['a high shelf', { on: 1, type: 5, freq: 4000, gain: -7, q: 0.71 }, [500, 2000, 4000, 8000, 16000]],
    ['a notch', { on: 1, type: 4, freq: 1500, q: 4 }, [400, 1200, 1430, 1600, 6000]],
    ['a 12 dB high-pass', { on: 1, type: 0, freq: 500 }, [100, 250, 500, 1000, 5000]],
    ['a 12 dB low-pass', { on: 1, type: 6, freq: 3000 }, [300, 1500, 3000, 6000, 12000]],
    ['a 48 dB high-pass', { on: 1, type: 1, freq: 800 }, [200, 500, 800, 1100, 4000]],
    ['a 48 dB low-pass', { on: 1, type: 7, freq: 6000 }, [1000, 4000, 6000, 8000, 15000]]
  ]

  for (const rate of [48000, 96000]) {
    for (const [name, band, frequencies] of cases) {
      it(`holds ${name} to the plot within 0.15 dB at ${rate / 1000} kHz`, async () => {
        const plotted = f => response.bandResponseDb({ ...band, gain: band.gain ?? 0, q: band.q ?? 1 }, f, rate)
        for (const hz of frequencies) {
          const got = await measured(({ setBand }) => setBand(3, band), hz, rate)
          expect(Math.abs(got - plotted(hz)), `${hz} Hz: audio ${got.toFixed(3)} dB, plot ${plotted(hz).toFixed(3)} dB`).toBeLessThan(0.15)
        }
      })
    }
  }

  it('removes the centre of a notch by more than 40 dB, in the audio and in the plot', async () => {
    const notch = { on: 1, type: 4, freq: 1500, q: 4 }
    expect(response.bandResponseDb({ ...notch, gain: 0 }, 1500, RATE)).toBeLessThan(-40)
    expect(await measured(({ setBand }) => setBand(3, notch), 1500)).toBeLessThan(-40)
  })

  it('draws a 48 dB cut 3 dB down at the corner and 48 dB per octave beyond it', () => {
    const cut = { on: 1, type: 1, freq: 1000, gain: 0, q: 1 }
    expect(response.bandResponseDb(cut, 1000, RATE)).toBeCloseTo(-3.01, 1)
    const slope = response.bandResponseDb(cut, 250, RATE) - response.bandResponseDb(cut, 500, RATE)
    expect(slope).toBeGreaterThan(-50)
    expect(slope).toBeLessThan(-46)
    const twelve = { ...cut, type: 0 }
    expect(response.bandResponseDb(twelve, 1000, RATE)).toBeCloseTo(-3.01, 1)
  })

  it('draws a band that does nothing as flat: off, or a bell or shelf at 0 dB', () => {
    expect(response.bandResponseDb({ on: 0, type: 3, freq: 1000, gain: 12, q: 1 }, 1000, RATE)).toBe(0)
    expect(response.bandResponseDb({ on: 1, type: 3, freq: 1000, gain: 0, q: 1 }, 1000, RATE)).toBe(0)
    expect(response.isActive({ on: 1, type: 1, freq: 1000, gain: 0, q: 1 })).toBe(true)
  })

  it('adds the bands: the total is the sum of each band\'s decibels', () => {
    const bands = [{ on: 1, type: 3, freq: 500, gain: 6, q: 1 }, { on: 1, type: 5, freq: 5000, gain: -4, q: 0.71 }]
    const total = response.totalResponseDb(bands, 1000, RATE)
    expect(total).toBeCloseTo(bands.reduce((s, b) => s + response.bandResponseDb(b, 1000, RATE), 0), 9)
  })
})

describeBuilt('a fresh instance, and what a band does to the stereo image', () => {
  const noise = (seed = 1) => { let s = seed; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return (s / 4294967296 * 2 - 1) * 0.4 } }

  it('passes the signal unchanged, bit for bit', async () => {
    const { run } = await load()
    const a = noise(1), b = noise(2)
    const left = Float32Array.from({ length: 4096 }, () => a()), right = Float32Array.from({ length: 4096 }, () => b())
    const [outL, outR] = run(32, n => left[n], n => right[n])
    expect(Array.from(outL)).toEqual(Array.from(left))
    expect(Array.from(outR)).toEqual(Array.from(right))
  })

  it('is silent for silence, and treats a non-finite sample as silence', async () => {
    const { run, setBand } = await load()
    setBand(3, { gain: 12 })
    expect(run(8, () => 0)[0].every(v => v === 0)).toBe(true)
    const [out] = run(8, n => (n === 100 ? NaN : n === 101 ? Infinity : 0))
    expect(out.every(Number.isFinite)).toBe(true)
  })

  it('gives each band a channel in Left/Right: a band on the left does nothing to the right', async () => {
    const { run, set, setBand } = await load()
    set('mode', 1)
    setBand(4, { on: 1, type: 3, freq: 1000, gain: 12, q: 1, channel: 1 })
    const [left, right] = run(120, sine(1000, 0.1), sine(1000, 0.1))
    const tail = view => view.subarray(view.length - 4800)
    expect(dB(rms(tail(left)) / rms(tail(right)))).toBeGreaterThan(11)
    expect(rms(tail(right)) / (0.1 / Math.SQRT2)).toBeCloseTo(1, 3)
  })

  it('acts in Mid/Side on mid alone for a mono signal, and not at all on a side-only one', async () => {
    const mid = async () => {
      const { run, set, setBand } = await load()
      set('mode', 2)
      setBand(4, { on: 1, type: 3, freq: 1000, gain: 12, q: 1, channel: 1 })
      return run(120, sine(1000, 0.1), sine(1000, 0.1))
    }
    const [l, r] = await mid()
    expect(dB(rms(l.subarray(-4800)) / (0.1 / Math.SQRT2))).toBeGreaterThan(11)
    expect(Math.abs(rms(l.subarray(-4800)) - rms(r.subarray(-4800)))).toBeLessThan(1e-6)   // still mono
    const { run, set, setBand } = await load()
    set('mode', 2)
    setBand(4, { on: 1, type: 3, freq: 1000, gain: 12, q: 1, channel: 1 })
    const [sl] = run(120, sine(1000, 0.1), n => -sine(1000, 0.1)(n))
    expect(rms(sl.subarray(-4800)) / (0.1 / Math.SQRT2)).toBeCloseTo(1, 3)
  })

  it('ignores a band\'s channel in Stereo mode', async () => {
    const { run, setBand } = await load()
    setBand(4, { on: 1, type: 3, freq: 1000, gain: 12, q: 1, channel: 2 })
    const [l, r] = run(120, sine(1000, 0.1))
    expect(Math.abs(rms(l.subarray(-4800)) - rms(r.subarray(-4800)))).toBeLessThan(1e-7)
    expect(dB(rms(l.subarray(-4800)) / (0.1 / Math.SQRT2))).toBeGreaterThan(11)
  })

  it('moves the output level, and glides to it without a step', async () => {
    const { run, set } = await load()
    run(4, () => 0.25)
    set('output', 6)
    const [out] = run(8, () => 0.25)
    expect(out[0]).toBeGreaterThan(0.25)
    expect(out[0]).toBeLessThan(0.25 * 2.0)
    expect(out[out.length - 1]).toBeCloseTo(0.25 * 10 ** (6 / 20), 4)
  })

  it('starts a band that was switched off from clean memory, so enabling it again does not replay old state', async () => {
    const { run, setBand } = await load()
    setBand(4, { on: 1, type: 3, freq: 200, gain: 15, q: 8 })
    run(40, sine(200, 0.5))
    setBand(4, { on: 0 })
    run(2, () => 0)
    setBand(4, { on: 1 })
    const [out] = run(4, () => 0)
    expect(out.every(v => v === 0)).toBe(true)
  })

  it('stays stable at the extremes of every band, at 192 kHz as at 44.1', async () => {
    for (const rate of [44100, 192000]) {
      const { run, setBand, set } = await load(rate)
      set('mode', 2)
      for (let b = 1; b <= 8; b++) setBand(b, { on: 1, type: (b * 3) % 8, freq: b % 2 ? 20 : 20000, gain: b % 2 ? 18 : -18, q: b % 2 ? 18 : 0.1, channel: b % 3 })
      const g = noise(7)
      const [out] = run(300, () => g())
      expect(out.every(Number.isFinite)).toBe(true)
      // The ringing dies away rather than growing.
      const late = rms(out.subarray(-2000))
      expect(late).toBeLessThan(1e3)
    }
  })
})

describeBuilt('MIDI, the Drift convention', () => {
  it('lets controllers 1 to 4 on the chosen channel drive the chosen band and the output', async () => {
    const { e, set, cc, run } = await load()
    set('cc_channel', 3)
    set('cc_band', 2)
    cc(3, 1, 127)
    run(1, () => 0)
    expect(e.jig_live_active(0)).toBe(1)
    expect(e.jig_live_value(0)).toBeCloseTo(20000, 0)
    cc(3, 1, 0); run(1, () => 0)
    expect(e.jig_live_value(0)).toBeCloseTo(20, 3)
    cc(3, 2, 127); run(1, () => 0)
    expect(e.jig_live_value(1)).toBeCloseTo(18, 3)
    cc(3, 3, 127); run(1, () => 0)
    expect(e.jig_live_value(2)).toBeCloseTo(18, 3)
    cc(3, 3, 0); run(1, () => 0)
    expect(e.jig_live_value(2)).toBeCloseTo(0.1, 5)
    cc(3, 4, 0); run(1, () => 0)
    expect(e.jig_live_value(3)).toBeCloseTo(-12, 4)
    cc(3, 4, 127); run(1, () => 0)
    expect(e.jig_live_value(3)).toBeCloseTo(12, 4)
  })

  it('ignores another channel, channel 0, and controllers outside 1 to 4', async () => {
    const { e, set, cc, run } = await load()
    set('cc_channel', 3)
    cc(4, 1, 100); run(1, () => 0)
    cc(3, 5, 100); run(1, () => 0)
    cc(3, 74, 100); run(1, () => 0)
    for (let slot = 0; slot < 4; slot++) expect(e.jig_live_active(slot)).toBe(0)
    set('cc_channel', 0)
    cc(1, 1, 100); run(1, () => 0)
    expect(e.jig_live_active(0)).toBe(0)
  })

  it('changes what is heard, and holds it until the panel moves that control', async () => {
    const { e, set, setBand, cc, run } = await load()
    set('cc_channel', 1)
    set('cc_band', 4)
    setBand(4, { on: 1, type: 3, freq: 600, gain: 12, q: 1 })
    const level = async () => dB(rms(run(80, sine(5000, 0.2))[0].subarray(-4800)) / (0.2 / Math.SQRT2))
    expect(await level()).toBeLessThan(1)
    // CC 1 at 127 moves the bell to 20 kHz, which lifts a 5 kHz tone, and the audio changes.
    cc(1, 1, 112); run(1, () => 0)
    expect(e.jig_live_active(0)).toBe(1)
    const moved = await level()
    expect(moved).toBeGreaterThan(3)
    // Setting the same control from the panel takes it back.
    setBand(4, { freq: 601 })
    expect(e.jig_live_active(0)).toBe(0)
    expect(await level()).toBeLessThan(1)
  })

  it('releases every held controller when the CC band changes', async () => {
    const { e, set, cc, run } = await load()
    set('cc_channel', 1)
    cc(1, 1, 50); run(1, () => 0)
    cc(1, 4, 50); run(1, () => 0)
    expect(e.jig_live_active(0) + e.jig_live_active(3)).toBe(2)
    set('cc_band', 5)
    expect([0, 1, 2, 3].map(s => e.jig_live_active(s))).toEqual([0, 0, 0, 0])
  })

  it('releases the output controller when the output is set, and not when another control is', async () => {
    const { e, set, setBand, cc, run } = await load()
    set('cc_channel', 1)
    cc(1, 4, 100); run(1, () => 0)
    setBand(1, { freq: 50 })
    expect(e.jig_live_active(3)).toBe(1)
    set('output', 1)
    expect(e.jig_live_active(3)).toBe(0)
  })
})

describeBuilt('the spectrum analyser', () => {
  const bandOf = (hz, e) => { for (let k = 0; k < 64; k++) if (hz >= e.jig_spectrum_edge_hz(k) && hz < e.jig_spectrum_edge_hz(k + 1)) return k; return -1 }

  it('has band edges that are geometric from 20 Hz to 20 kHz', async () => {
    const { e } = await load()
    expect(e.jig_spectrum_edge_hz(0)).toBeCloseTo(20, 9)
    expect(e.jig_spectrum_edge_hz(64)).toBeCloseTo(20000, 6)
    expect(e.jig_spectrum_edge_hz(32)).toBeCloseTo(Math.sqrt(20 * 20000), 6)
  })

  it('reads a full-scale sine at about 0 dB in the band that holds it, and far below in the others', async () => {
    const { e, run, spectrum } = await load()
    run(60, sine(2000, 1))
    const k = bandOf(2000, e)
    expect(spectrum[k]).toBeGreaterThan(-3)
    expect(spectrum[k]).toBeLessThan(1)
    expect(spectrum[(k + 20) % 64]).toBeLessThan(-40)
    expect(spectrum[0]).toBeLessThan(-40)
  })

  it('refreshes about thirty times a second, and says so by moving its serial', async () => {
    const { e, run } = await load()
    const start = e.jig_spectrum_serial()
    run(375, sine(1000, 0.5))   // one second
    const refreshes = e.jig_spectrum_serial() - start
    expect(refreshes).toBeGreaterThanOrEqual(28)
    expect(refreshes).toBeLessThanOrEqual(31)
  })

  it('falls slowly, at about 40 dB a second, rather than at once', async () => {
    const { e, run, spectrum } = await load()
    run(80, sine(1000, 1))
    const k = bandOf(1000, e)
    const peak = spectrum[k]
    run(38, () => 0)   // about a tenth of a second
    expect(spectrum[k]).toBeLessThan(peak)
    expect(spectrum[k]).toBeGreaterThan(peak - 8)
  })

  it('reads the signal after the EQ at Post and before it at Pre', async () => {
    const level = async source => {
      const { e, set, setBand, run, spectrum } = await load()
      set('spectrum_source', source)
      setBand(4, { on: 1, type: 3, freq: 1000, gain: -12, q: 1 })
      run(80, sine(1000, 0.5))
      return spectrum[bandOf(1000, e)]
    }
    const post = await level(2)
    const pre = await level(1)
    expect(pre - post).toBeGreaterThan(9)
    expect(pre - post).toBeLessThan(13)
  })

  it('stops, and drops to the floor, when it is switched off', async () => {
    const { e, set, run, spectrum } = await load()
    run(80, sine(1000, 1))
    expect(Math.max(...spectrum)).toBeGreaterThan(-6)
    const before = e.jig_spectrum_serial()
    set('spectrum_source', 0)
    run(2, sine(1000, 1))
    expect(e.jig_spectrum_serial()).toBeGreaterThan(before)
    expect(Math.max(...spectrum)).toBe(-90)
    const settled = e.jig_spectrum_serial()
    run(100, sine(1000, 1))
    expect(e.jig_spectrum_serial()).toBe(settled)
  })

  it('starts at the floor, not at 0 dB', async () => {
    const { spectrum } = await load()
    expect([...spectrum].every(v => v === -90)).toBe(true)
  })

  it('does not change the audio, whichever tap it reads', async () => {
    const render = async source => {
      const { set, setBand, run } = await load()
      set('spectrum_source', source)
      setBand(4, { on: 1, type: 3, freq: 1000, gain: 6, q: 1 })
      return run(60, sine(700, 0.4))[0]
    }
    const off = await render(0)
    for (const source of [1, 2]) expect(Array.from(await render(source))).toEqual(Array.from(off))
  })
})
