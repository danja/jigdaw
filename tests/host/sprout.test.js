// tests/host/sprout.test.js
//
// Sprout through the real loader and engine, driven by transport messages as the host sends them.
// The expected lines are worked out here by an independent turtle and scale table, so the
// processor's tables are compared with a second reading of docs/scales.md and the grammars rather
// than with themselves.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const CANONICAL = `${ORIGIN}plugins/sprout/`
const SAMPLE_RATE = 48000
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function makeEngine (validator) {
  const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
  const context = new OfflineContext({ sampleRate: SAMPLE_RATE })
  const loader = new PluginLoader({
    fetch: site.fetch, parse: parseText, validator,
    capabilities: detectCapabilities({}), processorUrl: site.processorUrl
  })
  const engine = new Engine({ context, loader, AudioWorkletNode: OfflineWorkletNode })
  engine.testLoader = loader
  return engine
}

async function load (validator, settings = {}) {
  const engine = makeEngine(validator)
  const entry = await engine.addPlugin(CANONICAL)
  for (const [symbol, value] of Object.entries(settings)) engine.setParameter(entry.id, symbol, value)
  return { engine, entry, node: entry.node }
}

const roll = (node, { tempo = 120, beat = 0, playing = true, beatsPerBar = 4, beatUnit = 4 } = {}) => {
  node.port.postMessage({
    type: 'transport', playing, frame: node.frame, beat, tempo,
    beatsPerFrame: tempo / (60 * SAMPLE_RATE), timeSignature: { beatsPerBar, beatUnit }, loop: null
  })
}

/** Render `blocks` quanta and return the MIDI the processor emitted, as [frame, status, d1, d2]. */
async function render (node, blocks) {
  await settle()
  const before = node.processor.port.posted.length
  for (let i = 0; i < blocks; i++) node.render()
  await settle()
  return node.processor.port.posted.slice(before)
    .filter(m => m.type === 'events')
    .flatMap(m => m.events.map(e => [e.frame, ...Array.from(e.bytes)]))
}

const QUARTER = 24000 // frames at 120 bpm
const blocksFor = quarters => Math.ceil((quarters * QUARTER) / 128) + 1
const ons = events => events.filter(e => (e[1] & 0xf0) === 0x90 && e[3] > 0)
const offs = events => events.filter(e => (e[1] & 0xf0) === 0x80)

// An independent reading of the Koch grammar and the turtle, for the expected line.
function kochUnits (generations) {
  let s = 'F'
  for (let g = 0; g < generations; g++) s = [...s].map(c => (c === 'F' ? 'F+F-F-F+F' : c)).join('')
  const units = []
  let unit = 0
  for (const c of s) {
    if (c === 'F') units.push(unit)
    else if (c === '+') unit += 1
    else if (c === '-') unit -= 1
  }
  return units
}
const MAJOR = [0, 2, 4, 5, 7, 9, 11]
const majorNote = (root, degree) => root + 12 * Math.floor(degree / 7) + MAJOR[((degree % 7) + 7) % 7]

