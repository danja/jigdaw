// tests/ui/Fugue.test.js
//
// The Fugue preset has to do more than open: every voice must actually sound
// with the settings the preset file carries. A preset that opens cleanly but
// holds a seed that never emits, or a voice that never rises, passes every
// generic check in Presets.test.js and is silent on Play. So each generator
// is driven at the preset's tempo with the preset's own settings and must
// emit note onsets, each Pulse voice must render signal from a note, and
// Cadence must pass what it hears with the preset's settings (it learns its
// cycle from the subject line on the page; here a short figure stands in).
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
const TEMPO = 66
const SAMPLE_RATE = 48000
const BEATS_PER_FRAME = TEMPO / (60 * SAMPLE_RATE)

const PLUGINS = {
  melgen: 'plugins/melgen',
  ground: 'plugins/ground',
  cadence: 'plugins/cadence',
  pulse: 'plugins/pulse'
}

// The preset's own settings, by node id: a preset edit that silences a voice
// fails here, which is the point. Read from the file, not restated, so the
// two cannot disagree about anything but the mapping below.
let voice
beforeAll(async () => {
  const text = readFileSync(resolve(root, 'web/presets/fugue.ttl'), 'utf8')
  const read = readProject(await parseText(text, `${SITE}presets/fugue.ttl`))
  voice = {}
  for (const change of read.changes.filter(c => c.op === 'addNode')) {
    voice[change.id] = { plugin: change.pluginIri, settings: change.settings }
  }
  expect(Object.keys(voice)).toHaveLength(12)
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

function sendNotes (node, notes) {
  node.port.postMessage({ type: 'events', events: notes.map(([frame, pitch]) => ({ frame, bytes: [0x90, pitch, 100] })) })
  return settle()
}

const energy = node => {
  let peak = 0
  for (const channel of node.render()) for (const v of channel) peak = Math.max(peak, Math.abs(v))
  return peak
}

describe('the Fugue preset sounds', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('states the subject: MelGen emits with the preset seed, root and scale', async () => {
    const { node } = await makeVoice(validator, 'subject')
    expect(onsets(await drive(node, 1500)).length).toBeGreaterThan(0)
  })

  it('answers a fifth below: the second MelGen emits on its own seed and root', async () => {
    const { node } = await makeVoice(validator, 'answer')
    expect(onsets(await drive(node, 1500)).length).toBeGreaterThan(0)
  })

  it('walks the long bass form: Ground emits with the preset plan', async () => {
    const { node } = await makeVoice(validator, 'bassline')
    expect(onsets(await drive(node, 3000)).length).toBeGreaterThan(0)
  })

  it('passes what it hears to the organ: Cadence with the preset key and scale', async () => {
    // pass_input is on, so heard notes reach the output without a learned
    // cycle; on the page the cycle comes from the subject line.
    const { node } = await makeVoice(validator, 'chords')
    postTransport(node)
    await settle()
    await sendNotes(node, [[0, 50], [0, 53], [0, 57]])
    node.render()
    await settle()
    expect(onsets(await drive(node, 200)).length).toBeGreaterThanOrEqual(3)
  })

  for (const voiceId of ['violins', 'violas', 'cellos', 'organ']) {
    it(`sounds the ${voiceId} from a note through the preset voice`, async () => {
      const { node } = await makeVoice(validator, voiceId)
      await sendNotes(node, [[0, 62]])
      let peak = 0
      for (let b = 0; b < 300; b++) peak = Math.max(peak, energy(node))
      expect(peak).toBeGreaterThan(0.01)
    })
  }
})
