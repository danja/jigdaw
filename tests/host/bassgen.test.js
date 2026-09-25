// tests/host/bassgen.test.js
//
// BassGen through the real host path, focused on what the 100ms transport
// loop does to it. Jiggy tells the plugins where the transport is on that
// loop rather than every quantum: scheduling purely from the supplied beat
// replays the same step while it repeats, then skips ahead on the next
// update, quantising the line to the update grid. The module's beat clock
// flywheels through the gaps instead, so a sparse transport sounds exactly
// like a dense one.
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
const pluginDir = resolve(root, 'plugins/bassgen')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/bassgen/'

const SAMPLE_RATE = 48000
const TEMPO = 120
const BEATS_PER_FRAME = TEMPO / (60 * SAMPLE_RATE)

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'bassgen-processor.js')).href
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

describe('bassgen, a transport synced bass line generator', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('runs the init/ready handshake and reports ready', async () => {
    const { entry } = await makeEntry(validator)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(entry.profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
  })

  it('plays a line once the transport rolls', async () => {
    const { node } = await makeEntry(validator)
    const hits = onsets(await drive(node, 750))
    expect(hits.length).toBeGreaterThan(0)
  })

  it('sounds the same line whether transport updates are dense or sparse', async () => {
    // An update every 150 blocks covers about three steps at this tempo: the
    // old code skipped the steps between updates and played only where each
    // one landed.
    const dense = await drive((await makeEntry(validator)).node, 750, 1)
    const flown = await drive((await makeEntry(validator)).node, 750, 150)
    expect(onsets(dense).length).toBeGreaterThan(0)
    expect(signature(flown)).toEqual(signature(dense))
  })
})
