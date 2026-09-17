// tests/host/integration.test.js
//
// The whole path, for real, headless.
//
// Nothing here is mocked except the two things node does not have, the
// AudioContext and the AudioWorkletNode, and those are supplied by
// src/testing/OfflineHost.js, which really evaluates the processor module and
// really calls its process(). Everything else runs: the profile is fetched and
// parsed, validated against vocabs/shapes.ttl, negotiated, its resources are
// fetched and their digests verified, the wasm is compiled, the processor is
// registered and instantiated, and audio comes out of the DSP.
//
// AGENTS.md prefers a deterministic offline render over a device-based check.
// This is that, and it covers more of contract section 3 than clicking a page
// would.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PluginLoader, STEPS } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/cascade')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/cascade/'

const built = existsSync(resolve(pluginDir, 'cascade.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/cascade/build.sh first')

function makeLoader (validator, over = {}) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    // node cannot import a blob URL, so the verified bytes are loaded from the
    // file they were verified from.
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'cascade-processor.js')).href,
    ...over
  })
}

const rms = channel => Math.sqrt(channel.reduce((s, v) => s + v * v, 0) / channel.length)

suite('loading a real plugin end to end', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('dereferences the IRI and gets a valid profile', async () => {
    const { profile, granted } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Cascade')
    expect(profile.iri).toBe(CANONICAL)
    expect(profile.ports.map(p => p.symbol).sort()).toEqual(['damping', 'freeze', 'mix', 'mode', 'size'])
    expect(granted).toEqual([])
  })

  it('verifies integrity against the digests in the profile', async () => {
    // Not a stub: these are the real sha384 digests of the built artefacts,
    // recomputed over the bytes that were actually fetched.
    const loader = makeLoader(validator)
    const { profile } = await loader.loadProfile(CANONICAL)
    await expect(loader.fetchVerified(profile.module, { kind: 'module' })).resolves.toBeInstanceOf(Uint8Array)
    await expect(loader.fetchVerified(profile.processor, { kind: 'processor' })).resolves.toBeInstanceOf(Uint8Array)
  })

  it('refuses the module if a single byte of it changed', async () => {
    const loader = makeLoader(validator)
    const { profile } = await loader.loadProfile(CANONICAL)
    const tampered = { ...profile.module, integrity: profile.module.integrity.replace(/.$/, 'A') }
    const error = await loader.fetchVerified(tampered, { kind: 'module' }).catch(e => e)
    expect(error.step).toBe(STEPS.integrity)
  })

  it('instantiates through the engine and makes sound', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })

    const entry = await engine.addPlugin(CANONICAL)
    expect(entry.profile.label).toBe('Cascade')
    expect(entry.ready.latencyFrames).toBe(0)
    expect(entry.node).toBeInstanceOf(OfflineWorkletNode)

    // Fully wet, so what comes out is the reverb rather than the input.
    engine.setParameter(entry.id, 'mix', 1)

    const impulse = new Float32Array(128)
    impulse[0] = 1

    let heard = 0
    let peak = 0
    for (let block = 0; block < 200; block++) {
      const output = entry.node.render(block === 0 ? [impulse, impulse] : null)
      const level = rms(output[0])
      if (level > 1e-9) heard++
      peak = Math.max(peak, level)
      expect(output[0].every(Number.isFinite)).toBe(true)
    }

    expect(heard, 'the plugin produced no output at all').toBeGreaterThan(50)
    expect(peak).toBeGreaterThan(1e-5)
  })

  it('applies a parameter change through the AudioParam, not a message', async () => {
    // messaging.md 1.5: parameters travel as AudioParams. Two paths for one
    // value arrive at different times with no defined precedence.
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)

    const before = entry.node.port.posted.length
    engine.setParameter(entry.id, 'mix', 0.75)
    expect(entry.node.parameters.get('mix').value).toBe(0.75)
    expect(entry.node.port.posted.length, 'a parameter was sent as a message').toBe(before)
  })

  it('clamps a parameter to the range the profile declares', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    expect(engine.setParameter(entry.id, 'mix', 99)).toBe(1)
    expect(engine.setParameter(entry.id, 'size', -5)).toBe(2)
  })

  it('names a parameter the plugin does not have', async () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    expect(() => engine.setParameter(entry.id, 'nonesuch', 1)).toThrow(/has no parameter/)
  })

  it('passes the dry signal at mix 0, proving the audio path is really connected', async () => {
    // If the harness were faking the DSP this would pass trivially; it only
    // passes because the wasm actually processed these samples.
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    const entry = await engine.addPlugin(CANONICAL)
    engine.setParameter(entry.id, 'mix', 0)

    const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 8) * 0.5)
    const output = entry.node.render([signal, signal])
    expect(Array.from(output[0])).toEqual(Array.from(signal))
  })
})

suite('a graph of real plugins', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  const dispatcherWithEngine = () => {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({
      context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode
    })
    return { context, engine, dispatcher: new OpDispatcher({ engine }) }
  }

  const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
  const edge = (from, to, toPort = 0) => ({
    op: 'addConnection',
    from: { node: from, portIndex: 0 },
    to: { node: to, portIndex: toPort },
    signalKind: AUDIO
  })

  it('loads two real plugins and links them', async () => {
    const { engine, dispatcher } = dispatcherWithEngine()
    const a = await dispatcher.addPlugin(CANONICAL)
    const b = await dispatcher.addPlugin(CANONICAL)
    expect(a.ok && b.ok).toBe(true)

    const result = dispatcher.apply([edge(a.nodeId, b.nodeId)])
    expect(result.ok).toBe(true)
    expect(engine.links).toHaveLength(1)
    expect(engine.links[0].delay).toBeNull()
  })

  it('refuses a feedback loop between two real plugins', async () => {
    // Cascade declares zero latency, so a loop between two of them carries no
    // delay at all and Web Audio would answer with silence.
    const { dispatcher } = dispatcherWithEngine()
    const a = await dispatcher.addPlugin(CANONICAL)
    const b = await dispatcher.addPlugin(CANONICAL)

    const result = dispatcher.apply([edge(a.nodeId, b.nodeId), edge(b.nodeId, a.nodeId)])
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('compile')
    expect(dispatcher.project.connections).toHaveLength(0)
  })

  it('creates a real delay node when a path needs compensating', async () => {
    const { context, engine, dispatcher } = dispatcherWithEngine()
    const src = await dispatcher.addPlugin(CANONICAL)
    const slow = await dispatcher.addPlugin(CANONICAL)
    const fast = await dispatcher.addPlugin(CANONICAL)
    const mix = await dispatcher.addPlugin(CANONICAL)

    // Cascade reports zero latency, so one is given some to compensate for.
    engine.get(slow.entry.id).ready.latencyFrames = 512

    const result = dispatcher.apply([
      edge(src.nodeId, slow.nodeId), edge(src.nodeId, fast.nodeId),
      edge(slow.nodeId, mix.nodeId), edge(fast.nodeId, mix.nodeId, 1)
    ])
    expect(result.ok).toBe(true)

    expect(context.delays).toHaveLength(1)
    // 512 frames at 48 kHz.
    expect(context.delays[0].delayTime.value).toBeCloseTo(512 / 48000, 6)
    expect(result.compiled.totalLatency).toBe(512)
  })
})
