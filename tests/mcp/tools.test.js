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
  { op: 'addTrack', id: 't' },
  { op: 'addNode', id: 'a', track: 't', pluginIri: IRI },
  { op: 'addNode', id: 'b', track: 't', pluginIri: IRI }
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
      changes: [{ op: 'addTrack', id: 't' }, { op: 'addNode', id: 'a', track: 't', pluginIri: IRI }]
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

describe('transport_play and transport_stop', () => {
  it('drives the transport passed in, the way plugin_load takes loadPlugin', async () => {
    const played = []
    const tools = createTools({
      dispatcher,
      onPlay: async () => { played.push('play') },
      onStop: async () => { played.push('stop') }
    })
    const play = input => tools.find(t => t.name === 'transport_play').handler(input)
    const stop = input => tools.find(t => t.name === 'transport_stop').handler(input)
    expect((await play()).ok).toBe(true)
    expect((await stop()).ok).toBe(true)
    expect(played).toEqual(['play', 'stop'])
  })

  it('explains itself when no transport is connected, rather than vanishing', async () => {
    const tools = createTools({ dispatcher })
    expect((await tools.find(t => t.name === 'transport_play').handler()).ok).toBe(false)
    expect((await tools.find(t => t.name === 'transport_play').handler()).error).toContain('cannot play')
    expect((await tools.find(t => t.name === 'transport_stop').handler()).error).toContain('cannot stop')
  })

  it('reports a transport failure as a result, not a throw', async () => {
    const tools = createTools({ dispatcher, onPlay: async () => { throw new Error('no audio') } })
    const result = await tools.find(t => t.name === 'transport_play').handler()
    expect(result.ok).toBe(false)
    expect(result.error).toContain('no audio')
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
    { op: 'addTrack', id: 't' },
    { op: 'addNode', id: 'a', track: 't', pluginIri: IRI },
    { op: 'addNode', id: 'b', track: 't', pluginIri: IRI },
    { op: 'addNode', id: 'c', track: 't', pluginIri: IRI }
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

describe('tracks', () => {
  it('adds a track and reports its id', async () => {
    const result = await call('track_add', { label: 'Drums' })
    expect(result.ok).toBe(true)
    expect(dispatcher.project.track(result.trackId).label).toBe('Drums')
    expect((await call('status')).tracks).toBe(1)
  })

  it('sets a fader and reports the whole strip back', async () => {
    const { trackId } = await call('track_add', {})
    const result = await call('track_set_channel', { trackId, gain: 0.5, muted: true })
    expect(result.channel).toEqual({ gain: 0.5, pan: 0, muted: true, soloed: false })
    expect((await call('track_set_channel', { trackId, pan: 3 })).ok).toBe(false)
  })

  it('lays a track out: place, colour and lane size, as editor metadata that bumps no revision', async () => {
    const a = (await call('track_add', {})).trackId
    const b = (await call('track_add', {})).trackId
    const revision = dispatcher.project.revision
    const result = await call('track_layout', { trackId: b, move: -1, color: '#3e8ef7', laneSize: 'large' })
    expect(result).toMatchObject({ trackId: b, position: 1, of: 2, layout: { color: '#3e8ef7', laneSize: 'large' } })
    expect(dispatcher.project.orderedTracks.map(t => t.id)).toEqual([b, a])
    expect(dispatcher.project.revision).toBe(revision)
  })

  it('refuses a layout the editor graph refuses, and a track that is not there', async () => {
    const { trackId } = await call('track_add', {})
    expect((await call('track_layout', { trackId, color: 'red' })).ok).toBe(false)
    expect((await call('track_layout', { trackId, laneSize: 'huge' })).ok).toBe(false)
    expect((await call('track_layout', { trackId: 'ghost', move: 1 })).ok).toBe(false)
  })

  it('renames a track and names its MIDI input, refusing a node on another track', async () => {
    addNodes()
    const other = (await call('track_add', {})).trackId
    expect((await call('track_set', { trackId: 't', label: 'Keys', midiInput: 'a' })).ok).toBe(true)
    expect(dispatcher.project.track('t')).toMatchObject({ label: 'Keys', midiInput: 'a' })
    const refused = await call('track_set', { trackId: other, midiInput: 'b' })
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/not on track/)
  })

  it('moves a node between tracks, and removes a track only once it is empty or told where they go', async () => {
    addNodes()
    const other = (await call('track_add', {})).trackId
    expect((await call('node_move_to_track', { nodeId: 'a', trackId: other })).ok).toBe(true)
    expect(dispatcher.project.node('a').track).toBe(other)
    expect((await call('track_remove', { trackId: 't' })).ok).toBe(false)
    expect((await call('track_remove', { trackId: 't', moveNodesTo: other })).ok).toBe(true)
    expect(dispatcher.project.tracks.map(t => t.id)).toEqual([other])
  })

  it('passes a track through plugin_load', async () => {
    const seen = []
    const tools = createTools({
      dispatcher,
      catalogue: fakeCatalogue(),
      loadPlugin: async (iri, options) => {
        seen.push([iri, options])
        return { ok: true, nodeId: 'n', trackId: options.track ?? 'new', entry: { profile: { label: 'X', ports: [] }, ready: { latencyFrames: 0 } }, revision: 1 }
      }
    })
    const load = input => tools.find(t => t.name === 'plugin_load').handler(input)
    expect((await load({ iri: IRI, track: 'track-9' })).trackId).toBe('track-9')
    await load({ iri: IRI })
    expect(seen).toEqual([[IRI, { track: 'track-9' }], [IRI, {}]])
  })
})

describe('clips', () => {
  const note = { startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }

  it('adds a clip with notes, replaces them, moves it and removes it', async () => {
    const { trackId } = await call('track_add', {})
    const added = await call('clip_add', { trackId, startBeat: 4, lengthBeats: 8, notes: [note] })
    expect(added.ok).toBe(true)
    expect((await call('status')).clips).toBe(1)
    expect((await call('clip_set_notes', { clipId: added.clipId, notes: [note, { ...note, pitch: 64 }] })).ok).toBe(true)
    expect(dispatcher.project.clip(added.clipId).notes).toHaveLength(2)
    expect((await call('clip_move', { clipId: added.clipId, startBeat: 12, lengthBeats: 2 })).ok).toBe(true)
    expect(dispatcher.project.clip(added.clipId)).toMatchObject({ startBeat: 12, lengthBeats: 2 })
    expect((await call('clip_remove', { clipId: added.clipId })).ok).toBe(true)
    expect(dispatcher.project.clips).toEqual([])
  })

  it('refuses a note MIDI cannot carry, and says which', async () => {
    const { trackId } = await call('track_add', {})
    const refused = await call('clip_add', { trackId, startBeat: 0, lengthBeats: 4, notes: [{ ...note, velocity: 0 }] })
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/note 0 needs a velocity/)
  })
})

describe('envelope tools', () => {
  const setup = () => dispatcher.apply([{ op: 'addTrack', id: 't' }, { op: 'addNode', id: 'n', track: 't', pluginIri: 'https://example.org/p/' }])
  const points = [{ atBeat: 0, value: 100, curve: 'linear' }, { atBeat: 4, value: 900, curve: 'smooth' }]

  it('adds, replaces and removes an envelope, one edit each', async () => {
    setup()
    const added = await call('envelope_add', { nodeId: 'n', symbol: 'cutoff', points })
    expect(added.ok).toBe(true)
    expect(dispatcher.project.envelopes).toHaveLength(1)
    expect(dispatcher.project.envelopes[0].points.map(p => p.curve)).toEqual(['linear', 'smooth'])
    expect((await call('envelope_set', { envelopeId: added.envelopeId, points: [{ atBeat: 2, value: 5 }] })).ok).toBe(true)
    expect(dispatcher.project.envelopes[0].points).toEqual([{ atBeat: 2, value: 5, curve: 'linear' }])
    expect((await call('envelope_remove', { envelopeId: added.envelopeId })).ok).toBe(true)
    expect(dispatcher.project.envelopes).toEqual([])
  })

  it('refuses a second envelope on one parameter, an unknown node, a bad curve, two points at one beat, and an unknown envelope', async () => {
    setup()
    expect((await call('envelope_add', { nodeId: 'n', symbol: 'cutoff', points })).ok).toBe(true)
    expect((await call('envelope_add', { nodeId: 'n', symbol: 'cutoff', points })).error).toMatch(/already automates/)
    expect((await call('envelope_add', { nodeId: 'ghost', symbol: 'x', points })).ok).toBe(false)
    expect((await call('envelope_add', { nodeId: 'n', symbol: 'q', points: [{ atBeat: 0, value: 1, curve: 'wavy' }] })).error).toMatch(/curve must be one of/)
    expect((await call('envelope_add', { nodeId: 'n', symbol: 'r', points: [{ atBeat: 1, value: 1 }, { atBeat: 1, value: 2 }] })).error).toMatch(/two envelope points/)
    expect((await call('envelope_set', { envelopeId: 'ghost', points: [] })).ok).toBe(false)
    expect((await call('envelope_remove', { envelopeId: 'ghost' })).ok).toBe(false)
  })
})

describe('node_move_in_chain', () => {
  it('refuses, with the reason, what it cannot swap, and a move that is not one place', async () => {
    dispatcher.apply([{ op: 'addTrack', id: 't' }, { op: 'addNode', id: 'a', track: 't', pluginIri: 'https://example.org/p/' }, { op: 'addNode', id: 'b', track: 't', pluginIri: 'https://example.org/p/' },
      { op: 'addConnection', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: 'http://purl.org/stuff/transmissions/Audio' }])
    // Nothing is loaded in this dispatcher, so neither node is known to take and give audio.
    const refused = await call('node_move_in_chain', { nodeId: 'a', delta: 1 })
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/cannot swap/)
    expect((await call('node_move_in_chain', { nodeId: 'a', delta: 2 })).error).toMatch(/one place/)
    expect((await call('node_move_in_chain', { nodeId: 'ghost', delta: 1 })).ok).toBe(false)
  })
})

describe('node_bypass', () => {
  it('bypasses and restores a node, refusing what is not a node or not a boolean', async () => {
    dispatcher.apply([{ op: 'addTrack', id: 't' }, { op: 'addNode', id: 'n', track: 't', pluginIri: 'https://example.org/p/' }])
    const done = await call('node_bypass', { nodeId: 'n', bypassed: true })
    expect(done.ok).toBe(true)
    expect(dispatcher.project.node('n').bypassed).toBe(true)
    expect((await call('node_bypass', { nodeId: 'n', bypassed: false })).ok).toBe(true)
    expect(dispatcher.project.node('n').bypassed).toBe(false)
    expect((await call('node_bypass', { nodeId: 'ghost', bypassed: true })).ok).toBe(false)
    expect((await call('node_bypass', { nodeId: 'n', bypassed: 'yes' })).ok).toBe(false)
  })
})

describe('clip behaviour, split and duplicate', () => {
  const note = { startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }
  const make = async (extra = {}) => {
    const { trackId } = await call('track_add', {})
    const added = await call('clip_add', { trackId, startBeat: 0, lengthBeats: 8, notes: [note, { ...note, startBeat: 5 }], ...extra })
    return { trackId, clipId: added.clipId }
  }

  it('mutes, locks and colours a clip, and colour is not an edit', async () => {
    const { clipId } = await make()
    const before = dispatcher.project.revision
    const colored = await call('clip_set', { clipId, color: '#3e8ef7' })
    expect(colored.ok).toBe(true)
    expect(dispatcher.project.revision).toBe(before)
    expect(colored.clip.color).toBe('#3e8ef7')
    const done = await call('clip_set', { clipId, muted: true, locked: true })
    expect(done.ok).toBe(true)
    expect(dispatcher.project.clip(clipId)).toMatchObject({ muted: true, locked: true })
    expect(dispatcher.project.revision).toBe(before + 1)
  })

  it('says a locked clip is locked when it is moved, and nothing when asked to change nothing', async () => {
    const { clipId } = await make()
    await call('clip_set', { clipId, locked: true })
    const refused = await call('clip_move', { clipId, startBeat: 4 })
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/locked/)
    expect((await call('clip_set', { clipId })).error).toMatch(/nothing to change/)
    expect((await call('clip_set', { clipId, color: 'red' })).ok).toBe(false)
    expect((await call('clip_set', { clipId: 'ghost', muted: true })).ok).toBe(false)
  })

  it('splits a clip, keeping the first id and reporting the second, in one undo', async () => {
    const { clipId } = await make()
    const split = await call('clip_split', { clipId, atBeat: 3 })
    expect(split.ok).toBe(true)
    expect(split.firstClipId).toBe(clipId)
    expect(dispatcher.project.clip(clipId).lengthBeats).toBe(3)
    expect(dispatcher.project.clip(split.secondClipId)).toMatchObject({ startBeat: 3, lengthBeats: 5 })
    await dispatcher.undo()
    expect(dispatcher.project.clips).toHaveLength(1)
    expect(dispatcher.project.clip(clipId).lengthBeats).toBe(8)
  })

  it('refuses a cut outside the clip', async () => {
    const { clipId } = await make()
    const refused = await call('clip_split', { clipId, atBeat: 0 })
    expect(refused.ok).toBe(false)
    expect(refused.error).toMatch(/inside the clip/)
  })

  it('sets fades on an audio clip only', async () => {
    const { trackId, clipId } = await make()
    expect((await call('clip_set', { clipId, fadeInBeats: 1 })).error).toMatch(/only an audio clip/)
    const audio = await call('clip_add_audio', { trackId, source: 'https://example.org/a.wav', startBeat: 0, lengthBeats: 4 })
    expect((await call('clip_set', { clipId: audio.clipId, fadeInBeats: 1, fadeOutBeats: 0.5 })).ok).toBe(true)
    expect(dispatcher.project.clip(audio.clipId)).toMatchObject({ fadeInBeats: 1, fadeOutBeats: 0.5 })
  })

  it('duplicates after the clip, or where asked, and the copy is not locked', async () => {
    const { trackId, clipId } = await make()
    await call('clip_set', { clipId, locked: true })
    const copy = await call('clip_duplicate', { clipId })
    expect(copy.ok).toBe(true)
    expect(dispatcher.project.clip(copy.clipId)).toMatchObject({ startBeat: 8, track: trackId })
    expect(dispatcher.project.clip(copy.clipId).locked).toBe(false)
    const other = await call('track_add', {})
    const placed = await call('clip_duplicate', { clipId, startBeat: 2, trackId: other.trackId })
    expect(dispatcher.project.clip(placed.clipId)).toMatchObject({ startBeat: 2, track: other.trackId })
    expect((await call('clip_duplicate', { clipId: 'ghost' })).ok).toBe(false)
  })
})

