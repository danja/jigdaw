// tests/dsp/sam.test.js
//
// Sam is a port of somebody else's synthesiser, and almost every way it can
// break is two files disagreeing rather than one being wrong.
//
// The parameters are declared once in plugins/sam/profile.json, registered a
// second time in plugins/sam/sam-processor.js, and addressed a third time by
// index in plugins/sam/sam.cpp. The first half of this file binds the three
// lists to each other. The second half drives the compiled module directly,
// deterministically and offline: the speech, the pitch, and the transport
// scheduling, including that the output does not depend on how the host cuts
// its blocks.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../plugins/sam')
const read = name => readFileSync(resolve(dir, name), 'utf8')
const profile = JSON.parse(read('profile.json'))
const processorSource = read('sam-processor.js')
const coreSource = read('sam.cpp')

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
    const map = [...processorSource.matchAll(/^ {2}([a-z0-9_]+): (\d+),?$/gm)]
      .map(m => [m[1], Number(m[2])])
    expect(map).toEqual(profile.ports.map(p => [p.symbol, p.paramIndex]))
  })

  it('registers under the name the profile says it does', () => {
    expect(processorSource).toContain(`registerProcessor('${profile.registeredName}'`)
  })

  it('declares the version 2 ABI, MIDI events and the host transport it uses', () => {
    expect(profile.abi).toBe('jig:Abi2')
    expect(profile.requires).toEqual(expect.arrayContaining(['jig:MidiEvents', 'trn:HostTransport']))
  })
})

describe('the module agrees with the profile about every range', () => {
  // sam.cpp holds P_MIN, P_MAX and P_DEF as arrays in the same order as the
  // ports. Read out of the source, so a range changed in one place only fails here.
  const array = name => {
    const m = coreSource.match(new RegExp(`${name}\\[P_COUNT\\] = \\{([^}]*)\\}`))
    expect(m, `${name} not found in sam.cpp`).not.toBeNull()
    return m[1].split(',').map(s => Number(s.trim().replace(/f$/, '')))
  }

  it('has the minimum, maximum and default of every port, in index order', () => {
    const ports = [...profile.ports].sort((a, b) => a.paramIndex - b.paramIndex)
    expect(array('P_MIN')).toEqual(ports.map(p => p.minimum))
    expect(array('P_MAX')).toEqual(ports.map(p => p.maximum))
    expect(array('P_DEF')).toEqual(ports.map(p => p.default))
  })

  it('names the step lengths the Step port offers', () => {
    const step = profile.ports.find(p => p.symbol === 'step')
    expect(step.scalePoints.map(s => s.label))
      .toEqual(['1/16', '1/8', '1/4', '1/2', '1/1', '1 bar', '2 bars', '4 bars'])
  })

  it('offers Off, sixteen channels and All on MIDI In', () => {
    const midiCh = profile.ports.find(p => p.symbol === 'midi_ch')
    expect(midiCh.scalePoints).toHaveLength(18)
    expect(midiCh.scalePoints[0].label).toBe('Off')
    expect(midiCh.scalePoints[17].label).toBe('All')
  })
})

describe('the shipped text is a plain file the module can read', () => {
  it('is declared as a user replaceable text asset', () => {
    expect(profile.assets).toEqual([
      { key: 'text', file: 'text.txt', mediaType: 'text/plain', userReplaceable: true }
    ])
  })

  it('fits the module\'s text buffer', () => {
    expect(readFileSync(resolve(dir, 'text.txt')).length).toBeLessThanOrEqual(2000)
  })
})

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------
const wasmPath = resolve(dir, 'sam.wasm')
const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/sam/sam.wasm not built; run plugins/sam/build.sh')

const RATE = 48000
const EVENT_BYTES = 8
const P = Object.fromEntries(profile.ports.map(p => [p.symbol, p.paramIndex]))
const VALID_BPM = 1
const VALID_BEAT = 2
const VALID_METER = 8

