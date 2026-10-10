// tests/host/retune.test.js
//
// Retune through the real loader and engine: the profile is fetched and validated, the shipped
// scale arrives as a jig:asset, and a replacement arrives as loadAsset, as it would from the panel.
// The tuning is checked against the arithmetic of a Scala file worked out here, independently of
// the processor, and the channel pool against the rules the VST3 documents.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { encodeState, decodeState } from '../../src/host/StateCodec.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const CANONICAL = `${ORIGIN}plugins/retune/`
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function makeEngine (validator) {
  const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
  const context = new OfflineContext({ sampleRate: 48000 })
  const loader = new PluginLoader({
    fetch: site.fetch, parse: parseText, validator,
    capabilities: detectCapabilities({}), processorUrl: site.processorUrl
  })
  const engine = new Engine({ context, loader, AudioWorkletNode: OfflineWorkletNode })
  engine.testLoader = loader
  return engine
}

const scale = name => {
  const bytes = readFileSync(resolve(root, 'plugins/retune/scales', name))
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
}
const text = string => new TextEncoder().encode(string).buffer

/** Send MIDI messages at a frame, render two quanta, and return what came out. */
async function send (node, messages) {
  const before = node.processor.port.posted.length
  node.port.postMessage({ type: 'events', events: messages.map(bytes => ({ frame: node.frame, bytes: Uint8Array.from(bytes) })) })
  await settle()
  node.render()
  node.render()
  await settle()
  return node.processor.port.posted.slice(before).filter(m => m.type === 'events').flatMap(m => m.events.map(e => Array.from(e.bytes)))
}

const errorsFrom = (node, from = 0) => node.processor.port.posted.slice(from).filter(m => m.type === 'error')
const bendOf = bytes => bytes[1] | (bytes[2] << 7)

