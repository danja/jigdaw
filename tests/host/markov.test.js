// tests/host/markov.test.js
//
// Markov through the real loader and engine, driven by transport messages as the host sends them.
// The statistical claims (a style gives its character, a learned line is followed) are checked on
// the notes that come out, and the model is checked as the state it is: saved, restored through
// the codec, and not disturbed by a restored session re-applying its own parameters.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { encodeState, decodeState } from '../../src/host/StateCodec.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const CANONICAL = `${ORIGIN}plugins/markov/`
const SAMPLE_RATE = 48000
const QUARTER = 24000 // frames at 120 bpm
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

async function load (validator, settings = {}, options = {}) {
  const engine = makeEngine(validator)
  const entry = await engine.addPlugin(CANONICAL, options)
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

const blocksFor = quarters => Math.ceil((quarters * QUARTER) / 128) + 1
const ons = events => events.filter(e => (e[1] & 0xf0) === 0x90 && e[3] > 0)
const offs = events => events.filter(e => (e[1] & 0xf0) === 0x80)
const pitchClass = (note, root = 60) => (((note - root) % 12) + 12) % 12

/** Feed a line of note-ons to the plugin as it would arrive from another track. */
async function hear (node, notes) {
  node.port.postMessage({ type: 'events', events: notes.map(n => ({ frame: node.frame, bytes: Uint8Array.of(0x90, n, 100) })) })
  await settle()
  node.render()
  await settle()
}

const parseModel = text => Object.fromEntries(text.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)] }))

