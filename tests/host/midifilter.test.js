// tests/host/midifilter.test.js
//
// The whole path, for real, headless: the plugin is loaded by the real loader
// and its processor runs in the offline worklet host. Every message goes in as
// the host sends it and what comes out is what the next plugin would receive.
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
const pluginDir = resolve(root, 'plugins/midifilter')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/midifilter/'

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'midifilter-processor.js')).href
  })
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

/** Send messages, run two quanta, and return what came out as [status, data1, data2] lists. */
async function through (node, messages) {
  const before = node.processor.port.posted.length
  node.port.postMessage({
    type: 'events',
    events: messages.map((bytes, i) => ({ frame: node.frame + i, bytes: Uint8Array.from(bytes) }))
  })
  await settle()
  node.render()
  node.render()
  await settle()
  return node.processor.port.posted.slice(before)
    .filter(m => m.type === 'events')
    .flatMap(m => m.events)
    .map(e => [...e.bytes])
}

describe('midifilter, a MIDI channel filter, remap, transpose and range gate', () => {
  let validator, engine, entry
  const setup = async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    entry = await engine.addPlugin(CANONICAL)
    return entry.node
  }
  const set = (symbol, value) => engine.setParameter(entry.id, symbol, value)
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares no module, requires MIDI both ways, and offers five settings', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('MIDI Filter')
    expect(profile.module).toBeNull()
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiOut')
    expect(profile.ports.map(p => p.symbol).sort()).toEqual(['high_note', 'in_channel', 'low_note', 'out_channel', 'transpose'])
  })

  it('reports ready with no latency, and passes everything at its defaults', async () => {
    const node = await setup()
    expect(entry.ready.latencyFrames).toBe(0)
    const messages = [[0x90, 60, 100], [0x80, 60, 0], [0xb0, 7, 90], [0xe0, 0, 64], [0x93, 40, 80]]
    expect(await through(node, messages)).toEqual(messages)
  })

  it('keeps one channel and drops the others, notes and controls alike', async () => {
    const node = await setup()
    set('in_channel', 2)
    const out = await through(node, [[0x90, 60, 100], [0x91, 61, 100], [0xb1, 7, 90], [0xb0, 7, 90]])
    expect(out).toEqual([[0x91, 61, 100], [0xb1, 7, 90]])
  })

  it('sends what it keeps on another channel', async () => {
    const node = await setup()
    set('out_channel', 10)
    expect(await through(node, [[0x90, 36, 100], [0xb0, 7, 90], [0x80, 36, 0]])).toEqual([[0x99, 36, 100], [0xb9, 7, 90], [0x89, 36, 0]])
  })

  it('transposes notes and leaves other messages alone, and drops a note pushed off the keyboard', async () => {
    const node = await setup()
    set('transpose', 12)
    const out = await through(node, [[0x90, 60, 100], [0xb0, 1, 5], [0x90, 120, 100], [0x80, 60, 0], [0x80, 120, 0]])
    expect(out).toEqual([[0x90, 72, 100], [0xb0, 1, 5], [0x80, 72, 0]])
  })

  it('passes only the notes inside a range, ends included', async () => {
    const node = await setup()
    set('low_note', 48)
    set('high_note', 59)
    const out = await through(node, [[0x90, 47, 90], [0x90, 48, 90], [0x90, 59, 90], [0x90, 60, 90]])
    expect(out.map(m => m[1])).toEqual([48, 59])
  })

  it('splits a keyboard between two of them with no note lost or doubled', async () => {
    const low = await setup()
    set('high_note', 59)
    const high = await setup()
    set('low_note', 60)
    const notes = [40, 59, 60, 84]
    const messages = notes.map(n => [0x90, n, 90])
    const a = (await through(low, messages)).map(m => m[1])
    const b = (await through(high, messages)).map(m => m[1])
    expect([...a, ...b].sort((x, y) => x - y)).toEqual(notes)
    expect(a).toEqual([40, 59])
    expect(b).toEqual([60, 84])
  })

  it('turns a note off on the pitch and channel it went out on, even if a setting changed while it was held', async () => {
    const node = await setup()
    set('transpose', 7)
    set('out_channel', 3)
    expect(await through(node, [[0x90, 60, 100]])).toEqual([[0x92, 67, 100]])
    set('transpose', -12)
    set('out_channel', 5)
    expect(await through(node, [[0x80, 60, 0]])).toEqual([[0x82, 67, 0]])
  })

  it('sends no note-off for a note-on it dropped, and none twice', async () => {
    const node = await setup()
    set('low_note', 70)
    expect(await through(node, [[0x90, 60, 100], [0x80, 60, 0]])).toEqual([])
    set('low_note', 0)
    expect(await through(node, [[0x90, 60, 100], [0x80, 60, 0], [0x80, 60, 0]])).toEqual([[0x90, 60, 100], [0x80, 60, 0]])
  })

  it('treats a note-on with velocity 0 as the note-off it is', async () => {
    const node = await setup()
    set('transpose', 2)
    expect(await through(node, [[0x90, 60, 100], [0x90, 60, 0]])).toEqual([[0x90, 62, 100], [0x80, 62, 0]])
  })

  it('always passes system messages, and a short one keeps its length', async () => {
    const node = await setup()
    set('in_channel', 5)
    expect(await through(node, [[0xf8], [0xc0, 3]])).toEqual([[0xf8]])
    set('in_channel', 1)
    expect(await through(node, [[0xc0, 3]])).toEqual([[0xc0, 3]])
  })

  it('keeps every message at its own frame, and renders with no audio output', async () => {
    const node = await setup()
    const before = node.processor.port.posted.length
    node.port.postMessage({ type: 'events', events: [{ frame: node.frame + 5, bytes: Uint8Array.from([0x90, 60, 100]) }] })
    await settle()
    node.render()
    await settle()
    const events = node.processor.port.posted.slice(before).filter(m => m.type === 'events').flatMap(m => m.events)
    expect(events.map(e => e.frame)).toEqual([node.frame - 128 + 5])
    // It has no audio output, and a real node hands its processor an empty `outputs`: rendering
    // must neither throw nor produce audio.
    expect(() => node.render()).not.toThrow()
    expect(node.render()).toEqual([])
  })
})
