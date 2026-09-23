// tests/ops/OpenProject.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { openProject } from '../../src/ops/OpenProject.js'
import { readProject } from '../../src/rdf/ProjectReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { Engine } from '../../src/engine/Engine.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const root = resolve(import.meta.dirname, '../..')
const SITE = 'https://site.test/'

// Tremolo, because it has no WebAssembly to build, and a plugin that is not
// there, which the site answers with a 404 as a real server would.
const project = `
@prefix jig:  <http://purl.org/stuff/jigdaw/> .
@prefix trn:  <http://purl.org/stuff/transmissions/> .
<> a jig:Project ; jig:revision 1 ;
   jig:node <#a> , <#gone> , <#b> ; jig:connection <#c1> , <#c2> .
<#a> a jig:Node ; jig:plugin <../../plugins/tremolo/> ; jig:setting <#a-rate> .
<#a-rate> a jig:ParameterSetting ; jig:symbol "rate" ; jig:value 3.0 .
<#gone> a jig:Node ; jig:plugin <../../plugins/nosuch/> .
<#b> a jig:Node ; jig:plugin <../../plugins/tremolo/> .
<#c1> a jig:Connection ; jig:from <#c1-f> ; jig:to <#c1-t> ; jig:signalKind trn:Audio .
<#c1-f> a jig:Endpoint ; jig:endpointNode <#a> ; jig:portIndex 0 .
<#c1-t> a jig:Endpoint ; jig:endpointNode <#gone> ; jig:portIndex 0 .
<#c2> a jig:Connection ; jig:from <#c2-f> ; jig:to <#c2-t> ; jig:signalKind trn:Audio .
<#c2-f> a jig:Endpoint ; jig:endpointNode <#a> ; jig:portIndex 0 .
<#c2-t> a jig:Endpoint ; jig:endpointNode <#b> ; jig:portIndex 0 .
`

describe('openProject', () => {
  let dispatcher
  let read

  beforeAll(async () => {
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const site = sitePlugins(SITE, resolve(root, 'plugins'))
    const loader = new PluginLoader({
      fetch: site.fetch, parse: parseText, validator,
      capabilities: detectCapabilities({ WebAssembly }), processorUrl: site.processorUrl
    })
    const engine = new Engine({ context: new OfflineContext({ sampleRate: 48000 }), loader, AudioWorkletNode: OfflineWorkletNode })
    dispatcher = new OpDispatcher({ engine })
    read = readProject(await parseText(project, `${SITE}sessions/one/`))
  })

  it('skips a plugin that cannot be loaded, with one error, and loads the rest', async () => {
    const opened = await openProject(dispatcher, read)
    expect(opened.ok).toBe(true)
    expect(opened.total).toBe(3)
    expect([...opened.loaded].sort()).toEqual(['a', 'b'])
    // One error for the missing plugin, and none for the connection to it,
    // which would only be the same failure said a second time.
    expect(opened.errors).toHaveLength(1)
    expect(opened.errors[0]).toMatch(/^gone: /)
    expect(dispatcher.project.connections).toHaveLength(1)
    expect(dispatcher.project.node('a').settings.get('rate')).toBe(3)
  })

  it('replaces what was open rather than adding to it, and leaves nothing to undo', async () => {
    const cleared = []
    const opened = await openProject(dispatcher, read, { onCleared: () => cleared.push(dispatcher.project.nodes.length) })
    expect(opened.ok).toBe(true)
    expect(cleared).toEqual([0])
    expect(dispatcher.project.nodes.map(n => n.id).sort()).toEqual(['a', 'b'])
    expect(dispatcher.canUndo()).toBe(false)
  })

  it('names each plugin before fetching it', async () => {
    const seen = []
    await openProject(dispatcher, read, { onLoading: iri => seen.push(iri) })
    expect(seen.sort()).toEqual([`${SITE}plugins/nosuch/`, `${SITE}plugins/tremolo/`, `${SITE}plugins/tremolo/`])
  })
})
