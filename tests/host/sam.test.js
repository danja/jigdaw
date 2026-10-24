// tests/host/sam.test.js
//
// Sam through the real loader and engine: the profile is fetched and validated, the module's bytes
// are checked against the digest the profile carries and compiled in the processor, the shipped
// text arrives as a jig:asset, and a replacement arrives as loadAsset, as it would from the panel.
// A fake that skipped any of that would pass while a browser did not (CLAUDE.md).
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const CANONICAL = `${ORIGIN}plugins/sam/`
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
const text = string => new TextEncoder().encode(string).buffer

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

const errorsFrom = (node, from = 0) => node.processor.port.posted.slice(from).filter(m => m.type === 'error')

/** Send MIDI at the node's current frame and render `blocks` quanta, returning the left channel. */
async function play (node, messages, blocks) {
  node.port.postMessage({ type: 'events', events: messages.map(bytes => ({ frame: node.frame, bytes: Uint8Array.from(bytes) })) })
  await settle()
  return render(node, blocks)
}

function render (node, blocks) {
  const out = new Float32Array(blocks * 128)
  for (let i = 0; i < blocks; i++) out.set(node.render()[0], i * 128)
  return out
}

const peak = view => view.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

describe('sam, a speech synthesiser', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('loads through the real path and reports ready with no latency', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(errorsFrom(entry.node)).toEqual([])
  })

  it('is an instrument with a module, MIDI in, audio out and the text as a replaceable asset', async () => {
    const engine = makeEngine(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    expect(profile.label).toBe('Sam')
    expect(profile.module).not.toBeNull()
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(profile.ports).toHaveLength(17)
    expect(profile.assets.map(a => [a.iri.split('#')[1], a.userReplaceable])).toEqual([['text', true]])
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

  it('is audible untouched: a fresh plugin speaks when a key is pressed', async () => {
    // CLAUDE.md: assert that a fresh plugin is audible untouched. Defaults only, no parameter set.
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    expect(peak(render(entry.node, 20))).toBe(0)
    const out = await play(entry.node, [[0x90, 60, 100]], 120)
    expect(peak(out)).toBeGreaterThan(0.02)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(errorsFrom(entry.node)).toEqual([])
  })

  it('speaks the shipped text: its first word is the shipped first word', async () => {
    const engine = makeEngine(validator)
    const shipped = readFileSync(resolve(root, 'plugins/sam/text.txt'), 'utf8').trim().split(/\s+/)
    const a = await engine.addPlugin(CANONICAL)
    const first = await play(a.node, [[0x90, 60, 100]], 120)
    // A second plugin given just that first word in place of the file speaks the same samples.
    const b = await engine.addPlugin(CANONICAL)
    b.node.port.postMessage({ type: 'loadAsset', key: 'text', bytes: text(shipped[0]) })
    await settle()
    const alone = await play(b.node, [[0x90, 60, 100]], 120)
    expect(Array.from(alone)).toEqual(Array.from(first))
  })

  it('replaces the text with loadAsset, and a state request returns what is loaded', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    const bytes = text('zero')
    entry.node.port.postMessage({ type: 'loadAsset', key: 'text', bytes })
    await settle()
    entry.node.port.postMessage({ type: 'stateRequest', token: 7 })
    await settle()
    const reply = entry.node.processor.port.posted.find(m => m.type === 'state' && m.token === 7)
    expect(reply.state.text).toBe(bytes)
    const out = await play(entry.node, [[0x90, 60, 100]], 120)
    expect(peak(out)).toBeGreaterThan(0.02)
  })

  it('a state request before any replacement returns the shipped text', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'stateRequest', token: 1 })
    await settle()
    const reply = entry.node.processor.port.posted.find(m => m.type === 'state' && m.token === 1)
    expect(new TextDecoder().decode(reply.state.text)).toBe(readFileSync(resolve(root, 'plugins/sam/text.txt'), 'utf8'))
  })

  it('a bad asset is reported without stopping the music', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'loadAsset', key: 'text', bytes: 'not bytes' })
    await settle()
    const errors = errorsFrom(entry.node)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ phase: 'asset', fatal: false })
    const out = await play(entry.node, [[0x90, 60, 100]], 120)
    expect(peak(out)).toBeGreaterThan(0.02)
  })

  it('a different asset key is ignored', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.port.postMessage({ type: 'loadAsset', key: 'scl', bytes: text('zero') })
    await settle()
    expect(errorsFrom(entry.node)).toEqual([])
  })

  it('moves a parameter: Level 0 is silent', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.parameters.get('level').value = 0
    const out = await play(entry.node, [[0x90, 60, 100]], 120)
    expect(peak(out)).toBe(0)
  })

  it('Transport mode speaks from the host transport message and not before the start bar', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.parameters.get('mode').value = 1
    entry.node.parameters.get('start_bar').value = 2
    // The host sends this each quantum: the beat now, and how fast it advances.
    const perFrame = 120 / (60 * 48000)
    let beat = 0
    let first = -1
    for (let i = 0; i < 1000; i++) {
      entry.node.port.postMessage({
        type: 'transport', playing: true, frame: entry.node.frame, beat, beatsPerFrame: perFrame,
        tempo: 120, timeSignature: { beatsPerBar: 4, beatUnit: 4 }
      })
      await settle()
      const out = entry.node.render()[0]
      if (first < 0 && peak(out) > 0) first = entry.node.frame - 128 + out.findIndex(v => v !== 0)
      beat += 128 * perFrame
    }
    // Beat 4 at 120 bpm is 96000 frames.
    expect(first).toBeGreaterThanOrEqual(96000)
    expect(first).toBeLessThan(96000 + 0.05 * 48000)
  })
})