/** A module, initialised, with the views the ABI says to take once. */
async function load (text = null) {
  const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {})
  const e = instance.exports
  e.jig_init(RATE)
  const frames = e.jig_max_frames()
  const midi = new DataView(e.memory.buffer, e.jig_midi_in_ptr(), e.jig_midi_in_capacity() * EVENT_BYTES)
  const transport = new DataView(e.memory.buffer, e.jig_transport_ptr(), 64)
  const output = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))
  const textView = new Uint8Array(e.memory.buffer, e.jig_text_ptr(), e.jig_text_capacity())

  const setText = string => {
    const bytes = new TextEncoder().encode(string)
    textView.set(bytes.subarray(0, textView.length))
    e.jig_set_text(Math.min(bytes.length, textView.length))
  }
  if (text !== null) setText(text)
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

  /** The transport block, as a host fills it. Omitted fields are flagged invalid. */
  const setTransport = ({ playing = false, bpm, beat, beatsPerBar }) => {
    let valid = 0
    transport.setUint32(0, playing ? 1 : 0, true)
    if (bpm !== undefined) { transport.setFloat64(8, bpm, true); valid |= VALID_BPM }
    if (beat !== undefined) { transport.setFloat64(16, beat, true); valid |= VALID_BEAT }
    if (beatsPerBar !== undefined) { transport.setInt32(44, beatsPerBar, true); transport.setInt32(48, 4, true); valid |= VALID_METER }
    transport.setUint32(52, valid, true)
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

  return { e, frames, send, set, setText, setTransport, output, run }
}

const rms = view => Math.sqrt(view.reduce((s, v) => s + v * v, 0) / view.length)
const peak = view => view.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CC = 0xb0

/** Fundamental by autocorrelation over a steady stretch, in hertz. */
function pitchOf (samples, from, length = 2048) {
  const sums = []
  for (let l = 40; l < 1200; l++) {
    let sum = 0
    for (let i = 0; i < length; i++) sum += samples[from + i] * samples[from + i + l]
    sums[l] = sum
  }
  // The first lag within a tenth of the strongest, not the strongest: a
  // multiple of the period correlates as well and would read an octave low.
  const best = Math.max(...sums.filter(Number.isFinite))
  let lag = sums.findIndex((s, l) => l >= 40 && s >= 0.9 * best)
  // Refine to the local maximum around it.
  while (sums[lag + 1] > sums[lag]) lag++
  return RATE / lag
}

/** A vowel held for about a second, long enough to measure a pitch in. */
const VOWEL = 'a'.repeat(48)

describeBuilt('the sam module', () => {
  it('instantiates with no imports at all', async () => {
    const module = new WebAssembly.Module(await readFile(wasmPath))
    expect(WebAssembly.Module.imports(module)).toEqual([])
  })

  it('exports the version 2 surface its profile promises', async () => {
    const { e } = await load()
    for (const name of ['jig_init', 'jig_max_frames', 'jig_output_ptr', 'jig_process', 'jig_set_param',
      'jig_midi_in_ptr', 'jig_midi_in_capacity', 'jig_midi_in', 'jig_transport_ptr', 'memory']) {
      expect(e[name], `missing export ${name}`).toBeDefined()
    }
    expect(e.jig_max_frames()).toBe(profile.shape.renderQuantum)
  })

  it('does not export the version 1 note entry points', async () => {
    // A host that finds both must use the event buffer, so having only one
    // way in removes the question.
    const { e } = await load()
    expect(e.jig_note_on).toBeUndefined()
    expect(e.jig_note_off).toBeUndefined()
  })

  it('never grows its memory after jig_init', async () => {
    const { e, send, run } = await load('Hello world')
    const before = e.memory.buffer.byteLength
    send([0, NOTE_ON, 60, 100])
    run(60)
    expect(e.memory.buffer.byteLength).toBe(before)
  })
})

describeBuilt('freestanding maths', () => {
  it('exp2 matches Math.pow over the range the pitch and tone code use', async () => {
    // There is no libm in this build. Measured against the platform's pow on
    // the day it was written, as CLAUDE.md asks of freestanding maths.
    const { e } = await load()
    for (let x = -14; x <= 14; x += 0.0137) {
      expect(Math.abs(e.jig_exp2(x) / 2 ** x - 1), `exp2(${x})`).toBeLessThan(1e-12)
    }
  })

  it('exp2 saturates rather than producing garbage far out of range', async () => {
    const { e } = await load()
    expect(e.jig_exp2(-5000)).toBe(0)
    expect(Number.isFinite(e.jig_exp2(5000))).toBe(true)
  })
})

