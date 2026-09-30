// tests/ui/Chiptune.test.js
//
// The Chiptune preset has to do more than open: every voice must actually
// sound with the settings the preset file carries. A preset that opens
// cleanly but holds a seed that never emits, or a voice that never rises,
// passes every generic check in Presets.test.js and is silent on Play. So
// each generator is driven at the preset's tempo with the preset's own
// settings and must emit note onsets, each chip and Pulse voice must render
// signal from a note, and Counterpointer and Cadence must pass what they hear
// with the preset's settings (they learn their cycles from the lead line on
// the page; here a short figure stands in).
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { readProject } from '../../src/rdf/ProjectReader.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const SITE = 'https://site.test/jigdaw/'
const TEMPO = 90
const SAMPLE_RATE = 48000
const BEATS_PER_FRAME = TEMPO / (60 * SAMPLE_RATE)

const PLUGINS = {
  melgen: 'plugins/melgen',
  counterpointer: 'plugins/counterpointer',
  cadence: 'plugins/cadence',
  bassgen: 'plugins/bassgen',
  ground: 'plugins/ground',
  drumgen: 'plugins/drumgen',
  mop: 'plugins/mop',
  '8b8': 'plugins/8b8',
  pulse: 'plugins/pulse'
}

// The preset's own settings, by node id: a preset edit that silences a voice
// fails here, which is the point. Read from the file, not restated, so the
// two cannot disagree about anything but the mapping below.
let voice
beforeAll(async () => {
  const text = readFileSync(resolve(root, 'web/presets/chiptune.ttl'), 'utf8')
  const read = readProject(await parseText(text, `${SITE}presets/chiptune.ttl`))
  voice = {}
  for (const change of read.changes.filter(c => c.op === 'addNode')) {
    voice[change.id] = { plugin: change.pluginIri, settings: change.settings }
  }
  expect(Object.keys(voice)).toHaveLength(10)
})

function makeLoader (validator, dir, canonical) {
  return new PluginLoader({
    fetch: directoryFetch({ [canonical]: resolve(root, dir) }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(root, dir, `${dir.split('/')[1]}-processor.js`)).href
  })
}

async function makeVoice (validator, nodeId) {
  const { plugin, settings } = voice[nodeId]
  const dir = PLUGINS[Object.keys(PLUGINS).find(k => plugin.endsWith(`${k}/`))]
  const context = new OfflineContext({ sampleRate: SAMPLE_RATE })
  const engine = new Engine({
    context,
    loader: makeLoader(validator, dir, plugin),
    AudioWorkletNode: OfflineWorkletNode
  })
  const entry = await engine.addPlugin(plugin)
  for (const [symbol, value] of Object.entries(settings)) engine.setParameter(entry.id, symbol, value)
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

async function drive (node, blocks, every = 10) {
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

function sendNotes (node, notes, channel = 0) {
  node.port.postMessage({
    type: 'events',
    events: notes.map(([frame, pitch]) => ({ frame, bytes: [0x90 | channel, pitch, 100] }))
  })
  return settle()
}

const energy = node => {
  let peak = 0
  for (const channel of node.render()) for (const v of channel) peak = Math.max(peak, Math.abs(v))
  return peak
}

describe('the Chiptune preset sounds', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('states the lead: MelGen emits with the preset seed, root and scale', async () => {
    const { node } = await makeVoice(validator, 'lead')
    expect(onsets(await drive(node, 800)).length).toBeGreaterThan(0)
  })

  it('answers the lead: Counterpointer passes what it hears with the preset cycle', async () => {
    // pass_input is on, so heard notes reach the chip without a learned
    // cycle; on the page the counter-melody joins in from the second cycle.
    const { node } = await makeVoice(validator, 'counter')
    postTransport(node)
    await settle()
    await sendNotes(node, [[0, 69], [0, 72], [0, 76]])
    node.render()
    await settle()
    expect(onsets(await drive(node, 200)).length).toBeGreaterThanOrEqual(3)
  })

  it('comps under the lead: Cadence passes what it hears with the preset key and scale', async () => {
    const { node } = await makeVoice(validator, 'chords')
    postTransport(node)
    await settle()
    await sendNotes(node, [[0, 57], [0, 60], [0, 64]])
    node.render()
    await settle()
    expect(onsets(await drive(node, 200)).length).toBeGreaterThanOrEqual(3)
  })

  it('drives the bass: BassGen emits with the preset genre and root', async () => {
    const { node } = await makeVoice(validator, 'bassline')
    expect(onsets(await drive(node, 800)).length).toBeGreaterThan(0)
  })

  it('plans the sub form: Ground emits with the preset style and shape', async () => {
    const { node } = await makeVoice(validator, 'subform')
    expect(onsets(await drive(node, 1500)).length).toBeGreaterThan(0)
  })

  it('plays the kit: DrumGen emits with the preset genre and map', async () => {
    const { node } = await makeVoice(validator, 'drums')
    expect(onsets(await drive(node, 800)).length).toBeGreaterThan(0)
  })

  it('sounds the square lead from a note through the preset program', async () => {
    const { node } = await makeVoice(validator, 'squlead')
    await sendNotes(node, [[0, 69]])
    let peak = 0
    for (let b = 0; b < 300; b++) peak = Math.max(peak, energy(node))
    expect(peak).toBeGreaterThan(0.01)
  })

  it('sounds the chip bus from a pitched note and a drum note', async () => {
    const { node } = await makeVoice(validator, 'chip')
    await sendNotes(node, [[0, 69]])
    let peak = 0
    for (let b = 0; b < 300; b++) peak = Math.max(peak, energy(node))
    expect(peak).toBeGreaterThan(0.01)

    await sendNotes(node, [[0, 36]], 9)
    peak = 0
    for (let b = 0; b < 300; b++) peak = Math.max(peak, energy(node))
    expect(peak).toBeGreaterThan(0.01)
  })

  for (const voiceId of ['pulseb', 'pulses']) {
    it(`sounds the ${voiceId} from a note through the preset voice`, async () => {
      const { node } = await makeVoice(validator, voiceId)
      await sendNotes(node, [[0, 33]])
      let peak = 0
      for (let b = 0; b < 300; b++) peak = Math.max(peak, energy(node))
      expect(peak).toBeGreaterThan(0.01)
    })
  }
})
