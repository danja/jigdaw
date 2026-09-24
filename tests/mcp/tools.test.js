// tests/mcp/tools.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { createTools } from '../../src/mcp/tools.js'
import { registerTools } from '../../src/mcp/adapter.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'

const IRI = 'https://strandz.it/jigdaw/plugins/cascade/'
const T = 'http://purl.org/stuff/transmissions/'

const fakeCatalogue = (over = {}) => ({
  async search () { return [{ iri: IRI, label: 'Cascade', web: true, roles: ['AudioEffect'], formats: [] }] },
  async describe (iri) {
    return { iri, properties: { produces: ['Audio'], accepts: ['Audio'], caution: ['Mind the tail.'] } }
  },
  ...over
})

let dispatcher
let call
beforeEach(() => {
  dispatcher = new OpDispatcher()
  const tools = createTools({ dispatcher, catalogue: fakeCatalogue() })
  call = (name, input) => tools.find(t => t.name === name).handler(input)
})

const addNodes = () => dispatcher.apply([
  { op: 'addNode', id: 'a', pluginIri: IRI },
  { op: 'addNode', id: 'b', pluginIri: IRI }
])

describe('the tool surface', () => {
  it('needs a dispatcher rather than working without one', () => {
    expect(() => createTools({})).toThrow(/needs a dispatcher/)
  })

  it('describes every tool, because the description is the whole interface', () => {
    // An agent cannot read the source. A tool with no description is unusable.
    for (const tool of createTools({ dispatcher })) {
      expect(tool.description.length, `${tool.name} has no useful description`).toBeGreaterThan(30)
      expect(tool.inputSchema.type).toBe('object')
    }
  })
})

describe('status', () => {
  it('is small and says whether the graph compiles', () => {
    addNodes()
    return call('status').then(result => {
      expect(result.ok).toBe(true)
      expect(result.nodes).toBe(2)
      expect(result.compiles).toBe(true)
      expect(result.problems).toEqual([])
    })
  })

  it('reports a graph that does not compile as a problem, not a crash', async () => {
    addNodes()
    // Force an undelayed cycle straight into the model, bypassing the
    // dispatcher, which is the only way to get one there.
    dispatcher.project.apply([
      { op: 'addConnection', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: `${T}Audio` },
      { op: 'addConnection', from: { node: 'b', portIndex: 0 }, to: { node: 'a', portIndex: 0 }, signalKind: `${T}Audio` }
    ])
    const result = await call('status')
    expect(result.compiles).toBe(false)
    expect(result.problems[0]).toContain('feedback loop')
  })
})