describe('sprout, an L-system MIDI generator', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares MIDI out and the host transport, no module', async () => {
    const { engine } = await load(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    expect(profile.label).toBe('Sprout')
    expect(profile.module).toBeNull()
    expect(profile.requires).toEqual(expect.arrayContaining([
      'http://purl.org/stuff/jigdaw/MidiOut', 'http://purl.org/stuff/transmissions/HostTransport'
    ]))
  })

  it('binds the processor descriptors to the profile ports', async () => {
    const { engine, node } = await load(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    const descriptors = node.processor.constructor.parameterDescriptors
    expect(descriptors.map(d => d.name).sort()).toEqual(profile.ports.map(p => p.symbol).sort())
    for (const port of profile.ports) {
      const d = descriptors.find(x => x.name === port.symbol)
      expect([d.defaultValue, d.minValue, d.maxValue]).toEqual([port.defaultValue, port.minimum, port.maximum])
    }
  })

  it('says nothing until the transport is rolling', async () => {
    const { node } = await load(validator)
    expect(await render(node, 400)).toEqual([])
    roll(node, { playing: false })
    expect(await render(node, 400)).toEqual([])
  })

  it('plays the Koch curve as a scale-quantised line on the step grid', async () => {
    const { node } = await load(validator, { preset: 1, generations: 1, scale: 1, root: 60 })
    roll(node)
    const events = await render(node, blocksFor(1.25))
    const expectedUnits = kochUnits(1) // [0, 1, 0, -1, 0]
    expect(expectedUnits).toEqual([0, 1, 0, -1, 0])
    const played = ons(events).slice(0, 5)
    expect(played.map(e => e[2])).toEqual(expectedUnits.map(u => majorNote(60, u)))
    // One sixteenth apart, exactly: a sixteenth at 120 bpm is 6000 frames.
    expect(played.map(e => e[0])).toEqual([0, 6000, 12000, 18000, 24000])
    // Gate 0.7 of a step: 4200 frames after each note-on, on the same note.
    for (const on of played.slice(0, 4)) {
      const off = offs(events).find(e => e[2] === on[2] && e[0] > on[0])
      expect(off[0] - on[0]).toBe(4200)
    }
    // Accent on the first step of the pattern, then the base velocity.
    expect(played[0][3]).toBe(100)
    expect(played[1][3]).toBe(90)
  })

  it('is the same line however the stream is cut into blocks and wherever it is joined', async () => {
    const a = await load(validator, { preset: 0, generations: 3, seed: 7, probability: 0.6 })
    roll(a.node)
    const whole = ons(await render(a.node, blocksFor(8))).map(e => [e[0], e[2]])

    // Join the same stream partway through: transport already at beat 4 when the plugin starts listening.
    const b = await load(validator, { preset: 0, generations: 3, seed: 7, probability: 0.6 })
    roll(b.node, { beat: 4 })
    const later = ons(await render(b.node, blocksFor(4))).map(e => [e[0] + 4 * QUARTER, e[2]])
    const expected = whole.filter(([frame]) => frame >= 4 * QUARTER && frame < 8 * QUARTER)
    expect(later.filter(([frame]) => frame < 8 * QUARTER)).toEqual(expected)
    expect(expected.length).toBeGreaterThan(0)
  })

  it('applies probability by a seeded draw, and probability 0 plays nothing', async () => {
    const half = await load(validator, { preset: 6, generations: 3, probability: 0.5 })
    roll(half.node)
    const some = ons(await render(half.node, blocksFor(8)))
    const all = await load(validator, { preset: 6, generations: 3, probability: 1 })
    roll(all.node)
    const every = ons(await render(all.node, blocksFor(8)))
    expect(some.length).toBeGreaterThan(0)
    expect(some.length).toBeLessThan(every.length)
    const none = await load(validator, { preset: 6, generations: 3, probability: 0 })
    roll(none.node)
    expect(ons(await render(none.node, blocksFor(8)))).toEqual([])
  })

  it('releases a sounding note when the transport stops, jumps or loops back', async () => {
    const { node } = await load(validator, { preset: 1, generations: 1, gate: 1, grid: 8 }) // quarter-note grid, full gate
    roll(node)
    // Half way through the first note: it has been struck and not yet released.
    const early = await render(node, 100)
    expect(ons(early)).toHaveLength(1)
    expect(offs(early)).toHaveLength(0)
    roll(node, { playing: false })
    const stopped = await render(node, 2)
    expect(offs(stopped)).toHaveLength(1)

    // And a jump backwards while rolling.
    roll(node, { beat: 0 })
    await render(node, 100)
    roll(node, { beat: 40 }) // far from where the stream was heading
    const jumped = await render(node, 2)
    expect(offs(jumped).length).toBeGreaterThanOrEqual(1)
  })

  it('grows one generation every N bars and restarts the pattern at each change', async () => {
    const { node } = await load(validator, { preset: 1, generations: 3, grow_bars: 1 }) // 1/16 grid: 16 steps a bar
    roll(node)
    const events = ons(await render(node, blocksFor(16)))
    const bar = n => events.filter(e => e[0] >= n * 4 * QUARTER && e[0] < (n + 1) * 4 * QUARTER).map(e => e[2])
    const line = (generation, from) => {
      const units = kochUnits(generation)
      return Array.from({ length: 16 }, (_, i) => majorNote(60, units[(from + i) % units.length]))
    }
    // Bar 0 is generation 1, a five-step line that cycles. Bar 1 is generation 2 and starts from its
    // first step, not from where generation 1 left off. Bar 2 is generation 3.
    expect(bar(0)).toEqual(line(1, 0))
    expect(bar(1)).toEqual(line(2, 0))
    expect(bar(2)).toEqual(line(3, 0))
    // Bar 3 stays on generation 3, which is the most asked for, and carries on rather than restarting.
    expect(bar(3)).toEqual(line(3, 16))
    expect(line(1, 0)).not.toEqual(line(2, 0))
  })

  it('plays only the held notes, spread across them, and rests when none are held', async () => {
    const { node } = await load(validator, { preset: 1, generations: 2, pitch_source: 1, range: 28 })
    roll(node)
    expect(ons(await render(node, blocksFor(2)))).toEqual([]) // nothing held is a rest
    node.port.postMessage({ type: 'events', events: [60, 64, 67].map(n => ({ frame: node.frame, bytes: Uint8Array.of(0x90, n, 100) })) })
    const played = ons(await render(node, blocksFor(6)))
    expect(played.length).toBeGreaterThan(0)
    expect(played.every(e => [0, 4, 7].includes(((e[2] - 60) % 12 + 12) % 12))).toBe(true)
  })

  it('does not take Conductor\'s section note on the Conductor channel as a held note', async () => {
    // Conductor holds a note (base note plus the section) on its own channel; heard as a key it would make Sprout play it.
    const { node } = await load(validator, { preset: 1, generations: 2, pitch_source: 1, range: 28, conductor_ch: 16 })
    roll(node)
    node.port.postMessage({ type: 'events', events: [{ frame: node.frame, bytes: Uint8Array.of(0x9f, 24, 100) }] })
    expect(ons(await render(node, blocksFor(4)))).toEqual([])
    // The same note on another channel is a key like any other.
    const keyed = await load(validator, { preset: 1, generations: 2, pitch_source: 1, range: 28, conductor_ch: 16 })
    roll(keyed.node)
    keyed.node.port.postMessage({ type: 'events', events: [{ frame: keyed.node.frame, bytes: Uint8Array.of(0x90, 60, 100) }] })
    expect(ons(await render(keyed.node, blocksFor(4))).length).toBeGreaterThan(0)
  })

  it('keeps a latched chord after the keys are released', async () => {
    const { node } = await load(validator, { preset: 1, generations: 2, pitch_source: 2 })
    roll(node)
    node.port.postMessage({ type: 'events', events: [60, 64, 67].flatMap(n => [
      { frame: node.frame, bytes: Uint8Array.of(0x90, n, 100) },
      { frame: node.frame + 10, bytes: Uint8Array.of(0x80, n, 0) }
    ]) })
    const played = ons(await render(node, blocksFor(4)))
    expect(played.length).toBeGreaterThan(0)
    expect(played.every(e => [0, 4, 7].includes(((e[2] - 60) % 12 + 12) % 12))).toBe(true)
  })

  it('answers the Conductor CCs on its channel only, and lets the panel take a parameter back', async () => {
    const { engine, entry, node } = await load(validator, { preset: 6, generations: 3, conductor_ch: 2 })
    roll(node)
    // CC 21 value 0 on the Conductor channel (2): probability 0.
    node.port.postMessage({ type: 'events', events: [{ frame: node.frame, bytes: Uint8Array.of(0xb1, 21, 0) }] })
    expect(ons(await render(node, blocksFor(4)))).toEqual([])
    // The same CC on channel 1 is not addressed to it.
    const other = await load(validator, { preset: 6, generations: 3, conductor_ch: 2 })
    roll(other.node)
    other.node.port.postMessage({ type: 'events', events: [{ frame: other.node.frame, bytes: Uint8Array.of(0xb0, 21, 0) }] })
    expect(ons(await render(other.node, blocksFor(4))).length).toBeGreaterThan(0)
    // Moving the parameter again ends the override.
    engine.setParameter(entry.id, 'probability', 0.9)
    expect(ons(await render(node, blocksFor(4))).length).toBeGreaterThan(0)
  })

  it('takes its generations from the Conductor scene, CC 20, on its channel only', async () => {
    const { node } = await load(validator, { preset: 1, generations: 1, conductor_ch: 1 })
    roll(node)
    const quiet = ons(await render(node, blocksFor(8)))
    const scened = await load(validator, { preset: 1, generations: 1, conductor_ch: 1 })
    roll(scened.node)
    // Scene 127 is the top of the generations range, taken up at the next bar.
    scened.node.port.postMessage({ type: 'events', events: [{ frame: scened.node.frame, bytes: Uint8Array.of(0xb0, 20, 127) }] })
    const grown = ons(await render(scened.node, blocksFor(8)))
    expect(grown.map(e => e[2]).join()).not.toBe(quiet.map(e => e[2]).join())
    // The same CC on another channel is not addressed to it.
    const other = await load(validator, { preset: 1, generations: 1, conductor_ch: 2 })
    roll(other.node)
    other.node.port.postMessage({ type: 'events', events: [{ frame: other.node.frame, bytes: Uint8Array.of(0xb0, 20, 127) }] })
    const same = ons(await render(other.node, blocksFor(8)))
    expect(same.map(e => e[2]).join()).toBe(quiet.map(e => e[2]).join())
  })

  it('restarts the pattern at the next bar line on Conductor CC 24', async () => {
    const { node } = await load(validator, { preset: 1, generations: 3, conductor_ch: 1, grid: 8 })
    roll(node)
    const before = await render(node, blocksFor(1.5)) // into bar 0, a few steps in
    expect(ons(before).length).toBeGreaterThan(0)
    node.port.postMessage({ type: 'events', events: [{ frame: node.frame, bytes: Uint8Array.of(0xb0, 24, 127) }] })
    const after = ons(await render(node, blocksFor(8)))
    // The first step of bar 1 (beat 4) is the first step of the pattern again.
    const atBar = after.find(e => Math.abs(e[0] - 4 * QUARTER) < 200)
    expect(atBar[2]).toBe(majorNote(60, kochUnits(3)[0]))
    expect(atBar[3]).toBe(100) // and carries the first-step accent
  })

  it('emits only valid MIDI and always pairs a note-off with its note-on, across every grammar', async () => {
    for (let preset = 0; preset < 7; preset++) {
      const { node } = await load(validator, { preset, generations: 16, scale: 16, range: 28, step_size: 3 })
      roll(node, { tempo: 173 })
      const events = await render(node, 1500)
      const sounding = new Map()
      for (const [, status, d1, d2] of events) {
        expect(status === 0x90 || status === 0x80).toBe(true)
        expect(d1).toBeGreaterThanOrEqual(0)
        expect(d1).toBeLessThanOrEqual(127)
        expect(d2).toBeLessThanOrEqual(127)
        if (status === 0x90) { expect(sounding.has(d1)).toBe(false); sounding.set(d1, true) } else { expect(sounding.has(d1)).toBe(true); sounding.delete(d1) }
      }
      expect(events.length).toBeGreaterThan(0)
    }
  })
})
