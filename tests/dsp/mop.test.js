// tests/dsp/mop.test.js
//
// Mop is a port of somebody else's synth, and almost every way it can break
// is two files disagreeing rather than one being wrong.
//
// The parameters are declared once in plugins/mop/profile.json, registered a
// second time in plugins/mop/mop-processor.js, and addressed a third time by
// index in plugins/mop/mop.cpp. Any one of the three can be re-derived while
// another is not, and nothing about that is visible: the symptom is a
// control that moves the wrong parameter. So the first half of this file
// binds the three lists to each other, and the second half renders audio,
// deterministically and offline, as AGENTS.md prefers.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseText } from '../../src/rdf/parse.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'

const dir = resolve(import.meta.dirname, '../../plugins/mop')
const read = name => readFileSync(resolve(dir, name), 'utf8')
const profile = JSON.parse(read('profile.json'))
const processorSource = read('mop-processor.js')

describe('the processor registers the parameters the profile declares', () => {
  // Read out of the source rather than imported: the file is an AudioWorklet
  // module and there is no AudioWorkletProcessor to extend under node. That
  // makes this a text match, so it also checks that the list is written in
  // the shape it is read in, which a mutation of either end breaks.
  const descriptors = [...processorSource.matchAll(
    /\{ name: '([a-z0-9_]+)', defaultValue: (-?[\d.]+), minValue: (-?[\d.]+), maxValue: (-?[\d.]+), automationRate: '([a-z-]+)' \}/g
  )].map(m => ({
    name: m[1], defaultValue: Number(m[2]), minValue: Number(m[3]), maxValue: Number(m[4]), rate: m[5]
  }))

  it('found the descriptor list, so the rest of this is not vacuous', () => {
    expect(descriptors.length).toBe(profile.ports.length)
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

  it('declares the module ABI the processor speaks', () => {
    // Abi2 rather than Abi1: percussion is MIDI channel 10, every control
    // answers to a CC, and bend and program change are per-channel messages,
    // none of which jig_note_on can express.
    expect(profile.abi).toBe('jig:Abi2')
    expect(profile.requires).toContain('jig:MidiEvents')
  })
})

describe('the program port carries the General MIDI presets', () => {
  const program = profile.ports.find(p => p.symbol === 'program')

  it('is an enumeration over all 128 programs', () => {
    expect(program.scalePoints.length).toBe(128)
    expect(program.scalePoints.map(sp => sp.value))
      .toEqual([...Array(128).keys()])
    for (const sp of program.scalePoints) {
      expect(sp.label.length, `program ${sp.value} has no name`).toBeGreaterThan(0)
    }
  })

  it('names the programs a General MIDI bank answers to', () => {
    const name = value => program.scalePoints[value].label
    expect(name(0)).toBe('Acoustic Grand Piano')
    expect(name(24)).toMatch(/nylon/i)
    expect(name(40)).toBe('Violin')
    expect(name(73)).toBe('Flute')
    expect(name(127)).toBe('Gunshot')
  })

  it('has no MIDI CC binding, because a program change is its control', () => {
    expect(program.controller).toBeUndefined()
  })
})

describe('every other control answers to a MIDI CC', () => {
  // What mop does not do on its own: its channel controllers are per-channel
  // performance messages, while these five panel parameters each take one
  // controller on any channel, as the profile declares.
  it('binds one controller per port, from CC 70 upward in parameter order', () => {
    const bound = profile.ports.filter(p => p.symbol !== 'program')
    expect(bound.map(p => [p.symbol, p.controller])).toEqual([
      ['voices', 70],
      ['gain', 71],
      ['bend_range', 72],
      ['tuning', 73],
      ['vel_sense', 74]
    ])
  })

  it('defaults to eight voices out of the eighteen the chip has', () => {
    const voices = profile.ports.find(p => p.symbol === 'voices')
    expect([voices.default, voices.minimum, voices.maximum]).toEqual([8, 1, 18])
  })
})

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------
// The plugin is a build artefact. Skipping rather than failing when it is
// absent keeps a fresh clone green, and the message says what to run.
const wasmPath = resolve(dir, 'mop.wasm')
const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/mop/mop.wasm not built; run plugins/mop/build.sh')

const RATE = 48000
const EVENT_BYTES = 8

/** A module, initialised, with the views the ABI says to take once. */
async function load () {
  const { instance } = await WebAssembly.instantiate(await readFile(wasmPath), {})
  const e = instance.exports
  e.jig_init(RATE)
  const frames = e.jig_max_frames()
  const midi = new DataView(e.memory.buffer, e.jig_midi_in_ptr(),
    e.jig_midi_in_capacity() * EVENT_BYTES)

  /** Write events for the next block and hand them over. */
  const send = (...events) => {
    events.forEach(([frame, ...bytes], i) => {
      const at = i * EVENT_BYTES
      midi.setUint32(at, frame, true)
      midi.setUint8(at + 4, bytes.length)
      for (let b = 0; b < 3; b++) midi.setUint8(at + 5 + b, bytes[b] ?? 0)
    })
    e.jig_midi_in(events.length)
  }

  const output = [0, 1].map(c => new Float32Array(e.memory.buffer, e.jig_output_ptr(c), frames))

  /** Render n blocks and return the loudest block's RMS. */
  const run = blocks => {
    let loudest = 0
    for (let i = 0; i < blocks; i++) {
      e.jig_process(frames)
      loudest = Math.max(loudest, rms(output[0]))
    }
    return loudest
  }

  return { e, frames, midi, send, output, run }
}

const rms = view => Math.sqrt(view.reduce((s, v) => s + v * v, 0) / view.length)

const NOTE_ON = 0x90
const NOTE_OFF = 0x80
const CONTROL_CHANGE = 0xb0
const PROGRAM_CHANGE = 0xc0
const PITCH_BEND = 0xe0
const ALL_NOTES_OFF = 123
const SUSTAIN = 64
const PERC_CHANNEL = 9      // MIDI channel 10, zero-based
const FLUTE = 73            // the most nearly sinusoidal timbre in the bank

/** Zero-crossing pitch estimate, in hertz. */
const pitchOf = (samples, rate = RATE) => {
  let crossings = 0
  for (let i = 1; i < samples.length; i++) {
    if ((samples[i - 1] < 0) !== (samples[i] < 0)) crossings++
  }
  return crossings / 2 / (samples.length / rate)
}

describeBuilt('the mop module', () => {
  it('instantiates with no imports at all', async () => {
    // docs/module-abi.md: a module declaring an ABI must require none. This
    // is why the build is clang with -nostdlib rather than Emscripten, and
    // an import creeping back in would fail at load in the worklet, which is
    // the wrong end to find out.
    const module = new WebAssembly.Module(await readFile(wasmPath))
    expect(WebAssembly.Module.imports(module)).toEqual([])
  })

  it('exports the version 2 surface its profile promises', async () => {
    const { e } = await load()
    for (const name of ['jig_init', 'jig_max_frames', 'jig_output_ptr', 'jig_process',
      'jig_set_param', 'jig_midi_in_ptr', 'jig_midi_in_capacity', 'jig_midi_in', 'memory']) {
      expect(e[name], `missing export ${name}`).toBeDefined()
    }
    expect(e.jig_max_frames()).toBe(profile.shape.renderQuantum)
  })

  it('does not export the version 1 note entry points', async () => {
    // A host that finds both must use the event buffer, and one that does
    // not would sound every note twice. Not exporting them removes the
    // choice.
    const { e } = await load()
    expect(e.jig_note_on).toBeUndefined()
    expect(e.jig_note_off).toBeUndefined()
  })

  it('is silent before anything is played', async () => {
    const { run } = await load()
    expect(run(40)).toBe(0)
  })

  it('sounds a note in the very first block', async () => {
    const { send, run, e } = await load()
    send([0, NOTE_ON, 60, 100])
    expect(run(30)).toBeGreaterThan(0.005)
    expect(e.jig_active_voices()).toBe(1)
  })

  it('plays the pitch it was asked for', async () => {
    // Through the flute, whose output is near enough a sine that a
    // zero-crossing count says which note was meant. Ten cents is far below
    // what the chip's 10-bit f-number can miss by.
    const { e, frames, send, output } = await load()
    send([0, PROGRAM_CHANGE, FLUTE, 0])
    e.jig_process(frames)
    send([0, NOTE_ON, 72, 100])    // C5 = 523.25 Hz
    const captured = []
    for (let i = 0; i < 60; i++) {
      e.jig_process(frames)
      captured.push(...output[0])
    }
    const steady = captured.slice(128 * 20)
    const cents = Math.abs(1200 * Math.log2(pitchOf(steady) / 523.25))
    expect(cents).toBeLessThan(25)
  })

  it('takes percussion on channel 10', async () => {
    const { send, run, e } = await load()
    send([0, NOTE_ON | PERC_CHANNEL, 36, 110])     // bass drum
    expect(run(40)).toBeGreaterThan(0.005)
    expect(e.jig_active_voices()).toBe(1)
  })

  it('treats a note on at velocity zero as a note off', async () => {
    // Every MIDI source does this, and a synth that ignores it sustains for
    // ever.
    const { send, run, e, frames } = await load()
    send([0, NOTE_ON, 60, 100])
    expect(run(30)).toBeGreaterThan(0.005)
    send([0, NOTE_ON, 60, 0])
    e.jig_process(frames)
    expect(e.jig_active_voices()).toBe(0)
  })

  it('silences everything on all notes off', async () => {
    const { send, run, e, frames } = await load()
    send([0, NOTE_ON, 55, 100], [0, NOTE_ON, 59, 100], [0, NOTE_ON, 62, 100])
    expect(run(30)).toBeGreaterThan(0.005)
    send([0, CONTROL_CHANGE, ALL_NOTES_OFF, 0])
    e.jig_process(frames)
    expect(e.jig_active_voices()).toBe(0)
  })

  it('holds a note under the sustain pedal and releases it after', async () => {
    const { send, run, e } = await load()
    send([0, NOTE_ON, 60, 100])
    expect(run(20)).toBeGreaterThan(0.005)
    send([0, CONTROL_CHANGE, SUSTAIN, 127])
    e.jig_process(128)
    send([0, NOTE_OFF, 60, 0])
    e.jig_process(128)
    expect(e.jig_active_voices()).toBe(1)
    send([0, CONTROL_CHANGE, SUSTAIN, 0])
    e.jig_process(128)
    expect(e.jig_active_voices()).toBe(0)
  })

  it('caps polyphony at eight voices by default, stealing the oldest', async () => {
    const { send, run, e } = await load()
    send(...[60, 62, 64, 65, 67, 69, 71, 72, 74, 76].map((n, i) => [i, NOTE_ON, n, 100]))
    expect(run(30)).toBeGreaterThan(0.005)
    expect(e.jig_active_voices()).toBe(8)
  })

  it('widens the cap when told to, up to the eighteen the chip has', async () => {
    const { send, run, e } = await load()
    e.jig_set_param(1, 18)
    send(...[60, 62, 64, 65, 67, 69, 71, 72, 74, 76].map((n, i) => [i, NOTE_ON, n, 100]))
    run(30)
    expect(e.jig_active_voices()).toBe(10)
  })

  it('narrows the cap from a MIDI CC, on any channel', async () => {
    // CC 70 is the voices binding the profile declares. Zero is the bottom
    // of the control, which is one voice.
    const { send, run, e } = await load()
    send([0, CONTROL_CHANGE | 3, 70, 0])
    e.jig_process(128)
    send([0, NOTE_ON, 60, 100], [1, NOTE_ON, 64, 100])
    run(30)
    expect(e.jig_active_voices()).toBe(1)
  })

  it('routes a program change to one channel and never to the drums', async () => {
    const { send, e, frames } = await load()
    send([0, PROGRAM_CHANGE, 40, 0])          // violin, channel 1
    e.jig_process(frames)
    expect(e.jig_channel_program(0)).toBe(40)
    expect(e.jig_channel_program(1)).toBe(0)
    send([0, PROGRAM_CHANGE | PERC_CHANNEL, 40, 0])
    e.jig_process(frames)
    expect(e.jig_channel_program(PERC_CHANNEL)).toBe(0)
  })

  it('sets every melodic channel from the program parameter', async () => {
    const { e } = await load()
    e.jig_set_param(0, 73)
    for (let ch = 0; ch < 16; ch++) {
      expect(e.jig_channel_program(ch)).toBe(ch === PERC_CHANNEL ? 0 : 73)
    }
  })

  it('bends a sounding note up when told to', async () => {
    const { e, frames, send, output } = await load()
    send([0, PROGRAM_CHANGE, FLUTE, 0])
    e.jig_process(frames)
    send([0, NOTE_ON, 72, 100])
    for (let i = 0; i < 30; i++) e.jig_process(frames)
    const before = []
    for (let i = 0; i < 20; i++) {
      e.jig_process(frames)
      before.push(...output[0])
    }
    // Half of a full upward bend: one semitone at the default range of two.
    send([0, PITCH_BEND, 0, 96])
    for (let i = 0; i < 5; i++) e.jig_process(frames)
    const after = []
    for (let i = 0; i < 20; i++) {
      e.jig_process(frames)
      after.push(...output[0])
    }
    expect(pitchOf(after)).toBeGreaterThan(pitchOf(before) * 1.03)
  })

  it('applies an event in the block that contains it, not at a boundary', async () => {
    // AGENTS.md: an event fires in the block that contains it, located by
    // position and never by equality with a quantum boundary. Frame 77 is
    // not a multiple of anything.
    const { send, run } = await load()
    send([77, NOTE_ON, 60, 100])
    expect(run(30)).toBeGreaterThan(0.005)
  })

  it('renders the same audio twice from the same events', async () => {
    // Offline and deterministic, which is why AGENTS.md prefers this to a
    // device. A render that differs run to run cannot be regression tested
    // at all.
    const take = async () => {
      const { send, e, frames, output } = await load()
      send([0, PROGRAM_CHANGE, 40, 0])
      e.jig_process(frames)
      send([0, NOTE_ON, 60, 100], [40, NOTE_ON | PERC_CHANNEL, 38, 100])
      const captured = []
      for (let i = 0; i < 60; i++) {
        e.jig_process(frames)
        captured.push(...output[0])
      }
      return captured
    }
    expect(await take()).toEqual(await take())
  })

  it('puts signal on both stereo channels', async () => {
    const { send, e, frames, output } = await load()
    send([0, NOTE_ON, 60, 100])
    for (let i = 0; i < 30; i++) e.jig_process(frames)
    expect(rms(output[0])).toBeGreaterThan(0.005)
    expect(rms(output[1])).toBeGreaterThan(0.005)
  })

  it('never grows its memory, so the host may hold its views', async () => {
    // The ABI forbids it after jig_init because a host holds the pointers it
    // took, and in a browser a view over a grown memory is zero length:
    // silence, with no exception to notice.
    const { e, send, frames } = await load()
    const before = e.memory.buffer.byteLength
    send([0, NOTE_ON, 60, 100])
    for (let i = 0; i < 200; i++) e.jig_process(frames)
    expect(e.memory.buffer.byteLength).toBe(before)
  })
})

describeBuilt('the committed profile describes the files on disk', () => {
  it('carries the digest of the wasm and the processor that are there', async () => {
    const { digestOf } = await import('../../src/host/Integrity.js')
    const parsed = readProfile(await parseText(read('profile.ttl'), 'urn:jigdaw:test'))
    expect(parsed.module.integrity)
      .toBe(await digestOf(new Uint8Array(await readFile(wasmPath))))
    expect(parsed.processor.integrity)
      .toBe(await digestOf(new Uint8Array(await readFile(resolve(dir, 'mop-processor.js')))))
  })

  it('binds the controllers the module answers to', async () => {
    const parsed = readProfile(await parseText(read('profile.ttl'), 'urn:jigdaw:test'))
    const controller = symbol => parsed.ports.find(p => p.symbol === symbol).controller
    expect([controller('voices'), controller('gain'), controller('bend_range'),
      controller('tuning'), controller('vel_sense')]).toEqual([70, 71, 72, 73, 74])
    expect(parsed.ports.find(p => p.symbol === 'program').controller).toBeNull()
  })
})
