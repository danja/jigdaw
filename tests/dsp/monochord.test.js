// tests/dsp/monochord.test.js
//
// Monochord is a port of a native plugin, and most of the ways it can break are two files
// disagreeing rather than one being wrong. The parameters are declared in profile.json, registered
// again in monochord-processor.js, and addressed a third time by index and range in monochord.cpp;
// the first half of this file binds the three lists together. The second half drives the compiled
// module directly and offline: the maths it had to write for itself, the tuning, the decay, the
// bow, and that the output does not depend on how the host cuts its blocks.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../plugins/monochord')
const read = name => readFileSync(resolve(dir, name), 'utf8')
const profile = JSON.parse(read('profile.json'))
const processorSource = read('monochord-processor.js')
const coreSource = read('monochord.cpp')

describe('the processor registers the parameters the profile declares', () => {
  const descriptors = [...processorSource.matchAll(
    /\{ name: '([a-z0-9_]+)', defaultValue: (-?[\d.]+), minValue: (-?[\d.]+), maxValue: (-?[\d.]+), automationRate: '([a-z-]+)' \}/g
  )].map(m => ({ name: m[1], defaultValue: Number(m[2]), minValue: Number(m[3]), maxValue: Number(m[4]) }))

  it('found the descriptor list, so the rest of this is not vacuous', () => {
    expect(descriptors.length).toBe(profile.ports.length)
    expect(descriptors.length).toBeGreaterThan(0)
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
})

describe('the module agrees with the profile about every range', () => {
  // monochord.cpp holds P_MIN, P_MAX and P_DEF as arrays in the same order as the ports.
  const array = name => {
    const m = coreSource.match(new RegExp(`${name}\\[P_COUNT\\] = \\{([^}]*)\\}`))
    expect(m, `${name} not found in monochord.cpp`).not.toBeNull()
    return m[1].split(',').map(s => Number(s.trim().replace(/f$/, '')))
  }

  it('has the minimum, maximum and default of every port, in index order', () => {
    const ports = [...profile.ports].sort((a, b) => a.paramIndex - b.paramIndex)
    expect(array('P_MIN')).toEqual(ports.map(p => p.minimum))
    expect(array('P_MAX')).toEqual(ports.map(p => p.maximum))
    expect(array('P_DEF')).toEqual(ports.map(p => p.default))
  })

  it('offers the three exciters as a selector', () => {
    const exciter = profile.ports.find(p => p.symbol === 'exciter')
    expect(exciter.scalePoints.map(s => s.label)).toEqual(['Pluck', 'Bow', 'Hammer'])
  })

  it('has no state to save: no assets, no text', () => {
    expect(profile.assets).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------
const wasmPath = resolve(dir, 'monochord.wasm')
const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/monochord/monochord.wasm not built; run plugins/monochord/build.sh')

const RATE = 48000
const EVENT_BYTES = 8
const P = Object.fromEntries(profile.ports.map(p => [p.symbol, p.paramIndex]))
const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CC = 0xb0
const BEND = 0xe0
const PLUCK = 0
const BOW = 1
const HAMMER = 2

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
const dB = (a, b) => 20 * Math.log10(a / b)

/**
 * The frequency of the strongest component within a semitone of `near`, by a fine scan of a Hann
 * windowed transform. An autocorrelation lag is a whole number of samples and so cannot resolve
 * three cents at 880 Hz; this can, given 8192 samples.
 */
function pitchOf (samples, from, near, length = 8192) {
  let best = 0
  let bestHz = near
  const window = new Float64Array(length)
  for (let i = 0; i < length; i++) window[i] = samples[from + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / length))
  for (let step = -60; step <= 60; step += 0.5) {
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

const cents = (hz, target) => 1200 * Math.log2(hz / target)
const midiHz = note => 440 * 2 ** ((note - 69) / 12)

/** A clean string: nothing but the loop, so a measurement sees the loop. */
function plain (m) {
  m.set('damping', 0)
  m.set('stiffness', 0)
  m.set('body_level', 0)
  m.set('pickup', 0)
}

describeBuilt('the monochord module', () => {
  it('instantiates with no imports at all', async () => {
    const module = new WebAssembly.Module(await readFile(wasmPath))
    expect(WebAssembly.Module.imports(module)).toEqual([])
  })

  it('exports the version 2 surface its profile promises', async () => {
    const { e } = await load()
    for (const name of ['jig_init', 'jig_max_frames', 'jig_output_ptr', 'jig_process', 'jig_set_param',
      'jig_midi_in_ptr', 'jig_midi_in_capacity', 'jig_midi_in', 'jig_latency_frames', 'memory']) {
      expect(e, name).toHaveProperty(name)
    }
    expect(e.jig_latency_frames()).toBe(0)
  })

  it('does not grow its memory when rendering', async () => {
    const m = await load()
    const before = m.e.memory.buffer.byteLength
    m.send([0, NOTE_ON, 60, 100], [0, NOTE_ON, 64, 100])
    m.run(200)
    expect(m.e.memory.buffer.byteLength).toBe(before)
  })

  it('is silent until a note arrives', async () => {
    const m = await load()
    expect(peak(m.run(50))).toBe(0)
  })

  it('is audible untouched: defaults only, a pressed key sounds', async () => {
    const m = await load()
    m.send([0, NOTE_ON, 57, 100])
    const out = m.run(100)
    expect(peak(out)).toBeGreaterThan(0.05)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(m.output[1].every((v, i) => v === m.output[0][i])).toBe(true)
  })
})

describeBuilt('the maths written for a module with no libm', () => {
  // A freestanding function is wrong until it has been set against the real one, over the range
  // it is called in: tuning and the body filters use angles up to 0.8 pi, exp2 spans the pitch range.
  let m
  const math = async (op, a, b = 0) => { m ??= await load(); return m.e.jig_math(op, a, b) }

  it('sine and cosine agree with Math over several turns', async () => {
    for (let x = -20; x <= 20; x += 0.137) {
      expect(Math.abs(await math(0, x) - Math.sin(x))).toBeLessThan(1e-12)
      expect(Math.abs(await math(1, x) - Math.cos(x))).toBeLessThan(1e-12)
    }
  })

  it('arctangent agrees with Math.atan2 in every quadrant', async () => {
    for (const y of [-7, -1, -0.3, 0, 0.05, 0.3, 1, 7]) {
      for (const x of [-5, -1, -0.2, 0.2, 1, 5]) {
        expect(Math.abs(await math(2, y, x) - Math.atan2(y, x)), `atan2(${y}, ${x})`).toBeLessThan(1e-12)
      }
    }
  })

  it('tangent agrees with Math below the angle tuning uses', async () => {
    for (let x = 0.01; x < 1.3; x += 0.011) {
      const want = Math.tan(x)
      expect(Math.abs(await math(3, x) - want) / want).toBeLessThan(1e-11)
    }
  })

  it('exp2 agrees with Math.pow across the range of a pitch and a decay', async () => {
    for (let x = -30; x <= 10; x += 0.173) {
      const want = 2 ** x
      expect(Math.abs(await math(4, x) - want) / want).toBeLessThan(1e-13)
    }
  })
})

describeBuilt('the loop is in tune', () => {
  it('has a phase delay of one period at the note, whatever the damping and stiffness', async () => {
    const m = await load()
    for (const [damping, stiffness] of [[0, 0], [0.3, 0.5], [1, 0], [0.5, 1], [1, 1]]) {
      m.set('damping', damping)
      m.set('stiffness', stiffness)
      for (let note = 28; note <= 100; note += 3) {
        const err = m.e.jig_tuning_error(midiHz(note))
        expect(Math.abs(err), `note ${note}, damping ${damping}, stiffness ${stiffness}`).toBeLessThan(2e-3)
      }
    }
  })

  it('sounds at the pitch of the key, within three cents, over three octaves', async () => {
    for (const note of [45, 57, 69, 81]) {
      const m = await load()
      plain(m)
      m.send([0, NOTE_ON, note, 100])
      const out = m.run(120)
      expect(Math.abs(cents(pitchOf(out, 2000, midiHz(note)), midiHz(note))), `note ${note}`).toBeLessThan(3)
    }
  })

  it('stays in tune with damping and stiffness at their defaults', async () => {
    const m = await load()
    m.set('body_level', 0)
    m.send([0, NOTE_ON, 57, 100])
    const out = m.run(120)
    expect(Math.abs(cents(pitchOf(out, 2000, 220), 220))).toBeLessThan(6)
  })

  it('bends a sounding note by the bend range, up an octave at full bend and 12 semitones of range', async () => {
    const m = await load()
    plain(m)
    m.set('bend_range', 12)
    m.send([0, NOTE_ON, 57, 100], [0, BEND, 0x7f, 0x7f])
    const out = m.run(400)
    expect(Math.abs(cents(pitchOf(out, 24000, 440), 440))).toBeLessThan(6)
  })

  it('bends one channel and leaves the others where they were', async () => {
    const m = await load()
    plain(m)
    m.set('bend_range', 12)
    m.send([0, BEND, 0x7f, 0x7f], [0, NOTE_ON | 1, 57, 100])   // the bend is on channel 0, the note on channel 1
    const out = m.run(400)
    expect(Math.abs(cents(pitchOf(out, 24000, 220), 220))).toBeLessThan(6)
  })
})

describeBuilt('the three exciters', () => {
  it('a plucked note with no damping falls 60 dB in the Decay time', async () => {
    const m = await load()
    plain(m)
    m.set('decay', 1)
    m.send([0, NOTE_ON, 57, 127])
    const out = m.run(Math.ceil(1.6 * RATE / 128))
    // 0.2 s to 0.7 s is half a decay time: 30 dB, within the original's 12 per cent.
    const early = rms(out.subarray(Math.round(0.2 * RATE), Math.round(0.25 * RATE)))
    const late = rms(out.subarray(Math.round(0.7 * RATE), Math.round(0.75 * RATE)))
    expect(dB(early, late)).toBeGreaterThan(30 * 0.88)
    expect(dB(early, late)).toBeLessThan(30 * 1.12)
  })

  it('a longer Decay rings longer', async () => {
    const tail = async decay => {
      const m = await load()
      plain(m)
      m.set('decay', decay)
      m.send([0, NOTE_ON, 57, 100])
      return rms(m.run(Math.ceil(2 * RATE / 128)).subarray(Math.round(1.6 * RATE)))
    }
    expect(await tail(8)).toBeGreaterThan(5 * await tail(0.5))
  })

  it('the hammer sounds and differs from the pluck', async () => {
    const play = async exciter => {
      const m = await load()
      m.set('exciter', exciter)
      m.send([0, NOTE_ON, 57, 100])
      return m.run(60)
    }
    const pluck = await play(PLUCK)
    const hammer = await play(HAMMER)
    expect(peak(hammer)).toBeGreaterThan(0.02)
    expect(pluck.some((v, i) => Math.abs(v - hammer[i]) > 1e-3)).toBe(true)
  })

  it('the bow oscillates and keeps sounding while the key is held', async () => {
    const m = await load()
    m.set('exciter', BOW)
    m.send([0, NOTE_ON, 57, 100])
    const out = m.run(Math.ceil(2 * RATE / 128))
    const second = out.subarray(RATE)
    expect(rms(second)).toBeGreaterThan(0.01)
    // It really oscillates rather than holding an offset: the signal crosses zero over and over.
    let crossings = 0
    for (let i = 1; i < second.length; i++) if ((second[i - 1] < 0) !== (second[i] < 0)) crossings++
    expect(crossings).toBeGreaterThan(300)
  })

  it('the bow gets louder with velocity', async () => {
    const level = async velocity => {
      const m = await load()
      m.set('exciter', BOW)
      m.send([0, NOTE_ON, 57, velocity])
      return rms(m.run(Math.ceil(1.5 * RATE / 128)).subarray(RATE))
    }
    expect(await level(120)).toBeGreaterThan(1.2 * await level(30))
  })

  it('Velocity at 0 plays every note at full level', async () => {
    const level = async velocity => {
      const m = await load()
      plain(m)
      m.set('velocity', 0)
      m.send([0, NOTE_ON, 57, velocity])
      return peak(m.run(20))
    }
    expect(await level(20)).toBeCloseTo(await level(127), 5)
  })

  it('Pickup removes a harmonic: a pickup at one half takes out the even ones', async () => {
    const spectrumAt = async (pickup, hz) => {
      const m = await load()
      plain(m)
      m.set('pickup', pickup)
      m.set('position', 0.3)
      m.send([0, NOTE_ON, 57, 100])
      const out = m.run(160).subarray(4000, 4000 + 8192)
      let re = 0; let im = 0
      out.forEach((v, i) => { const w = 2 * Math.PI * hz * i / RATE; re += v * Math.cos(w); im += v * Math.sin(w) })
      return Math.hypot(re, im)
    }
    // The delay is rounded to whole samples, so the cancellation is deep rather than total.
    expect(await spectrumAt(0.5, 440)).toBeLessThan(0.15 * await spectrumAt(0, 440))
    // The fundamental is not touched: the comb takes out a harmonic, not the note.
    expect(await spectrumAt(0.5, 220)).toBeGreaterThan(0.5 * await spectrumAt(0, 220))
  })
})

describeBuilt('notes', () => {
  it('a released note is damped over the Release time, then the voice is free', async () => {
    const m = await load()
    plain(m)
    m.set('decay', 20)
    m.set('release', 50)
    m.send([0, NOTE_ON, 57, 100])
    m.run(50)
    m.send([0, NOTE_OFF, 57, 0])
    const out = m.run(Math.ceil(0.5 * RATE / 128))
    expect(rms(out.subarray(out.length - 2000))).toBeLessThan(0.001 * Math.max(1e-9, peak(out)))
    expect(m.e.jig_active_voices()).toBe(0)
  })

  it('the sustain pedal holds a released note and letting go damps it', async () => {
    const m = await load()
    plain(m)
    m.set('decay', 20)
    m.set('release', 50)
    m.send([0, CC, 64, 127], [0, NOTE_ON, 57, 100], [100, NOTE_OFF, 57, 0])
    const held = m.run(Math.ceil(0.5 * RATE / 128))
    expect(rms(held.subarray(held.length - 2000))).toBeGreaterThan(0.02)
    m.send([0, CC, 64, 0])
    m.run(Math.ceil(0.5 * RATE / 128))
    expect(m.e.jig_active_voices()).toBe(0)
  })

  it('CC 123 lets go of every note and CC 120 silences them at once', async () => {
    const m = await load()
    plain(m)
    m.set('decay', 20)
    m.set('release', 50)
    m.send([0, NOTE_ON, 57, 100], [0, NOTE_ON, 60, 100])
    m.run(20)
    expect(m.e.jig_active_voices()).toBe(2)
    m.send([0, CC, 123, 0])
    m.run(Math.ceil(0.5 * RATE / 128))
    expect(m.e.jig_active_voices()).toBe(0)

    m.send([0, NOTE_ON, 57, 100])
    m.run(20)
    m.send([0, CC, 120, 0])
    expect(peak(m.run(40).subarray(256))).toBeLessThan(1e-4)
    expect(m.e.jig_active_voices()).toBe(0)
  })

  it('a ninth note steals a voice rather than being refused or growing past eight', async () => {
    const m = await load()
    m.send(...Array.from({ length: 9 }, (_, i) => [0, NOTE_ON, 48 + i * 2, 100]))
    const out = m.run(20)
    expect(m.e.jig_active_voices()).toBe(8)
    expect(out.every(Number.isFinite)).toBe(true)
  })

  it('a note on with velocity 0 is a note off', async () => {
    const m = await load()
    plain(m)
    m.set('release', 5)
    m.send([0, NOTE_ON, 57, 100])
    m.run(10)
    m.send([0, NOTE_ON, 57, 0])
    m.run(Math.ceil(0.3 * RATE / 128))
    expect(m.e.jig_active_voices()).toBe(0)
  })

  it('a note is located by its frame: nothing sounds before it, in the block that holds it', async () => {
    const m = await load()
    m.send([100, NOTE_ON, 57, 127])
    const out = m.run(1)
    expect(Array.from(out.subarray(0, 100)).every(v => v === 0)).toBe(true)
    expect(peak(out.subarray(100))).toBeGreaterThan(0)
  })

  it('ignores events it cannot read', async () => {
    const m = await load()
    m.send([0, 0x90], [0, 0xf8, 1, 2], [0, 0xa0, 60, 40])
    expect(peak(m.run(10))).toBe(0)
    expect(m.e.jig_active_voices()).toBe(0)
  })
})

describeBuilt('the output does not depend on how the host cuts its blocks', () => {
  it('renders the same samples in blocks of 128 as in 64 then 64', async () => {
    const play = async cut => {
      const m = await load()
      const events = [[0, 57], [37, 64], [200, 69]]
      const out = new Float32Array(1024)
      for (let o = 0; o < 1024; o += cut) {
        const due = events.filter(([f]) => f >= o && f < o + cut).map(([f, n]) => [f - o, NOTE_ON, n, 100])
        m.send(...due)
        m.e.jig_process(cut)
        out.set(m.output[0].subarray(0, cut), o)
      }
      return out
    }
    const whole = await play(128)
    const halves = await play(64)
    const quarters = await play(32)
    expect(Array.from(halves)).toEqual(Array.from(whole))
    expect(Array.from(quarters)).toEqual(Array.from(whole))
  })
})

describeBuilt('extremes', () => {
  it('stays finite and bounded with every control at either end and eight notes held', async () => {
    for (const edge of ['minimum', 'maximum']) {
      for (const exciter of [PLUCK, BOW, HAMMER]) {
        const m = await load()
        for (const port of profile.ports) m.set(port.symbol, port[edge])
        m.set('exciter', exciter)
        m.send(...Array.from({ length: 8 }, (_, i) => [0, NOTE_ON, 24 + i * 11, 127]))
        const out = m.run(300)
        expect(out.every(Number.isFinite), `${edge}, exciter ${exciter}`).toBe(true)
        expect(peak(out), `${edge}, exciter ${exciter}`).toBeLessThan(40)
      }
    }
  })

  it('treats a parameter that is not a number, or out of range, as the nearest limit', async () => {
    const m = await load()
    m.set('decay', NaN)
    m.set('master', 9)
    m.set('exciter', 1.4)
    m.set('bend_range', -5)
    m.send([0, NOTE_ON, 57, 100])
    const out = m.run(20)
    expect(out.every(Number.isFinite)).toBe(true)
    m.e.jig_set_param(99, 1)   // an index that is not a parameter changes nothing
    expect(m.run(5).every(Number.isFinite)).toBe(true)
  })

  it('does not blow up at 44.1 kHz or 96 kHz', async () => {
    for (const rate of [44100, 96000]) {
      const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {})
      const e = instance.exports
      e.jig_init(rate)
      const midi = new DataView(e.memory.buffer, e.jig_midi_in_ptr(), 16)
      midi.setUint32(0, 0, true); midi.setUint8(4, 3); midi.setUint8(5, NOTE_ON); midi.setUint8(6, 33); midi.setUint8(7, 100)
      e.jig_midi_in(1)
      const out = new Float32Array(e.memory.buffer, e.jig_output_ptr(0), 128)
      let top = 0
      for (let i = 0; i < 300; i++) { e.jig_process(128); for (const v of out) { expect(Number.isFinite(v)).toBe(true); top = Math.max(top, Math.abs(v)) } }
      expect(top).toBeGreaterThan(0.01)
    }
  })
})
