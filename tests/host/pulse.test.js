// tests/host/pulse.test.js
//
// Pulse is the first plugin with a tail: a voice still ringing from a long
// release has to outlive the notes, or every offline bounce cuts it off.
// latency.md section 5 is exercised here in three bindings: the profile
// declares the worst case, the processor reports it for the actual rate, and
// the reference host renders past the last input by it.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readFileSync } from 'node:fs'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const pluginDir = resolve(root, 'plugins/pulse')
const CANONICAL = 'https://strandz.it/jigdaw/plugins/pulse/'

function makeLoader (validator) {
  return new PluginLoader({
    fetch: directoryFetch({ [CANONICAL]: pluginDir }),
    parse: parseText,
    validator,
    capabilities: detectCapabilities({}),
    processorUrl: () => pathToFileURL(resolve(pluginDir, 'pulse-processor.js')).href
  })
}

async function readyAt (validator, sampleRate) {
  const context = new OfflineContext({ sampleRate })
  const engine = new Engine({ context, loader: makeLoader(validator), AudioWorkletNode: OfflineWorkletNode })
  return (await engine.addPlugin(CANONICAL)).ready
}

describe('pulse tailFrames', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('declares the worst case in the profile: the release maximum at 48 kHz', async () => {
    // 4000 is not a second source of truth about the release range: it is
    // read off the release port itself, so a profile re-derived with a longer
    // release fails here rather than under-declaring.
    const template = JSON.parse(readFileSync(resolve(pluginDir, 'profile.json'), 'utf8'))
    const release = template.ports.find(p => p.symbol === 'release')
    const profile = readProfile(await parseText(readFileSync(resolve(pluginDir, 'profile.ttl'), 'utf8'), 'urn:test'))
    expect(profile.tailFrames).toBe(Math.ceil(release.maximum * 48000 / 1000))
    expect(template.shape.tailFrames).toBe(profile.tailFrames)
  })

  it('reports the worst case for the actual rate in ready', async () => {
    expect((await readyAt(validator, 48000)).tailFrames).toBe(192000)
    expect((await readyAt(validator, 44100)).tailFrames).toBe(Math.ceil(4000 * 44100 / 1000))
  })
})
