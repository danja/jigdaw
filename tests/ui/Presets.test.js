// tests/ui/Presets.test.js
//
// The bundled presets, walked from the directory rather than named, so a
// preset added without an index entry, or an index entry without a file, fails
// here. Each one is opened for real, through the same openProject a click on
// "Open preset" runs, against the real plugins.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readdirSync, readFileSync } from 'node:fs'
import { listPresets, fetchPreset } from '../../src/ui/Presets.js'
import { openProject } from '../../src/ops/OpenProject.js'
import { decodeState } from '../../src/host/StateCodec.js'
import { readProject } from '../../src/rdf/ProjectReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { OfflineContext, OfflineWorkletNode, directoryFetch, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const presetsDir = resolve(root, 'web/presets')
// Any origin will do: what matters is that the presets resolve against it.
const SITE = 'https://site.test/jigdaw/'
const INDEX = `${SITE}presets/index.json`
const webFetch = directoryFetch({ [SITE]: resolve(root, 'web') })

const onDisk = readdirSync(presetsDir).filter(f => f.endsWith('.ttl')).sort()
const indexed = JSON.parse(readFileSync(resolve(presetsDir, 'index.json'), 'utf8')).presets
const indexedFiles = indexed.map(p => p.file)

describe('the bundled presets', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('are listed in the index exactly as they are in the directory', () => {
    expect(onDisk.length).toBeGreaterThan(0)
    expect([...indexedFiles].sort()).toEqual(onDisk)
  })

  it('are listed from the index alone, in index order, without fetching a preset', async () => {
    const asked = []
    const fetch = url => { asked.push(url); return webFetch(url) }
    const presets = await listPresets({ fetch, index: INDEX })
    expect(asked).toEqual([INDEX])
    expect(presets).toEqual(indexed.map(p => ({ url: `${SITE}presets/${p.file}`, label: p.label })))
  })

  it('refuses an index entry with no label, since the label is its name in the menu', async () => {
    const fetch = async () => ({ ok: true, status: 200, json: async () => ({ presets: [{ file: onDisk[0] }] }) })
    await expect(listPresets({ fetch, index: INDEX })).rejects.toThrow(/needs a file and a label/)
  })

  it('refuses to open a preset whose file is not there', async () => {
    await expect(fetchPreset({ fetch: webFetch, url: `${SITE}presets/missing.ttl` })).rejects.toThrow(/missing\.ttl: 404/)
  })

  for (const file of onDisk) {
    describe(file, () => {
      const text = readFileSync(resolve(presetsDir, file), 'utf8')
      const url = `${SITE}presets/${file}`

      it('is listed under its own rdfs:label', async () => {
        const read = readProject(await parseText(text, url))
        expect(indexed.find(p => p.file === file)?.label).toBe(read.label)
      })

      it('has no @base, so its plugins are the ones served beside it', async () => {
        expect(text).not.toMatch(/^@base/m)
        const read = readProject(await parseText(text, url))
        for (const change of read.changes.filter(c => c.op === 'addNode')) {
          expect(change.pluginIri).toMatch(new RegExp(`^${SITE}plugins/[^/]+/$`))
        }
      })

      it('conforms to the shapes', async () => {
        const report = await validator.validate(await parseText(text, url))
        expect(report.violations.map(v => `${v.focusNode} ${v.path}: ${v.message}`)).toEqual([])
      })

      it('opens for real: every plugin loads, every setting lands unclamped, every connection is made', async () => {
        const site = sitePlugins(SITE, resolve(root, 'plugins'))
        const loader = new PluginLoader({
          fetch: site.fetch,
          parse: parseText,
          validator,
          capabilities: detectCapabilities({ WebAssembly }),
          processorUrl: site.processorUrl
        })
        const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
        const dispatcher = new OpDispatcher({ engine })
        const read = readProject(await parseText(text, url))

        const opened = await openProject(dispatcher, read)

        expect(opened.errors).toEqual([])
        expect(opened.loaded.size).toBe(opened.total)
        for (const change of read.changes.filter(c => c.op === 'addNode')) {
          const settings = Object.fromEntries(dispatcher.project.node(change.id).settings)
          expect(settings, change.id).toEqual(change.settings)
        }
        const connections = read.changes.filter(c => c.op === 'addConnection')
        expect(dispatcher.project.connections.length).toBe(connections.length)
        // Stacked in the order signal flows, so the rack reads top to bottom.
        const position = new Map(dispatcher.project.nodes.map((n, i) => [n.id, i]))
        for (const c of connections) {
          expect(position.get(c.from.node), `${c.from.node} above ${c.to.node}`).toBeLessThan(position.get(c.to.node))
        }
        expect(dispatcher.canUndo()).toBe(false)

        // Embedded state is restored, not silently replaced by the plugin's
        // own defaults: a restore that fails is reported and not thrown, so
        // everything above would pass without it.
        for (const change of read.changes.filter(c => c.op === 'addNode' && c.state)) {
          const embedded = decodeState(change.state)
          const running = await dispatcher.getNodeState(change.id)
          for (const [key, bytes] of Object.entries(embedded)) {
            // Compared as buffers: a failing toEqual on a megabyte of audio
            // spends most of a minute printing the difference.
            const same = running?.[key] instanceof ArrayBuffer && Buffer.from(running[key]).equals(Buffer.from(bytes))
            expect(same, `${change.id}.${key} is not the embedded ${bytes.byteLength} bytes`).toBe(true)
          }
        }
      })
    })
  }
})
