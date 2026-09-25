// tests/host/quefrency.test.js
//
// Quefrency through the real host path: profile, integrity, compile, the
// processor's init and ready handshake. The first worked plugin with a
// latency, so the one place the ready message's latencyFrames is checked
// against a plugin that actually has some.
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
const pluginDir = resolve(root, 'plugins/quefrency')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/quefrency/'
const QUANTUM = 128

const built = existsSync(resolve(pluginDir, 'quefrency.wasm'))
const suite = built ? describe : describe.skip
if (!built) console.warn('run plugins/quefrency/build.sh first')

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({ WebAssembly }),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'quefrency-processor.js')).href
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

suite('quefrency through the host', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  async function add (sampleRate) {
    const context = new OfflineContext({ sampleRate })
    const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
    return { engine, entry: await engine.addPlugin(CANONICAL) }
  }

  it('dereferences the IRI and gets a profile declaring its latency and every port', async () => {
    const { profile } = await makeLoader(validator).loadProfile(CANONICAL)
    expect(profile.label).toBe('Quefrency')
    expect(profile.latencyFrames).toBe(2047)
    expect(profile.ports).toHaveLength(11)
  })

  it('reports the latency for the rate it was given in its ready message', async () => {
    expect((await add(48000)).entry.ready.latencyFrames).toBe(2047)
    expect((await add(96000)).entry.ready.latencyFrames).toBe(4095)
  })

  it('passes an impulse through at exactly the latency it reported', async () => {
    const { entry } = await add(48000)
    const latency = entry.ready.latencyFrames
    const impulse = new Float32Array(latency + 4096)
    impulse[300] = 1
    const out = renderAll(entry.node, impulse)
    expect(out[300 + latency]).toBeCloseTo(1, 4)
    expect(out.every(Number.isFinite)).toBe(true)
  })

  it('takes a parameter from the engine by symbol', async () => {
    const { engine, entry } = await add(48000)
    engine.setParameter(entry.id, 'output', -6.0206)
    const latency = entry.ready.latencyFrames
    const impulse = new Float32Array(latency + 1024)
    impulse[0] = 1
    expect(renderAll(entry.node, impulse)[latency]).toBeCloseTo(0.5, 4)
  })
})
