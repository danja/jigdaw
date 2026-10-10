// tests/host/conductor.test.js
//
// Conductor through the real loader and engine, driven by transport messages as the host sends them.
// The form and the CC values are compared with tables written out here from the VST3's documented
// protocol, not read back from the processor.
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
const CANONICAL = `${ORIGIN}plugins/conductor/`
const SAMPLE_RATE = 48000
const BAR = 96000 // frames in a bar of four quarters at 120 bpm
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

const roll = (node, { tempo = 120, beat = 0, playing = true } = {}) => {
  node.port.postMessage({
    type: 'transport', playing, frame: node.frame, beat, tempo,
    beatsPerFrame: tempo / (60 * SAMPLE_RATE), timeSignature: { beatsPerBar: 4, beatUnit: 4 }, loop: null
  })
}

async function render (node, blocks) {
  await settle()
  const before = node.processor.port.posted.length
  for (let i = 0; i < blocks; i++) node.render()
  await settle()
  return node.processor.port.posted.slice(before)
    .filter(m => m.type === 'events')
    .flatMap(m => m.events.map(e => [e.frame, ...Array.from(e.bytes)]))
}

const blocksForBars = bars => Math.ceil((bars * BAR) / 128) + 1
const noteOns = events => events.filter(e => (e[1] & 0xf0) === 0x90)
const noteOffs = events => events.filter(e => (e[1] & 0xf0) === 0x80)
const ccs = events => events.filter(e => (e[1] & 0xf0) === 0xb0)

// The documented protocol: scene, density, energy, mutation, reset for each of the five sections.
const VALUES = [[0, 30, 28, 12, 127], [32, 74, 68, 54, 0], [64, 18, 20, 38, 0], [96, 62, 58, 32, 0], [127, 20, 42, 8, 127]]
const FORM = [0, 1, 1, 2, 1, 3, 1, 4]

/** The sections that begin in [fromBar, toBar), as [bar, section], read from the emitted notes. */
const sections = (events, base = 24) => noteOns(events).map(e => [e[0] / BAR, e[2] - base])