describe('retune, a MIDI retuner', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares MIDI in and out, no module, and the scale as a replaceable asset', async () => {
    const engine = makeEngine(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    expect(profile.label).toBe('Retune')
    expect(profile.module).toBeNull()
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiOut')
    expect(profile.ports.map(p => p.symbol).sort()).toEqual(['bend_range', 'root'])
    expect(profile.assets.map(a => [a.iri.split('#')[1], a.userReplaceable])).toEqual([['scl', true]])
  })

  it('binds the processor descriptors to the profile ports', async () => {
    const engine = makeEngine(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    const entry = await engine.addPlugin(CANONICAL)
    const descriptors = entry.node.processor.constructor.parameterDescriptors
    expect(descriptors.map(d => d.name).sort()).toEqual(profile.ports.map(p => p.symbol).sort())
    for (const port of profile.ports) {
      const d = descriptors.find(x => x.name === port.symbol)
      expect([d.defaultValue, d.minValue, d.maxValue]).toEqual([port.defaultValue, port.minimum, port.maximum])
    }
  })

  it('plays 12-TET untouched by default: no bend, carrier on channel 2', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    expect(entry.ready.latencyFrames).toBe(0)
    const out = await send(entry.node, [[0x90, 64, 100]])
    expect(out).toEqual([[0xe1, 0x00, 0x40], [0x91, 64, 100]]) // bend 8192 is centre
    const off = await send(entry.node, [[0x80, 64, 0]])
    expect(off).toEqual([[0x81, 64, 0]])
  })

  it('retunes to a loaded Scala file: nearest key as carrier, the remainder as the bend', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: scale('19-edo.scl') })
    await settle()
    // Degree 1 of 19-EDO is 1200/19 cents above the root, 36.8 cents flat of the next 12-TET key.
    const cents = 1200 / 19
    const expectedBend = Math.round(8192 + ((cents - 100) / 200) * 8192)
    const out = await send(entry.node, [[0x90, 61, 90]])
    expect(out).toHaveLength(2)
    expect(out[0][0]).toBe(0xe1)
    expect(bendOf(out[0])).toBe(expectedBend)
    expect(out[1]).toEqual([0x91, 61, 90])
    // The period is repeated, not assumed to be an octave: 19 degrees up is one period (1200 cents) up.
    const octave = await send(entry.node, [[0x90, 60 + 19, 90]])
    expect(bendOf(octave[0])).toBe(8192)
    expect(octave[1][1]).toBe(72)
  })

  it('follows the root and treats a non-octave period as the period', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: scale('bohlen-pierce.scl') })
    await settle()
    engine.setParameter(entry.id, 'root', 48)
    // Bohlen-Pierce has 13 degrees to a 3/1 tritave of 1901.955 cents.
    const tritave = 1200 * Math.log2(3)
    const out = await send(entry.node, [[0x90, 48 + 13, 100]])
    const steps = Math.round(tritave / 100)
    expect(out[1][1]).toBe(48 + steps)
    expect(bendOf(out[0])).toBe(Math.round(8192 + ((tritave - 100 * steps) / 200) * 8192))
  })

  it('drops a note whose carrier would fall outside 0 to 127, and its note-off', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: scale('bohlen-pierce.scl') })
    await settle()
    expect(await send(entry.node, [[0x90, 127, 100]])).toEqual([])
    expect(await send(entry.node, [[0x80, 127, 0]])).toEqual([])
  })

  it('gives each held note its own channel, longest idle first, and steals the oldest when all 15 are busy', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    const first = await send(entry.node, Array.from({ length: 15 }, (_, i) => [0x90, 40 + i, 100]))
    const channels = first.filter(m => (m[0] & 0xf0) === 0x90).map(m => m[0] & 0x0f)
    expect(channels.sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 1)) // 1 to 15, never 0
    // A sixteenth note silences the oldest (note 40) before taking its channel.
    const stolen = await send(entry.node, [[0x90, 80, 100]])
    expect(stolen[0][0] & 0xf0).toBe(0x80)
    expect(stolen[0][1]).toBe(40)
    expect(stolen[stolen.length - 1][1]).toBe(80)
    expect(stolen[0][0] & 0x0f).toBe(stolen[stolen.length - 1][0] & 0x0f)
  })

  it('retriggers a repeated note-on, and routes CC to every channel but poly aftertouch to its note', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    await send(entry.node, [[0x90, 60, 100]])
    const again = await send(entry.node, [[0x90, 60, 100]])
    expect(again.map(m => m[0] & 0xf0)).toEqual([0x80, 0xe0, 0x90]) // release, bend, strike
    const cc = await send(entry.node, [[0xb0, 1, 64]])
    expect(cc).toHaveLength(15)
    expect(cc.every(m => (m[0] & 0xf0) === 0xb0 && m[1] === 1 && m[2] === 64)).toBe(true)
    const pressure = await send(entry.node, [[0xa0, 60, 33]])
    expect(pressure).toEqual([[0xa0 | (again[2][0] & 0x0f), 60, 33]])
  })

  it('drops incoming pitch bend, channel aftertouch and system messages, and releases everything on CC 123', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    await send(entry.node, [[0x90, 60, 100], [0x90, 64, 100]])
    expect(await send(entry.node, [[0xe0, 0, 100], [0xd0, 50, 0], [0xf8, 0, 0]])).toEqual([])
    const off = await send(entry.node, [[0xb0, 123, 0]])
    expect(off.map(m => m[0] & 0xf0)).toEqual([0x80, 0x80])
    expect(off.map(m => m[1]).sort()).toEqual([60, 64])
  })

  it('keeps the previous scale and reports, without being fatal, when a replacement does not parse', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: scale('19-edo.scl') })
    await settle()
    const mark = entry.node.processor.port.posted.length
    for (const bad of ['', 'not a scale', '! c\nd\n3\n100.0\n200.0\n', '! c\nd\n1\n-5/1\n', 'd\n2\n100.0\n200.0\n300.0\n']) {
      entry.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: text(bad) })
    }
    await settle()
    const errors = errorsFrom(entry.node, mark)
    expect(errors).toHaveLength(5)
    expect(errors.every(e => e.phase === 'asset' && e.fatal === false)).toBe(true)
    // Still 19-EDO.
    const out = await send(entry.node, [[0x90, 61, 90]])
    expect(bendOf(out[0])).toBe(Math.round(8192 + ((1200 / 19 - 100) / 200) * 8192))
  })

  it('accepts ratios, comments and a trailing description in a hand-written file', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: text('! mine.scl\n!\nthree notes\n 3\n!\n 9/8 extra words\n 5/4\n 2\n') })
    await settle()
    const out = await send(entry.node, [[0x90, 61, 90]]) // 9/8 is 203.9 cents
    const cents = 1200 * Math.log2(9 / 8)
    expect(out[1][1]).toBe(60 + Math.round(cents / 100))
    expect(bendOf(out[0])).toBe(Math.round(8192 + ((cents - 200) / 200) * 8192))
  })

  it('saves the scale as state and restores it, through the codec', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: scale('31-edo.scl') })
    await settle()
    const saved = await engine.requestState(entry.id)
    expect(saved.scl).toBeInstanceOf(ArrayBuffer)

    const restoredEngine = makeEngine(validator)
    const restored = await restoredEngine.addPlugin(CANONICAL, { state: decodeState(encodeState(saved)) })
    const out = await send(restored.node, [[0x90, 61, 90]])
    expect(bendOf(out[0])).toBe(Math.round(8192 + ((1200 / 31) / 200) * 8192)) // 38.7 cents sharp of the root key
    expect(Array.from(new Uint8Array((await restoredEngine.requestState(restored.id)).scl))).toEqual(Array.from(new Uint8Array(saved.scl)))
  })

  it('emits only finite, in-range MIDI bytes over a long mixed run', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: scale('pelog-approx.scl') })
    await settle()
    for (let n = 0; n < 128; n++) {
      const out = await send(entry.node, [[0x90, n, 1 + (n % 127)], [0x80, n, 0]])
      for (const message of out) {
        expect(message.every(b => Number.isInteger(b) && b >= 0 && b <= 255)).toBe(true)
        if ((message[0] & 0xf0) === 0xe0) expect(message[2]).toBeLessThanOrEqual(127)
      }
    }
  })
})
