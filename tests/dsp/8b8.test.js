// tests/dsp/8b8.test.js
//
// The 8-Bit 8asterd is a port of somebody else's firmware, and almost every
// way it can break is two files disagreeing rather than one being wrong.
//
// The parameter definition lives in the 8bit8asterd repository, as the PARAMS
// list its generate.py turns into the firmware's parameters.h. Here it is
// vendored as params.json, and four things are derived from it: the ports in
// profile.json, the scale table the module converts with, the descriptors the
// processor registers, and the firmware's own parameters.h, which came from
// the other end of the same generator. Any one of them can be re-derived
// while another is not, and nothing about that is visible: the symptom is a
// control that moves the wrong parameter.
//
// So the first half of this file binds the five lists to each other, and the
// second half renders audio, deterministically and offline, as AGENTS.md
// prefers.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseText } from '../../src/rdf/parse.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'

const dir = resolve(import.meta.dirname, '../../plugins/8b8')
const read = name => readFileSync(resolve(dir, name), 'utf8')
const json = name => JSON.parse(read(name))

const { params, layoutVersion } = json('params.json')
const profile = json('profile.json')
const processorSource = read('8b8-processor.js')

/** Pull one `static const uint8_t NAME[...] = { ... };` table out of a header. */
function headerTable (source, name) {
  const match = source.match(new RegExp(`${name}\\[[^\\]]*\\][^=]*=\\s*{([^}]*)}`))
  if (!match) throw new Error(`no ${name} table in the header`)
  return match[1].split(',').map(s => s.trim()).filter(Boolean).map(Number)
}

/** `P_BUZZ_ENABLE = 0,  // Buzzy Bass: Enable [0..1] default 0` */
function headerEnum (source) {
  return [...source.matchAll(/P_([A-Z0-9_]+) = (\d+),\s*\/\/ (.+?) \[(\d+)\.\.(\d+)\] default (\d+)/g)]
    .map(m => ({
      symbol: m[1].toLowerCase(),
      index: Number(m[2]),
      name: m[3],
      min: Number(m[4]),
      max: Number(m[5]),
      default: Number(m[6])
    }))
}

