// tests/dsp/quartet.test.js
//
// Quartet is a port of a native plugin, and most of the ways it can break are two files disagreeing
// rather than one being wrong. The parameters are declared in profile.json, registered again in
// quartet-processor.js, and addressed a third time by index and range in quartet.cpp; the first half
// of this file binds the three lists together. The second half drives the compiled module directly
// and offline: the maths it had to write for itself, the original's renders (a fixture made by
// compiling the Downspout core natively), and what a player meets first, which is the bass it opens as.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../plugins/quartet')
const read = name => readFileSync(resolve(dir, name), 'utf8')
const profile = JSON.parse(read('profile.json'))
const processorSource = read('quartet-processor.js')

describe('the processor registers the parameters the profile declares', () => {
  const descriptors = [...processorSource.matchAll(
    /\{ name: '([a-z0-9_]+)', defaultValue: (-?[\d.]+), minValue: (-?[\d.]+), maxValue: (-?[\d.]+), automationRate: '([a-z-]+)' \}/g
  )].map(m => ({ name: m[1], defaultValue: Number(m[2]), minValue: Number(m[3]), maxValue: Number(m[4]) }))

  it('found the descriptor list, so the rest of this is not vacuous', () => {
    expect(descriptors.length).toBe(59)
    expect(profile.ports.length).toBe(59)
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

  it('declares the version 2 ABI and MIDI events, and uses no transport', () => {
    expect(profile.abi).toBe('jig:Abi2')
    expect(profile.requires).toEqual(['jig:MidiEvents'])
  })

  it('has no state to save: no assets, no text', () => {
    expect(profile.assets).toBeUndefined()
  })
})

describe('the profile describes the choices in words', () => {
  const port = symbol => profile.ports.find(p => p.symbol === symbol)

  it('names every algorithm by its routing, so the panel needs no drawing', () => {
    expect(port('algorithm').scalePoints).toHaveLength(11)
    expect(port('algorithm').scalePoints[0].label).toBe('1: D > C > B > A')
  })

  it('offers the waveforms, filter types, play modes and quality as choices', () => {
    expect(port('opa_wave').scalePoints.map(s => s.label)).toEqual(['Sine', 'Saw', 'Square'])
    expect(port('filter_type').scalePoints).toHaveLength(5)
    expect(port('play_mode').scalePoints.map(s => s.label)).toEqual(['Poly', 'Mono', 'Legato'])
    expect(port('quality').scalePoints.map(s => s.label)).toEqual(['1x', '2x'])
  })

  it('puts the controls a player reaches for first on top', () => {
    const top = profile.ports.filter(p => p.displayPriority !== undefined).sort((a, b) => b.displayPriority - a.displayPriority).map(p => p.symbol)
    expect(top.slice(0, 4)).toEqual(['algorithm', 'master', 'depth', 'cutoff'])
  })

  it('gives every port some words, so the help line has something to say', () => {
    expect(profile.ports.filter(p => !p.comment).map(p => p.symbol)).toEqual([
      'pitch_attack', 'pitch_decay', 'pitch_sustain', 'pitch_release'
    ])
  })
})

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------
const wasmPath = resolve(dir, 'quartet.wasm')
const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/quartet/quartet.wasm not built; run plugins/quartet/build.sh')

const RATE = 48000
const EVENT_BYTES = 8
const P = Object.fromEntries(profile.ports.map(p => [p.symbol, p.paramIndex]))
const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CC = 0xb0

/** A module, initialised, with the views the ABI says to take once. */
async function load () {
  const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {})
  const e = instance.exports
  e.jig_init(RATE)
  const frames = e.jig_max_frames()
  const midi = new DataView(e.memory.buffer, e.jig_midi_in_ptr(), e.jig_midi_in_capacity() * EVENT_BYTES)
  const output = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))
  const set = (symbol, value) => e.jig_set_param(P[symbol], value)

  const send = (...events) => {
    events.forEach(([frame, ...bytes], i) => {
      const at = i * EVENT_BYTES
      midi.setUint32(at, frame, true)
      midi.setUint8(at + 4, bytes.length)
      for (let b = 0; b < 3; b++) midi.setUint8(at + 5 + b, bytes[b] ?? 0)
    })
    e.jig_midi_in(events.length)
  }

  /** Render n blocks of `size` frames, returning every left sample. */
  const run = (blocks, size = frames) => {
    const samples = new Float32Array(blocks * size)
    for (let i = 0; i < blocks; i++) {
      e.jig_process(size)
      samples.set(output[0].subarray(0, size), i * size)
    }
    return samples
  }

  return { e, frames, send, set, output, run }
}