describe('audio clips', () => {
  it('adds one by the IRI of its file, and refuses a relative one', async () => {
    const { trackId } = await call('track_add', {})
    const added = await call('clip_add_audio', { trackId, source: 'https://example.org/loop.wav', startBeat: 0, lengthBeats: 8, offsetSeconds: 1 })
    expect(dispatcher.project.clip(added.clipId)).toMatchObject({ kind: 'audio', source: 'https://example.org/loop.wav', offsetSeconds: 1 })
    expect((await call('clip_add_audio', { trackId, source: 'loop.wav', startBeat: 0, lengthBeats: 8 })).ok).toBe(false)
  })
})

describe('history and parameter reset', () => {
  it('undoes the last edit and redoes it, and says what is left to step over', async () => {
    // An edit that needs no engine to reverse: undoing a removed plugin reloads it.
    addNodes()
    await call('parameter_set', { node: 'a', symbol: 'mix', value: 0.2 })
    const mix = () => dispatcher.project.nodes.find(n => n.id === 'a').settings.get('mix')
    expect(mix()).toBe(0.2)

    const undone = await call('history_undo')
    expect(undone).toMatchObject({ ok: true, canRedo: true })
    expect(mix()).toBeUndefined()

    const redone = await call('history_redo')
    expect(redone).toMatchObject({ ok: true, canRedo: false })
    expect(mix()).toBe(0.2)
  })

  it('fails, changing nothing, when there is nothing to undo or redo', async () => {
    const revision = dispatcher.project.revision
    expect(await call('history_undo')).toMatchObject({ ok: false, error: 'nothing to undo' })
    expect(await call('history_redo')).toMatchObject({ ok: false, error: 'nothing to redo' })
    expect(dispatcher.project.revision).toBe(revision)
  })

  it('forgets a parameter setting, so the project says what an untouched node says', async () => {
    addNodes()
    await call('parameter_set', { node: 'a', symbol: 'mix', value: 0.2 })
    const settings = () => dispatcher.project.nodes.find(n => n.id === 'a').settings
    expect(settings().get('mix')).toBe(0.2)
    const reset = await call('parameter_reset', { node: 'a', symbol: 'mix' })
    expect(reset.ok).toBe(true)
    expect(settings().has('mix')).toBe(false)
  })

  it('refuses to reset a parameter on a node that is not there', async () => {
    const reset = await call('parameter_reset', { node: 'nope', symbol: 'mix' })
    expect(reset.ok).toBe(false)
  })
})