describeBuilt('keys mode', () => {
  it('is silent until a note arrives', async () => {
    const { run } = await load('Hello world')
    expect(peak(run(20))).toBe(0)
  })

  it('speaks a word when a note arrives, and the output is finite', async () => {
    const { send, run } = await load('Hello world')
    send([0, NOTE_ON, 60, 100])
    const out = run(120)
    expect(peak(out)).toBeGreaterThan(0.02)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(peak(out)).toBeLessThanOrEqual(1)
  })

  it('writes both channels identically: the voice is mono', async () => {
    const { send, run, output } = await load('Hello world')
    send([0, NOTE_ON, 60, 100])
    for (let i = 0; i < 40; i++) {
      run(1)
      expect(Array.from(output[1])).toEqual(Array.from(output[0]))
    }
  })

  it('is deterministic: the same note on a fresh module gives the same samples', async () => {
    const a = await load('Hello world')
    const b = await load('Hello world')
    a.send([0, NOTE_ON, 60, 100])
    b.send([0, NOTE_ON, 60, 100])
    expect(Array.from(a.run(60))).toEqual(Array.from(b.run(60)))
  })

  it('sings at the pitch of the key, within a quarter of a semitone', async () => {
    // The pitch byte is a whole number of glottal ticks, which is up to 0.7
    // semitone off near C5 and worse above; the engine resamples the rest.
    for (const note of [48, 60, 72]) {
      const m = await load(VOWEL)
      m.send([0, NOTE_ON, note, 100])
      const out = m.run(200)
      const target = 440 * 2 ** ((note - 69) / 12)
      const measured = pitchOf(out, 8000, 2048)
      const cents = 1200 * Math.log2(measured / target)
      expect(Math.abs(cents), `note ${note}: ${measured.toFixed(1)} Hz vs ${target.toFixed(1)}`).toBeLessThan(25)
    }
  })

  it('transposes the pitch it is sung at', async () => {
    const a = await load(VOWEL)
    const b = await load(VOWEL)
    b.set('transpose', 12)
    a.send([0, NOTE_ON, 48, 100])
    b.send([0, NOTE_ON, 48, 100])
    const low = pitchOf(a.run(200), 8000, 2048)
    const high = pitchOf(b.run(200), 8000, 2048)
    expect(high / low).toBeGreaterThan(1.9)
    expect(high / low).toBeLessThan(2.1)
  })

  it('speaks the next word each time, and starts over after the last', async () => {
    const { send, run, e } = await load('one two three')
    const lengths = []
    for (let i = 0; i < 4; i++) {
      send([0, NOTE_ON, 60, 100])
      const out = run(100)
      send([0, NOTE_OFF, 60, 0])
      run(10)
      lengths.push(out.findLastIndex(v => Math.abs(v) > 1e-3))
    }
    // Words one and four are the same word, so the same render at the same pitch.
    expect(lengths[3]).toBe(lengths[0])
    expect(lengths[0]).not.toBe(lengths[1])
    expect(e.jig_word_count()).toBe(3)
  })

  it('Key = word picks the word by key, modulo the word count, and ignores order', async () => {
    const a = await load('one two three')
    const b = await load('one two three')
    a.set('advance', 1)
    b.set('advance', 1)
    // C3 (48) is the first word. 51 is word 3 mod 3 = the first again.
    a.send([0, NOTE_ON, 48, 100])
    b.send([0, NOTE_ON, 51, 100])
    const first = a.run(100)
    const wrapped = b.run(100)
    // Different keys sing at different pitches, so compare which word it was by length.
    const end = out => out.findLastIndex(v => Math.abs(v) > 1e-3)
    expect(Math.abs(end(first) - end(wrapped))).toBeLessThan(end(first) * 0.2)
  })

  it('releases on note off: the voice fades rather than cutting', async () => {
    const { send, run, set } = await load('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    set('release', 100)
    send([0, NOTE_ON, 60, 100])
    run(20)
    send([0, NOTE_OFF, 60, 0])
    const tail = run(80)
    expect(peak(tail.subarray(0, 128))).toBeGreaterThan(0)
    expect(peak(tail.subarray(tail.length - 256))).toBe(0)
  })

  it('CC 123 releases everything', async () => {
    const { send, run, e } = await load('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    send([0, NOTE_ON, 60, 100], [0, NOTE_ON, 64, 100])
    run(10)
    expect(e.jig_active_voices()).toBe(2)
    send([0, CC, 123, 0])
    run(20)
    expect(e.jig_active_voices()).toBe(0)
  })

  it('hears only the channel MIDI In selects', async () => {
    const { send, run, set } = await load('Hello world')
    set('midi_ch', 3)
    send([0, NOTE_ON, 60, 100])     // channel 1
    expect(peak(run(40))).toBe(0)
    send([0, NOTE_ON | 2, 60, 100]) // channel 3
    expect(peak(run(80))).toBeGreaterThan(0.02)
  })

  it('Off ignores every channel', async () => {
    const { send, run, set } = await load('Hello world')
    set('midi_ch', 0)
    send([0, NOTE_ON, 60, 100])
    expect(peak(run(40))).toBe(0)
  })

  it('a rest speaks nothing', async () => {
    const { send, run } = await load('_ hello')
    send([0, NOTE_ON, 60, 100])
    expect(peak(run(60))).toBe(0)
    send([0, NOTE_ON, 60, 100])
    expect(peak(run(80))).toBeGreaterThan(0.02)
  })

  it('empty text is silent and does not throw', async () => {
    const { send, run } = await load('')
    send([0, NOTE_ON, 60, 100])
    expect(peak(run(20))).toBe(0)
  })

  it('text that cleans to nothing is silent and does not throw', async () => {
    const { send, run } = await load('123 456 !!! ###')
    send([0, NOTE_ON, 60, 100])
    send([0, NOTE_ON, 60, 100])
    expect(peak(run(20))).toBe(0)
  })

  it('survives long and hostile text: a 48 character word, binary bytes, a full buffer', async () => {
    const m = await load('')
    const hostile = 'x'.repeat(2500) + '\u0000ÿ\u0007 ' + 'qz'.repeat(30) + ' ' + 'aeiou'.repeat(20)
    m.setText(hostile)
    for (let i = 0; i < 6; i++) {
      m.send([0, NOTE_ON, 36 + i * 9, 127])
      const out = m.run(30)
      expect(out.every(Number.isFinite)).toBe(true)
    }
  })

  it('voice stealing: nine notes at once do not exceed eight voices', async () => {
    const { send, run, e } = await load('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    send(...Array.from({ length: 9 }, (_, i) => [0, NOTE_ON, 50 + i, 100]))
    const out = run(20)
    expect(e.jig_active_voices()).toBe(8)
    expect(out.every(Number.isFinite)).toBe(true)
  })

  it('Phonetic reads SAM phoneme codes', async () => {
    const english = await load('hello')
    const phonetic = await load('/HEH3LOW2')
    phonetic.set('phonetic', 1)
    english.send([0, NOTE_ON, 60, 100])
    phonetic.send([0, NOTE_ON, 60, 100])
    expect(peak(english.run(80))).toBeGreaterThan(0.02)
    expect(peak(phonetic.run(80))).toBeGreaterThan(0.02)
    // The same codes read as English are gibberish, but the point is that the
    // switch changes what is read: a phoneme string spelt out is not "hello".
    const misread = await load('/HEH3LOW2')
    misread.send([0, NOTE_ON, 60, 100])
    expect(Array.from(misread.run(80))).not.toEqual(Array.from(phonetic.run(0)))
  })

  it('Level scales the output', async () => {
    const loud = await load('aaaaaaaaaa')
    const quiet = await load('aaaaaaaaaa')
    loud.set('level', 0.8)
    quiet.set('level', 0.2)
    loud.send([0, NOTE_ON, 60, 100])
    quiet.send([0, NOTE_ON, 60, 100])
    const ratio = peak(loud.run(60)) / peak(quiet.run(60))
    expect(ratio).toBeGreaterThan(3.5)
    expect(ratio).toBeLessThan(4.5)
  })

  it('Tone at the top of its range is open, below it softens', async () => {
    const open = await load('sssssssss')
    const soft = await load('sssssssss')
    open.set('tone', 12000)
    soft.set('tone', 1000)
    open.send([0, NOTE_ON, 60, 100])
    soft.send([0, NOTE_ON, 60, 100])
    const brightness = out => {
      let diff = 0
      for (let i = 1; i < out.length; i++) diff += Math.abs(out[i] - out[i - 1])
      return diff / (out.reduce((s, v) => s + Math.abs(v), 0) + 1e-9)
    }
    expect(brightness(open.run(60))).toBeGreaterThan(brightness(soft.run(60)) * 1.5)
  })

  it('an out of range parameter is clamped, not trusted', async () => {
    const { send, run, e } = await load('Hello world')
    for (const symbol of Object.keys(P)) {
      e.jig_set_param(P[symbol], 1e9)
      e.jig_set_param(P[symbol], -1e9)
      e.jig_set_param(P[symbol], NaN)
    }
    e.jig_set_param(9999, 1)
    for (const symbol of ['mode', 'speed', 'pitch', 'mouth', 'throat', 'monotone', 'phonetic', 'midi_ch',
      'advance', 'transpose', 'release', 'step', 'start_bar', 'loop', 'tone', 'level']) {
      e.jig_set_param(P[symbol], profile.ports.find(p => p.symbol === symbol).default)
    }
    send([0, NOTE_ON, 60, 100])
    expect(run(40).every(Number.isFinite)).toBe(true)
  })
})

describeBuilt('transport mode', () => {
  // 120 bpm at 48 kHz: one beat is 24000 frames, a quantum is 128 frames.
  const BPM = 120
  const FRAMES_PER_BEAT = RATE * 60 / BPM

  /** Advance the module along the timeline, filling the transport per block. */
  function player (m, { startBeat = 0, size = 128, bpm = BPM } = {}) {
    const framesPerBeat = RATE * 60 / bpm
    let beat = startBeat
    return {
      get beat () { return beat },
      /** Render blocks, returning every sample. `playing` false leaves the beat where it is. */
      play (blocks, { playing = true, extra = {} } = {}) {
        const samples = new Float32Array(blocks * size)
        for (let i = 0; i < blocks; i++) {
          m.setTransport({ playing, bpm, beat, beatsPerBar: 4, ...extra })
          m.e.jig_process(size)
          samples.set(m.output[0].subarray(0, size), i * size)
          if (playing) beat += size / framesPerBeat
        }
        return samples
      }
    }
  }

  const firstSound = (samples, threshold = 1e-4) => samples.findIndex(v => Math.abs(v) > threshold)

  it('is silent while the host is stopped', async () => {
    const m = await load('Hello world')
    m.set('mode', 1)
    expect(peak(player(m).play(200, { playing: false }))).toBe(0)
  })

  it('is silent when the host gives a tempo but no beat position', async () => {
    const m = await load('Hello world')
    m.set('mode', 1)
    let loudest = 0
    for (let i = 0; i < 200; i++) {
      m.setTransport({ playing: true, bpm: 120 })
      m.e.jig_process(128)
      loudest = Math.max(loudest, peak(m.output[0]))
    }
    expect(loudest).toBe(0)
  })

  it('speaks the first word at the start bar, not before', async () => {
    const m = await load('Hello world')
    m.set('mode', 1)
    m.set('start_bar', 2)       // beat 4 at 4/4
    const p = player(m)
    const out = p.play(Math.ceil(5 * FRAMES_PER_BEAT / 128))
    const first = firstSound(out)
    expect(first).toBeGreaterThan(0)
    // The word starts on the first frame at or after beat 4, then ramps in over 2 ms.
    expect(first).toBeGreaterThanOrEqual(4 * FRAMES_PER_BEAT)
    expect(first).toBeLessThan(4 * FRAMES_PER_BEAT + 0.05 * RATE)
  })

  it('lays words out one per step: the second word starts one step later', async () => {
    const m = await load('hello world')
    m.set('mode', 1)
    m.set('step', 3)            // 1/2: two beats per word
    m.set('loop', 0)
    const out = player(m).play(Math.ceil(8 * FRAMES_PER_BEAT / 128))
    const index = i => out.findIndex((v, k) => k >= i && Math.abs(v) > 1e-4)
    // Silence returns between the words (each is well under two beats = 1 s long).
    const gapStart = out.findIndex((v, k) => k > 4000 && Math.abs(v) < 1e-6)
    expect(gapStart).toBeGreaterThan(0)
    const second = index(gapStart)
    expect(second).toBeGreaterThanOrEqual(2 * FRAMES_PER_BEAT)
    expect(second).toBeLessThan(2 * FRAMES_PER_BEAT + 0.05 * RATE)
  })

  it('stops after one pass with Loop off, and repeats with Loop on', async () => {
    const run = async loop => {
      const m = await load('hi')
      m.set('mode', 1)
      m.set('step', 2)        // 1/4 = one beat
      m.set('loop', loop)
      const out = player(m).play(Math.ceil(6 * FRAMES_PER_BEAT / 128))
      return out
    }
    const once = await run(0)
    const looped = await run(1)
    const lateStart = 3 * FRAMES_PER_BEAT
    expect(peak(once.subarray(lateStart))).toBe(0)
    expect(peak(looped.subarray(lateStart))).toBeGreaterThan(0.02)
  })

  it('does not depend on how the host cuts its blocks', async () => {
    // The onset is the first frame at or after the step. Rounding to the
    // nearest frame would move it by one depending on the block size, and an
    // event compared by equality with a block edge would not fire at all.
    const render = async size => {
      const m = await load('Hello world. Again')
      m.set('mode', 1)
      m.set('step', 1)
      const p = player(m, { size })
      return p.play(Math.floor(4 * FRAMES_PER_BEAT / size), { })
    }
    const whole = await render(128)
    const halves = await render(64)
    const odd = await render(100)
    const n = Math.min(whole.length, halves.length, odd.length)
    expect(firstSound(halves)).toBe(firstSound(whole))
    expect(firstSound(odd)).toBe(firstSound(whole))
    let worst = 0
    for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(whole[i] - halves[i]))
    expect(worst).toBe(0)
  })

  it('does not depend on the block size when a step does not land on a whole frame', async () => {
    // At 120 bpm every step is a whole number of frames. At 133.37 bpm they are
    // not, and the output must still be the same sample for sample whatever the
    // host's block size, including one that is not a power of two. The test
    // below pins which frame an onset lands on.
    const bpm = 133.37
    const render = async size => {
      const m = await load('Hello world. Again')
      m.set('mode', 1)
      m.set('step', 0)
      return player(m, { size, bpm }).play(Math.floor(RATE * 4 / size), { })
    }
    const whole = await render(128)
    const small = await render(32)
    const odd = await render(50)
    const n = Math.min(whole.length, small.length, odd.length)
    for (const other of [small, odd]) {
      expect(firstSound(other)).toBe(firstSound(whole))
      let worst = 0
      for (let i = 0; i < n; i++) worst = Math.max(worst, Math.abs(whole[i] - other[i]))
      expect(worst).toBe(0)
    }
  })

  it('starts a word on the first frame at or after its step, not the nearest', async () => {
    // Step 0 is a quarter beat. At 20000.8 frames a beat the second word's
    // step is 5000.2 frames in: it starts on frame 5001, and the same text at
    // exactly 20004 frames a beat (a step of 5001.0) is the reference for what
    // starting on 5001 sounds like. Rounding to the nearest frame starts it on
    // 5000 and the two renders differ.
    const render = async framesPerBeat => {
      const m = await load('_ hello')
      m.set('mode', 1)
      m.set('step', 0)
      m.set('loop', 0)
      return player(m, { bpm: RATE * 60 / framesPerBeat }).play(100)
    }
    const fractional = await render(20000.8)
    const exact = await render(20004)
    expect(firstSound(exact)).toBeGreaterThan(5000)
    expect(firstSound(fractional)).toBe(firstSound(exact))
    expect(Array.from(fractional)).toEqual(Array.from(exact))
  })

  it('a word starting between two blocks fires in the block that contains it', async () => {
    // Start beat set so the first word begins mid-block, at a position that is
    // not a multiple of the quantum.
    const m = await load('Hello')
    m.set('mode', 1)
    const startBeat = -37.3 / FRAMES_PER_BEAT * 1       // 37.3 frames before beat 0
    const out = player(m, { startBeat }).play(40)
    const first = firstSound(out)
    expect(first).toBeGreaterThanOrEqual(38)
    expect(first).toBeLessThan(38 + 0.01 * RATE)
  })

  it('a locate into the middle of a word speaks the rest of it', async () => {
    const m = await load(VOWEL)      // a second or so
    m.set('mode', 1); m.set('step', 4); m.set('loop', 0)
    // Entered one beat (0.5 s) into the 4 beat slot: the word is already under way.
    const out = player(m, { startBeat: 1.0 }).play(20)
    expect(peak(out)).toBeGreaterThan(0.02)
    expect(firstSound(out)).toBeLessThan(4 * 128)
    // And what it speaks is the rest of the word, so it ends half a second sooner.
    const longer = await load(VOWEL)
    longer.set('mode', 1); longer.set('step', 4); longer.set('loop', 0)
    const whole = player(longer).play(Math.ceil(RATE * 3.5 / 128))
    const end = x => x.findLastIndex(v => Math.abs(v) > 1e-4)
    const rest = player(m, { startBeat: 1.0 }).play(Math.ceil(RATE * 3.5 / 128))
    expect(end(rest) / RATE).toBeCloseTo(end(whole) / RATE - 0.5, 1)
  })

  it('Speak plays one pass without the transport, then stops', async () => {
    const m = await load('hi there')
    m.set('mode', 1)
    m.set('step', 2)
    m.setTransport({ playing: false, bpm: 120, beat: 0, beatsPerBar: 4 })
    m.set('speak', 1)
    const blocks = Math.ceil(5 * FRAMES_PER_BEAT / 128)
    let heard = 0
    let lateHeard = 0
    for (let i = 0; i < blocks; i++) {
      m.setTransport({ playing: false, bpm: 120, beat: 0, beatsPerBar: 4 })
      m.e.jig_process(128)
      const p = peak(m.output[0])
      heard = Math.max(heard, p)
      if (i * 128 > 3.5 * FRAMES_PER_BEAT) lateHeard = Math.max(lateHeard, p)
    }
    expect(heard).toBeGreaterThan(0.02)
    expect(lateHeard).toBe(0)
  })

  it('reports the word being spoken, and 0 when idle', async () => {
    const m = await load('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bbbbbbbbbbbbbbbbbbbbbbbbbbbbbb')
    m.set('mode', 1)
    m.set('step', 4)
    const p = player(m)
    p.play(4)
    expect(m.e.jig_out_word()).toBe(1)
    const idle = await load('hello')
    idle.set('mode', 1)
    idle.setTransport({ playing: false, bpm: 120, beat: 0, beatsPerBar: 4 })
    idle.e.jig_process(128)
    expect(idle.e.jig_out_word()).toBe(0)
  })

  it('switching mode lets go of what the other mode started', async () => {
    const m = await load('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    m.send([0, NOTE_ON, 60, 100])
    m.run(10)
    expect(m.e.jig_active_voices()).toBe(1)
    m.set('mode', 1)
    m.run(10)
    expect(m.e.jig_active_voices()).toBe(0)
  })

  it('stopping the host fades the words out', async () => {
    const m = await load('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
    m.set('mode', 1)
    m.set('step', 5)
    const p = player(m)
    p.play(20)
    expect(m.e.jig_active_voices()).toBeGreaterThan(0)
    p.play(20, { playing: false })
    expect(m.e.jig_active_voices()).toBe(0)
  })
})

describeBuilt('the text', () => {
  it('counts whitespace separated words and folds newlines and tabs to spaces', async () => {
    const { e, setText } = await load()
    setText('one  two\nthree\tfour')
    expect(e.jig_word_count()).toBe(4)
    setText('   ')
    expect(e.jig_word_count()).toBe(0)
  })

  it('caps the word count at 512', async () => {
    const { e, setText } = await load()
    setText('a '.repeat(1000))
    expect(e.jig_word_count()).toBe(512)
  })

  it('has a buffer of 2000 bytes, which the processor clips to', async () => {
    const { e } = await load()
    expect(e.jig_text_capacity()).toBe(2000)
  })
})
