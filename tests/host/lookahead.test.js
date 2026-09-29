// tests/host/lookahead.test.js
//
// The whole path, for real, headless, for the plugin whose latency changes
// while audio flows. Docs/latency.md section 2 is the clause: the profile
// declares the worst case, the processor reports the actual figure in ready,
// and every change arrives as a latency message naming the frame it applies
// from. Same shape as tests/host/tremolo.test.js, scoped to what is different
// here: position 0 passes through, position 512 holds the signal back by
// exactly 512 frames, and the host is told.
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
const pluginDir = resolve(root, 'plugins/lookahead')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/lookahead/'

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'lookahead-processor.js')).href
  })
}

async function loadedEntry (validator) {
  const context = new OfflineContext({ sampleRate: 48000 })
  const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
  const entry = await engine.addPlugin(CANONICAL)
  return { context, engine, entry }
}

const tick = () => new Promise(resolve => setTimeout(resolve, 0))

describe('lookahead, a plugin that changes its latency', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares the worst case in the profile, not the current figure', async () => {
    // module-abi.md: a module whose latency moves with its settings declares
    // the worst case. There is no module here, but the rule is about the
    // declaration: a host compiling before ready must assume the worst.
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Lookahead')
    expect(profile.latencyFrames).toBe(512)
    expect(profile.module).toBeNull()
    expect(profile.ports.map(p => p.symbol)).toEqual(['position'])
  })

  it('reports the actual figure in ready, which is none at the default', async () => {
    const { entry } = await loadedEntry(validator)
    expect(entry.ready.latencyFrames).toBe(0)
  })

  it('passes the signal unchanged at position 0', async () => {
    const { entry } = await loadedEntry(validator)
    const signal = Float32Array.from({ length: 128 }, (_, i) => Math.sin(i / 8) * 0.5)
    const output = entry.node.render([signal, signal])
    expect(Array.from(output[0])).toEqual(Array.from(signal))
    expect(output[0].every(Number.isFinite)).toBe(true)
  })

  it('holds the signal back by exactly 512 frames at position 512', async () => {
    // Latency is a property of the signal path (latency.md section 1): an
    // impulse in must come out 512 frames later, not 511 and not 513. A ring
    // of exactly 512 slots reads back the sample just written, which is the
    // off-by-one this guards.
    const { engine, entry } = await loadedEntry(validator)
    engine.setParameter(entry.id, 'position', 512)

    let found = -1
    for (let quantum = 0; quantum < 8; quantum++) {
      const input = new Float32Array(128)
      if (quantum === 0) input[0] = 1
      const output = entry.node.render([input, input])
      expect(output[0].every(Number.isFinite)).toBe(true)
      for (let i = 0; i < 128; i++) {
        if (output[0][i] !== 0) {
          expect(found, 'the impulse came out twice').toBe(-1)
          found = quantum * 128 + i
        }
      }
    }
    expect(found).toBe(512)
  })

  it('posts one latency message per change, naming the quantum-start frame', async () => {
    // messaging.md 1.3 and contract 6.2: fromFrame is the absolute stream
    // position the new figure applies from, not an offset in this block and
    // not a block index. Position is k-rate, so the change lands on the
    // quantum boundary.
    const { engine, entry } = await loadedEntry(validator)
    const messages = []
    engine.onMessage(entry.id, message => {
      if (message?.type === 'latency') messages.push(message)
    })

    entry.node.render([new Float32Array(128), new Float32Array(128)])
    engine.setParameter(entry.id, 'position', 512)
    entry.node.render([new Float32Array(128), new Float32Array(128)])
    await tick()
    expect(messages).toEqual([{ type: 'latency', latencyFrames: 512, fromFrame: 128 }])

    engine.setParameter(entry.id, 'position', 0)
    entry.node.render([new Float32Array(128), new Float32Array(128)])
    await tick()
    expect(messages).toEqual([
      { type: 'latency', latencyFrames: 512, fromFrame: 128 },
      { type: 'latency', latencyFrames: 0, fromFrame: 256 }
    ])
  })

  it('sends no latency message when nothing changed', async () => {
    const { engine, entry } = await loadedEntry(validator)
    const messages = []
    engine.onMessage(entry.id, message => {
      if (message?.type === 'latency') messages.push(message)
    })
    for (let quantum = 0; quantum < 4; quantum++) {
      entry.node.render([new Float32Array(128), new Float32Array(128)])
    }
    await tick()
    expect(messages).toEqual([])
  })

  it('is silent before ready', async () => {
    // No init posted, so no ready: a processor whose instance is not ready
    // outputs silence rather than whatever is in its buffers (contract 3.1).
    const context = new OfflineContext({ sampleRate: 48000 })
    await context.audioWorklet.addModule(pathToFileURL(resolve(pluginDir, 'lookahead-processor.js')).href)
    const node = new OfflineWorkletNode(context, 'lookahead', { numberOfOutputs: 1, outputChannelCount: [2] })
    const signal = new Float32Array(128).fill(0.5)
    const output = node.render([signal, signal])
    expect(output[0].every(v => v === 0)).toBe(true)
  })
})

describe('lookahead position is declared once', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('derives the AudioParam from the one port declaration', async () => {
    // Contract 5.1. Two scale points is the two-position shape, so the panel
    // draws a switch naming Direct and 512 frames (contract 5.3).
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    const port = profile.ports.find(p => p.symbol === 'position')
    expect(port.widget).toBe('switch')
    expect(port.scalePoints).toEqual([
      { label: 'Direct', value: 0 },
      { label: '512 frames', value: 512 }
    ])
    expect(port.automationRate).toBe('k-rate')

    const { entry } = await loadedEntry(validator)
    expect(entry.node.parameters.get('position').value).toBe(port.defaultValue)
  })
})
