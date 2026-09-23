// tests/host/squelch.test.js
//
// Squelch through the real loader and a real render. What is measured is what
// a person hears: a resonant lowpass passes lows, cuts highs, rings at its
// cutoff when resonance is up, and opens further on a loud note when the
// envelope is up. And whatever the knobs say, nothing leaves it outside plus
// or minus one.
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
const pluginDir = resolve(root, 'plugins/squelch')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/squelch/'
const RATE = 48000

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'squelch-processor.js')).href
  })
}

const rms = channel => Math.sqrt(channel.reduce((s, v) => s + v * v, 0) / channel.length)

describe('squelch, a resonant lowpass with an envelope follower', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  async function load (settings) {
    const engine = new Engine({ context: new OfflineContext({ sampleRate: RATE }), loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    for (const [symbol, value] of Object.entries(settings)) engine.setParameter(entry.id, symbol, value)
    return entry
  }

  /** The output level of a steady sine, measured after it has settled. */
  function levelOf (entry, frequency, amplitude = 0.1) {
    let phase = 0
    let last = 0
    for (let block = 0; block < 60; block++) {
      const tone = Float32Array.from({ length: 128 }, () => {
        const v = Math.sin(phase) * amplitude
        phase += 2 * Math.PI * frequency / RATE
        return v
      })
      const output = entry.node.render([tone, tone])
      expect(output[0].every(Number.isFinite)).toBe(true)
      if (block >= 40) last = Math.max(last, rms(output[0]))
    }
    return last / (amplitude / Math.SQRT2)
  }

  it('dereferences the IRI and gets a profile that declares no module', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Squelch')
    expect(profile.module).toBeNull()
    expect(profile.ports.map(p => p.symbol).sort()).toEqual(['cutoff', 'decay', 'envelope', 'resonance'])
  })

  it('passes a low tone and cuts a high one', async () => {
    const flat = { cutoff: 500, resonance: 0, envelope: 0 }
    expect(levelOf(await load(flat), 100)).toBeGreaterThan(0.9)
    // Three octaves and more above a 12 dB per octave cutoff.
    expect(levelOf(await load(flat), 8000)).toBeLessThan(0.02)
  })

  it('rings at its cutoff when the resonance is up, which is the peak', async () => {
    const at = { cutoff: 1000, envelope: 0 }
    const damped = levelOf(await load({ ...at, resonance: 0 }), 1000)
    const peaky = levelOf(await load({ ...at, resonance: 100 }), 1000)
    expect(damped).toBeLessThan(0.6)
    expect(peaky / damped, 'resonance did not raise the level at the cutoff').toBeGreaterThan(5)
  })

  it('opens further on a loud signal when the envelope is up', async () => {
    const shut = { cutoff: 300, resonance: 0, decay: 500 }
    const closed = levelOf(await load({ ...shut, envelope: 0 }), 2400, 0.8)
    const opened = levelOf(await load({ ...shut, envelope: 6 }), 2400, 0.8)
    expect(opened / closed, 'the envelope did not move the cutoff').toBeGreaterThan(4)
  })

  it('never leaves plus or minus one, even a hot signal on the peak at full resonance', async () => {
    const entry = await load({ cutoff: 1000, resonance: 100, envelope: 0 })
    const tone = Float32Array.from({ length: 128 }, (_, i) => Math.sin(2 * Math.PI * 1000 * i / RATE) * 1)
    for (let block = 0; block < 100; block++) {
      for (const v of entry.node.render([tone, tone])[0]) expect(Math.abs(v)).toBeLessThanOrEqual(1)
    }
  })

  it('is silent when fed silence', async () => {
    const entry = await load({ resonance: 100, envelope: 6 })
    const silence = new Float32Array(128)
    for (let block = 0; block < 10; block++) expect(rms(entry.node.render([silence, silence])[0])).toBe(0)
  })
})