describe('the vendored firmware and the parameter definition are one generation', () => {
  const header = read('firmware/parameters.h')

  it('agrees on how many parameters there are', () => {
    expect(header).toMatch(/#define NUM_PARAMS 42/)
    expect(params.length).toBe(42)
  })

  // generate.py hashes the whole definition into this byte, and the firmware
  // refuses an EEPROM bank saved under a different one. It is the closest
  // thing to a version number the definition has, so a params.json re-read
  // without a re-copied header, or the reverse, shows up here first.
  it('agrees on the layout version generate.py derived', () => {
    const declared = header.match(/#define PARAM_LAYOUT_VERSION (0x[0-9A-Fa-f]+)/)
    expect(declared, 'no PARAM_LAYOUT_VERSION in the vendored header').not.toBeNull()
    expect(Number(declared[1])).toBe(layoutVersion)
  })

  it('agrees on every range and default', () => {
    expect(headerTable(header, 'PARAM_MIN')).toEqual(params.map(p => p.min))
    expect(headerTable(header, 'PARAM_MAX')).toEqual(params.map(p => p.max))
    expect(headerTable(header, 'PARAM_DEFAULT')).toEqual(params.map(p => p.default))
  })

  it('agrees on every name, index and group', () => {
    const declared = headerEnum(header)
    expect(declared.length, 'the header enum did not parse').toBe(params.length)
    expect(declared.map(p => [p.index, p.symbol, p.name]))
      .toEqual(params.map(p => [p.index, p.key, `${p.group}: ${p.label}`]))
  })
})

describe('the profile describes the parameters the firmware has', () => {
  // The port carries the displayed value, not the firmware's byte: raw 0 to
  // 48 is minus 24 to plus 24 semitones. This is generate.py's own formula,
  // written out a second time on purpose. make.js computing the ports and
  // this checking them with the same expression would agree about a wrong
  // formula, but not about a port that was not regenerated.
  const display = (raw, p) => Number(((raw + p.offset) * p.scale).toFixed(6))

  it('declares one port per parameter, in index order', () => {
    expect(profile.ports.map(p => p.symbol)).toEqual(params.map(p => p.key))
    expect(profile.ports.map(p => p.paramIndex)).toEqual(params.map(p => p.index))
  })

  it('groups the ports under the hardware\'s own sections', () => {
    // The 42 controls flat are not navigable; the generated panel sections
    // them by the group each parameter carries in the definition.
    expect(profile.ports.map(p => p.group)).toEqual(params.map(p => p.group))
  })

  it('declares the displayed range of each one', () => {
    for (const p of params) {
      const port = profile.ports[p.index]
      expect([port.symbol, port.minimum]).toEqual([p.key, display(p.min, p)])
      expect([port.symbol, port.maximum]).toEqual([p.key, display(p.max, p)])
      expect([port.symbol, port.default]).toEqual([p.key, display(p.default, p)])
    }
  })

  it('gives every enumerated parameter its options, and nothing else any', () => {
    for (const p of params) {
      const port = profile.ports[p.index]
      if (p.kind === 'enum') {
        expect(port.scalePoints, `${p.key} lost its options`)
          .toEqual(p.options.map((label, value) => ({ label, value })))
      } else {
        expect(port.scalePoints, `${p.key} is not enumerated`).toBeUndefined()
      }
      expect(Boolean(port.toggled), `${p.key} toggled`).toBe(p.kind === 'toggle')
    }
  })

  it('carries the module ABI the processor and the adapter both need', () => {
    // Abi2 rather than Abi1: percussion is MIDI channel 10 and every control
    // answers to a CC, neither of which jig_note_on can express.
    expect(profile.abi).toBe('jig:Abi2')
    expect(profile.requires).toContain('jig:MidiEvents')
  })
})

describe('the module converts with the same table the profile was built from', () => {
  const header = read('generated/param-map.h')

  it('has a row per parameter, with its scale and offset', () => {
    expect(header).toMatch(new RegExp(`#define JIG_PARAM_COUNT ${params.length}\\b`))
    const rows = [...header.matchAll(/\{ ([-\d.]+)f, (-?\d+) \}/g)]
      .map(m => [Number(m[1]), Number(m[2])])
    expect(rows).toEqual(params.map(p => [p.scale, p.offset]))
  })

  it('carries the same layout version, so a stale header is visible', () => {
    const declared = header.match(/#define JIG_PARAM_LAYOUT_VERSION (0x[0-9A-Fa-f]+)/)
    expect(Number(declared[1])).toBe(layoutVersion)
  })
})

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
    expect(descriptors.length).toBe(params.length)
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
})

// ---------------------------------------------------------------------------
// The module
// ---------------------------------------------------------------------------
// The plugin is a build artefact. Skipping rather than failing when it is
// absent keeps a fresh clone green, and the message says what to run.
const wasmPath = resolve(dir, '8b8.wasm')
const built = existsSync(wasmPath)
const describeBuilt = built ? describe : describe.skip
if (!built) console.warn('plugins/8b8/8b8.wasm not built; run plugins/8b8/build.sh')

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
const ALL_NOTES_OFF = 123
const PERC_CHANNEL = 9      // MIDI channel 10, one-based

/** The frequency the chip is programmed for, from its tone period registers. */
const toneHz = (e, chip) => {
  const period = e.jig_x_register(chip, 0) | (e.jig_x_register(chip, 1) << 8)
  return 1000000 / (16 * period)   // the datasheet's clock / (16 * period)
}

/**
 * How far apart two pitches are, in cents.
 *
 * The comparison is in cents rather than in hertz because a tone period is
 * an integer: the chip cannot be in tune, only near. At the top of the range
 * the nearest available period is several hertz off, which says nothing
 * about whether the right note was played. Ten cents is a fifth of the
 * smallest interval the firmware's temperament tables move a note by.
 */
const cents = (a, b) => Math.abs(1200 * Math.log2(a / b))

describeBuilt('the 8b8 module', () => {
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

  it('sounds a note in the very first block, at the pitch it was asked for', async () => {
    // The first block on purpose. The firmware flushes its register cache on
    // a 100Hz tick and ends its startup by invalidating that cache, so a
    // note arriving before the first flush used to reach the chip with only
    // half its tone period written: middle C came out at under a hertz. On
    // hardware USB enumeration hides it; a host that calls jig_init and then
    // jig_process with an event does not. The module renders the boot period
    // in jig_init so that the flush has happened.
    const { e, send, run } = await load()
    send([0, NOTE_ON, 60, 100])
    expect(run(30)).toBeGreaterThan(0.01)

    // Read from the chip's tone period rather than from the audio: the
    // register says which note was meant even when the mixer or the
    // envelope is wrong, and it is exact where a spectrum estimate is not.
    expect(cents(toneHz(e, 0), 261.63)).toBeLessThan(10)
  })

  it('takes percussion on channel 10 and pitched notes on the others', async () => {
    const { send, run } = await load()
    send([0, NOTE_ON | PERC_CHANNEL, 36, 110])     // bass drum
    expect(run(40)).toBeGreaterThan(0.01)
  })

  it('ignores a pitched note outside the range the firmware accepts', async () => {
    const { send, run } = await load()
    send([0, NOTE_ON, 12, 100])     // below MIDI_MIN, which is 24
    expect(run(40)).toBe(0)
  })

  it('falls silent after a note off', async () => {
    const { send, run } = await load()
    send([0, NOTE_ON, 60, 100])
    expect(run(30)).toBeGreaterThan(0.01)
    send([0, NOTE_OFF, 60, 0])
    run(400)                       // through the release and the DC filter
    expect(run(10)).toBeLessThan(1e-6)
  })

  it('treats a note on at velocity zero as a note off', async () => {
    // Every MIDI source does this, and a synth that ignores it sustains for
    // ever. The firmware handles it; this checks the events reach the part
    // of it that does.
    const { send, run } = await load()
    send([0, NOTE_ON, 60, 100])
    expect(run(30)).toBeGreaterThan(0.01)
    send([0, NOTE_ON, 60, 0])
    run(400)
    expect(run(10)).toBeLessThan(1e-6)
  })

  it('silences everything on all notes off', async () => {
    const { send, run } = await load()
    send([0, NOTE_ON, 55, 100], [0, NOTE_ON, 59, 100], [0, NOTE_ON, 62, 100])
    expect(run(30)).toBeGreaterThan(0.01)
    send([0, CONTROL_CHANGE, ALL_NOTES_OFF, 0])
    run(400)
    expect(run(10)).toBeLessThan(1e-6)
  })

  it('stays silent for a long time after a panic, rather than banging later', async () => {
    // The firmware's softReset() silences its voices and then reinitialises
    // the chips, which leaves all nine amplitude registers at 0xFF: the M
    // bit set, so every channel's volume follows the envelope generator, at
    // a period of 0xFFFF. That is a sixteen second ramp to full scale,
    // arriving as a bang about seventeen seconds after the message a host
    // sends to make everything stop. It measured 0.93 RMS before the module
    // put the chips back where boot leaves them.
    //
    // Twenty five seconds of render, which is slow for a unit test and is
    // the only length at which the failure is visible at all.
    const { send, run } = await load()
    send([0, NOTE_ON, 60, 100])
    run(30)
    send([0, CONTROL_CHANGE, ALL_NOTES_OFF, 0])
    run(400)                                     // through the release
    expect(run(Math.round(25 * RATE / 128))).toBeLessThan(1e-6)
  }, 30000)

  it('stays silent when left alone, for the same reason', async () => {
    const { run } = await load()
    expect(run(Math.round(25 * RATE / 128))).toBe(0)
  }, 30000)

  it('applies an event in the block that contains it, not at a boundary', async () => {
    // AGENTS.md: an event fires in the block that contains it, located by
    // position and never by equality with a quantum boundary. Frame 77 is
    // not a multiple of anything.
    const { send, run } = await load()
    send([77, NOTE_ON, 60, 100])
    expect(run(30)).toBeGreaterThan(0.01)
  })

  it('takes a parameter as the port declares it, not as the firmware stores it', async () => {
    const { e } = await load()
    const index = profile.ports.findIndex(p => p.symbol === 'transpose')
    const raw = params[index]

    // Minus 24 to plus 24 semitones on the port, 0 to 48 in the firmware.
    for (const [shown, stored] of [[-24, 0], [0, 24], [12, 36], [24, 48]]) {
      e.jig_set_param(index, shown)
      expect(e.jig_x_param(index), `transpose ${shown}`).toBe(stored)
    }
    expect([raw.min, raw.max, raw.default]).toEqual([0, 48, 24])
  })

  it('clamps a parameter outside its range rather than wrapping it', async () => {
    // The bank is bytes, so a value that wrapped would land somewhere
    // musically arbitrary instead of at the end of the control.
    const { e } = await load()
    const index = profile.ports.findIndex(p => p.symbol === 'transpose')
    e.jig_set_param(index, 1000)
    expect(e.jig_x_param(index)).toBe(48)
    e.jig_set_param(index, -1000)
    expect(e.jig_x_param(index)).toBe(0)
  })

  it('transposes what it plays when told to', async () => {
    const { e, send, run } = await load()
    const index = profile.ports.findIndex(p => p.symbol === 'transpose')
    e.jig_set_param(index, 12)
    send([0, NOTE_ON, 60, 100])
    run(30)
    // An octave up halves the period.
    expect(cents(toneHz(e, 0), 523.25)).toBeLessThan(10)
  })

  it('still plays in tune after a parameter change in the same block', async () => {
    // The register cache's invalidate-then-flush window again, this time
    // reachable at any point in a session rather than only at startup: any
    // parameter change invalidates, and a note landing before the flush
    // loses whichever byte of its tone period matches the complement. Middle
    // C's high byte is one of them, so this plays it after touching an
    // unrelated control.
    const { e, send, run } = await load()
    e.jig_set_param(profile.ports.findIndex(p => p.symbol === 'mix_tone'), 15)
    send([0, NOTE_ON, 60, 100])
    run(30)
    expect(cents(toneHz(e, 0), 261.63)).toBeLessThan(10)
  })

  it('applies a parameter rather than only storing it', async () => {
    // The firmware recomputes its LFO steps, warp interval and held note
    // tuning in recalcDerived(), which its own CC and serial handlers call
    // after every setParam. Changing the temperament retunes a sounding
    // note, so a parameter that was stored and not applied shows up as a
    // pitch that did not move.
    const { e, send, run } = await load()
    send([0, NOTE_ON, 61, 100])          // C sharp, where temperaments differ
    run(20)
    const before = toneHz(e, 0)
    // Five limit just intonation, rooted on C: the third row of the
    // firmware's table, which puts C sharp 27 cents above equal.
    e.jig_set_param(profile.ports.findIndex(p => p.symbol === 'temperament'), 2)
    run(20)
    expect(cents(toneHz(e, 0), before)).toBeGreaterThan(5)
  })

  it('renders the same audio twice from the same events', async () => {
    // Offline and deterministic, which is why AGENTS.md prefers this to a
    // device. A render that differs run to run cannot be regression tested
    // at all, and the firmware's Chaos and Warp are driven by counters that
    // could easily have been a clock.
    const take = async () => {
      const { send, e, frames, output } = await load()
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

  it('puts the same mono signal on both channels', async () => {
    const { send, e, frames, output } = await load()
    send([0, NOTE_ON, 60, 100])
    for (let i = 0; i < 30; i++) e.jig_process(frames)
    expect(Array.from(output[1])).toEqual(Array.from(output[0]))
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
      .toBe(await digestOf(new Uint8Array(await readFile(resolve(dir, '8b8-processor.js')))))
  })

  it('binds one controller per port, from CC 70 upward in parameter order', async () => {
    // What the hardware does, declared per port so a host can label each
    // control with its controller instead of reading the caution.
    const parsed = readProfile(await parseText(read('profile.ttl'), 'urn:jigdaw:test'))
    for (const p of params) {
      const port = parsed.ports.find(q => q.symbol === p.key)
      expect(port.controller, p.key).toBe(70 + p.index)
    }
  })
})