describe('plugins_search', () => {
  it('returns candidates', async () => {
    const result = await call('plugins_search', { q: 'reverb' })
    expect(result.ok).toBe(true)
    expect(result.results[0].label).toBe('Cascade')
  })

  it('names an unknown facet rather than ignoring it', async () => {
    // A silently dropped facet returns a full result set that looks like an
    // answer, which is worse than an error.
    const result = await call('plugins_search', { nonesuch: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('nonesuch')
    expect(result.known).toContain('accepts')
  })

  it('explains itself when there is no catalogue, rather than vanishing', async () => {
    const tools = createTools({ dispatcher, catalogue: null })
    const result = await tools.find(t => t.name === 'plugins_search').handler({ q: 'x' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no catalogue')
  })

  it('reports an upstream failure as the catalogue being down', async () => {
    const tools = createTools({
      dispatcher,
      catalogue: fakeCatalogue({ async search () { throw new Error('returned 503') } })
    })
    const result = await tools.find(t => t.name === 'plugins_search').handler({})
    expect(result.error).toContain('catalogue')
  })
})

describe('plugin_validate_chain', () => {
  it('accepts a chain whose signals line up, and reports cautions', async () => {
    const result = await call('plugin_validate_chain', { iris: [IRI, IRI] })
    expect(result.valid).toBe(true)
    expect(result.cautions[0].caution).toContain('tail')
  })

  it('reports a mismatch with both sides named', async () => {
    const tools = createTools({
      dispatcher,
      catalogue: fakeCatalogue({
        async describe (iri) {
          return iri.endsWith('midi/')
            ? { iri, properties: { produces: ['Midi'], accepts: [] } }
            : { iri, properties: { produces: ['Audio'], accepts: ['Audio'] } }
        }
      })
    })
    const result = await tools.find(t => t.name === 'plugin_validate_chain')
      .handler({ iris: ['https://x/midi/', 'https://x/audio/'] })
    expect(result.valid).toBe(false)
    expect(result.problems[0].message).toContain('produces Midi')
  })

  it('does not call a plugin that declares nothing a mismatch', async () => {
    // Declaring nothing is not evidence of a problem, and reporting one would
    // train an agent to ignore this tool.
    const tools = createTools({
      dispatcher,
      catalogue: fakeCatalogue({ async describe (iri) { return { iri, properties: {} } } })
    })
    const result = await tools.find(t => t.name === 'plugin_validate_chain').handler({ iris: [IRI, IRI] })
    expect(result.valid).toBe(true)
  })

  it('refuses a chain of one', async () => {
    expect((await call('plugin_validate_chain', { iris: [IRI] })).ok).toBe(false)
  })
})

describe('collection_open', () => {
  const fakeResult = (over = {}) => ({
    collection: { label: 'Reverbs', comment: 'Rooms and plates.' },
    warnings: [],
    members: [{ iri: IRI, ok: true, profile: { label: 'Cascade' }, notes: [] }],
    ...over
  })

  it('needs an iri', async () => {
    const tools = createTools({ dispatcher, openCollection: async () => fakeResult() })
    const result = await tools.find(t => t.name === 'collection_open').handler({})
    expect(result.ok).toBe(false)
    expect(result.error).toContain('iri')
  })

  it('explains itself when this host cannot open collections, rather than vanishing', async () => {
    const tools = createTools({ dispatcher })
    const result = await tools.find(t => t.name === 'collection_open').handler({ iri: 'https://x/c' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('cannot open collections')
  })

  it('reports the collection and each member, ok or not', async () => {
    const tools = createTools({
      dispatcher,
      openCollection: async iri => fakeResult({
        members: [
          { iri: IRI, ok: true, profile: { label: 'Cascade' }, notes: ['names itself https://mirror/'] },
          { iri: 'https://x/gone/', ok: false, listedLabel: 'Gone', step: 'fetch-profile', message: '410' }
        ]
      })
    })
    const result = await tools.find(t => t.name === 'collection_open').handler({ iri: 'https://x/c' })
    expect(result.ok).toBe(true)
    expect(result.label).toBe('Reverbs')
    expect(result.members).toEqual([
      { iri: IRI, label: 'Cascade', ok: true, notes: ['names itself https://mirror/'] },
      { iri: 'https://x/gone/', label: 'Gone', ok: false, step: 'fetch-profile', message: '410' }
    ])
  })

  it('reports a refused collection as a located failure, not a throw', async () => {
    const tools = createTools({
      dispatcher,
      openCollection: async () => { const e = new Error('404'); e.step = 'fetch-collection'; throw e }
    })
    const result = await tools.find(t => t.name === 'collection_open').handler({ iri: 'https://x/c' })
    expect(result.ok).toBe(false)
    expect(result.step).toBe('fetch-collection')
  })
})

describe('graph_apply_changes', () => {
  it('applies atomically and reports the revision', async () => {
    const result = await call('graph_apply_changes', {
      changes: [{ op: 'addNode', id: 'a', pluginIri: IRI }]
    })
    expect(result.ok).toBe(true)
    expect(result.revision).toBe(1)
  })

  it('refuses a changeset that would not compile, and says why', async () => {
    addNodes()
    const result = await call('graph_apply_changes', {
      changes: [
        { op: 'addConnection', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: `${T}Audio` },
        { op: 'addConnection', from: { node: 'b', portIndex: 0 }, to: { node: 'a', portIndex: 0 }, signalKind: `${T}Audio` }
      ]
    })
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('compile')
    expect(result.error).toContain('feedback loop')
  })

  it('reports a stale revision with both numbers', async () => {
    addNodes()
    const result = await call('graph_apply_changes', { changes: [], expectedRevision: 0 })
    expect(result.kind).toBe('conflict')
    expect(result.expected).toBe(0)
    expect(result.revision).toBe(1)
  })

  it('does not commit under dryRun', async () => {
    addNodes()
    const before = dispatcher.revision
    const result = await call('graph_apply_changes', {
      changes: [{ op: 'removeNode', id: 'a' }], dryRun: true
    })
    expect(result.applied).toBe(false)
    expect(dispatcher.revision).toBe(before)
  })
})

describe('connection_add', () => {
  it('takes a bare signal name and expands it', async () => {
    addNodes()
    const result = await call('connection_add', { from: 'a', to: 'b', signalKind: 'Audio' })
    expect(result.ok).toBe(true)
    expect(dispatcher.project.connections[0].signalKind).toBe(`${T}Audio`)
  })

  it('can target a parameter by symbol', async () => {
    addNodes()
    await call('connection_add', { from: 'a', to: 'b', toParameter: 'mix' })
    expect(dispatcher.project.connections[0].to.portSymbol).toBe('mix')
  })

  it('reports a node that is not there', async () => {
    addNodes()
    const result = await call('connection_add', { from: 'a', to: 'ghost' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no such node')
  })
})

describe('transport_configure', () => {
  it('sets a tempo', async () => {
    const result = await call('transport_configure', { tempo: 96 })
    expect(result.ok).toBe(true)
    expect(dispatcher.project.transport.tempoPoints[0].bpm).toBe(96)
  })

  it('refuses a loop that ends before it starts', async () => {
    const result = await call('transport_configure', { loopEnabled: true, loopStart: 8, loopEnd: 2 })
    expect(result.ok).toBe(false)
  })
})

describe('registerTools', () => {
  it('always exposes the surface on the page, whatever else it finds', () => {
    const target = {}
    const { bound, surface, count } = registerTools({ dispatcher, target })
    expect(bound).toBe('page')
    expect(count).toBeGreaterThan(5)
    expect(target.jigdaw.mcp).toBe(surface)
  })

  it('binds to navigator.modelContext when it is there', () => {
    let provided = null
    const target = { navigator: { modelContext: { provideContext: c => { provided = c } } } }
    const { bound } = registerTools({ dispatcher, target })
    expect(bound).toBe('navigator.modelContext')
    expect(provided.tools.length).toBeGreaterThan(5)
    expect(typeof provided.tools[0].execute).toBe('function')
  })

  it('keeps the page working when registration is refused', () => {
    // A failure to register must not stop the page working.
    const target = { navigator: { modelContext: { provideContext () { throw new Error('refused') } } } }
    const { bound, warning } = registerTools({ dispatcher, target })
    expect(bound).toBe('page')
    expect(warning).toContain('refused')
  })

  it('names an unknown tool rather than throwing', async () => {
    const { surface } = registerTools({ dispatcher, target: {} })
    const result = await surface.call('nonesuch')
    expect(result.ok).toBe(false)
    expect(result.known).toContain('status')
  })

  it('turns a throwing tool into a result, not a rejection', async () => {
    // Every failure must look like every other failure to an agent.
    const broken = createTools({ dispatcher })
    broken.find(t => t.name === 'status').handler = async () => { throw new Error('boom') }
    const target = {}
    const { surface } = registerTools({ dispatcher, target })
    surface.tools.find(t => t.name === 'status').handler = async () => { throw new Error('boom') }
    const result = await surface.call('status')
    expect(result.ok).toBe(false)
    expect(result.error).toContain('boom')
  })
})

describe('the tools webmcp.md specified and nothing had built', () => {
  const AUDIO = `${T}Audio`
  const addThree = () => dispatcher.apply([
    { op: 'addNode', id: 'a', pluginIri: IRI },
    { op: 'addNode', id: 'b', pluginIri: IRI },
    { op: 'addNode', id: 'c', pluginIri: IRI }
  ])

  it('removes a node, and says how much of the graph went with it', async () => {
    addNodes()
    await call('connection_add', { from: 'a', to: 'b' })
    const result = await call('node_remove', { nodeId: 'b' })
    expect(result.ok).toBe(true)
    expect(result.removed).toBe('b')
    // The part an agent cannot see from the changeset it sent.
    expect(result.connectionsRemoved).toBe(1)
  })

  it('heals the path when asked, so removing one plugin is not removing two edges', async () => {
    addThree()
    await call('connection_add', { from: 'a', to: 'b' })
    await call('connection_add', { from: 'b', to: 'c' })
    const result = await call('node_remove', { nodeId: 'b', heal: true })
    expect(result.ok).toBe(true)
    expect(dispatcher.project.connections).toHaveLength(1)
    expect(dispatcher.project.connections[0].from.node).toBe('a')
    expect(dispatcher.project.connections[0].to.node).toBe('c')
  })

  it('severs by default, because a changeset means what it says', async () => {
    addThree()
    await call('connection_add', { from: 'a', to: 'b' })
    await call('connection_add', { from: 'b', to: 'c' })
    await call('node_remove', { nodeId: 'b' })
    expect(dispatcher.project.connections).toEqual([])
  })

  it('reports a node that is not there', async () => {
    const result = await call('node_remove', { nodeId: 'ghost' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no such node/)
  })

  it('removes one connection by id', async () => {
    addNodes()
    const added = await call('connection_add', { from: 'a', to: 'b' })
    const result = await call('connection_remove', { connectionId: added.connection })
    expect(result.ok).toBe(true)
    expect(dispatcher.project.connections).toEqual([])
  })

  it('reports a connection that is not there rather than succeeding quietly', async () => {
    const result = await call('connection_remove', { connectionId: 'conn-99' })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/no such connection/)
  })

  it('sets several parameters as one edit', async () => {
    // A preset is one edit. Thirty separate ones would be thirty undo entries
    // and a sweep through intermediate states on the way.
    addNodes()
    const before = dispatcher.revision
    const result = await call('parameters_set_batch', {
      settings: [
        { nodeId: 'a', symbol: 'mix', value: 0.25 },
        { nodeId: 'b', symbol: 'mix', value: 0.75 }
      ]
    })
    expect(result.ok).toBe(true)
    expect(dispatcher.revision - before).toBe(1)
    expect(dispatcher.project.node('a').settings.get('mix')).toBe(0.25)
    expect(dispatcher.project.node('b').settings.get('mix')).toBe(0.75)
  })

  it('applies none of a batch when one of them is wrong', async () => {
    addNodes()
    const before = dispatcher.revision
    const result = await call('parameters_set_batch', {
      settings: [
        { nodeId: 'a', symbol: 'mix', value: 0.5 },
        { nodeId: 'ghost', symbol: 'mix', value: 0.5 }
      ]
    })
    expect(result.ok).toBe(false)
    expect(dispatcher.revision).toBe(before)
    expect(dispatcher.project.node('a').settings.get('mix')).toBeUndefined()
  })

  it('refuses an empty batch rather than reporting a successful no-op', async () => {
    const result = await call('parameters_set_batch', { settings: [] })
    expect(result.ok).toBe(false)
    expect(result.error).toMatch(/non-empty/)
  })

  it('reports every value it applied, which is what a surface renders', async () => {
    addNodes()
    const result = await call('parameters_set_batch', {
      settings: [{ nodeId: 'a', symbol: 'mix', value: 0.4 }]
    })
    expect(result.applied).toEqual([{ nodeId: 'a', symbol: 'mix', value: 0.4 }])
  })
})
