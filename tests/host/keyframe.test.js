// tests/host/keyframe.test.js
//
// Keyframe through the real host path: profile, integrity, compile, the
// processor's init and ready handshake, and parameters by symbol.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/keyframe')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/keyframe/'
const QUANTUM = 128
const LATENCY = 512

const built = existsSync(resolve(pluginDir, 'keyframe.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/keyframe/build.sh first')

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({ WebAssembly }),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'keyframe-processor.js')).href
  })
}

/** Render a mono signal through the node; returns a copy of channel 0. */
function renderAll (node, signal) {
  const result = new Float32Array(signal.length)
  const block = new Float32Array(QUANTUM)
  for (let at = 0; at < signal.length; at += QUANTUM) {
    block.fill(0)
    block.set(signal.subarray(at, at + QUANTUM))
    const output = node.render([block, block])
    result.set(output[0].subarray(0, Math.min(QUANTUM, signal.length - at)), at)
  }
  return result
}

suite('keyframe through the host', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  async function add (sampleRate = 48000) {
    const context = new OfflineContext({ sampleRate })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    return { engine, entry: await engine.addPlugin(CANONICAL) }
  }

  it('dereferences the IRI and gets a profile declaring its latency and every port', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Keyframe')
    expect(profile.latencyFrames).toBe(LATENCY)
    expect(profile.ports).toHaveLength(9)
  })

  it('reports its latency in the ready message, the same at every rate', async () => {
    expect((await add(44100)).entry.ready.latencyFrames).toBe(LATENCY)
    expect((await add(96000)).entry.ready.latencyFrames).toBe(LATENCY)
  })

  it('passes an impulse through at exactly the latency it reported', async () => {
    const { entry } = await add()
    const impulse = new Float32Array(LATENCY + 4096)
    impulse[300] = 1
    const out = renderAll(entry.node, impulse)
    expect(out[300 + LATENCY]).toBeCloseTo(1, 4)
    expect(out.every(Number.isFinite)).toBe(true)
  })

  it('takes a parameter from the engine by symbol', async () => {
    const { engine, entry } = await add()
    engine.setParameter(entry.id, 'output', -6.0206)
    const impulse = new Float32Array(LATENCY + 1024)
    impulse[300] = 1
    expect(renderAll(entry.node, impulse)[300 + LATENCY]).toBeCloseTo(0.5, 3)
  })

  it('takes a change of Quality and keeps producing finite sound', async () => {
    const { engine, entry } = await add()
    const tone = Float32Array.from({ length: 48000 }, (_, i) => 0.5 * Math.sin(2 * Math.PI * 440 * i / 48000))
    renderAll(entry.node, tone)
    engine.setParameter(entry.id, 'quality', 2)
    engine.setParameter(entry.id, 'stereo', 1)
    const out = renderAll(entry.node, tone)
    expect(out.every(Number.isFinite)).toBe(true)
    expect(out.some(v => Math.abs(v) > 0.2)).toBe(true)
  })

  it('renders silence from silence, with no input given', async () => {
    const { entry } = await add()
    for (let i = 0; i < 20; i++) {
      const out = entry.node.render()
      expect(out[0].every(v => v === 0)).toBe(true)
    }
  })
})
