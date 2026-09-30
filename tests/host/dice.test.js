// tests/host/dice.test.js
//
// The whole path, for real, headless, for the second plugin answering state
// requests. Contract section 8 is the clause: state is what parameters do not
// carry, and with two stateful nodes the host must route each reply by token.
// Same shape as tests/host/tremolo.test.js for the plugin half, plus the
// joint round trip with Ferrite the item this covers asks for.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { encodeState, decodeState } from '../../src/host/StateCodec.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/dice')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/dice/'
const FERRITE = 'https://strandz.it/jigdaw/plugins/ferrite/'

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'dice-processor.js')).href
  })
}

async function loadedEntry (validator) {
  const context = new OfflineContext({ sampleRate: 48000 })
  const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
  const entry = await engine.addPlugin(CANONICAL)
  return { context, engine, entry }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

const NOTE_ON = notes => ({
  type: 'events',
  events: notes.map(([pitch, frame]) => ({ frame, bytes: Uint8Array.from([0x90, pitch, 100]) }))
})

const NOTE_OFF = notes => ({
  type: 'events',
  events: notes.map(([pitch, frame]) => ({ frame, bytes: Uint8Array.from([0x80, pitch, 0]) }))
})

/** Post note-ons, run two quanta, and return what the processor emitted. */
async function play (node, pitches, fromFrame = node.frame) {
  const before = node.processor.port.posted.length
  node.port.postMessage(NOTE_ON(pitches.map((pitch, i) => [pitch, fromFrame + i * 10])))
  await settle()
  node.render()
  node.render()
  await settle()
  return node.processor.port.posted.slice(before)
    .filter(m => m.type === 'events')
    .flatMap(m => m.events)
}

const passedOns = events => events
  .filter(e => (e.bytes[0] & 0xf0) === 0x90 && e.bytes[2] > 0)
  .map(e => e.bytes[1])

describe('dice, a MIDI probability gate', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares no module and requires MIDI in both directions', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Dice')
    expect(profile.module).toBeNull()
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiOut')
    expect(profile.ports.map(p => p.symbol).sort()).toEqual(['probability', 'reseed', 'seed'])
  })

  it('reports ready with no latency', async () => {
    const { entry } = await loadedEntry(validator)
    expect(entry.ready.latencyFrames).toBe(0)
  })

  it('passes everything at probability 1, including every note-off', async () => {
    const { entry } = await loadedEntry(validator)
    const pitches = [60, 61, 62, 63, 64]
    const out = await play(entry.node, pitches)
    expect(passedOns(out)).toEqual(pitches)

    const before = entry.node.processor.port.posted.length
    entry.node.port.postMessage(NOTE_OFF(pitches.map(p => [p, 256])))
    await settle()
    entry.node.render()
    await settle()
    const offs = entry.node.processor.port.posted.slice(before)
      .filter(m => m.type === 'events')
      .flatMap(m => m.events)
      .map(e => e.bytes[1])
    expect(offs).toEqual(pitches)
  })

  it('drops everything at probability 0, and leaks no note-off', async () => {
    const { engine, entry } = await loadedEntry(validator)
    engine.setParameter(entry.id, 'probability', 0)
    const pitches = [60, 61, 62]
    expect(passedOns(await play(entry.node, pitches))).toEqual([])

    entry.node.port.postMessage(NOTE_OFF(pitches.map(p => [p, 256])))
    await settle()
    entry.node.render()
    await settle()
    // Still nothing: a note-off for a dropped note-on is dropped, never
    // passed, so nothing downstream is left sustaining. And the queue did
    // not accumulate: reopened, the same notes play.
    expect(passedOns(await play(entry.node, pitches))).toEqual([])
    engine.setParameter(entry.id, 'probability', 1)
    expect(passedOns(await play(entry.node, pitches))).toEqual(pitches)
  })

  it('gates deterministically from the seed', async () => {
    // The same seed and the same notes gate the same way twice, which is
    // what makes the state below worth saving: it captures a future.
    const run = async () => {
      const { engine, entry } = await loadedEntry(validator)
      engine.setParameter(entry.id, 'probability', 0.5)
      return passedOns(await play(entry.node, [60, 61, 62, 63, 64, 65, 66, 67, 68, 69]))
    }
    const first = await run()
    const second = await run()
    expect(first).toEqual(second)
    // And it actually gates rather than passing all: with ten notes at
    // probability one half, passing all ten has probability 2^-10.
    expect(first.length).toBeGreaterThan(0)
    expect(first.length).toBeLessThan(10)
  })
})

