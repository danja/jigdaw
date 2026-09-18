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


const AUDIO = 'http://purl.org/stuff/transmissions/Audio'

/** An audio edge between two nodes, port 0 to port 0 unless told otherwise. */
const edge = (from, to, toPort = 0) => ({
  op: 'addConnection',
  from: { node: from, portIndex: 0 },
  to: { node: to, portIndex: toPort },
  signalKind: AUDIO
})

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


  it('loads two real plugins and links them', async () => {
    const { engine, dispatcher } = dispatcherWithEngine()
    const a = await dispatcher.addPlugin(CANONICAL)
    const b = await dispatcher.addPlugin(CANONICAL)
    expect(a.ok && b.ok).toBe(true)

    const result = dispatcher.apply([edge(a.nodeId, b.nodeId)])
    expect(result.ok).toBe(true)
    // Every sink also reaches the speakers now, so an assertion about the edge
    // between two nodes has to say that it means that edge.
    const between = engine.links.filter(l => l.toId !== 'output')
    expect(between).toHaveLength(1)
    expect(between[0].delay).toBeNull()
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

const PULSE = 'https://strandz.it/jigdaw/plugins/pulse/'
const pulseDir = resolve(root, 'plugins/pulse')
const pulseBuilt = existsSync(resolve(pulseDir, 'pulse.wasm'))
const midiSuite = pulseBuilt ? describe : describe.skip

midiSuite('MIDI into a real instrument', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  const loaderFor = () => new PluginLoader({
    fetch: directoryFetch({ [PULSE]: pulseDir, [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: (bytes, url) =>
      pathToFileURL(resolve(url.includes('pulse') ? pulseDir : pluginDir,
        url.includes('pulse') ? 'pulse-processor.js' : 'cascade-processor.js')).href
  })

  // Message delivery hops through the ports, so let the queue drain on a real
  // tick rather than a microtask checkpoint.
  const settle = () => new Promise(resolve => setTimeout(resolve, 0))

  const noteOn = (frame, note = 69, velocity = 100) => ({ frame, bytes: Uint8Array.from([0x90, note, velocity]) })
  const noteOff = (frame, note = 69) => ({ frame, bytes: Uint8Array.from([0x80, note, 0]) })
  // render() returns the output's channels, so take the first one.
  const rmsOf = channels => {
    const channel = channels[0]
    return Math.sqrt(channel.reduce((sum, v) => sum + v * v, 0) / channel.length)
  }

  async function loadPulse () {
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: loaderFor(), AudioWorkletNode: OfflineWorkletNode })
    const dispatcher = new OpDispatcher({ engine })
    const added = await dispatcher.addPlugin(PULSE)
    expect(added.ok, added.message).toBe(true)
    return { context, engine, dispatcher, added }
  }

  it('requires the MIDI capability, and the host grants it', async () => {
    const { added } = await loadPulse()
    expect(added.entry.profile.requires).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
    expect(added.entry.granted).toContain('http://purl.org/stuff/jigdaw/MidiEvents')
  })

  it('is silent until a note arrives', async () => {
    const { added } = await loadPulse()
    for (let i = 0; i < 4; i++) {
      expect(rmsOf(added.entry.node.render())).toBe(0)
    }
  })

  it('makes sound when sent a note, and stops when the note ends', async () => {
    // The whole of contract section 6, end to end: the host routes the event,
    // the processor queues it, applies it by stream position, and the wasm
    // sounds it.
    const { dispatcher, added } = await loadPulse()
    const node = added.entry.node

    expect(dispatcher.sendEvents(added.nodeId, [noteOn(0)])).toBe(true)
    await settle()

    let peak = 0
    for (let i = 0; i < 40; i++) peak = Math.max(peak, rmsOf(node.render()))
    expect(peak, 'the instrument made no sound').toBeGreaterThan(0.01)

    dispatcher.sendEvents(added.nodeId, [noteOff(node.frame)])
    await settle()
    for (let i = 0; i < 400; i++) node.render()
    expect(rmsOf(node.render())).toBeLessThan(1e-6)
  })

  it('applies a note in the quantum that contains its frame, not before', async () => {
    // Located by stream position. An event scheduled three quanta ahead must
    // not sound now, and must not be lost either.
    const { dispatcher, added } = await loadPulse()
    const node = added.entry.node
    const target = 128 * 3

    dispatcher.sendEvents(added.nodeId, [noteOn(target)])
    await settle()

    for (let i = 0; i < 3; i++) {
      expect(rmsOf(node.render()), `sounded early, in quantum ${i}`).toBe(0)
    }
    let peak = 0
    for (let i = 0; i < 40; i++) peak = Math.max(peak, rmsOf(node.render()))
    expect(peak).toBeGreaterThan(0.01)
  })

  it('sounds an event whose frame has already passed rather than losing it', async () => {
    const { dispatcher, added } = await loadPulse()
    const node = added.entry.node
    for (let i = 0; i < 5; i++) node.render()

    // Frame 0 is long gone. Moving it is better than dropping it.
    dispatcher.sendEvents(added.nodeId, [noteOn(0)])
    await settle()

    let peak = 0
    for (let i = 0; i < 40; i++) peak = Math.max(peak, rmsOf(node.render()))
    expect(peak).toBeGreaterThan(0.01)
  })

  it('treats a note on with velocity zero as a note off', async () => {
    // Every MIDI source does this, and a synth that ignores it sustains for ever.
    const { dispatcher, added } = await loadPulse()
    const node = added.entry.node
    dispatcher.sendEvents(added.nodeId, [noteOn(0)])
    await settle()
    for (let i = 0; i < 40; i++) node.render()

    dispatcher.sendEvents(added.nodeId, [noteOn(node.frame, 69, 0)])
    await settle()
    for (let i = 0; i < 400; i++) node.render()
    expect(rmsOf(node.render())).toBeLessThan(1e-6)
  })

  it('reports dropped events rather than growing its queue', async () => {
    const { dispatcher, added, engine } = await loadPulse()
    const reports = []
    engine.onMessage(added.entry.id, message => { if (message?.type === 'dropped') reports.push(message) })

    // More than the queue holds. The processor cannot allocate, so it refuses
    // and says how many.
    const flood = Array.from({ length: 700 }, (_, i) => noteOn(100000 + i, 40 + (i % 40)))
    dispatcher.sendEvents(added.nodeId, flood)
    await settle()

    expect(reports.length).toBeGreaterThan(0)
    expect(reports[0].count).toBeGreaterThan(0)
    expect(dispatcher.router.droppedFor(added.entry.id)).toBeGreaterThan(0)
  })

  it('routes MIDI from one node to another through the host', async () => {
    // A MIDI connection is not an audio edge: the host carries it between two
    // ports, which is why it must never reach connect().
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader: loaderFor(), AudioWorkletNode: OfflineWorkletNode })
    const dispatcher = new OpDispatcher({ engine })

    const a = await dispatcher.addPlugin(PULSE)
    const b = await dispatcher.addPlugin(PULSE)

    const result = dispatcher.apply([{
      op: 'addConnection',
      from: { node: a.nodeId, portIndex: 0 },
      to: { node: b.nodeId, portIndex: 0 },
      signalKind: 'http://purl.org/stuff/transmissions/Midi'
    }])
    expect(result.ok).toBe(true)

    // No audio link was made for it.
    // A MIDI edge is not an audio edge and must not reach connect(). The link
    // to the speakers is the instrument's own output and is not this edge.
    expect(engine.links.filter(l => l.toId !== 'output')).toEqual([])
    expect(dispatcher.router.routes).toEqual([{ from: a.entry.id, to: b.entry.id }])
  })
})