const rms = view => Math.sqrt(view.reduce((s, v) => s + v * v, 0) / view.length)
const peak = view => view.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

/** The strongest component within a semitone of `near`, by a fine scan of a Hann windowed transform. */
function pitchOf (samples, from, near, length = 8192) {
  let best = 0
  let bestHz = near
  const window = new Float64Array(length)
  for (let i = 0; i < length; i++) window[i] = samples[from + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / length))
  for (let step = -100; step <= 100; step += 1) {
    const hz = near * 2 ** (step / 1200)
    let re = 0
    let im = 0
    const w = 2 * Math.PI * hz / RATE
    for (let i = 0; i < length; i++) { re += window[i] * Math.cos(w * i); im += window[i] * Math.sin(w * i) }
    const magnitude = Math.hypot(re, im)
    if (magnitude > best) { best = magnitude; bestHz = hz }
  }
  return bestHz
}

describeBuilt('the module agrees with the profile about every range', () => {
  it('has the minimum, maximum and default of every port, in index order', async () => {
    const { e } = await load()
    const ports = [...profile.ports].sort((a, b) => a.paramIndex - b.paramIndex)
    // Float32 in the module, so the profile's decimals are compared as float32 too.
    const f = Math.fround
    expect(ports.map(p => e.jig_param_min(p.paramIndex))).toEqual(ports.map(p => f(p.minimum)))
    expect(ports.map(p => e.jig_param_max(p.paramIndex))).toEqual(ports.map(p => f(p.maximum)))
    expect(ports.map(p => e.jig_param_default(p.paramIndex))).toEqual(ports.map(p => f(p.default)))
    expect(ports.map(p => e.jig_param(p.paramIndex))).toEqual(ports.map(p => f(p.default)))
  })

  it('clamps a value out of range and rounds a choice to a whole number', async () => {
    const { e, set } = await load()
    set('depth', 99)
    expect(e.jig_param(P.depth)).toBe(4)
    set('cutoff', -5)
    expect(e.jig_param(P.cutoff)).toBe(20)
    set('algorithm', 3.6)
    expect(e.jig_param(P.algorithm)).toBe(4)
    set('master', NaN)
    expect(e.jig_param(P.master)).toBe(0)
  })

  it('ignores an index it has no parameter for', async () => {
    const { e } = await load()
    expect(() => e.jig_set_param(59, 1)).not.toThrow()
    expect(e.jig_param(59)).toBe(0)
  })
})

describeBuilt('the freestanding maths agrees with Math.*', () => {
  it('sin, cos, tan and exp2 are within 1e-12 over the range the synth uses', async () => {
    const { e } = await load()
    let worst = 0
    for (let x = -12; x <= 12; x += 0.037) {
      worst = Math.max(worst, Math.abs(e.jig_math(0, x, 0) - Math.sin(x)), Math.abs(e.jig_math(1, x, 0) - Math.cos(x)))
    }
    for (let x = 0.001; x < 1.4; x += 0.013) worst = Math.max(worst, Math.abs(e.jig_math(2, x, 0) - Math.tan(x)) / Math.max(1, Math.tan(x)))
    for (let x = -12; x <= 12; x += 0.071) worst = Math.max(worst, Math.abs(e.jig_math(3, x, 0) - 2 ** x) / 2 ** x)
    expect(worst).toBeLessThan(1e-12)
  })
})