describe('script_run', () => {
  const fakeReel = over => ({
    check: async () => ({ ok: true, plan: { seed: 1 } }),
    run: async () => ({ ok: true, swapped: 'now' }),
    describe: plan => ({ described: plan.seed }),
    ...over
  })
  const callWith = (reel, input) => createTools({ dispatcher, reel }).find(t => t.name === 'script_run').handler(input)

  it('says so when the host has no scripting, rather than being absent', async () => {
    expect(await callWith(null, { source: 'x' })).toMatchObject({ ok: false, error: 'this host has no scripting' })
  })

  it('needs the script as a string', async () => {
    expect((await callWith(fakeReel(), {})).ok).toBe(false)
    expect((await callWith(fakeReel(), { source: 3 })).ok).toBe(false)
  })

  it('returns the plan as data for a dry run, and does not run it', async () => {
    let ran = false
    const r = await callWith(fakeReel({ run: async () => { ran = true; return { ok: true } } }), { source: 'x', dryRun: true })
    expect(r).toEqual({ ok: true, plan: { described: 1 } })
    expect(ran).toBe(false)
  })

  it('runs the script and says when it took over', async () => {
    let received
    const r = await callWith(fakeReel({ run: async (source, options) => { received = { source, options }; return { ok: true, swapped: 'at-bar' } } }), { source: 'a.b = 1', now: true })
    expect(r).toEqual({ ok: true, swapped: 'at-bar' })
    expect(received).toEqual({ source: 'a.b = 1', options: { now: true } })
  })

  it('returns a script\'s errors with their lines, and says nothing was changed', async () => {
    const errors = [{ line: 2, column: 1, message: 'no plugin called "x"' }]
    const r = await callWith(fakeReel({ run: async () => ({ ok: false, stage: 'plan', errors }) }), { source: 'x.a = 1' })
    expect(r).toMatchObject({ ok: false, stage: 'plan', errors })
    expect(r.error).toMatch(/nothing was changed/)
    const dry = await callWith(fakeReel({ check: async () => ({ ok: false, stage: 'parse', errors }) }), { source: 'x', dryRun: true })
    expect(dry).toMatchObject({ ok: false, stage: 'parse', errors })
  })

  it('reports a run that went through with errors as failed, keeping them', async () => {
    const errors = [{ line: 3, message: 'offline' }]
    const r = await callWith(fakeReel({ run: async () => ({ ok: false, errors, swapped: 'now' }) }), { source: 'x' })
    expect(r).toMatchObject({ ok: false, swapped: 'now', errors })
  })
})

