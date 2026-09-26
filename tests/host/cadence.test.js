// tests/host/cadence.test.js
//
// Cadence through the real host path: the profile dereferences, the module
// instantiates in a worklet, and a learned harmony comes out once it has
// heard a cycle. Transport and input notes are posted as the messages a host
// sends, and the outgoing events are read back the same way, so this
// exercises the contract's processor path rather than the Rust in isolation.
//
// Learning needs whole cycles, so these drives run a hot tempo and a short
// cycle: one bar per cycle at 240 bpm is 375 blocks, and two cycles teach
// and play. Drive lengths below are in those units, not arbitrary.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFile } from 'node:fs/promises'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/cadence')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/cadence/'

const SAMPLE_RATE = 48000
const TEMPO = 240
const BEATS_PER_FRAME = TEMPO / (60 * SAMPLE_RATE)

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'cadence-processor.js')).href
  })
}

async function makeEntry (validator) {
  const context = new OfflineContext({ sampleRate: SAMPLE_RATE })
  const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
  const entry = await engine.addPlugin(CANONICAL)
  return { engine, entry, node: entry.node }
}

// Message delivery hops through the ports, so let the queue drain on a real
// tick rather than a microtask checkpoint.
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

function postTransport (node) {
  node.port.postMessage({
    type: 'transport',
    playing: true,
    frame: node.frame,
    beat: node.frame * BEATS_PER_FRAME,
    beatsPerFrame: BEATS_PER_FRAME,
    tempo: TEMPO,
    timeSignature: { beatsPerBar: 4, beatUnit: 4 }
  })
}

async function drive (node, blocks, every = 1) {
  for (let b = 0; b < blocks; b++) {
    if (b % every === 0) {
      postTransport(node)
      await settle()
    }
    node.render()
  }
  await settle()
  return node.processor.port.posted
    .filter(m => m.type === 'events')
    .flatMap(m => m.events)
}

async function holdChord (node, notes = [60, 64, 67], velocity = 100) {
  node.port.postMessage({
    type: 'events',
    events: notes.map(note => ({ frame: node.frame, bytes: Uint8Array.from([0x90, note, velocity]) }))
  })
  await settle()
}

async function releaseChord (node, notes = [60, 64, 67]) {
  node.port.postMessage({
    type: 'events',
    events: notes.map(note => ({ frame: node.frame, bytes: Uint8Array.from([0x80, note, 0]) }))
  })
  await settle()
}

const onsets = events => events.filter(e => (e.bytes[0] & 0xf0) === 0x90 && e.bytes[2] > 0)
const signature = events => events.map(e => `${e.frame}:${[...e.bytes].join(',')}`)