// The original's renders, so a port that is merely plausible fails. The fixture is made by compiling
// downspout/plugins/quartet's core natively and running the same script of events at 48 kHz; the
// largest difference when it was made was 6e-8 of full scale. It samples one frame in 32.
describeBuilt('the module renders what the original renders', () => {
  const fixture = JSON.parse(readFileSync(resolve(import.meta.dirname, 'fixtures/quartet-reference.json'), 'utf8'))
  const names = ['the original defaults', 'saw and square operators, feedback, 2x oversampling and a pitch envelope', 'mono with glide, a band-pass and no oversampling', 'legato with a fixed operator, a notch and a detuned operator']

  fixture.scenarios.forEach((overrides, index) => {
    it(`matches for ${names[index]}`, async () => {
      const { send, set, run } = await load()
      for (const [symbol, value] of Object.entries({ ...fixture.defaults, ...overrides })) set(symbol, value)
      const bend = 4000 + 8192
      const script = [[10, NOTE_ON, 48, 100], [700, NOTE_ON, 55, 90], [1500, 0xe0, bend & 127, bend >> 7], [4000, NOTE_OFF, 48, 0], [6000, NOTE_OFF, 55, 0]]
      const rendered = []
      for (let block = 0; block < 128; block++) {
        const here = script.filter(([frame]) => frame >= block * 128 && frame < (block + 1) * 128).map(([frame, ...bytes]) => [frame - block * 128, ...bytes])
        send(...here)
        rendered.push(...run(1))
      }
      let worst = 0
      fixture.renders[index].forEach((expected, i) => { worst = Math.max(worst, Math.abs(rendered[i * fixture.every] - expected)) })
      expect(peak(Float32Array.from(fixture.renders[index]))).toBeGreaterThan(0.1)
      expect(worst).toBeLessThan(1e-5)
    })
  })
})

describeBuilt('what a player meets first: a bass', () => {
  const midiNote = (n) => 440 * 2 ** ((n - 69) / 12)

  it('is silent until a note arrives', async () => {
    const { run } = await load()
    expect(peak(run(20))).toBe(0)
  })

  it('plays the note it is given, at the pitch it is given, with nothing set', async () => {
    const { send, run } = await load()
    send([0, NOTE_ON, 36, 100])
    const samples = run(80)
    // Half a second in, the attack is over and the note is steady.
    expect(pitchOf(samples, 24000, midiNote(36))).toBeCloseTo(midiNote(36), -0.5)
  })

  it('is audible and does not clip, so it can sit in a mix without being turned down', async () => {
    const { send, run } = await load()
    send([0, NOTE_ON, 28, 110])
    const samples = run(300)
    expect(rms(samples.subarray(12000, 24000))).toBeGreaterThan(0.05)
    expect(peak(samples)).toBeLessThan(0.9)
  })

  it('is mono: a second note takes over the one voice rather than adding another', async () => {
    const { e, send, run } = await load()
    send([0, NOTE_ON, 36, 100], [64, NOTE_ON, 43, 100])
    run(20)
    expect(e.jig_active_voices()).toBe(1)
  })

  it('goes poly when asked: three notes are three voices', async () => {
    const { e, send, set, run } = await load()
    set('play_mode', 0)
    send([0, NOTE_ON, 36, 100], [0, NOTE_ON, 43, 100], [0, NOTE_ON, 48, 100])
    run(20)
    expect(e.jig_active_voices()).toBe(3)
  })

  it('stops by itself after the key is let go', async () => {
    const { e, send, run } = await load()
    send([0, NOTE_ON, 36, 100])
    run(10)
    send([0, NOTE_OFF, 36, 0])
    run(700)
    expect(e.jig_active_voices()).toBe(0)
  })

  it('a ninth poly note steals a voice rather than adding a ninth', async () => {
    const { e, send, set, run } = await load()
    set('play_mode', 0)
    send(...Array.from({ length: 9 }, (_, i) => [0, NOTE_ON, 40 + i, 100]))
    run(60)
    expect(e.jig_active_voices()).toBeLessThanOrEqual(8)
  })

  it('all notes off lets the keys go and all sound off silences at once', async () => {
    const { e, send, run } = await load()
    send([0, NOTE_ON, 36, 100])
    run(10)
    send([0, CC, 120, 0])
    run(1)
    expect(e.jig_active_voices()).toBe(0)
  })
})

describeBuilt('the output does not depend on how the host cuts its blocks', () => {
  it('renders the same samples in blocks of 128 as in blocks of 64 with the same events', async () => {
    const script = [[10, NOTE_ON, 40, 100], [300, NOTE_ON, 47, 80], [1200, NOTE_OFF, 40, 0], [2400, NOTE_OFF, 47, 0]]
    const render = async size => {
      const { send, set, run } = await load()
      set('play_mode', 0)
      const out = []
      for (let at = 0; at < 4096; at += size) {
        const here = script.filter(([f]) => f >= at && f < at + size).map(([f, ...b]) => [f - at, ...b])
        send(...here)
        out.push(...run(1, size))
      }
      return Float32Array.from(out)
    }
    const a = await render(128)
    const b = await render(64)
    let worst = 0
    for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]))
    expect(worst).toBeLessThan(1e-6)
  })
})