describe('dice state is what the parameters do not carry', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('advances with use and restores exactly', async () => {
    // Two instances with identical parameters diverge after different
    // histories: the divergence is the behavioural proof the state channel
    // carries something the parameters do not.
    const { engine, entry } = await loadedEntry(validator)
    engine.setParameter(entry.id, 'probability', 0.5)
    await play(entry.node, [60, 61, 62, 63, 64])
    const diverged = await engine.requestState(entry.id)

    const fresh = await loadedEntry(validator)
    const pristine = await fresh.engine.requestState(fresh.entry.id)
    expect(diverged).not.toEqual(pristine)

    // Round-tripped through the codec, as a real save and reopen would.
    const restored = decodeState(encodeState(diverged))
    const resumed = await (async () => {
      const context = new OfflineContext({ sampleRate: 48000 })
      const eng = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
      return { engine: eng, entry: await eng.addPlugin(CANONICAL, { state: restored }) }
    })()
    resumed.engine.setParameter(resumed.entry.id, 'probability', 0.5)

    // The resumed node gates the next notes exactly as the original would
    // have, and reports the state it was given rather than a fresh one.
    const notes = [70, 71, 72, 73, 74]
    const continued = passedOns(await play(entry.node, notes))
    const replayed = passedOns(await play(resumed.entry.node, notes))
    expect(replayed).toEqual(continued)
    expect(await resumed.engine.requestState(resumed.entry.id)).toEqual(await engine.requestState(entry.id))
  })

  it('reseeds on the rising edge, and only there', async () => {
    const { engine, entry } = await loadedEntry(validator)
    engine.setParameter(entry.id, 'probability', 0.5)
    await play(entry.node, [60, 61, 62])
    const before = await engine.requestState(entry.id)

    engine.setParameter(entry.id, 'reseed', 1)
    entry.node.render()
    await settle()
    // Back to the seed default, whatever had been drawn since.
    expect(await engine.requestState(entry.id)).toEqual({ rng: 1 })
    expect(before).not.toEqual({ rng: 1 })

    // Held high is not a repeated reseed: the sequence advances.
    await play(entry.node, [70, 71, 72])
    const advanced = await engine.requestState(entry.id)
    expect(advanced).not.toEqual({ rng: 1 })
  })

  it('falls back to the seed when a saved state is not a usable seed', async () => {
    // Zero, a string, and a missing rng alike: the node reaches ready on the
    // shipped default and keeps playing, rather than running a broken
    // generator. The refusal itself is posted during init, before any host
    // listener is attached, exactly like Ferrite's asset-restore reports.
    for (const state of [{ rng: 0 }, { rng: 'nope' }, {}]) {
      const context = new OfflineContext({ sampleRate: 48000 })
      const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
      const entry = await engine.addPlugin(CANONICAL, { state })
      expect(entry.ready).toBeDefined()
      expect(await engine.requestState(entry.id)).toEqual({ rng: 1 })
      expect(passedOns(await play(entry.node, [60, 61, 62]))).toHaveLength(3)
    }
  })
})

describe('two stateful nodes route replies by token', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('tells a dice reply from a ferrite reply in either initiation order', async () => {
    // Contract section 8 with two stateful nodes: both requestState calls in
    // flight at once must resolve with their own node's state, an integer
    // against asset bytes, whichever was asked first. One engine, so the
    // ports and the token table are shared for real.
    const origin = 'https://strandz.it/jigdaw/'
    const site = sitePlugins(origin, resolve(root, 'plugins'))
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({
      context,
      loader: new PluginLoader({
        fetch: site.fetch,
        parse: parseText,
        validator,
        capabilities: detectCapabilities({ WebAssembly }),
        processorUrl: site.processorUrl
      }),
      AudioWorkletNode: OfflineWorkletNode
    })
    const dice = await engine.addPlugin(`${origin}plugins/dice/`)
    const ferrite = await engine.addPlugin(`${origin}plugins/ferrite/`)
    engine.setParameter(dice.id, 'probability', 0.5)
    await play(dice.node, [60, 61, 62])

    for (const first of ['dice', 'ferrite']) {
      const diceAsked = engine.requestState(dice.id)
      const ferriteAsked = engine.requestState(ferrite.id)
      const [diceState, ferriteState] = first === 'dice'
        ? await Promise.all([diceAsked, ferriteAsked])
        : await Promise.all([ferriteAsked, diceAsked]).then(([f, d]) => [d, f])
      expect(Number.isInteger(diceState?.rng)).toBe(true)
      expect(ferriteState?.nam).toBeInstanceOf(ArrayBuffer)
      expect(ferriteState?.ir).toBeInstanceOf(ArrayBuffer)
      expect(ferriteState).not.toHaveProperty('rng')
    }
  })
})
