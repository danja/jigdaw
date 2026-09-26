// tests/host/drumkit.test.js
//
// DrumKit through the real host path: the profile dereferences, the module
// instantiates in a worklet, and MIDI notes come out as drum audio. Notes
// and CCs are posted as the messages a host sends, and the rendered stereo
// is read back the same way, so this exercises the contract's instrument
// path rather than the Rust in isolation.
//
// The behavioural vectors mirror downspout's own core tests: a kick renders,
// a muted voice does not, the transient adds attack, the closed hat chokes
// the open one even muted, and CC 123 stops everything.
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
const pluginDir = resolve(root, 'plugins/drumkit')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/drumkit/'

const NOTES = [36, 39, 40, 41, 42, 45, 46, 50, 51, 52, 53]

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'drumkit-processor.js')).href
  })
}

async function makeEntry (validator) {
  const context = new OfflineContext({ sampleRate: 48000 })
  const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
  const entry = await engine.addPlugin(CANONICAL)
  return { engine, entry, node: entry.node }
}

// Message delivery hops through the ports, so let the queue drain on a real
// tick rather than a microtask checkpoint.
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

async function note (node, note, velocity = 110) {
  node.port.postMessage({
    type: 'events',
    events: [{ frame: node.frame, bytes: Uint8Array.from([0x99, note, velocity]) }]
  })
  await settle()
}

async function cc (node, number) {
  node.port.postMessage({
    type: 'events',
    events: [{ frame: node.frame, bytes: Uint8Array.from([0xb0, number, 0]) }]
  })
  await settle()
}

// Sum of absolute samples over both channels, however many blocks are
// rendered. The downspout core tests measure the same thing.
function energy (node, blocks) {
  let sum = 0
  for (let b = 0; b < blocks; b++) {
    for (const channel of node.render()) {
      for (const sample of channel) sum += Math.abs(sample)
    }
  }
  return sum
}