describe('conductor, a section generator', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares MIDI out and the host transport, no module', async () => {
    const { engine } = await load(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    expect(profile.label).toBe('Conductor')
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

  it('plays the fixed form on bar lines: a note, then the five CCs, on channel 16', async () => {
    const { node } = await load(validator, { min_bars: 2, max_bars: 2 })
    roll(node)
    const events = await render(node, blocksForBars(18))
    const played = sections(events).filter(([bar]) => bar < 16)
    expect(played).toEqual(Array.from({ length: 8 }, (_, k) => [2 * k, FORM[k]]))
    // Each section sends its five CCs at the same frame as its note, with the documented values.
    for (const [bar, section] of played) {
      const at = events.filter(e => e[0] === bar * BAR)
      const sent = at.filter(e => (e[1] & 0xf0) === 0xb0)
      expect(sent.map(e => e[2])).toEqual([20, 21, 22, 23, 24])
      expect(sent.map(e => e[3])).toEqual(VALUES[section])
      expect(at.every(e => (e[1] & 0x0f) === 15)).toBe(true) // channel 16
    }
  })

  it('releases the old section note before the new one, at the same frame', async () => {
    const { node } = await load(validator, { min_bars: 1, max_bars: 1 })
    roll(node)
    const events = await render(node, blocksForBars(6))
    const ons = noteOns(events)
    const offs = noteOffs(events)
    expect(offs.length).toBe(ons.length - 1)
    offs.forEach((off, i) => {
      expect(off[0]).toBe(ons[i + 1][0])
      expect(off[2]).toBe(ons[i][2])
      expect(events.indexOf(off)).toBeLessThan(events.indexOf(ons[i + 1]))
    })
  })

  it('follows its own channel, CC numbers and base note', async () => {
    const { node } = await load(validator, { channel: 3, base_note: 60, scene_cc: 100, density_cc: 101, energy_cc: 102, mutation_cc: 103, reset_cc: 104 })
    roll(node)
    const events = await render(node, 4)
    expect(noteOns(events)[0].slice(1)).toEqual([0x92, 60, 100]) // intro is section 0
    expect(ccs(events).map(e => [e[1], e[2]])).toEqual([[0xb2, 100], [0xb2, 101], [0xb2, 102], [0xb2, 103], [0xb2, 104]])
  })

  it('chooses sections by weight from the seed, in whole bars between the limits, and the same way twice', async () => {
    const settings = { mode: 1, min_bars: 3, max_bars: 7, seed: 77 }
    const run = async () => {
      const { node } = await load(validator, settings)
      roll(node)
      return sections(await render(node, blocksForBars(200)))
    }
    const first = await run()
    expect(await run()).toEqual(first)
    expect(first.length).toBeGreaterThan(25)
    for (let i = 1; i < first.length; i++) {
      const length = first[i][0] - first[i - 1][0]
      expect(Number.isInteger(length) && length >= 3 && length <= 7).toBe(true)
    }
    expect(new Set(first.map(([, s]) => s)).size).toBeGreaterThanOrEqual(4)
    // A different seed is a different form.
    const { node } = await load(validator, { ...settings, seed: 78 })
    roll(node)
    expect(sections(await render(node, blocksForBars(200)))).not.toEqual(first)
  })

  it('favours what the weights favour', async () => {
    const count = async weights => {
      const { node } = await load(validator, { mode: 1, min_bars: 1, max_bars: 1, seed: 5, ...weights })
      roll(node)
      const found = sections(await render(node, blocksForBars(400)))
      return found.reduce((n, [, s]) => { n[s] += 1; return n }, [0, 0, 0, 0, 0])
    }
    const breaks = await count({ intro_weight: 0, develop_weight: 0, break_weight: 1, reprise_weight: 0, coda_weight: 0 })
    // Break is penalised right after itself, so the others (all zero) are only reached through the
    // follow-on bonuses: break leans to reprise, which then has to come back.
    expect(breaks[2]).toBeGreaterThan(breaks[0] + breaks[4])
  })

  it('gives the same section at a bar however the stream was reached', async () => {
    const settings = { mode: 1, min_bars: 2, max_bars: 6, seed: 9 }
    const a = await load(validator, settings)
    roll(a.node)
    const whole = sections(await render(a.node, blocksForBars(60)))
    // Joined at bar 30 with the transport already there: rebuilt from the seed, not remembered.
    const b = await load(validator, settings)
    roll(b.node, { beat: 30 * 4 })
    const joined = sections(await render(b.node, 4)) // only the statement on arrival
    const current = whole.filter(([bar]) => bar <= 30).pop()
    expect(joined).toHaveLength(1)
    expect(joined[0][1]).toBe(current[1])
  })

  it('releases its note when the transport stops and states the section again when it restarts', async () => {
    const { node } = await load(validator, { min_bars: 4, max_bars: 4 })
    roll(node)
    expect(noteOns(await render(node, 20))).toHaveLength(1)
    roll(node, { playing: false })
    const stopped = await render(node, 2)
    expect(noteOffs(stopped)).toHaveLength(1)
    roll(node, { beat: 0 })
    const again = await render(node, 4)
    expect(noteOns(again)).toHaveLength(1)
    expect(ccs(again)).toHaveLength(5)
  })

  it('jumps to a requested section at the next bar line and then carries on from there', async () => {
    const { engine, entry, node } = await load(validator, { min_bars: 2, max_bars: 2 })
    roll(node)
    await render(node, blocksForBars(1) - 1) // bar 0, section 0
    engine.setParameter(entry.id, 'jump_to', 5) // Coda
    const events = await render(node, blocksForBars(6))
    const found = sections(events).filter(([bar]) => bar > 0)
    expect(found[0]).toEqual([2, 4]) // the boundary at bar 2 is the coda
    expect(found[1][1]).toBe(FORM[2]) // and the schedule carries on with its own next section
  })

  it('does not jump on the first value it sees, as when a saved session reopens', async () => {
    const { node } = await load(validator, { min_bars: 2, max_bars: 2, jump_to: 5 })
    roll(node)
    const found = sections(await render(node, blocksForBars(5)))
    expect(found.map(([, s]) => s)).toEqual([0, 1, 1])
  })
})
