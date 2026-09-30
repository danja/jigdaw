// tests/host/presetRender.test.js
//
// Every bundled preset, played for a few seconds through the offline host, must
// get sound to every track that has something on it that makes sound. This is
// the check that would have caught Dice never running in a browser: it opens
// the preset for real, plays the transport, routes MIDI between the plugins and
// audio to the tracks, and looks at what arrives.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { openProject } from '../../src/ops/OpenProject.js'
import { readProject } from '../../src/rdf/ProjectReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch, sitePlugins } from '../../src/testing/OfflineHost.js'
import { renderChain } from '../../src/testing/ChainRender.js'

const root = resolve(import.meta.dirname, '../..')
const presetsDir = resolve(root, 'web/presets')
const SITE = 'https://site.test/jigdaw/'
const onDisk = readdirSync(presetsDir).filter(f => f.endsWith('.ttl')).sort()
// Seconds of music: enough for a generator's first phrase at the slowest preset tempo.
const SECONDS = 6

async function open (file, validator) {
  const site = sitePlugins(SITE, resolve(root, 'plugins'))
  const loader = new PluginLoader({
    fetch: site.fetch, parse: parseText, validator,
    capabilities: detectCapabilities({ WebAssembly }), processorUrl: site.processorUrl
  })
  const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
  const dispatcher = new OpDispatcher({ engine })
  const url = `${SITE}presets/${file}`
  const read = readProject(await parseText(readFileSync(resolve(presetsDir, file), 'utf8'), url))
  const opened = await openProject(dispatcher, read)
  expect(opened.errors).toEqual([])
  return { dispatcher, engine }
}

describe('the bundled presets, played', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  for (const file of onDisk) {
    it(`${file}: every track with something that makes sound gets sound`, async () => {
      const { dispatcher, engine } = await open(file, validator)
      const peaks = await renderChain(dispatcher, engine, { quanta: Math.ceil(SECONDS * 48000 / 128) })
      const makesSound = track => dispatcher.project.nodes.some(n => n.track === track.id && (dispatcher.engineNode(n.id)?.profile.audioOutputs ?? 0) > 0)
      const expected = dispatcher.project.tracks.filter(makesSound)
      expect(expected.length, 'a preset with nothing that makes sound').toBeGreaterThan(0)
      for (const track of expected) {
        expect(peaks.get(track.id), `${track.label ?? track.id} in ${file}`).toBeGreaterThan(1e-4)
      }
    }, 120000)
  }
})