describe('drumkit, a synthesised drum instrument', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('dereferences the IRI to an instrument profile with 75 controls', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('DrumKit')
    expect(profile.ports).toHaveLength(75)
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(profile.requires).not.toContain('http://purl.org/stuff/jigdaw/MidiOut')
    expect(profile.accepts.some(s => s.endsWith('DrumMidi'))).toBe(true)
    expect(profile.produces.some(s => s.endsWith('Audio'))).toBe(true)
  })

  it('declares the same parameters in the profile, the processor and the module order', async () => {
    // Three lists name the controls: profile.json ports, the processor's
    // parameterDescriptors, and the module's jig:paramIndex. The first two
    // are text here and checkable directly; the module end is bound by the
    // mute and pan tests below, which steer voices by symbol.
    const template = JSON.parse(await readFile(resolve(pluginDir, 'profile.json'), 'utf8'))
    const source = await readFile(resolve(pluginDir, 'drumkit-processor.js'), 'utf8')
    const dials = [...source.matchAll(/dial\('([^']+)',\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/g)]
      .map(m => ({ symbol: m[1], default: Number(m[2]), min: Number(m[3]), max: Number(m[4]) }))
    expect(dials.map(d => d.symbol)).toEqual(template.ports.map(p => p.symbol))
    for (const [i, port] of template.ports.entries()) {
      expect(dials[i].default, port.symbol).toBe(port.default)
      expect(dials[i].min, port.symbol).toBe(port.minimum)
      expect(dials[i].max, port.symbol).toBe(port.maximum)
    }
  })

  it('groups the voices, so 75 controls read as sections', async () => {
    // One group per drum voice, from the symbol prefix the profile assigns;
    // the generated panel sections by it. Bit Crush stands alone, which also
    // exercises the panel's ungrouped path on a real plugin.
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    const groups = new Map()
    for (const port of profile.ports) {
      const voice = port.symbol.startsWith('hh_closed') ? 'hh_closed'
        : port.symbol.startsWith('hh_open') ? 'hh_open' : port.symbol.split('_')[0]
      if (voice === 'bit') {
        expect(port.group, port.symbol).toBeNull()
        continue
      }
      expect(port.group, port.symbol).not.toBeNull()
      if (!groups.has(voice)) groups.set(voice, port.group)
      else expect(port.group, port.symbol).toBe(groups.get(voice))
    }
    expect([...groups.values()].sort()).toEqual(
      ['Bash', 'Clap', 'Clave', 'Closed HH', 'Cowbell', 'Crash',
        'Kick', 'Master', 'Open HH', 'Snare', 'Tom 1', 'Tom 2'].sort())
  })

  it('runs the init/ready handshake and reports ready', async () => {
    const { entry } = await makeEntry(validator)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(entry.node).toBeInstanceOf(OfflineWorkletNode)
  })

  it('is silent with no notes, and finite throughout', async () => {
    const { node } = await makeEntry(validator)
    for (let b = 0; b < 4; b++) {
      for (const channel of node.render()) {
        expect(channel.every(v => v === 0)).toBe(true)
        expect(channel.every(Number.isFinite)).toBe(true)
      }
    }
  })

  it('renders every voice on its note', async () => {
    // The crash is why this renders each voice rather than one of them: the
    // port fixes an upstream unit slip that left its bandpass cascade at a
    // clamped 20 Hz, which this would hear as silence.
    for (const midiNote of NOTES) {
      const { node } = await makeEntry(validator)
      await note(node, midiNote)
      const hit = energy(node, 4)
      expect(hit, `note ${midiNote} rendered nothing`).toBeGreaterThan(1.0)
    }
  })

  it('plays the same hit twice, bit for bit', async () => {
    const first = await makeEntry(validator)
    await note(first.node, 36)
    const a = [first.node.render()[0].slice(), first.node.render()[1].slice()]
    const second = await makeEntry(validator)
    await note(second.node, 36)
    const b = [second.node.render()[0].slice(), second.node.render()[1].slice()]
    expect([...b[0]]).toEqual([...a[0]])
    expect([...b[1]]).toEqual([...a[1]])
    expect(a[0].some(v => v !== 0)).toBe(true)
  })

  it('a muted voice ignores its note, and sounds again unmuted', async () => {
    const { engine, entry, node } = await makeEntry(validator)
    engine.setParameter(entry.id, 'kick_mute', 1)
    await note(node, 36)
    expect(energy(node, 4)).toBeLessThan(1e-6)

    engine.setParameter(entry.id, 'kick_mute', 0)
    await note(node, 36)
    expect(energy(node, 4)).toBeGreaterThan(1.0)
  })

  it('the kick transient adds attack energy', async () => {
    const dry = await makeEntry(validator)
    dry.engine.setParameter(dry.entry.id, 'master_reverb', 0)
    dry.engine.setParameter(dry.entry.id, 'kick_drive', 0)
    dry.engine.setParameter(dry.entry.id, 'kick_punch', 0)
    await note(dry.node, 36)
    const dryAttack = energy(dry.node, 1)

    const transient = await makeEntry(validator)
    transient.engine.setParameter(transient.entry.id, 'master_reverb', 0)
    transient.engine.setParameter(transient.entry.id, 'kick_drive', 0)
    transient.engine.setParameter(transient.entry.id, 'kick_punch', 0)
    transient.engine.setParameter(transient.entry.id, 'kick_transient', 1)
    await note(transient.node, 36)
    expect(energy(transient.node, 1)).toBeGreaterThan(dryAttack * 1.05)
  })

  it('the closed hat chokes the open hat even when muted', async () => {
    const { engine, entry, node } = await makeEntry(validator)
    engine.setParameter(entry.id, 'master_reverb', 0)
    engine.setParameter(entry.id, 'hh_closed_mute', 1)
    await note(node, 46)
    const ringing = energy(node, 1)
    expect(ringing).toBeGreaterThan(0.01)
    await note(node, 42)
    // The open voice is killed outright, so what follows is bus zeros rather
    // than a decay, however short.
    expect(energy(node, 4)).toBeLessThan(ringing)
  })

  it('CC 123 stops every voice and the bus', async () => {
    const { node } = await makeEntry(validator)
    await note(node, 51)
    expect(energy(node, 1)).toBeGreaterThan(0.01)
    await cc(node, 123)
    expect(energy(node, 4)).toBeLessThan(1e-6)
  })

  it('pans a voice across the stereo field by symbol', async () => {
    // kick_pan is paramIndex 64 in the module; steering it by symbol proves
    // the profile order and the module order agree.
    const { engine, entry, node } = await makeEntry(validator)
    engine.setParameter(entry.id, 'master_reverb', 0)
    engine.setParameter(entry.id, 'kick_pan', 1)
    await note(node, 36)
    let left = 0
    let right = 0
    for (let b = 0; b < 4; b++) {
      const [l, r] = node.render()
      for (const v of l) left += Math.abs(v)
      for (const v of r) right += Math.abs(v)
    }
    expect(right).toBeGreaterThan(1.0)
    expect(left).toBeLessThan(1e-6)
  })
})
