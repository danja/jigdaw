// tests/ops/StatelessSave.test.js
//
// What a plugin's declaration changes in the dispatcher, with the real plugins: Pulse declares jig:stateless and is
// not asked for its state, so a save does not wait out the timeout for a reply that will not come; Dice keeps state
// and does not declare it, and is asked.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readProject } from '../../src/rdf/ProjectReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { openProject } from '../../src/ops/OpenProject.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const SITE = 'https://site.test/jigdaw/'

const PROJECT = `@prefix jig: <http://purl.org/stuff/jigdaw/> .
@prefix trn: <http://purl.org/stuff/transmissions/> .
<> a jig:Project ; jig:revision 1 ; jig:track <#t> ; jig:node <#synth> , <#gate> .
<#t> a jig:Track .
<#synth> a jig:Node ; jig:onTrack <#t> ; jig:plugin <../plugins/pulse/> .
<#gate> a jig:Node ; jig:onTrack <#t> ; jig:plugin <../plugins/dice/> .`

describe('asking a plugin for its state', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('skips the plugin that says it keeps none, asks the one that may, and does not wait for the first', async () => {
    const site = sitePlugins(SITE, resolve(root, 'plugins'))
    const loader = new PluginLoader({ fetch: site.fetch, parse: parseText, validator, capabilities: detectCapabilities({ WebAssembly }), processorUrl: site.processorUrl })
    const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
    const asked = []
    const original = engine.requestState.bind(engine)
    engine.requestState = (id, options) => { asked.push(id); return original(id, { ...options, timeoutMs: 50 }) }
    const dispatcher = new OpDispatcher({ engine })
    const read = readProject(await parseText(PROJECT, `${SITE}presets/p.ttl`))
    const opened = await openProject(dispatcher, read)
    expect(opened.errors).toEqual([])
    const [synth, gate] = ['synth', 'gate'].map(id => dispatcher.project.nodes.find(n => n.id === id).id)
    expect(dispatcher.engineNode(synth).profile.stateless).toBe(true)
    expect(dispatcher.engineNode(gate).profile.stateless).toBe(false)

    const t0 = Date.now()
    expect(await dispatcher.getNodeState(synth)).toBeNull()
    expect(Date.now() - t0).toBeLessThan(40)
    expect(asked).toEqual([])
    await dispatcher.getNodeState(gate)
    expect(asked).toHaveLength(1)
  })
})
