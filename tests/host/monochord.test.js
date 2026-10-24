// tests/host/monochord.test.js
//
// Monochord through the real loader and engine: the profile is fetched and validated, the module's
// bytes are checked against the digest the profile carries and compiled in the processor, and MIDI
// arrives as the engine sends it. A fake that skipped any of that would pass while a browser did
// not (CLAUDE.md).
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const CANONICAL = `${ORIGIN}plugins/monochord/`
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

const errorsFrom = node => node.processor.port.posted.filter(m => m.type === 'error')

function render (node, blocks) {
  const out = new Float32Array(blocks * 128)
  for (let i = 0; i < blocks; i++) out.set(node.render()[0], i * 128)
  return out
}

/** Send MIDI at the node's current frame and render `blocks` quanta, returning the left channel. */
async function play (node, messages, blocks) {
  node.port.postMessage({ type: 'events', events: messages.map(bytes => ({ frame: node.frame, bytes: Uint8Array.from(bytes) })) })
  await settle()
  return render(node, blocks)
}

const peak = view => view.reduce((m, v) => Math.max(m, Math.abs(v)), 0)

describe('monochord, a waveguide string', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('loads through the real path and reports ready with no latency', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(errorsFrom(entry.node)).toEqual([])
  })

  it('is an instrument with a module, MIDI in and audio out, and nothing to save', async () => {
    const engine = makeEngine(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    expect(profile.label).toBe('Monochord')
    expect(profile.module).not.toBeNull()
    expect(profile.requires).toEqual(['http://purl.org/stuff/jigdaw/MidiEvents'])
    expect(profile.ports).toHaveLength(14)
    expect(profile.assets ?? []).toEqual([])
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

  it('is audible untouched: a fresh plugin sounds when a key is pressed, and is silent before', async () => {
    // CLAUDE.md: assert that a fresh plugin is audible untouched. Defaults only, no parameter set.
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    expect(peak(render(entry.node, 20))).toBe(0)
    const out = await play(entry.node, [[0x90, 57, 100]], 120)
    expect(peak(out)).toBeGreaterThan(0.05)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(errorsFrom(entry.node)).toEqual([])
  })

  it('answers a parameter change made through the node', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    const loud = await play(entry.node, [[0x90, 57, 100]], 60)
    const quiet = await (async () => {
      const other = await engine.addPlugin(CANONICAL)
      other.node.parameters.get('master').value = 0.1
      return play(other.node, [[0x90, 57, 100]], 60)
    })()
    expect(peak(quiet)).toBeLessThan(0.4 * peak(loud))
  })

  it('stops sounding when a note is released and the damper has done its work', async () => {
    const engine = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    entry.node.parameters.get('release').value = 20
    await play(entry.node, [[0x90, 57, 100]], 10)
    await play(entry.node, [[0x80, 57, 0]], 10)
    expect(peak(render(entry.node, 100).subarray(5000))).toBeLessThan(1e-3)
  })
})