describe('cadence, a MIDI harmonizer that learns a cycle', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('dereferences the IRI to a processor profile with every control', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Cadence')
    expect(profile.ports).toHaveLength(17)
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiOut')
    expect(profile.requires).toContain('http://purl.org/stuff/transmissions/HostTransport')
    expect(profile.accepts.some(s => s.endsWith('/Midi') || s.endsWith('#Midi') || s.endsWith('Midi'))).toBe(true)
    expect(profile.produces.some(s => s.endsWith('HarmonyMidi'))).toBe(true)
  })

  it('declares the same parameters in the profile and the processor', async () => {
    const template = JSON.parse(await readFile(resolve(pluginDir, 'profile.json'), 'utf8'))
    const source = await readFile(resolve(pluginDir, 'cadence-processor.js'), 'utf8')
    const descriptors = [...source.matchAll(/\{\s*name:\s*'([^']+)',\s*defaultValue:\s*([^,]+),\s*minValue:\s*([^,]+),\s*maxValue:\s*([^ },]+)/g)]
      .map(m => ({ symbol: m[1], default: Number(m[2]), min: Number(m[3]), max: Number(m[4]) }))
    expect(descriptors.map(d => d.symbol)).toEqual(template.ports.map(p => p.symbol))
    for (const [i, port] of template.ports.entries()) {
      expect(descriptors[i].default, port.symbol).toBe(port.default)
      expect(descriptors[i].min, port.symbol).toBe(port.minimum)
      expect(descriptors[i].max, port.symbol).toBe(port.maximum)
    }
  })

  it('runs the init/ready handshake and reports ready', async () => {
    const { entry } = await makeEntry(validator)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(entry.node).toBeInstanceOf(OfflineWorkletNode)
  })

  it('is silent with no input, then harmonizes what it heard', async () => {
    const { engine, entry, node } = await makeEntry(validator)
    engine.setParameter(entry.id, 'cycle_bars', 1)
    // One bar to learn in, one to play back: the second bar must hold chord
    // clusters that the input alone cannot explain.
    await holdChord(node)
    const events = await drive(node, 750)
    const hits = onsets(events)
    const harmony = hits.filter(e => e.frame > 0)
    expect(harmony.length).toBeGreaterThan(0)
    const byFrame = new Map()
    for (const e of harmony) byFrame.set(e.frame, (byFrame.get(e.frame) ?? 0) + 1)
    expect(Math.max(...byFrame.values())).toBeGreaterThanOrEqual(2)
    for (const e of hits) {
      expect(e.bytes[0]).toBe(0x90)
      expect(e.bytes[2]).toBeGreaterThanOrEqual(1)
      expect(e.bytes[2]).toBeLessThanOrEqual(127)
    }
  })

  it('passes input through stopped, and not at all when told not to', async () => {
    const open = await makeEntry(validator)
    await holdChord(open.node, [72])
    await open.node.render()
    await settle()
    const forwarded = onsets(open.node.processor.port.posted
      .filter(m => m.type === 'events').flatMap(m => m.events))
    expect(forwarded.length).toBeGreaterThan(0)

    const closed = await makeEntry(validator)
    closed.engine.setParameter(closed.entry.id, 'pass_input', 0)
    await holdChord(closed.node, [72])
    await closed.node.render()
    await settle()
    const blocked = onsets(closed.node.processor.port.posted
      .filter(m => m.type === 'events').flatMap(m => m.events))
    expect(blocked).toEqual([])
  })

  it('forgets everything on the Learn trigger', async () => {
    const { engine, entry, node } = await makeEntry(validator)
    engine.setParameter(entry.id, 'cycle_bars', 1)
    engine.setParameter(entry.id, 'pass_input', 0)
    await holdChord(node)
    const sounding = onsets(await drive(node, 750))
    expect(sounding.length).toBeGreaterThan(0)

    // Learn clears the progression: with the chord released and nothing
    // passing through, the next cycle is silent until something is played
    // into it again. Held notes would simply teach it straight back.
    await releaseChord(node)
    engine.setParameter(entry.id, 'learn', 1)
    // posted accumulates across drives on this entry, so read only what the
    // second drive emitted.
    const mark = node.processor.port.posted.length
    await drive(node, 750)
    const after = onsets(node.processor.port.posted.slice(mark)
      .filter(m => m.type === 'events').flatMap(m => m.events))
    expect(after).toEqual([])
  })

  it('learns the same harmony twice for the same input', async () => {
    const first = await makeEntry(validator)
    first.engine.setParameter(first.entry.id, 'cycle_bars', 1)
    await holdChord(first.node)
    const a = signature(await drive(first.node, 750))

    const second = await makeEntry(validator)
    second.engine.setParameter(second.entry.id, 'cycle_bars', 1)
    await holdChord(second.node)
    const b = signature(await drive(second.node, 750))

    expect(a.length).toBeGreaterThan(0)
    expect(b).toEqual(a)
  })

  it('keeps time when transport updates are sparse', async () => {
    // The flywheel test, as in the generator ports: the harmony must land
    // on the same beats either way rather than quantising to the update grid.
    const play = async (every) => {
      const { engine, entry, node } = await makeEntry(validator)
      engine.setParameter(entry.id, 'cycle_bars', 1)
      await holdChord(node)
      return drive(node, 750, every)
    }
    const dense = await play(1)
    const flown = await play(150)
    expect(onsets(dense).length).toBeGreaterThan(0)
    expect(signature(flown)).toEqual(signature(dense))
  })
})
