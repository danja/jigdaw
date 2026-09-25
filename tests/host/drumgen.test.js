// tests/host/drumgen.test.js
//
// DrumGen through the real host path: the profile dereferences, the module
// instantiates in a worklet, and drum MIDI comes out once the transport
// rolls. Transport and conductor CCs are posted as the messages a host sends,
// and the outgoing events are read back the same way, so this exercises the
// contract's event and transport sections rather than the Rust in isolation.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/drumgen')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/drumgen/'

const SAMPLE_RATE = 48000
const TEMPO = 240
const BEATS_PER_FRAME = TEMPO / (60 * SAMPLE_RATE)

// The Flues kit this defaults to, in lane order.
const KIT = [36, 39, 40, 41, 42, 45, 46, 50, 51, 52, 53]

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'drumgen-processor.js')).href
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

async function drive (node, blocks) {
  for (let b = 0; b < blocks; b++) {
    node.port.postMessage({
      type: 'transport',
      playing: true,
      frame: node.frame,
      beat: node.frame * BEATS_PER_FRAME,
      beatsPerFrame: BEATS_PER_FRAME,
      tempo: TEMPO,
      timeSignature: { beatsPerBar: 4, beatUnit: 4 }
    })
    await settle()
    node.render()
  }
  await settle()
  return node.processor.port.posted
    .filter(m => m.type === 'events')
    .flatMap(m => m.events)
}

const onsets = events => events.filter(e => (e.bytes[0] & 0xf0) === 0x90 && e.bytes[2] > 0)
const signature = events => events.map(e => `${e.frame}:${[...e.bytes].join(',')}`)

describe('drumgen, a transport synced drum generator', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('dereferences the IRI to a generator profile with every control', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('DrumGen')
    expect(profile.ports.map(p => p.symbol).sort()).toEqual([
      'aux_amt', 'backbeat_amt', 'bars', 'channel', 'conductor_ch',
      'density', 'fill', 'fill_amount', 'genre', 'hat_amt', 'kick_amt',
      'kit_map', 'metal_amt', 'mutate', 'new', 'resolution', 'seed',
      'style_mode', 'tom_amt', 'variation', 'vary'
    ])
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiOut')
    expect(profile.requires).toContain('http://purl.org/stuff/transmissions/HostTransport')
    expect(profile.accepts.some(s => s.endsWith('ControlMidi'))).toBe(true)
    expect(profile.produces.some(s => s.endsWith('DrumMidi'))).toBe(true)
  })

  it('runs the init/ready handshake and reports ready', async () => {
    const { entry } = await makeEntry(validator)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(entry.node).toBeInstanceOf(OfflineWorkletNode)
  })

  it('is silent until the transport rolls', async () => {
    const { node } = await makeEntry(validator)
    for (let b = 0; b < 8; b++) node.render()
    await settle()
    expect(node.processor.port.posted.filter(m => m.type === 'events')).toEqual([])
  })

  it('plays the kit on channel 10 once the transport rolls', async () => {
    const { node } = await makeEntry(validator)
    // A full two-bar loop at 240 bpm: 8 beats, 96000 frames, 750 blocks.
    const events = await drive(node, 750)
    const hits = onsets(events)
    // Thirty-two sixteenth steps, several lanes each: silence here would mean
    // the scheduler never fired, not a sparse pattern.
    expect(hits.length).toBeGreaterThan(25)
    for (const e of hits) {
      expect(e.bytes[0]).toBe(0x99)
      expect(KIT).toContain(e.bytes[1])
      expect(e.bytes[2]).toBeGreaterThan(0)
      expect(e.bytes[2]).toBeLessThanOrEqual(127)
    }
    const frames = events.map(e => e.frame)
    expect([...frames].sort((a, b) => a - b)).toEqual(frames)
    expect(Math.max(...frames)).toBeLessThan(750 * 128)
  })

  it('renders silence on its audio outputs and finite samples throughout', async () => {
    const { node } = await makeEntry(validator)
    await drive(node, 40)
    const out = node.render()
    for (const channel of out) {
      expect(channel.every(v => v === 0)).toBe(true)
      expect(channel.every(Number.isFinite)).toBe(true)
    }
  })

  it('plays the same pattern for the same seed, twice', async () => {
    const first = await drive((await makeEntry(validator)).node, 750)
    const second = await drive((await makeEntry(validator)).node, 750)
    expect(signature(second)).toEqual(signature(first))
    expect(onsets(first).length).toBeGreaterThan(25)
  })

  it('starts a fresh pattern on the New trigger', async () => {
    const plain = await makeEntry(validator)
    const before = signature(await drive(plain.node, 750))

    // The trigger fires on the rising edge, so the press lands before the
    // first block and the whole run below plays the regenerated pattern.
    const pressed = await makeEntry(validator)
    pressed.engine.setParameter(pressed.entry.id, 'new', 1)
    const after = signature(await drive(pressed.node, 750))

    expect(before.length).toBeGreaterThan(0)
    expect(after.length).toBeGreaterThan(0)
    expect(after).not.toEqual(before)
  })

  it('thins out when Conductor CC 21 closes the density', async () => {
    const open = await makeEntry(validator)
    open.engine.setParameter(open.entry.id, 'conductor_ch', 3)
    const wide = onsets(await drive(open.node, 750)).length

    const steered = await makeEntry(validator)
    steered.engine.setParameter(steered.entry.id, 'conductor_ch', 3)
    // CC 21 on the conductor channel, the third MIDI channel: density to 0.
    steered.node.port.postMessage({
      type: 'events',
      events: [{ frame: steered.node.frame, bytes: Uint8Array.from([0xb2, 21, 0]) }]
    })
    await settle()
    const narrow = onsets(await drive(steered.node, 750)).length

    // Density 0 keeps the downbeat kick and the guaranteed backbeat but drops
    // the hats and ghosts, so the count falls without reaching zero.
    expect(wide).toBeGreaterThan(narrow)
    expect(narrow).toBeGreaterThan(0)
  })
})