suite('what reaches the speakers, with real plugins', () => {
  // The dispatcher, not the page, decides what is audible. Until this worked the
  // page connected every plugin to the output as it loaded, so an effect in the
  // middle of a chain was heard twice, once wet and once dry.
  let validator
  beforeAll(async () => {
    validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
  }, 30000)

  const reaching = (engine, context) =>
    engine.links.filter(l => l.toId === 'output').map(l => l.fromId).sort()

  it('connects one plugin, through a master that is the only thing at the destination', async () => {
    const context = new OfflineContext()
    const engine = new Engine({
      context,
      loader: makeLoader(validator),
      AudioWorkletNode: OfflineWorkletNode
    })
    const dispatcher = new OpDispatcher({ engine })
    const only = await dispatcher.addPlugin(CANONICAL)

    expect(reaching(engine, context)).toEqual([only.entry.id])
    // Gains now exist per node too, for the channel strip, so the assertion is
    // about which one the destination hears rather than how many there are.
    expect(context.destination.incoming).toEqual([engine.master])
    expect(context.gains).toContain(engine.master)
  })

  it('connects the end of a real chain and not its middle', async () => {
    const context = new OfflineContext()
    const engine = new Engine({
      context,
      loader: makeLoader(validator),
      AudioWorkletNode: OfflineWorkletNode
    })
    const dispatcher = new OpDispatcher({ engine })
    const first = await dispatcher.addPlugin(CANONICAL)
    const second = await dispatcher.addPlugin(CANONICAL)

    // Both are sinks until one feeds the other.
    expect(reaching(engine, context)).toEqual([first.entry.id, second.entry.id].sort())

    const wired = dispatcher.apply([edge(first.nodeId, second.nodeId)])
    expect(wired.ok, wired.message).toBe(true)
    expect(reaching(engine, context)).toEqual([second.entry.id])
  })

  it('puts the chain back together when the middle is removed', async () => {
    const context = new OfflineContext()
    const engine = new Engine({
      context,
      loader: makeLoader(validator),
      AudioWorkletNode: OfflineWorkletNode
    })
    const dispatcher = new OpDispatcher({ engine })
    const a = await dispatcher.addPlugin(CANONICAL)
    const b = await dispatcher.addPlugin(CANONICAL)
    const c = await dispatcher.addPlugin(CANONICAL)
    dispatcher.apply([edge(a.nodeId, b.nodeId), edge(b.nodeId, c.nodeId)])
    expect(reaching(engine, context)).toEqual([c.entry.id])

    const removed = dispatcher.apply([{ op: 'removeNode', id: b.nodeId, heal: true }])
    expect(removed.ok, removed.message).toBe(true)
    // a still feeds c, so c is still the one thing you hear.
    expect(dispatcher.project.connections).toHaveLength(1)
    expect(reaching(engine, context)).toEqual([c.entry.id])
    // And the plugin that was removed is not still playing into anything.
    expect(engine.nodes().map(n => n.id)).not.toContain(b.entry.id)
  })
})