describe('the master, sends, markers and regions', () => {
  const twoTracks = () => dispatcher.apply([{ op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'b' }])

  it('sets the master and refuses a pan out of range, leaving it as it was', async () => {
    expect((await call('master_set', { gain: 0.5, pan: -0.25, muted: true })).ok).toBe(true)
    expect(dispatcher.project.master).toMatchObject({ gain: 0.5, pan: -0.25, muted: true })
    const refused = await call('master_set', { pan: 3 })
    expect(refused.ok).toBe(false)
    expect(dispatcher.project.master.pan).toBe(-0.25)
  })

  it('adds, changes and removes a send, refusing a cycle and a duplicate', async () => {
    twoTracks()
    const added = await call('send_add', { from: 'a', to: 'b', level: 0.4, tap: 'pre' })
    expect(added.ok).toBe(true)
    expect(dispatcher.project.sends.find(s => s.id === added.sendId)).toMatchObject({ from: 'a', to: 'b', level: 0.4, tap: 'pre' })
    expect((await call('send_add', { from: 'a', to: 'b' })).ok).toBe(false)
    expect((await call('send_add', { from: 'b', to: 'a' })).ok).toBe(false)
    expect((await call('send_set', { sendId: added.sendId, level: 0.9 })).ok).toBe(true)
    expect((await call('send_set', { sendId: added.sendId, tap: 'middle' })).ok).toBe(false)
    expect(dispatcher.project.sends[0].level).toBe(0.9)
    expect((await call('send_remove', { sendId: added.sendId })).ok).toBe(true)
    expect(dispatcher.project.sends).toHaveLength(0)
    expect((await call('send_remove', { sendId: 'ghost' })).ok).toBe(false)
  })

  it('makes a track a bus with output, refusing a loop', async () => {
    twoTracks()
    expect((await call('track_set', { trackId: 'a', output: 'b' })).ok).toBe(true)
    expect(dispatcher.project.track('a').output).toBe('b')
    expect((await call('track_set', { trackId: 'b', output: 'a' })).ok).toBe(false)
    expect((await call('track_set', { trackId: 'a', output: null })).ok).toBe(true)
    expect(dispatcher.project.track('a').output).toBe(null)
  })

  it('adds, moves and removes a marker', async () => {
    const added = await call('marker_add', { atBeat: 8, label: 'Chorus' })
    expect(added.ok).toBe(true)
    expect((await call('marker_set', { markerId: added.markerId, atBeat: 12 })).ok).toBe(true)
    expect(dispatcher.project.markers[0]).toMatchObject({ atBeat: 12, label: 'Chorus' })
    expect((await call('marker_add', { atBeat: -1 })).ok).toBe(false)
    expect((await call('marker_remove', { markerId: added.markerId })).ok).toBe(true)
    expect(dispatcher.project.markers).toHaveLength(0)
  })

  it('adds, resizes and removes a region, refusing one with no length', async () => {
    const added = await call('region_add', { startBeat: 4, lengthBeats: 8, label: 'Verse' })
    expect(added.ok).toBe(true)
    expect((await call('region_set', { regionId: added.regionId, lengthBeats: 16 })).ok).toBe(true)
    expect(dispatcher.project.regions[0]).toMatchObject({ startBeat: 4, lengthBeats: 16, label: 'Verse' })
    expect((await call('region_add', { startBeat: 0, lengthBeats: 0 })).ok).toBe(false)
    expect((await call('region_remove', { regionId: added.regionId })).ok).toBe(true)
  })

  it('takes expectedRevision, and refuses a stale one', async () => {
    const stale = await call('marker_add', { atBeat: 1, expectedRevision: 999 })
    expect(stale.ok).toBe(false)
    expect(dispatcher.project.markers).toHaveLength(0)
  })

  it('makes each a single undo step', async () => {
    const before = dispatcher.revision
    await call('marker_add', { atBeat: 2 })
    expect(dispatcher.canUndo()).toBe(true)
    dispatcher.undo()
    expect(dispatcher.project.markers).toHaveLength(0)
    expect(dispatcher.revision).toBeGreaterThanOrEqual(before)
  })
})
