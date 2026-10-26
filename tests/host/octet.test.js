// tests/host/octet.test.js
//
// Octet through the real loader and engine: the profile is fetched and validated, the module's bytes are checked against
// the digest the profile carries and compiled in the processor, audio goes through the node, MIDI arrives as the engine
// sends it, and the spectrum the module measures leaves the processor as a `plugin` message for the plugin's own editor. A
// fake that skipped any of that would pass while a browser did not (CLAUDE.md).
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { parameterDescriptors } from '../../src/host/Parameters.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'
const CANONICAL = `${ORIGIN}plugins/octet/`
const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const built = existsSync(resolve(root, 'plugins/octet/octet.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/octet/build.sh first')

function makeEngine (validator) {
  const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
  const context = new OfflineContext({ sampleRate: 48000 })
  const loader = new PluginLoader({
    fetch: site.fetch, parse: parseText, validator,
    capabilities: detectCapabilities({}), processorUrl: site.processorUrl
  })
  const engine = new Engine({ context, loader, AudioWorkletNode: OfflineWorkletNode })
  engine.testLoader = loader
  return { engine, context, site }
}

const errorsFrom = node => node.processor.port.posted.filter(m => m.type === 'error')
const sine = (hz, amplitude = 0.5) => n => amplitude * Math.sin(2 * Math.PI * hz * n / 48000)
const rms = view => Math.sqrt(view.reduce((s, v) => s + v * v, 0) / view.length)

/** Render blocks of a stereo signal given as functions of the running sample index, returning the left channel. */
function render (node, blocks, left, right = left, start = 0) {
  const out = new Float32Array(blocks * 128)
  for (let b = 0; b < blocks; b++) {
    const l = Float32Array.from({ length: 128 }, (_, i) => left(start + b * 128 + i))
    const r = Float32Array.from({ length: 128 }, (_, i) => right(start + b * 128 + i))
    out.set(node.render([l, r])[0], b * 128)
  }
  return out
}

suite('octet, an eight-band equalizer with an editor of its own', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('loads through the real path and reports ready with no latency', async () => {
    const { engine } = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    expect(entry.ready.latencyFrames).toBe(0)
    expect(errorsFrom(entry.node)).toEqual([])
  })

  it('is an effect with audio and MIDI in, audio out, an editor and nothing to save', async () => {
    const { engine } = makeEngine(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    expect(profile.label).toBe('Octet')
    expect(profile.module).not.toBeNull()
    expect(profile.audioInputs).toBe(1)
    expect(profile.audioOutputs).toBe(1)
    expect(profile.requires).toEqual(['http://purl.org/stuff/jigdaw/MidiEvents'])
    expect(profile.ports).toHaveLength(53)
    expect(profile.ui.location).toBe(`${CANONICAL}ui/index.html`)
    expect(profile.assets ?? []).toEqual([])
  })

  it('registers every port as an AudioParam from the one declaration', async () => {
    const { engine, context } = makeEngine(validator)
    const { profile } = await engine.testLoader.loadProfile(CANONICAL)
    const derived = parameterDescriptors(profile.ports)
    await engine.addPlugin(CANONICAL)
    const registered = context.registry.get('octet').parameterDescriptors
    expect(registered.map(d => d.name).sort()).toEqual(derived.map(d => d.name).sort())
    for (const want of derived) expect(registered.find(d => d.name === want.name)).toMatchObject(want)
  })

  it('passes audio through unchanged on the default patch', async () => {
    const { engine } = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    const out = render(entry.node, 20, sine(440, 0.4))
    const want = Float32Array.from({ length: 20 * 128 }, (_, i) => Math.fround(sine(440, 0.4)(i)))
    expect(Array.from(out)).toEqual(Array.from(want))
  })

  it('takes a boost set through the dispatcher path and moves the level by that much', async () => {
    const { engine } = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    engine.setParameter(entry.id, 'band4_freq', 1000)
    engine.setParameter(entry.id, 'band4_gain', 6)
    const out = render(entry.node, 100, sine(1000, 0.2))
    expect(rms(out.subarray(-4800)) / (0.2 / Math.SQRT2)).toBeCloseTo(10 ** (6 / 20), 1)
  })

  it('applies a controller sent as MIDI, on the channel it was told to listen to', async () => {
    const { engine } = makeEngine(validator)
    const entry = await engine.addPlugin(CANONICAL)
    engine.setParameter(entry.id, 'cc_channel', 2)
    engine.setParameter(entry.id, 'cc_band', 4)
    engine.setParameter(entry.id, 'band4_gain', 12)
    engine.setParameter(entry.id, 'band4_freq', 600)
    const level = () => rms(render(entry.node, 80, sine(5000, 0.2)).subarray(-4800)) / (0.2 / Math.SQRT2)
    const before = level()
    expect(before).toBeCloseTo(1, 1)
    // A controller on another channel does nothing.
    entry.node.port.postMessage({ type: 'events', events: [{ frame: entry.node.frame, bytes: Uint8Array.from([0xb0, 1, 120]) }] })
    await settle()
    expect(level()).toBeCloseTo(1, 1)
    // On the right channel it moves the bell up to the tone.
    entry.node.port.postMessage({ type: 'events', events: [{ frame: entry.node.frame, bytes: Uint8Array.from([0xb1, 1, 112]) }] })
    await settle()
    expect(level()).toBeGreaterThan(1.4)
  })

  describe('the spectrum, for the editor', () => {
    // The processor reposts one object, which a real port clones at once; this stand-in does not, so each post is copied here.
    function recordPlugin (entry) {
      const seen = []
      const port = entry.node.processor.port
      const original = port.postMessage.bind(port)
      port.postMessage = (message, transfer) => {
        if (message?.type === 'plugin') seen.push({ ...message.payload, levels: Float32Array.from(message.payload.levels) })
        return original(message, transfer)
      }
      return seen
    }

    it('sends the 64 levels, the rate and the tap as a plugin message about thirty times a second', async () => {
      const { engine } = makeEngine(validator)
      const entry = await engine.addPlugin(CANONICAL)
      const seen = recordPlugin(entry)
      render(entry.node, 375, sine(2000, 1))
      expect(seen.length).toBeGreaterThanOrEqual(28)
      expect(seen.length).toBeLessThanOrEqual(32)
      const last = seen.at(-1)
      expect(last.levels).toHaveLength(64)
      expect(last.rate).toBe(48000)
      expect(last.source).toBe(2)
      // 2 kHz is two decades above 20 Hz, two thirds of the way up the 64 bands: band 42.
      const peak = last.levels.indexOf(Math.max(...last.levels))
      expect(peak).toBe(42)
      expect(Math.max(...last.levels)).toBeGreaterThan(-3)
    })

    it('says which tap it reads, when the spectrum switch moves', async () => {
      const { engine } = makeEngine(validator)
      const entry = await engine.addPlugin(CANONICAL)
      const seen = recordPlugin(entry)
      engine.setParameter(entry.id, 'spectrum_source', 1)
      render(entry.node, 100, sine(500, 0.5))
      expect(seen.at(-1).source).toBe(1)
    })

    it('sends one clearing message when switched off and then nothing more', async () => {
      const { engine } = makeEngine(validator)
      const entry = await engine.addPlugin(CANONICAL)
      const seen = recordPlugin(entry)
      render(entry.node, 100, sine(500, 0.5))
      engine.setParameter(entry.id, 'spectrum_source', 0)
      render(entry.node, 4, sine(500, 0.5), sine(500, 0.5), 100 * 128)
      const count = seen.length
      expect(Math.max(...seen.at(-1).levels)).toBe(-90)
      render(entry.node, 200, sine(500, 0.5), sine(500, 0.5), 104 * 128)
      expect(seen.length).toBe(count)
    })

    it('sends the editor no more than the relay allows, 60 a second', async () => {
      const { engine } = makeEngine(validator)
      const entry = await engine.addPlugin(CANONICAL)
      const seen = recordPlugin(entry)
      render(entry.node, 375, sine(500, 0.5))
      expect(seen.length).toBeLessThanOrEqual(60)
    })
  })
})
