// tests/ops/DuplicateTrack.test.js
//
// Against a real engine on the offline host, so a plugin really is fetched and instantiated for the
// copy, and one that cannot be fetched really fails.
import { describe, it, expect, beforeEach } from 'vitest'
import { resolve } from 'node:path'
import { duplicateTrack } from '../../src/ops/DuplicateTrack.js'
import { parseText } from '../../src/rdf/parse.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const SITE = 'https://site.test/'
const TREMOLO = `${SITE}plugins/tremolo/`
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'

let d
beforeEach(async () => {
  const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
  const site = sitePlugins(SITE, resolve(root, 'plugins'))
  const loader = new PluginLoader({
    fetch: site.fetch, parse: parseText, validator,
    capabilities: detectCapabilities({ WebAssembly }), processorUrl: site.processorUrl
  })
  d = new OpDispatcher({ engine: new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode }) })
  expect((await d.addPlugin(TREMOLO, { id: 'a', track: undefined })).ok).toBe(true)
  const track = d.project.node('a').track
  expect((await d.addPlugin(TREMOLO, { id: 'b', track })).ok).toBe(true)
  expect(d.setParameter('a', 'rate', 3).ok).toBe(true)
  expect(d.apply([{ op: 'addConnection', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO }]).ok).toBe(true)
  d.clearHistory()
})

const trackOfA = () => d.project.node('a').track

describe('duplicateTrack', () => {
  it('loads each plugin onto a new track with its settings and wiring, as one edit', async () => {
    const result = await duplicateTrack(d, trackOfA())
    expect(result.ok).toBe(true)
    const copyNodes = d.project.nodes.filter(n => n.track === result.trackId)
    expect(copyNodes).toHaveLength(2)
    expect(d.project.node(result.nodeIds.a).settings.get('rate')).toBe(3)
    expect(d.project.connections.some(c => c.from.node === result.nodeIds.a && c.to.node === result.nodeIds.b)).toBe(true)
    // The copy is a different plugin instance, not a second name for the original.
    expect(d.engineNode(result.nodeIds.a)).not.toBe(d.engineNode('a'))

    await d.undo()
    expect(d.project.tracks.map(t => t.id)).toEqual([trackOfA()])
    expect(d.project.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
    expect(d.canUndo()).toBe(false)
  })

  it('takes back everything, and leaves nothing to undo, when a plugin will not load', async () => {
    d.apply([{ op: 'addNode', id: 'gone', track: trackOfA(), pluginIri: `${SITE}plugins/nosuch/` }])
    d.clearHistory()
    const before = d.project.snapshot()
    const result = await duplicateTrack(d, trackOfA())
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/nosuch/)
    expect({ ...d.project.snapshot(), revision: 0 }).toEqual({ ...before, revision: 0 })
    expect(d.canUndo()).toBe(false)
  })

  it('refuses a track that is not there without changing anything', async () => {
    const result = await duplicateTrack(d, 'nope')
    expect(result).toMatchObject({ ok: false, message: 'no such track: nope' })
    expect(d.canUndo()).toBe(false)
  })
})
