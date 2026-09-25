// tests/host/melgen.test.js
//
// MelGen through the real host path: the profile dereferences, the module
// instantiates in a worklet, and a phrase-aware melody comes out once the
// transport rolls. Transport, follow notes and conductor CCs are posted as
// the messages a host sends, and the outgoing events are read back the same
// way, so this exercises the contract's generator path rather than the Rust
// in isolation.
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
const pluginDir = resolve(root, 'plugins/melgen')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/melgen/'

const SAMPLE_RATE = 48000
const TEMPO = 120
const BEATS_PER_FRAME = TEMPO / (60 * SAMPLE_RATE)

// C major pitch classes, for the default scale with color off.
const MAJOR = [0, 2, 4, 5, 7, 9, 11]

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'melgen-processor.js')).href
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

const onsets = events => events.filter(e => (e.bytes[0] & 0xf0) === 0x90 && e.bytes[2] > 0)
const signature = events => events.map(e => `${e.frame}:${[...e.bytes].join(',')}`)

describe('melgen, a phrase-aware melody generator', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('dereferences the IRI to a generator profile with every control', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('MelGen')
    expect(profile.ports).toHaveLength(26)
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiOut')
    expect(profile.requires).toContain('http://purl.org/stuff/transmissions/HostTransport')
    expect(profile.accepts.some(s => s.endsWith('ControlMidi'))).toBe(true)
    expect(profile.produces.some(s => s.endsWith('MelodyMidi'))).toBe(true)
  })

  it('declares the same parameters in the profile and the processor', async () => {
    // Two lists name the controls: profile.json ports and the processor's
    // parameterDescriptors. The module end is bound by the mute-free
    // behavioural tests below, which steer voices by symbol.
    const template = JSON.parse(await readFile(resolve(pluginDir, 'profile.json'), 'utf8'))
    const source = await readFile(resolve(pluginDir, 'melgen-processor.js'), 'utf8')
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

  it('is silent until the transport rolls', async () => {
    const { node } = await makeEntry(validator)
    for (let b = 0; b < 8; b++) node.render()
    await settle()
    expect(node.processor.port.posted.filter(m => m.type === 'events')).toEqual([])
  })

  it('plays a C major line on channel 1 once the transport rolls', async () => {
    const { engine, entry, node } = await makeEntry(validator)
    engine.setParameter(entry.id, 'color', 0)
    const events = await drive(node, 400)
    const hits = onsets(events)
    expect(hits.length).toBeGreaterThan(0)
    for (const e of hits) {
      expect(e.bytes[0]).toBe(0x90)
      expect(MAJOR).toContain(((e.bytes[1] - 60) % 12 + 12) % 12)
      expect(e.bytes[2]).toBeGreaterThanOrEqual(1)
      expect(e.bytes[2]).toBeLessThanOrEqual(127)
    }
    const frames = events.map(e => e.frame)
    expect([...frames].sort((a, b) => a - b)).toEqual(frames)
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

  it('plays the same line for the same seed, twice', async () => {
    const first = await drive((await makeEntry(validator)).node, 400)
    const second = await drive((await makeEntry(validator)).node, 400)
    expect(signature(second)).toEqual(signature(first))
    expect(onsets(first).length).toBeGreaterThan(0)
  })

  it('starts a fresh line on the New trigger', async () => {
    const plain = await makeEntry(validator)
    const before = signature(await drive(plain.node, 400))

    // The trigger fires on the rising edge, so the press lands before the
    // first block and the whole run below plays the regenerated line.
    const pressed = await makeEntry(validator)
    pressed.engine.setParameter(pressed.entry.id, 'new', 1)
    const after = signature(await drive(pressed.node, 400))

    expect(before.length).toBeGreaterThan(0)
    expect(after.length).toBeGreaterThan(0)
    expect(after).not.toEqual(before)
  })

  it('follows an incoming line without input sounding like no follow', async () => {
    // Follow with nothing to follow is a passthrough: the pull has no pitch.
    // Shorter drives than elsewhere here: four runs through this test, and
    // the pull shows from the first notes either way.
    const off = await makeEntry(validator)
    const plain = signature(await drive(off.node, 350))

    const idle = await makeEntry(validator)
    idle.engine.setParameter(idle.entry.id, 'follow', 1)
    const unfollowed = signature(await drive(idle.node, 350))
    expect(unfollowed).toEqual(plain)

    // A held note pulls the line toward it, so the stream changes but stays
    // in key: the pull snaps back to the scale.
    const steered = await makeEntry(validator)
    steered.engine.setParameter(steered.entry.id, 'follow', 1)
    steered.engine.setParameter(steered.entry.id, 'color', 0)
    steered.node.port.postMessage({
      type: 'events',
      events: [{ frame: steered.node.frame, bytes: Uint8Array.from([0x90, 72, 100]) }]
    })
    await settle()
    const pulled = await drive(steered.node, 350)
    expect(signature(pulled).length).toBeGreaterThan(0)
    const reference = await makeEntry(validator)
    reference.engine.setParameter(reference.entry.id, 'color', 0)
    expect(signature(pulled)).not.toEqual(signature(await drive(reference.node, 350)))
    for (const e of onsets(pulled)) {
      expect(MAJOR).toContain(((e.bytes[1] - 60) % 12 + 12) % 12)
    }
  })

  it('thins out when Conductor CC 22 closes the density', async () => {
    // The full loop length here is load-bearing, not arbitrary: at shorter
    // drives even full density yields barely an onset, leaving no margin for
    // the comparison. Density differences only show over a whole phrase.
    const open = await makeEntry(validator)
    open.engine.setParameter(open.entry.id, 'conductor_ch', 3)
    const wide = onsets(await drive(open.node, 750)).length

    const steered = await makeEntry(validator)
    steered.engine.setParameter(steered.entry.id, 'conductor_ch', 3)
    // CC 22 on the conductor channel, the third MIDI channel: density to 0.
    steered.node.port.postMessage({
      type: 'events',
      events: [{ frame: steered.node.frame, bytes: Uint8Array.from([0xb2, 22, 0]) }]
    })
    await settle()
    const narrow = onsets(await drive(steered.node, 750)).length

    expect(wide).toBeGreaterThan(narrow)
  })

  it('spreads notes across blocks when transport updates are sparse', async () => {
    // The flywheel test, as in drumgen and bassgen: Jiggy reports the beat
    // on a slow loop, and the line must sound the same as with per-block
    // updates rather than quantising to the update grid.
    const dense = await drive((await makeEntry(validator)).node, 400, 1)
    const flown = await drive((await makeEntry(validator)).node, 400, 80)
    expect(onsets(dense).length).toBeGreaterThan(0)
    expect(signature(flown)).toEqual(signature(dense))
  })
})