describe('markov, a Markov-chain melody generator', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares MIDI out and the host transport, no module, and is not stateless', async () => {
    const { engine } = await load(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    expect(profile.label).toBe('Markov')
    expect(profile.module).toBeNull()
    expect(profile.requires).toEqual(expect.arrayContaining([
      'http://purl.org/stuff/jigdaw/MidiOut', 'http://purl.org/stuff/transmissions/HostTransport'
    ]))
    expect(profile.stateless).not.toBe(true)
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

  it('keeps to the scale and the register, and pairs every note-off with a note-on', async () => {
    const { node } = await load(validator, { scale: 14, root: 60, low: 48, octaves: 2, density: 1, velocity: 80 })
    roll(node)
    const events = await render(node, blocksFor(24))
    const played = ons(events)
    expect(played.length).toBeGreaterThan(80)
    expect(played.every(e => [0, 2, 4, 7, 9].includes(pitchClass(e[2])))).toBe(true) // major pentatonic
    expect(played.every(e => e[2] >= 48 && e[2] <= 71)).toBe(true)
    expect(played.every(e => e[3] >= 80)).toBe(true) // accents only add
    expect(Math.abs(played.length - offs(events).length)).toBeLessThanOrEqual(1)
  })

  it('places a note at its step: a sixteenth is 6000 frames at 120 bpm', async () => {
    const { node } = await load(validator, { density: 1 })
    roll(node)
    const played = ons(await render(node, blocksFor(2)))
    expect(played.slice(0, 8).map(e => e[0])).toEqual([0, 6000, 12000, 18000, 24000, 30000, 36000, 42000])
  })

  it('plays the same notes from the same seed, however the stream is joined', async () => {
    const a = await load(validator, { seed: 11, density: 0.8 })
    roll(a.node)
    const whole = ons(await render(a.node, blocksFor(16))).map(e => [e[0], e[2]])
    const b = await load(validator, { seed: 11, density: 0.8 })
    roll(b.node, { beat: 8 }) // joined half way, at a phrase boundary and after several phrases
    const later = ons(await render(b.node, blocksFor(8))).map(e => [e[0] + 8 * QUARTER, e[2]])
    const expected = whole.filter(([frame]) => frame >= 8 * QUARTER && frame < 16 * QUARTER)
    expect(later.filter(([frame]) => frame < 16 * QUARTER)).toEqual(expected)
    expect(expected.length).toBeGreaterThan(20)

    const other = await load(validator, { seed: 12, density: 0.8 })
    roll(other.node)
    expect(ons(await render(other.node, blocksFor(16))).map(e => [e[0], e[2]])).not.toEqual(whole)
  })

  it('gives each style its character: a chromatic crawl moves by steps, a uniform matrix leaps', async () => {
    const stepwise = async style => {
      const { node } = await load(validator, { scale: 0, style, density: 1, grid: 0, phrase_bars: 8 })
      roll(node)
      const notes = ons(await render(node, blocksFor(26))).map(e => e[2])
      expect(notes.length).toBeGreaterThan(190)
      let near = 0
      for (let i = 1; i < notes.length; i++) if (Math.abs(notes[i] - notes[i - 1]) <= 2) near += 1
      return near / (notes.length - 1)
    }
    const chromatic = await stepwise(5)
    const uniform = await stepwise(7)
    expect(chromatic).toBeGreaterThan(0.6)
    expect(chromatic).toBeGreaterThan(uniform + 0.2)
  })

  it('learns a line from its input and follows it when Learned mix is full', async () => {
    const { node } = await load(validator, { scale: 0, learn: 1, learned_mix: 1, density: 1, grid: 8, phrase_bars: 2 })
    const line = Array.from({ length: 24 }, (_, i) => [60, 62, 64][i % 3]) // C D E C D E ...
    await hear(node, line)
    roll(node)
    const played = ons(await render(node, blocksFor(24))).map(e => pitchClass(e[2]))
    // Each phrase restarts as if the last note were the tonic: C went to D, D to E, E to C.
    const phrase = 8
    expect(played.length).toBeGreaterThanOrEqual(phrase * 3)
    played.slice(0, phrase * 3).forEach((pc, i) => expect(pc).toBe([2, 4, 0][(i % phrase) % 3]))
  })

  it('learns nothing while Learn is off, and forgets the line when Learn is turned off', async () => {
    const off = await load(validator, { learned_mix: 1 })
    await hear(off.node, [60, 62, 64, 60, 62, 64])
    expect(parseModel((await off.engine.requestState(off.entry.id)).model).l1).toBe('')

    const { engine, entry, node } = await load(validator, { learn: 1 })
    await hear(node, [60, 62])
    engine.setParameter(entry.id, 'learn', 0)
    await hear(node, [64]) // not heard
    engine.setParameter(entry.id, 'learn', 1)
    await hear(node, [65]) // the first note of a new line: no transition from 62
    const l1 = parseModel((await engine.requestState(entry.id)).model).l1
    expect(l1).toBe('2:1') // only C to D
  })

  it('counts second-order transitions, and Order 2 with nothing learned is Order 1', async () => {
    const { engine, entry, node } = await load(validator, { learn: 1 })
    await hear(node, [60, 62, 64, 60])
    const model = parseModel((await engine.requestState(entry.id)).model)
    // Indexed (two back * 12 + one back) * 12 + next: (0,2)->4 is 28 and (2,4)->0 is 336.
    expect(model.l2.split(',')).toEqual(['28:1', '336:1'])

    const one = await load(validator, { order: 1, density: 1, scale: 0, seed: 5 })
    const two = await load(validator, { order: 2, density: 1, scale: 0, seed: 5 })
    roll(one.node); roll(two.node)
    expect(ons(await render(two.node, blocksFor(8)))).toEqual(ons(await render(one.node, blocksFor(8))))
  })

  it('wipes what it learned on the rising edge of Clear learned, and not on a restored 1', async () => {
    const { engine, entry, node } = await load(validator, { learn: 1 })
    await hear(node, [60, 62, 64])
    expect(parseModel((await engine.requestState(entry.id)).model).l1).not.toBe('')
    engine.setParameter(entry.id, 'clear_learned', 1)
    await hear(node, [])
    expect(parseModel((await engine.requestState(entry.id)).model).l1).toBe('')

    // A session saved with the button held restores with it held: the first value is adopted.
    const taught = await load(validator, { learn: 1 })
    await hear(taught.node, [60, 62, 64])
    const withLearning = await taught.engine.requestState(taught.entry.id)
    const restored = await load(validator, {}, { state: withLearning })
    restored.engine.setParameter(restored.entry.id, 'clear_learned', 1)
    await hear(restored.node, [])
    expect(parseModel((await restored.engine.requestState(restored.entry.id)).model).l1).not.toBe('')
  })

  it('Style replaces the matrix and keeps what was learned; Randomise rolls it from the seed', async () => {
    const { engine, entry, node } = await load(validator, { learn: 1 })
    await hear(node, [60, 62])
    const defaultBase = parseModel((await engine.requestState(entry.id)).model).base
    expect(defaultBase).toHaveLength(144)

    engine.setParameter(entry.id, 'style', 7) // Uniform: every weight 4
    await hear(node, [])
    const model = parseModel((await engine.requestState(entry.id)).model)
    expect(model.base).toBe('4'.repeat(144))
    expect(model.l1).toBe('2:1')

    engine.setParameter(entry.id, 'seed', 3)
    engine.setParameter(entry.id, 'randomise', 1)
    await hear(node, [])
    const rolled = parseModel((await engine.requestState(entry.id)).model).base
    expect(rolled).not.toBe(model.base)
    expect(rolled).toMatch(/^[0-8]{144}$/)
    // Held high is not a repeated roll, and the same seed rolls the same matrix.
    await hear(node, [])
    expect(parseModel((await engine.requestState(entry.id)).model).base).toBe(rolled)
    const again = await load(validator, { seed: 3, style: 7 })
    await hear(again.node, [])
    again.engine.setParameter(again.entry.id, 'randomise', 1)
    await hear(again.node, [])
    expect(parseModel((await again.engine.requestState(again.entry.id)).model).base).toBe(rolled)
  })

  it('saves the model as state, and a restored session does not re-apply its own style or roll', async () => {
    const { engine, entry, node } = await load(validator, { learn: 1, seed: 9, style: 3 })
    engine.setParameter(entry.id, 'randomise', 1)
    await hear(node, [60, 63, 67, 63, 60])
    const saved = await engine.requestState(entry.id)
    expect(typeof saved.model).toBe('string')

    // The restored session carries the same parameters it was saved with, applied after the state:
    // a roll and a style change must be adopted as already done, not performed again.
    const state = decodeState(encodeState(saved))
    const restored = await load(validator, {}, { state })
    restored.engine.setParameter(restored.entry.id, 'style', 3)
    restored.engine.setParameter(restored.entry.id, 'randomise', 1)
    restored.engine.setParameter(restored.entry.id, 'seed', 9)
    await hear(restored.node, [])
    expect(await restored.engine.requestState(restored.entry.id)).toEqual(saved)

    // And it plays what the original would have.
    for (const side of [{ engine, node, entry }, restored]) {
      side.engine.setParameter(side.entry.id, 'learn', 0)
      side.engine.setParameter(side.entry.id, 'learned_mix', 0.7)
      side.engine.setParameter(side.entry.id, 'density', 1)
      roll(side.node)
    }
    const a = ons(await render(node, blocksFor(8))).map(e => [e[0] - 0, e[2]])
    const b = ons(await render(restored.node, blocksFor(8))).map(e => [e[0] - 0, e[2]])
    expect(b.map(e => e[1])).toEqual(a.map(e => e[1]))
    expect(a.length).toBeGreaterThan(20)
  })

  it('falls back to the default matrix, and plays on, when a saved model is not usable', async () => {
    const fresh = await load(validator)
    const pristine = await fresh.engine.requestState(fresh.entry.id)
    for (const model of ['', 'version=2\nbase=' + '0'.repeat(144), 'version=1\nbase=short', 'version=1\nbase=' + '9'.repeat(144), 'version=1\nbase=' + '1'.repeat(144) + '\nl1=999999:1', 42]) {
      const { engine, entry, node } = await load(validator, { density: 1 }, { state: { model } })
      expect(await engine.requestState(entry.id)).toEqual(pristine)
      roll(node)
      expect(ons(await render(node, blocksFor(2))).length).toBeGreaterThan(0)
    }
  })

  it('moves Density and Velocity on Conductor CCs, and re-rolls at the next bar line on CC 24', async () => {
    const settings = { conductor_ch: 3, density: 1, grid: 8, phrase_bars: 1, seed: 21 }
    const barOf = (events, n) => events.filter(e => e[0] >= n * 4 * QUARTER && e[0] < (n + 1) * 4 * QUARTER)

    // Without the restart, bar 1 is simply the next phrase.
    const control = await load(validator, settings)
    roll(control.node)
    const plain = ons(await render(control.node, blocksFor(8)))

    const { node } = await load(validator, settings)
    roll(node)
    const before = ons(await render(node, blocksFor(2) - 1))
    expect(before).toHaveLength(2)
    node.port.postMessage({ type: 'events', events: [
      { frame: node.frame, bytes: Uint8Array.of(0xb2, 22, 127) }, // velocity to the top
      { frame: node.frame, bytes: Uint8Array.of(0xb2, 24, 127) } // re-roll at the bar line
    ] })
    const after = ons(await render(node, blocksFor(6)))
    expect(after.every(e => e[3] === 127)).toBe(true)
    const rerolled = barOf([...before, ...after], 1).map(e => e[2])
    expect(rerolled).toHaveLength(4)
    expect(rerolled).not.toEqual(barOf(plain, 1).map(e => e[2]))
    // The bar before the CC is untouched.
    expect(barOf([...before, ...after], 0).map(e => e[2])).toEqual(barOf(plain, 0).map(e => e[2]))

    node.port.postMessage({ type: 'events', events: [{ frame: node.frame, bytes: Uint8Array.of(0xb2, 21, 0) }] }) // density 0
    expect(ons(await render(node, blocksFor(4)))).toEqual([])
  })

  it('emits only valid MIDI over a long run at an awkward tempo and grid', async () => {
    const { node } = await load(validator, { grid: 4, scale: 16, order: 2, chaos: 1, learned_mix: 1, phrase_bars: 8 })
    roll(node, { tempo: 137 })
    const events = await render(node, 3000)
    const sounding = new Set()
    for (const [, status, d1, d2] of events) {
      expect([0x90, 0x80]).toContain(status)
      expect(d1).toBeGreaterThanOrEqual(0)
      expect(d1).toBeLessThanOrEqual(127)
      expect(d2).toBeLessThanOrEqual(127)
      if (status === 0x90) { expect(sounding.has(d1)).toBe(false); sounding.add(d1) } else { expect(sounding.has(d1)).toBe(true); sounding.delete(d1) }
    }
    expect(events.length).toBeGreaterThan(0)
  })
})
