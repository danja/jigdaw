// tests/ops/OpDispatcher.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { Project } from '../../src/model/Project.js'
import { encodeState } from '../../src/host/StateCodec.js'

const IRI = 'https://strandz.it/jigdaw/plugins/cascade/'
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'

/** An engine that records what it was asked to do. */
// Links between nodes, and links to a track's fader, are different questions.
// Every sink now reaches its track, so a test about one edge has to say which.
const between = engine => engine.links.filter(l => l.to !== 'track')
const toSpeakers = engine => engine.links.filter(l => l.to === 'track').map(l => l.from)

function fakeEngine ({ latency = 0, failWith = null, outputs = 1 } = {}) {
  const entries = new Map()
  let counter = 0
  return {
    calls: [],
    entries,
    async addPlugin (iri) {
      this.calls.push(['addPlugin', iri])
      if (failWith) throw Object.assign(new Error(failWith.message), { step: failWith.step })
      const id = `engine-${++counter}`
      const entry = {
        id,
        iri,
        // numberOfOutputs is what decides whether a sink reaches the speakers.
        node: { numberOfOutputs: outputs, numberOfInputs: 1, parameters: new Map([['mix', {}]]) },
        // The port counts, because the dispatcher now refuses an edge to a
        // port that is not there. They were missing and every test here
        // connected audio through a plugin that declared none, which is the
        // graph that threw IndexSizeError out of the real engine.
        profile: {
          label: 'Cascade',
          // Two, because the suite builds a mixer: one test joins two paths
          // into index 0 and index 1 of the same node.
          audioInputs: 2,
          audioOutputs: outputs,
          accepts: [],
          produces: [],
          ports: [{ symbol: 'mix', minimum: 0, maximum: 1, defaultValue: 0.3 }]
        },
        ready: { latencyFrames: latency }
      }
      entries.set(id, entry)
      return entry
    },
    get (id) {
      const entry = entries.get(id)
      if (!entry) throw new Error(`no such node: ${id}`)
      return entry
    },
    remove (id) { this.calls.push(['remove', id]); entries.delete(id) },
    // Track strips. Each refuses what the real engine refuses: a strip made
    // twice, and one used or removed that was never made.
    tracks: new Set(),
    addTrack (id) {
      if (this.tracks.has(id)) throw new Error(`track strip already exists: ${id}`)
      this.tracks.add(id)
    },
    removeTrack (id) {
      if (!this.tracks.delete(id)) throw new Error(`no such track strip: ${id}`)
      this.channels.delete(id)
    },
    trackIds () { return [...this.tracks] },
    // Sends, bus outputs and the master, refusing what the real engine refuses.
    sends: [],
    outputs: new Map(),
    master: null,
    clearSends () { this.sends = [] },
    addSend (id, from, to, options) {
      for (const t of [from, to]) if (!this.tracks.has(t)) throw new Error(`no such track strip: ${t}`)
      this.sends.push({ id, from, to, ...options })
    },
    setTrackOutput (id, to) {
      if (!this.tracks.has(id) || (to !== null && !this.tracks.has(to))) throw new Error(`no such track strip: ${to ?? id}`)
      this.outputs.set(id, to)
    },
    setMaster (m) { this.master = { ...m } },
    // Where audio arriving from another track goes, refusing what the real engine refuses: a strip that is
    // not there, and a node with no audio input.
    arrivals: new Map(),
    masterArrival: null,
    setTrackArrival (id, nodeId) {
      if (!this.tracks.has(id)) throw new Error(`no such track strip: ${id}`)
      if (nodeId !== null && !(this.get(nodeId).node.numberOfInputs > 0)) throw new Error(`node ${nodeId} has no audio input, so nothing can arrive at it`)
      this.arrivals.set(id, nodeId)
    },
    setMasterArrival (nodeId) {
      if (nodeId !== null && !(this.get(nodeId).node.numberOfInputs > 0)) throw new Error(`node ${nodeId} has no audio input, so nothing can arrive at it`)
      this.masterArrival = nodeId
    },
    // Track delays, refusing what the real engine refuses: a strip that is not there.
    delays: new Map(),
    setTrackDelay (id, frames) {
      if (!this.tracks.has(id)) throw new Error(`no such track strip: ${id}`)
      this.delays.set(id, frames)
    },
    linkToTrack (from, track) {
      if (track !== 'master' && !this.tracks.has(track)) throw new Error(`no such track strip: ${track}`)
      this.links.push({ from, to: 'track', track })
    },
    channels: new Map(),
    setTrackChannel (id, settings) {
      if (!this.tracks.has(id)) throw new Error(`no such track strip: ${id}`)
      this.channels.set(id, settings)
    },
    links: [],
    handlers: new Map(),
    onMessage (id, handler) {
      if (!this.handlers.has(id)) this.handlers.set(id, new Set())
      this.handlers.get(id).add(handler)
      return () => this.handlers.get(id).delete(handler)
    },
    post (id, message) { this.calls.push(['post', id, message]) },
    clearLinks () { this.links = [] },
    link (from, to, options = {}) { this.links.push({ from, to, ...options }) },
    defaultParameter (id, symbol) {
      const port = this.get(id).profile.ports.find(p => p.symbol === symbol)
      if (!port) throw new Error(`no parameter "${symbol}"`)
      return port.defaultValue
    },
    clampParameter (id, symbol, value) {
      const port = this.get(id).profile.ports.find(p => p.symbol === symbol)
      if (!port) throw new Error(`no parameter "${symbol}"`)
      return Math.min(port.maximum, Math.max(port.minimum, value))
    },
    setParameter (id, symbol, value) {
      this.calls.push(['setParameter', id, symbol, value])
      return Math.min(1, Math.max(0, value))
    }
  }
}

/** The track strip half of an engine, for the small fakes that need nothing else from it. */
const trackStrips = () => {
  const ids = new Set()
  return {
    addTrack: id => ids.add(id),
    removeTrack: id => ids.delete(id),
    trackIds: () => [...ids],
    linkToTrack: () => {},
    setTrackChannel: () => {},
    clearSends: () => {},
    addSend: () => {},
    setTrackOutput: () => {},
    setTrackArrival: () => {},
    setMasterArrival: () => {},
    setMaster: () => {}
  }
}

const edge = (from, to, over = {}) => ({
  op: 'addConnection',
  from: { node: from, portIndex: 0 },
  to: { node: to, portIndex: 0 },
  signalKind: AUDIO,
  ...over
})

let dispatcher
beforeEach(() => { dispatcher = new OpDispatcher() })

const addTwo = () => dispatcher.apply([
  { op: 'addTrack', id: 't' },
  { op: 'addNode', id: 'a', track: 't', pluginIri: IRI },
  { op: 'addNode', id: 'b', track: 't', pluginIri: IRI }
])

describe('apply', () => {
  it('commits a valid changeset and reports the new revision', () => {
    const result = addTwo()
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(true)
    expect(result.revision).toBe(1)
  })

  it('refuses a changeset that would not compile, before committing it', () => {
    // The whole reason this is the only way in: a graph that the compiler
    // rejects never reaches the model, so what is playing always matches what
    // the model says.
    addTwo()
    const before = dispatcher.revision
    const result = dispatcher.apply([edge('a', 'b'), edge('b', 'a')])
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('compile')
    expect(result.message).toContain('feedback loop')
    expect(dispatcher.revision).toBe(before)
    expect(dispatcher.project.connections).toHaveLength(0)
  })

  it('accepts that same loop once it carries a quantum of delay', () => {
    addTwo()
    expect(dispatcher.apply([edge('a', 'b'), edge('b', 'a', { delayFrames: 128 })]).ok).toBe(true)
  })

  it('reports a bad change as a change failure, naming its index', () => {
    addTwo()
    const result = dispatcher.apply([edge('a', 'b'), { op: 'removeNode', id: 'ghost' }])
    expect(result.kind).toBe('change')
    expect(result.index).toBe(1)
  })

  it('reports a stale revision as a conflict, with both numbers', () => {
    addTwo()
    const result = dispatcher.apply([], { expectedRevision: 0 })
    expect(result.kind).toBe('conflict')
    expect(result.expected).toBe(0)
    expect(result.revision).toBe(1)
  })

  it('does not throw for an expected failure, so a caller need not wrap it', () => {
    addTwo()
    expect(() => dispatcher.apply([edge('a', 'ghost')])).not.toThrow()
  })

  it('leaves the project untouched under dryRun', () => {
    addTwo()
    const result = dispatcher.apply([edge('a', 'b')], { dryRun: true })
    expect(result.ok).toBe(true)
    expect(result.applied).toBe(false)
    expect(dispatcher.project.connections).toHaveLength(0)
  })

  it('catches an uncompilable graph under dryRun too', () => {
    addTwo()
    expect(dispatcher.apply([edge('a', 'b'), edge('b', 'a')], { dryRun: true }).ok).toBe(false)
  })
})

describe('subscribe', () => {
  it('reports what changed, with the compiled result', () => {
    const seen = []
    dispatcher.subscribe(event => seen.push(event))
    addTwo()
    expect(seen).toHaveLength(1)
    expect(seen[0].type).toBe('changed')
    expect(seen[0].compiled.ok).toBe(true)
  })

  it('says nothing when a changeset was refused', () => {
    addTwo()
    const seen = []
    dispatcher.subscribe(event => seen.push(event))
    dispatcher.apply([edge('a', 'b'), edge('b', 'a')])
    expect(seen).toEqual([])
  })

  it('survives a listener that throws', () => {
    // One broken panel must not take down the surface.
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const seen = []
    dispatcher.subscribe(() => { throw new Error('broken panel') })
    dispatcher.subscribe(event => seen.push(event))
    expect(() => addTwo()).not.toThrow()
    expect(seen).toHaveLength(1)
    error.mockRestore()
  })

  it('stops reporting once unsubscribed', () => {
    const seen = []
    const off = dispatcher.subscribe(event => seen.push(event))
    addTwo()
    off()
    dispatcher.apply([edge('a', 'b')])
    expect(seen).toHaveLength(1)
  })
})

describe('addPlugin', () => {
  it('loads, then adds the node, and joins the two by id', () => {
    // Loading reaches the network and can fail slowly, so it happens outside
    // the changeset and the node id is what joins the halves.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    return d.addPlugin(IRI).then(result => {
      expect(result.ok).toBe(true)
      expect(d.project.nodes).toHaveLength(1)
      expect(d.engineNode(result.nodeId).id).toBe('engine-1')
    })
  })

  it('reports a load failure with the step that failed, and adds nothing', async () => {
    const engine = fakeEngine({ failWith: { message: 'no CORS header on the processor', step: 'fetch-resource' } })
    const d = new OpDispatcher({ engine })
    const result = await d.addPlugin(IRI)
    expect(result.ok).toBe(false)
    expect(result.kind).toBe('load')
    expect(result.step).toBe('fetch-resource')
    expect(d.project.nodes).toEqual([])
  })

  it('records a successful load as an inspection, contract section 10.3', async () => {
    const engine = fakeEngine()
    const inspections = { record: vi.fn() }
    const d = new OpDispatcher({ engine, inspections })
    await d.addPlugin(IRI)
    expect(inspections.record).toHaveBeenCalledWith({ iri: IRI, outcome: 'loaded' })
  })

  it('records a failed load as an inspection too, not only a successful one', async () => {
    const engine = fakeEngine({ failWith: { message: 'no CORS header on the processor', step: 'fetch-resource' } })
    const inspections = { record: vi.fn() }
    const d = new OpDispatcher({ engine, inspections })
    await d.addPlugin(IRI)
    expect(inspections.record).toHaveBeenCalledWith({ iri: IRI, outcome: 'failed: no CORS header on the processor' })
  })

  it('removes the loaded node from the engine if the model refuses it', async () => {
    // Otherwise a refused plugin keeps running, connected to nothing, audible
    // to nobody, and holding memory.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    await d.addPlugin('http://insecure/plugin/')
    expect(engine.calls.some(([name]) => name === 'remove')).toBe(true)
    expect(d.project.nodes).toEqual([])
  })

  it('refuses to load without an engine, rather than pretending', async () => {
    await expect(dispatcher.addPlugin(IRI)).rejects.toThrow(/no engine/)
  })

  it('uses the latency the engine reported when compiling', async () => {
    const engine = fakeEngine({ latency: 512 })
    const d = new OpDispatcher({ engine })
    await d.addPlugin(IRI)
    await d.addPlugin(IRI)
    const [a, b] = d.project.nodes.map(n => n.id)
    d.apply([edge(a, b)])
    expect(d.compile().totalLatency).toBe(1024)
  })
})

describe('how late each track is', () => {
  it('is the longest chain on the track, and zero for a track with nothing on it', async () => {
    const d = new OpDispatcher({ engine: fakeEngine({ latency: 512 }) })
    d.apply([{ op: 'addTrack', id: 'one' }, { op: 'addTrack', id: 'two' }, { op: 'addTrack', id: 'empty' }])
    const a = (await d.addPlugin(IRI, { track: 'one' })).nodeId
    const b = (await d.addPlugin(IRI, { track: 'two' })).nodeId
    const c = (await d.addPlugin(IRI, { track: 'two' })).nodeId
    d.apply([edge(b, c)])
    const byTrack = Object.fromEntries(d.trackLatencies().map(l => [l.trackId, l.frames]))
    expect(byTrack).toEqual({ one: 512, two: 1024, empty: 0 })
    expect(a).toBeTruthy()
  })

  it('is zero everywhere with no engine latency', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    d.apply([{ op: 'addTrack', id: 'one' }])
    await d.addPlugin(IRI, { track: 'one' })
    expect(d.trackLatencies()).toEqual([{ trackId: 'one', frames: 0, alignFrames: 0 }])
  })
})

describe('aligning tracks through a bus', () => {
  /** Two tracks into a bus that has a plugin of its own, and a third straight to the master. */
  async function bus (options = {}) {
    const engine = fakeEngine({ latency: 512 })
    const d = new OpDispatcher({ engine, ...options })
    d.apply([
      { op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'b' }, { op: 'addTrack', id: 'bus' }, { op: 'addTrack', id: 'c' }
    ])
    await d.addPlugin(IRI, { track: 'a' })
    const b1 = (await d.addPlugin(IRI, { track: 'b' })).nodeId
    const b2 = (await d.addPlugin(IRI, { track: 'b' })).nodeId
    d.apply([edge(b1, b2)])
    await d.addPlugin(IRI, { track: 'bus' })
    await d.addPlugin(IRI, { track: 'c' })
    d.apply([{ op: 'setTrack', id: 'a', output: 'bus' }, { op: 'setTrack', id: 'b', output: 'bus' }])
    return { d, engine }
  }

  it('lines the tracks into a bus up with each other, and the rest up with what the bus adds', async () => {
    const { d, engine } = await bus({ alignTracks: true })
    // a is 512 and b is 1024, so a waits 512 for b at the bus. The bus then adds its own 512, so what comes
    // out of it is 1536 late, and c, which is 512 late and goes straight to the master, waits 1024 for it.
    expect(Object.fromEntries(engine.delays)).toEqual({ a: 512, b: 0, bus: 0, c: 1024 })
    expect(Object.fromEntries(d.trackLatencies().map(l => [l.trackId, l.alignFrames]))).toEqual({ a: 512, b: 0, bus: 0, c: 1024 })
    // What each track says it has is its own chain, not what it is fed.
    expect(Object.fromEntries(d.trackLatencies().map(l => [l.trackId, l.frames]))).toEqual({ a: 512, b: 1024, bus: 512, c: 512 })
  })

  it('does nothing when off, and follows a track being sent to the master instead', async () => {
    const { d, engine } = await bus()
    expect(d.trackLatencies().every(l => l.alignFrames === 0)).toBe(true)
    d.setAlignTracks(true)
    d.apply([{ op: 'setTrack', id: 'a', output: null }])
    // a is now a peer of c and of the bus, which is 1536 with b alone feeding it, and so waits for all of them.
    expect(engine.delays.get('a')).toBe(1536 - 512)
    expect(engine.delays.get('c')).toBe(1536 - 512)
  })
})

describe('aligning tracks', () => {
  async function twoTracks (options = {}) {
    const engine = fakeEngine({ latency: 512 })
    const d = new OpDispatcher({ engine, ...options })
    d.apply([{ op: 'addTrack', id: 'slow' }, { op: 'addTrack', id: 'fast' }, { op: 'addTrack', id: 'empty' }])
    const a = (await d.addPlugin(IRI, { track: 'slow' })).nodeId
    const b = (await d.addPlugin(IRI, { track: 'slow' })).nodeId
    d.apply([edge(a, b)])
    await d.addPlugin(IRI, { track: 'fast' })
    return { d, engine }
  }

  it('delays the faster tracks by the difference to the slowest, when on', async () => {
    const { d, engine } = await twoTracks({ alignTracks: true })
    expect(Object.fromEntries(engine.delays)).toEqual({ fast: 512, empty: 1024 })
    expect(d.trackLatencies().find(t => t.trackId === 'fast')).toEqual({ trackId: 'fast', frames: 512, alignFrames: 512 })
  })

  it('does nothing to the engine when off, and says no track needs aligning', async () => {
    const { d, engine } = await twoTracks()
    expect(engine.delays.size).toBe(0)
    expect(d.trackLatencies().every(t => t.alignFrames === 0)).toBe(true)
  })

  it('turning it on gives every track its delay, and turning it off takes them away', async () => {
    const { d, engine } = await twoTracks()
    d.setAlignTracks(true)
    expect(d.alignTracks).toBe(true)
    expect(engine.delays.get('fast')).toBe(512)
    d.setAlignTracks(false)
    expect(engine.delays.get('fast')).toBe(0)
    expect(engine.delays.get('empty')).toBe(0)
  })

  it('follows an edit: a new plugin on the fast track changes what it needs', async () => {
    const { d, engine } = await twoTracks({ alignTracks: true })
    const [x] = d.project.nodes.filter(n => n.track === 'fast')
    const y = (await d.addPlugin(IRI, { track: 'fast' })).nodeId
    d.apply([edge(x.id, y)])
    expect(engine.delays.get('fast')).toBe(0)
  })

  it('forgets a track that has gone, and a track brought back starts with none', async () => {
    const { d, engine } = await twoTracks({ alignTracks: true })
    d.apply([{ op: 'removeTrack', id: 'empty' }])
    d.apply([{ op: 'addTrack', id: 'empty' }])
    expect(engine.delays.get('empty')).toBe(1024)
  })

  it('reports an alignment the engine cannot do, and leaves the graph as it was', async () => {
    const engine = fakeEngine({ latency: 512 })
    engine.setTrackDelay = () => { throw new Error('more than this host allows') }
    const d = new OpDispatcher({ engine, alignTracks: true })
    const errors = []
    const warnings = []
    d.subscribe(event => { if (event.type === 'warning') warnings.push(event.message) })
    const original = console.error
    console.error = m => errors.push(m)
    try {
      d.apply([{ op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'b' }])
      await d.addPlugin(IRI, { track: 'a' })
      expect(errors.some(m => /could not align track b: more than this host allows/.test(m))).toBe(true)
      expect(d.project.tracks).toHaveLength(2)
      // Said as an event too, so the page can show it, and once: another rebuild that fails the same way adds nothing.
      expect(warnings).toEqual(['could not align track b: more than this host allows'])
      d.apply([{ op: 'addTrack', id: 'c' }])
      expect(warnings.filter(m => m.includes('track b'))).toHaveLength(1)
    } finally { console.error = original }
  })
})

describe('sends, bus outputs and the master reach the engine', () => {
  it('makes each send in the engine from the model, with its level and tap, and again after an edit', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'b' }, { op: 'addSend', id: 's1', from: 'a', to: 'b', level: 0.4, tap: 'pre' }])
    expect(engine.sends).toEqual([{ id: 's1', from: 'a', to: 'b', level: 0.4, tap: 'pre' }])
    d.apply([{ op: 'setSend', id: 's1', level: 0.9 }])
    expect(engine.sends).toEqual([{ id: 's1', from: 'a', to: 'b', level: 0.9, tap: 'pre' }])
    d.apply([{ op: 'removeSend', id: 's1' }])
    expect(engine.sends).toEqual([])
  })

  it('sets a track output as a bus, and back to the master when the bus goes', () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'bus' }, { op: 'setTrack', id: 'a', output: 'bus' }])
    expect(engine.outputs.get('a')).toBe('bus')
    d.apply([{ op: 'removeTrack', id: 'bus' }])
    expect(engine.outputs.get('a')).toBeNull()
  })

  it('passes the master through, and undo puts the send back', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'b' }])
    d.apply([{ op: 'setMaster', gain: 0.5, pan: -0.25, muted: true }, { op: 'addSend', id: 's1', from: 'a', to: 'b' }])
    expect(engine.master).toEqual({ gain: 0.5, pan: -0.25, muted: true, audioInput: null })
    await d.undo()
    expect(engine.sends).toEqual([])
    expect(engine.master).toEqual({ gain: 1, pan: 0, muted: false, audioInput: null })
  })
})

describe('audio arriving at a track or the master reaches the engine', () => {
  it('sends a bus to the plugin the bus names as its audio input, and back to the fader when it is cleared', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'bus' }])
    const { nodeId } = await d.addPlugin(IRI, { track: 'bus' })
    expect(engine.arrivals.get('bus')).toBeNull()
    d.apply([{ op: 'setTrack', id: 'a', output: 'bus' }, { op: 'setTrack', id: 'bus', audioInput: nodeId }])
    expect(engine.arrivals.get('bus')).toBe('engine-1')
    d.apply([{ op: 'setTrack', id: 'bus', audioInput: null }])
    expect(engine.arrivals.get('bus')).toBeNull()
  })

  it('follows the audio input when the plugin is removed, so nothing is left wired to a plugin that is gone', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'bus' }])
    const { nodeId } = await d.addPlugin(IRI, { track: 'bus' })
    d.apply([{ op: 'setTrack', id: 'bus', audioInput: nodeId }])
    d.apply([{ op: 'removeNode', id: nodeId }])
    expect(engine.arrivals.get('bus')).toBeNull()
  })

  it('refuses an audio input that has no audio input of its own', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'bus' }])
    const { nodeId } = await d.addPlugin(IRI, { track: 'bus' })
    d.engineNode(nodeId).profile.audioInputs = 0
    const refused = d.apply([{ op: 'setTrack', id: 'bus', audioInput: nodeId }])
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/no audio input/)
    expect(d.project.track('bus').audioInput).toBeNull()
    d.apply([{ op: 'moveNodeToTrack', id: nodeId, track: 'master' }])
    expect(d.apply([{ op: 'setMaster', audioInput: nodeId }]).message).toMatch(/no audio input/)
  })

  it('puts a plugin on the master, links its sound to the master\'s fader, and sends the mix through its input', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'a' }])
    const { nodeId, trackId } = await d.addPlugin(IRI, { track: 'master' })
    expect(trackId).toBe('master')
    expect(d.project.node(nodeId).track).toBe('master')
    // A sink on the master reaches the master's fader, as a sink on a track reaches the track's.
    expect(engine.links.filter(l => l.to === 'track' && l.track === 'master').map(l => l.from)).toEqual(['engine-1'])
    d.apply([{ op: 'setMaster', audioInput: nodeId }])
    expect(engine.masterArrival).toBe('engine-1')
    d.apply([{ op: 'setMaster', audioInput: null }])
    expect(engine.masterArrival).toBeNull()
  })

  it('undoes and redoes a chain on the master, input and all', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI, { track: 'master' })
    d.apply([{ op: 'setMaster', audioInput: nodeId }])
    await d.undo()
    expect(d.project.master.audioInput).toBeNull()
    expect(engine.masterArrival).toBeNull()
    await d.undo()
    expect(d.project.nodes).toEqual([])
    await d.redo()
    await d.redo()
    expect(d.project.master.audioInput).toBe(nodeId)
    expect(d.project.node(nodeId).track).toBe('master')
  })
})

describe('a MIDI send between tracks reaches the router', () => {
  const MIDI = 'http://purl.org/stuff/transmissions/Midi'

  /** A track `src` with a MIDI generator and a track `dst` whose MIDI clips play into an instrument. */
  async function setup () {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'src' }, { op: 'addTrack', id: 'dst' }])
    const gen = await d.addPlugin(IRI, { track: 'src' })
    const inst = await d.addPlugin(IRI, { track: 'dst' })
    d.engineNode(gen.nodeId).profile.produces = [MIDI]
    d.engineNode(inst.nodeId).profile.accepts = [MIDI]
    return { engine, d, gen: gen.nodeId, inst: inst.nodeId }
  }
  const routes = d => d.router.routes

  it('routes the MIDI end of the source track to the node the target plays its clips into', async () => {
    const { d, gen, inst } = await setup()
    d.apply([{ op: 'setTrack', id: 'dst', midiInput: inst }, { op: 'addSend', id: 's1', from: 'src', to: 'dst', kind: 'midi' }])
    expect(routes(d)).toEqual([{ from: 'engine-1', to: 'engine-2' }])
    // Taking the send away takes the route with it.
    d.apply([{ op: 'removeSend', id: 's1' }])
    expect(routes(d)).toEqual([])
    void gen
  })

  it('routes to nothing when the target has no MIDI input, as its clips would play into nothing', async () => {
    const { d } = await setup()
    d.apply([{ op: 'addSend', id: 's1', from: 'src', to: 'dst', kind: 'midi' }])
    expect(routes(d)).toEqual([])
  })

  it('leaves out a node that already passes its MIDI on by a connection, and sees through one that is bypassed', async () => {
    const { d, gen, inst } = await setup()
    const second = await d.addPlugin(IRI, { track: 'src' })
    d.engineNode(second.nodeId).profile.produces = [MIDI]
    d.engineNode(second.nodeId).profile.accepts = [MIDI]
    d.apply([
      { op: 'setTrack', id: 'dst', midiInput: inst },
      { op: 'addConnection', from: { node: gen, portIndex: 0 }, to: { node: second.nodeId, portIndex: 0 }, signalKind: MIDI },
      { op: 'addSend', id: 's1', from: 'src', to: 'dst', kind: 'midi' }
    ])
    // The generator feeds the second plugin, so only the second is the end of the chain.
    expect(routes(d).filter(r => r.to === 'engine-2').map(r => r.from)).toEqual(['engine-3'])
    d.apply([{ op: 'setNode', id: second.nodeId, bypassed: true }])
    // Bypassed, it passes what it gets straight through, so the generator is the end of the chain again.
    expect(routes(d).filter(r => r.to === 'engine-2').map(r => r.from)).toEqual(['engine-1'])
  })

  it('does not carry audio, and an audio send does not carry MIDI', async () => {
    const { engine, d, inst } = await setup()
    d.apply([{ op: 'setTrack', id: 'dst', midiInput: inst }, { op: 'addSend', id: 's1', from: 'src', to: 'dst' }])
    expect(routes(d)).toEqual([])
    expect(engine.sends.map(x => x.id)).toEqual(['s1'])
    d.apply([{ op: 'addSend', id: 's2', from: 'src', to: 'dst', kind: 'midi' }])
    // The MIDI send is not an audio send: the engine, which makes audio sends, is told of one only.
    expect(engine.sends.map(x => x.id)).toEqual(['s1'])
    expect(routes(d)).toHaveLength(1)
  })
})

describe('a note range on MIDI routes reaches the router, and undo puts it back', () => {
  const MIDI = 'http://purl.org/stuff/transmissions/Midi'

  it('carries a connection\'s range, changes it live, and undoes the change', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 't' }])
    const a = (await d.addPlugin(IRI, { track: 't' })).nodeId
    const b = (await d.addPlugin(IRI, { track: 't' })).nodeId
    for (const id of [a, b]) { d.engineNode(id).profile.produces = [MIDI]; d.engineNode(id).profile.accepts = [MIDI] }
    d.apply([{ op: 'addConnection', id: 'c1', from: { node: a, portIndex: 0 }, to: { node: b, portIndex: 0 }, signalKind: MIDI, lowNote: 36, highNote: 59 }])
    expect(d.router.routes).toEqual([{ from: 'engine-1', to: 'engine-2', lowNote: 36, highNote: 59 }])
    d.apply([{ op: 'setConnection', id: 'c1', highNote: 71 }])
    expect(d.router.routes).toEqual([{ from: 'engine-1', to: 'engine-2', lowNote: 36, highNote: 71 }])
    d.apply([{ op: 'setConnection', id: 'c1', lowNote: null, highNote: null }])
    expect(d.router.routes).toEqual([{ from: 'engine-1', to: 'engine-2' }])
    await d.undo()
    expect(d.router.routes).toEqual([{ from: 'engine-1', to: 'engine-2', lowNote: 36, highNote: 71 }])
    await d.undo()
    expect(d.router.routes).toEqual([{ from: 'engine-1', to: 'engine-2', lowNote: 36, highNote: 59 }])
    await d.redo()
    expect(d.project.connection('c1')).toMatchObject({ lowNote: 36, highNote: 71 })
  })

  it('carries a MIDI send\'s range to the route it makes, and a second send to the same target splits the source', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 'src' }, { op: 'addTrack', id: 'low' }, { op: 'addTrack', id: 'high' }])
    const gen = (await d.addPlugin(IRI, { track: 'src' })).nodeId
    const lo = (await d.addPlugin(IRI, { track: 'low' })).nodeId
    const hi = (await d.addPlugin(IRI, { track: 'high' })).nodeId
    d.engineNode(gen).profile.produces = [MIDI]
    d.apply([
      { op: 'setTrack', id: 'low', midiInput: lo }, { op: 'setTrack', id: 'high', midiInput: hi },
      { op: 'addSend', id: 's1', from: 'src', to: 'low', kind: 'midi', highNote: 59 },
      { op: 'addSend', id: 's2', from: 'src', to: 'high', kind: 'midi', lowNote: 60 }
    ])
    expect(d.router.routes).toEqual([
      { from: 'engine-1', to: 'engine-2', highNote: 59 },
      { from: 'engine-1', to: 'engine-3', lowNote: 60 }
    ])
    const toLow = () => d.router.routes.find(r => r.to === 'engine-2')
    d.apply([{ op: 'setSend', id: 's1', highNote: 71 }])
    expect(toLow()).toEqual({ from: 'engine-1', to: 'engine-2', highNote: 71 })
    await d.undo()
    expect(toLow()).toEqual({ from: 'engine-1', to: 'engine-2', highNote: 59 })
  })
})

describe('setParameter', () => {
  it('records in the model and applies to the AudioParam', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI)

    const result = d.setParameter(nodeId, 'mix', 0.4)
    expect(result.ok).toBe(true)
    expect(d.project.node(nodeId).settings.get('mix')).toBe(0.4)
    expect(engine.calls).toContainEqual(['setParameter', 'engine-1', 'mix', 0.4])
  })

  it('records what was applied, not what was asked for', async () => {
    // messaging.md 2.3. The engine clamps to the declared range, and a surface
    // that renders its own request disagrees with the host the first time a
    // value is clamped.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI)

    const result = d.setParameter(nodeId, 'mix', 99)
    expect(result.value).toBe(1)
    expect(d.project.node(nodeId).settings.get('mix')).toBe(1)
  })

  it('is one revision for one edit, even when the value is clamped', async () => {
    // It used to write the asked-for value, then write the clamped one straight
    // to the project, around this dispatcher's own compile gate. Two revisions
    // for one movement of one slider, which an undo stack then has to unpick.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI)

    const before = d.revision
    d.setParameter(nodeId, 'mix', 0.4)
    expect(d.revision - before, 'a value inside the range').toBe(1)

    const middle = d.revision
    d.setParameter(nodeId, 'mix', 99)
    expect(d.revision - middle, 'a value that had to be clamped').toBe(1)
    expect(d.project.node(nodeId).settings.get('mix')).toBe(1)
  })

  it('never asks the engine to apply a value it did not record', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI)
    d.setParameter(nodeId, 'mix', 99)
    // The model and the AudioParam must have been given the same number.
    const applied = engine.calls.filter(c => c[0] === 'setParameter').map(c => c[3])
    expect(applied).toEqual([1])
    expect(d.project.node(nodeId).settings.get('mix')).toBe(1)
  })

  it('reports an unknown node without touching the engine', () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    expect(d.setParameter('ghost', 'mix', 0.5).ok).toBe(false)
    expect(engine.calls).toEqual([])
  })
})

/** A dispatcher with two plugins loaded and nothing wired between them. */
const twoLoaded = async (engine) => {
  const d = new OpDispatcher({ engine })
  const a = await d.addPlugin(IRI)
  const b = await d.addPlugin(IRI)
  return { d, a: a.nodeId, b: b.nodeId }
}

describe('rebuilding the audio links', () => {
  it('links the engine nodes a connection names', async () => {
    const engine = fakeEngine()
    const { d, a, b } = await twoLoaded(engine)
    d.apply([edge(a, b)])
    expect(between(engine)).toHaveLength(1)
    expect(between(engine)[0]).toMatchObject({
      from: 'engine-1', to: 'engine-2', fromOutput: 0, toInput: 0, delayFrames: 0
    })
    // An audio edge names no parameter, which is what keeps it an audio edge.
    expect(between(engine)[0].toParameter).toBe(null)
    // And the far end of the chain is what reaches the speakers.
    expect(toSpeakers(engine)).toEqual(['engine-2'])
  })

  it('links an endpoint that names a parameter to that parameter', async () => {
    // The project format has been able to express modulation since it was
    // written: an endpoint carries jig:portIndex or jig:portSymbol, the shapes
    // enforce exactly one with sh:xone, and connection_add exposes the symbol
    // form as toParameter. Nothing delivered it. The symbol was dropped and
    // portIndex ?? 0 put the signal on audio input zero instead, silently.
    const engine = fakeEngine()
    const { d, a, b } = await twoLoaded(engine)
    d.apply([{
      op: 'addConnection',
      from: { node: a, portIndex: 0 },
      to: { node: b, portSymbol: 'mix' },
      signalKind: AUDIO
    }])
    expect(between(engine)).toHaveLength(1)
    expect(between(engine)[0].toParameter).toBe('mix')
  })

  it('keeps an audio edge and a modulation edge between the same two nodes', async () => {
    // Different destinations, so not the same connection. Before signalKind and
    // the symbol were part of the identity these collided as a duplicate.
    const engine = fakeEngine()
    const { d, a, b } = await twoLoaded(engine)
    const result = d.apply([
      edge(a, b),
      {
        op: 'addConnection',
        from: { node: a, portIndex: 0 },
        to: { node: b, portSymbol: 'mix' },
        signalKind: AUDIO
      }
    ])
    expect(result.ok, result.message).toBe(true)
    expect(between(engine).map(l => l.toParameter)).toEqual([null, 'mix'])
  })

  it('refuses an edge to a port the node has not got, rather than throwing later', async () => {
    // The model checks the shape of an endpoint and has no profiles to check
    // it against. The engine has them and finds out by throwing IndexSizeError
    // out of AudioNode.connect while rebuilding the links, after the change
    // is committed, which escapes whatever was applying it and leaves the
    // interface half drawn. Loading a reverb and then an instrument was
    // enough: the application chains each plugin to the one before it, and an
    // instrument has no audio input.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = (await d.addPlugin(IRI)).nodeId
    const b = (await d.addPlugin(IRI)).nodeId

    const tooHigh = d.apply([edge(a, b, { to: { node: b, portIndex: 9 } })])
    expect(tooHigh.ok).toBe(false)
    expect(tooHigh.message).toMatch(/no audio input at index 9/)
    // Nothing was committed, and nothing reached the engine.
    expect(d.project.connections).toHaveLength(0)
    expect(between(engine)).toHaveLength(0)

    const noSuchParameter = d.apply([edge(a, b, { to: { node: b, portSymbol: 'nope' } })])
    expect(noSuchParameter.ok).toBe(false)
    expect(noSuchParameter.message).toMatch(/no parameter "nope"/)

    // And the edge that is there is still allowed.
    expect(d.apply([edge(a, b)]).ok).toBe(true)
  })

  it('says what the node does have, so the message is actionable', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = (await d.addPlugin(IRI)).nodeId
    const b = (await d.addPlugin(IRI)).nodeId
    const refused = d.apply([edge(a, b, { to: { node: b, portIndex: 9 } })])
    expect(refused.message).toMatch(/It has: Audio in 1, Audio in 2, mix \(modulate\)\./)
  })

  it('applies compensation as a delay on the fast path', async () => {
    // The compiler says which edge is early; this is where that becomes audio.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const src = (await d.addPlugin(IRI)).nodeId
    const slow = (await d.addPlugin(IRI)).nodeId
    const fast = (await d.addPlugin(IRI)).nodeId
    const mix = (await d.addPlugin(IRI)).nodeId

    // Only the slow node has latency.
    engine.entries.get(d.engineNode(slow).id).ready.latencyFrames = 512

    d.apply([
      edge(src, slow), edge(src, fast),
      edge(slow, mix), edge(fast, mix, { to: { node: mix, portIndex: 1 } })
    ])

    const delayed = engine.links.filter(l => l.delayFrames > 0)
    expect(delayed).toHaveLength(1)
    expect(delayed[0].delayFrames).toBe(512)
    expect(delayed[0].from).toBe(d.engineNode(fast).id)
  })

  it('tears down every link before rebuilding, leaving nothing stale', async () => {
    const engine = fakeEngine()
    const { d, a, b } = await twoLoaded(engine)
    d.apply([edge(a, b)])
    const [connection] = d.project.connections
    d.apply([{ op: 'removeConnection', id: connection.id }])
    expect(between(engine)).toEqual([])
  })

  it('skips a connection whose nodes are not both loaded', async () => {
    // Normal while loading: the model can name a node the engine has not
    // instantiated yet, and that is not an error.
    const engine = fakeEngine()
    const { d, a } = await twoLoaded(engine)
    d.apply([{ op: 'addNode', id: 'unloaded', track: d.project.tracks[0].id, pluginIri: IRI }])
    d.apply([edge(a, 'unloaded')])
    // No edge between nodes, because one end is not in the engine yet. The
    // loaded sink still reaches the speakers: that is not the connection under
    // test, and silencing it would be a worse answer than skipping the edge.
    expect(between(engine)).toEqual([])
  })
})

describe('removing a node lets go of what was playing it', () => {
  // Until this was checked, removing a plugin from the model left its
  // AudioWorkletNode running and connected to whatever the page had wired it
  // to. Rebuilding links does not cover it: a node with no links is exactly the
  // case that leaks. Found while adding session reopening, where the symptom
  // would have been the old session still audible under the new one.
  function recordingEngine () {
    const removed = []
    return {
      removed,
      nodes: () => [],
      addPlugin: async iri => ({
        id: `engine-${iri}`,
        profile: { label: 'X', produces: [], latencyFrames: 0 },
        node: {},
        ready: {}
      }),
      remove: id => removed.push(id),
      clearLinks: () => {},
      link: () => {},
      ...trackStrips(),
      get: () => ({ profile: { produces: [] } }),
      onMessage: () => () => {}
    }
  }

  it('removes the engine node too', async () => {
    const engine = recordingEngine()
    const d = new OpDispatcher({ engine })
    const added = await d.addPlugin('https://example.org/plugins/pulse/')
    expect(d.apply([{ op: 'removeNode', id: added.nodeId }]).ok).toBe(true)
    expect(engine.removed).toEqual([added.entry.id])
  })

  it('removes every engine node when a whole session is cleared', async () => {
    const engine = recordingEngine()
    const d = new OpDispatcher({ engine })
    const a = await d.addPlugin('https://example.org/plugins/pulse/')
    const b = await d.addPlugin('https://example.org/plugins/cascade/')
    d.apply([{ op: 'removeNode', id: a.nodeId }, { op: 'removeNode', id: b.nodeId }])
    expect(engine.removed.sort()).toEqual([a.entry.id, b.entry.id].sort())
  })

  it('keeps the ones that are still there', async () => {
    const engine = recordingEngine()
    const d = new OpDispatcher({ engine })
    const a = await d.addPlugin('https://example.org/plugins/pulse/')
    await d.addPlugin('https://example.org/plugins/cascade/')
    d.apply([{ op: 'removeNode', id: a.nodeId }])
    expect(engine.removed).toEqual([a.entry.id])
  })
})

describe('a node can be given its name, so a session can be reopened', () => {
  it('uses the id it is given rather than minting one', async () => {
    // The connections in a saved project name the nodes they join, so a node
    // that came back under a different name would be joined to nothing.
    const engine = {
      nodes: () => [],
      addPlugin: async () => ({ id: 'e1', profile: { label: 'X', produces: [], latencyFrames: 0 }, node: {}, ready: {} }),
      remove: () => {}, clearLinks: () => {}, link: () => {}, ...trackStrips(),
      get: () => ({ profile: { produces: [] } }), onMessage: () => () => {}
    }
    const d = new OpDispatcher({ engine })
    const added = await d.addPlugin('https://example.org/plugins/pulse/', { id: 'verb', label: 'Verb' })
    expect(added.nodeId).toBe('verb')
    expect(d.project.node('verb').label).toBe('Verb')
  })
})

describe('reaching the speakers', () => {
  // Engine.link could always resolve 'output', and the dispatcher never passed
  // it, so nothing in the compiled graph was connected to anything audible. The
  // page reached around the model and connected each node itself, which meant
  // the model was not in charge of what you could hear.
  it('connects a lone plugin', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI)
    d.apply([{ op: 'setSetting', node: nodeId, symbol: 'mix', value: 0.5 }])
    expect(toSpeakers(engine)).toEqual(['engine-1'])
  })

  it('connects the end of a chain and not its middle', async () => {
    const engine = fakeEngine()
    const { d, a, b } = await twoLoaded(engine)
    d.apply([edge(a, b)])
    expect(toSpeakers(engine)).toEqual(['engine-2'])
  })

  it('connects every branch that ends somewhere', async () => {
    // Two effects fed from one source, neither feeding anything: both are
    // sinks and both are things a person expects to hear.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const src = (await d.addPlugin(IRI)).nodeId
    const left = (await d.addPlugin(IRI)).nodeId
    const right = (await d.addPlugin(IRI)).nodeId
    d.apply([edge(src, left), edge(src, right)])
    expect(toSpeakers(engine).sort()).toEqual(['engine-2', 'engine-3'])
  })

  it('does not connect a node with no audio outputs', async () => {
    // A MIDI generator ends a path and produces nothing to hear. Connecting it
    // throws IndexSizeError, which is an exception in the middle of a rebuild.
    const engine = fakeEngine({ outputs: 0 })
    const d = new OpDispatcher({ engine })
    await d.addPlugin(IRI)
    expect(toSpeakers(engine)).toEqual([])
  })

  it('does not connect a node that feeds a parameter', async () => {
    // A modulation source feeds something, so it is not a sink, and putting an
    // LFO through the speakers is not what anybody meant.
    const engine = fakeEngine()
    const { d, a, b } = await twoLoaded(engine)
    d.apply([{
      op: 'addConnection',
      from: { node: a, portIndex: 0 },
      to: { node: b, portSymbol: 'mix' },
      signalKind: AUDIO
    }])
    expect(toSpeakers(engine)).toEqual(['engine-2'])
  })

  it('moves as the graph changes', async () => {
    const engine = fakeEngine()
    const { d, a, b } = await twoLoaded(engine)
    expect(toSpeakers(engine).sort()).toEqual(['engine-1', 'engine-2'])
    d.apply([edge(a, b)])
    expect(toSpeakers(engine)).toEqual(['engine-2'])
    const [connection] = d.project.connections
    d.apply([{ op: 'removeConnection', id: connection.id }])
    expect(toSpeakers(engine).sort()).toEqual(['engine-1', 'engine-2'])
  })
})

describe('the channel strip', () => {
  const strips = engine => Object.fromEntries(
    [...engine.channels].map(([id, c]) => [id, `${c.gain}/${c.pan}/${c.silent ? 'silent' : 'heard'}`]))

  it('reaches the engine with the defaults', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    await d.addPlugin(IRI)
    expect(strips(engine)).toEqual({ 'track-1': '1/0/heard' })
  })

  it('carries a fader and a pan', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { trackId } = await d.addPlugin(IRI)
    d.setTrackChannel(trackId, { gain: 0.5, pan: -1 })
    expect(strips(engine)).toEqual({ 'track-1': '0.5/-1/heard' })
  })

  it('silences a muted track without losing its level', async () => {
    // The reason a mixer has both: unmuting restores what was set.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { trackId } = await d.addPlugin(IRI)
    d.setTrackChannel(trackId, { gain: 0.7 })
    d.setTrackChannel(trackId, { muted: true })
    expect(strips(engine)).toEqual({ 'track-1': '0.7/0/silent' })
    d.setTrackChannel(trackId, { muted: false })
    expect(strips(engine)).toEqual({ 'track-1': '0.7/0/heard' })
  })

  it('silences everything that is not soloed', async () => {
    // Whether a track is heard depends on whether another is soloed, which
    // is why this is resolved here and not in the engine.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = (await d.addPlugin(IRI)).trackId
    await d.addPlugin(IRI)
    await d.addPlugin(IRI)
    d.setTrackChannel(a, { soloed: true })
    expect(strips(engine)).toEqual({
      'track-1': '1/0/heard', 'track-2': '1/0/silent', 'track-3': '1/0/silent'
    })
  })

  it('brings everything back when the solo is released', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = (await d.addPlugin(IRI)).trackId
    await d.addPlugin(IRI)
    d.setTrackChannel(a, { soloed: true })
    d.setTrackChannel(a, { soloed: false })
    expect(strips(engine)).toEqual({ 'track-1': '1/0/heard', 'track-2': '1/0/heard' })
  })

  it('still silences a soloed track that is also muted', async () => {
    // Somebody pressed mute and meant it.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = (await d.addPlugin(IRI)).trackId
    await d.addPlugin(IRI)
    d.setTrackChannel(a, { soloed: true, muted: true })
    expect(strips(engine)['track-1']).toBe('1/0/silent')
  })

  it('hears several soloed tracks together', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = (await d.addPlugin(IRI)).trackId
    const b = (await d.addPlugin(IRI)).trackId
    await d.addPlugin(IRI)
    d.setTrackChannel(a, { soloed: true })
    d.setTrackChannel(b, { soloed: true })
    expect(strips(engine)).toEqual({
      'track-1': '1/0/heard', 'track-2': '1/0/heard', 'track-3': '1/0/silent'
    })
  })

  it('refuses a gain below zero, which is an inverted signal', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { trackId } = await d.addPlugin(IRI)
    const result = d.setTrackChannel(trackId, { gain: -1 })
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/at or above zero/)
  })

  it('refuses a pan outside the stereo field', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { trackId } = await d.addPlugin(IRI)
    expect(d.setTrackChannel(trackId, { pan: 2 }).ok).toBe(false)
  })

  it('reports what a listener hears, which is not what any track says', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = (await d.addPlugin(IRI)).trackId
    const b = (await d.addPlugin(IRI)).trackId
    d.setTrackChannel(a, { soloed: true })
    const heard = Object.fromEntries(d.audibility().map(x => [x.trackId, x.silent]))
    expect(heard).toEqual({ [a]: false, [b]: true })
  })
})

describe('loading a plugin carries everything a node holds', () => {
  // The restore path lost a saved mix: the writer wrote it, the reader read it,
  // and addPlugin forwarded a chosen few fields on the way back in. Found in a
  // browser, because every test either built a node or read one and none of
  // them did both through the path the page uses.
  it('gives a plugin a track of its own, named after it, when given none', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId, trackId } = await d.addPlugin(IRI, { id: 'verb', label: 'Verb' })
    expect(d.project.node(nodeId).track).toBe(trackId)
    expect(d.project.track(trackId).label).toBe('Verb')
    // One edit, so one undo takes both away.
    expect(d.project.revision).toBe(1)
    // Cascade accepts no MIDI, so nothing is named as the MIDI input.
    expect(d.project.track(trackId).midiInput).toBeNull()
  })

  it('makes a plugin that accepts MIDI its new track\'s MIDI input', async () => {
    const engine = fakeEngine()
    const add = engine.addPlugin.bind(engine)
    engine.addPlugin = async iri => {
      const entry = await add(iri)
      entry.profile.accepts = ['http://purl.org/stuff/transmissions/Midi']
      return entry
    }
    const d = new OpDispatcher({ engine })
    const { nodeId, trackId } = await d.addPlugin(IRI)
    expect(d.project.track(trackId).midiInput).toBe(nodeId)

    // On a track that already exists nothing is guessed.
    const second = await d.addPlugin(IRI, { track: trackId })
    expect(second.trackId).toBe(trackId)
    expect(d.project.track(trackId).midiInput).toBe(nodeId)
  })

  it('puts a plugin on the track it is given, and refuses one that is not there', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const first = await d.addPlugin(IRI)
    const second = await d.addPlugin(IRI, { track: first.trackId })
    expect(d.project.node(second.nodeId).track).toBe(first.trackId)
    expect(d.project.tracks).toHaveLength(1)

    const refused = await d.addPlugin(IRI, { track: 'nope' })
    expect(refused.ok).toBe(false)
    expect(refused.message).toMatch(/no such track/)
    // Refused by the model, so released by the engine too.
    expect(engine.calls.at(-1)[0]).toBe('remove')
  })

  it('keeps settings and state it is given', async () => {
    // A real jig:nodeState string, per src/host/StateCodec.js: addPlugin
    // decodes it for the engine, which this suite's fake ignores, and the
    // model keeps the encoded form unchanged, exactly what a reopened
    // session's string was and what a later save writes back out.
    const state = encodeState({ a: 1 })
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI, {
      id: 'verb', settings: { mix: 0.34 }, state
    })
    expect(d.project.node(nodeId).settings.get('mix')).toBe(0.34)
    expect(d.project.node(nodeId).state).toBe(state)
  })

  it('forwards every field the model accepts, not a list of them', async () => {
    // The guard that makes the next field safe. Whatever addNode understands,
    // addPlugin must hand over, so this compares against the model rather than
    // against a list written here.
    const state = encodeState('zzz')
    const engine = fakeEngine()
    const plain = new Project()
    plain.apply([{ op: 'addTrack', id: 't' }, {
      op: 'addNode',
      id: 'x',
      track: 't',
      pluginIri: IRI,
      label: 'X',
      settings: { mix: 0.2 },
      state
    }])

    const d = new OpDispatcher({ engine })
    d.apply([{ op: 'addTrack', id: 't' }])
    await d.addPlugin(IRI, {
      id: 'x',
      track: 't',
      label: 'X',
      settings: { mix: 0.2 },
      state
    })

    const direct = plain.node('x')
    const loaded = d.project.node('x')
    for (const key of Object.keys(direct)) {
      const a = direct[key] instanceof Map ? [...direct[key]] : direct[key]
      const b = loaded[key] instanceof Map ? [...loaded[key]] : loaded[key]
      expect(b, `addPlugin dropped "${key}"`).toEqual(a)
    }
  })
})

describe('the history in words', () => {
  it('lists what was done, oldest first, and what was undone, next to redo first', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    expect(d.history()).toEqual({ done: [], undone: [] })
    d.apply([{ op: 'addTrack' }])
    d.apply([{ op: 'setTransport', beatsPerBar: 3 }])
    d.apply([{ op: 'addClip', track: 'track-1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [] }])
    expect(d.history()).toEqual({ done: ['Add a track', 'Change tempo, loop or time signature', 'Add a clip'], undone: [] })
    await d.undo()
    await d.undo()
    expect(d.history()).toEqual({ done: ['Add a track'], undone: ['Change tempo, loop or time signature', 'Add a clip'] })
    await d.redo()
    expect(d.history()).toEqual({ done: ['Add a track', 'Change tempo, loop or time signature'], undone: ['Add a clip'] })
  })

  it('forgets what was undone when something new is done, and clears with the history', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    d.apply([{ op: 'addTrack' }])
    await d.undo()
    d.apply([{ op: 'addTrack' }, { op: 'addTrack' }])
    expect(d.history()).toEqual({ done: ['Add a track'], undone: [] })
    d.clearHistory()
    expect(d.history()).toEqual({ done: [], undone: [] })
  })

  it('gives a grouped edit one step with the label it was given, and a default one without', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    await d.grouped(() => { d.apply([{ op: 'addTrack' }]); d.apply([{ op: 'addTrack' }]) }, { label: 'Run a script' })
    await d.grouped(() => { d.apply([{ op: 'addTrack' }]) })
    expect(d.history().done).toEqual(['Run a script', 'Several changes'])
  })
})

describe('undo and redo', () => {
  it('starts with nothing to step through', () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    expect(d.canUndo()).toBe(false)
    expect(d.canRedo()).toBe(false)
  })

  it('steps a parameter back to what it was, and forward again', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI, { settings: { mix: 0.2 } })
    d.setParameter(nodeId, 'mix', 0.9)
    expect(d.project.node(nodeId).settings.get('mix')).toBe(0.9)

    expect(d.canUndo()).toBe(true)
    await d.undo()
    expect(d.project.node(nodeId).settings.get('mix')).toBe(0.2)
    // Not only the model: the engine's AudioParam has to move with it, or an
    // undone knob turn is silent about the sound not having moved.
    expect(engine.calls.at(-1)).toEqual(['setParameter', 'engine-1', 'mix', 0.2])

    expect(d.canRedo()).toBe(true)
    await d.redo()
    expect(d.project.node(nodeId).settings.get('mix')).toBe(0.9)
    expect(engine.calls.at(-1)).toEqual(['setParameter', 'engine-1', 'mix', 0.9])
  })

  it('steps the first change to a parameter back to its default, everywhere', async () => {
    // Found in a browser: undoing the first change to a parameter left it where
    // it was, because the snapshot being restored had no setting for it and
    // undo only walked the settings the snapshot had.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI)
    const told = []
    d.subscribe(e => { if (e.type === 'parameter') told.push(e.value) })
    d.setParameter(nodeId, 'mix', 0.9)
    await d.undo()
    expect(d.project.node(nodeId).settings.has('mix')).toBe(false)
    expect(engine.calls.at(-1)).toEqual(['setParameter', 'engine-1', 'mix', 0.3])
    expect(told).toEqual([0.9, 0.3])
    await d.redo()
    expect(d.project.node(nodeId).settings.get('mix')).toBe(0.9)
  })

  it('steps a channel change back and forward', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { trackId } = await d.addPlugin(IRI)
    d.setTrackChannel(trackId, { muted: true, pan: -0.5 })

    await d.undo()
    expect(d.project.track(trackId).channel).toEqual({ gain: 1, pan: 0, muted: false, soloed: false })
    expect(engine.channels.get(trackId)).toEqual({ gain: 1, pan: 0, silent: false })
    await d.redo()
    expect(d.project.track(trackId).channel).toEqual({ gain: 1, pan: -0.5, muted: true, soloed: false })
    expect(engine.channels.get(trackId)).toEqual({ gain: 1, pan: -0.5, silent: true })
  })

  it('steps removing a track back, with its strip, label and inputs', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId, trackId } = await d.addPlugin(IRI, { label: 'Lead' })
    d.apply([{ op: 'setTrack', id: trackId, midiInput: nodeId }])
    d.setTrackChannel(trackId, { gain: 0.25 })
    d.apply([{ op: 'removeNode', id: nodeId }, { op: 'removeTrack', id: trackId }])
    expect(d.project.tracks).toEqual([])
    expect(engine.trackIds()).toEqual([])

    await d.undo()
    expect(d.project.track(trackId)).toMatchObject({ label: 'Lead', midiInput: nodeId, channel: { gain: 0.25 } })
    expect(d.project.node(nodeId).track).toBe(trackId)
    expect(engine.trackIds()).toEqual([trackId])
    expect(toSpeakers(engine)).toHaveLength(1)

    await d.redo()
    expect(d.project.tracks).toEqual([])
  })

  it('steps moving a node between tracks back and forward', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = await d.addPlugin(IRI)
    const b = await d.addPlugin(IRI)
    d.apply([{ op: 'moveNodeToTrack', id: a.nodeId, track: b.trackId }])
    expect(engine.links.find(l => l.from === 'engine-1').track).toBe(b.trackId)

    await d.undo()
    expect(d.project.node(a.nodeId).track).toBe(a.trackId)
    expect(engine.links.find(l => l.from === 'engine-1').track).toBe(a.trackId)
    await d.redo()
    expect(d.project.node(a.nodeId).track).toBe(b.trackId)
  })

  it('steps a connection back and forward', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    await d.addPlugin(IRI, { id: 'a' })
    await d.addPlugin(IRI, { id: 'b' })
    d.apply([edge('a', 'b')])
    expect(between(engine)).toHaveLength(1)

    await d.undo()
    expect(d.project.connections).toEqual([])
    expect(between(engine)).toHaveLength(0)

    await d.redo()
    expect(d.project.connections).toHaveLength(1)
    expect(between(engine)).toHaveLength(1)
  })

  it('steps the tempo back and forward', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    d.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: 140 }] }])
    await d.undo()
    expect(d.project.transport.tempoPoints[0].bpm).toBe(120)
    await d.redo()
    expect(d.project.transport.tempoPoints[0].bpm).toBe(140)
  })

  it('steps adding a node back, releasing it from the engine, and forward again', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI)
    expect(d.project.nodes).toHaveLength(1)

    await d.undo()
    expect(d.project.nodes).toEqual([])
    expect(engine.calls.some(([name, id]) => name === 'remove' && id === 'engine-1')).toBe(true)

    // Forward again reloads it: a project node is an instantiated plugin, not
    // only a row of data, so redoing an add is a second load.
    await d.redo()
    expect(d.project.nodes).toHaveLength(1)
    expect(d.project.node(nodeId)).not.toBeNull()
    expect(engine.calls.filter(([name]) => name === 'addPlugin')).toHaveLength(2)
  })

  it('steps removing a node back by reloading it, with its settings and track intact', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId, trackId } = await d.addPlugin(IRI, { settings: { mix: 0.42 } })
    d.apply([{ op: 'setTrack', id: trackId, audioInput: nodeId }])
    d.apply([{ op: 'removeNode', id: nodeId }])
    expect(d.project.nodes).toEqual([])
    expect(d.project.track(trackId).audioInput).toBeNull()

    await d.undo()
    const restored = d.project.node(nodeId)
    expect(restored).not.toBeNull()
    expect(restored.settings.get('mix')).toBe(0.42)
    expect(restored.track).toBe(trackId)
    expect(d.project.track(trackId).audioInput).toBe(nodeId)
    // Reloaded through the engine, not conjured: a second addPlugin call.
    expect(engine.calls.filter(([name]) => name === 'addPlugin')).toHaveLength(2)
    expect(engine.calls).toContainEqual(['setParameter', 'engine-2', 'mix', 0.42])
  })

  it('restores exactly the connections a healed removal replaced', async () => {
    // heal:true bridges a→c when b is removed from a chain a→b→c. Undoing
    // that removal must bring b back, restore a→b and b→c, and take the
    // healed a→c back out, not leave both.
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    await d.addPlugin(IRI, { id: 'a' })
    await d.addPlugin(IRI, { id: 'b' })
    await d.addPlugin(IRI, { id: 'c' })
    d.apply([edge('a', 'b'), edge('b', 'c')])

    d.apply([{ op: 'removeNode', id: 'b', heal: true }])
    expect(d.project.connections).toHaveLength(1)
    expect(d.project.connections[0].from.node).toBe('a')
    expect(d.project.connections[0].to.node).toBe('c')

    await d.undo()
    const pairs = d.project.connections.map(c => [c.from.node, c.to.node]).sort()
    expect(pairs).toEqual([['a', 'b'], ['b', 'c']])
  })

  it('does not record undo or redo themselves as further edits', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    const { nodeId } = await d.addPlugin(IRI)
    d.setParameter(nodeId, 'mix', 0.5)
    expect(d.canUndo()).toBe(true)

    await d.undo() // back to just the add
    expect(d.canUndo()).toBe(true) // the add itself is still there to undo
    await d.undo() // back to nothing
    expect(d.canUndo()).toBe(false)
  })

  it('drops the redo stack once a fresh edit is made after undoing', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const { nodeId } = await d.addPlugin(IRI, { settings: { mix: 0.2 } })
    d.setParameter(nodeId, 'mix', 0.9)
    await d.undo()
    expect(d.canRedo()).toBe(true)

    d.setParameter(nodeId, 'mix', 0.4) // a new edit, not a redo
    expect(d.canRedo()).toBe(false)
  })

  it('reports rather than throwing when there is nothing to step through', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    expect(await d.undo()).toEqual({ ok: false, message: 'nothing to undo' })
    expect(await d.redo()).toEqual({ ok: false, message: 'nothing to redo' })
  })

  it('does not record a dry run, or a refused change', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    await d.addPlugin(IRI, { id: 'a' })
    d.apply([{ op: 'setSetting', node: 'a', symbol: 'mix', value: 0.5 }], { dryRun: true })
    expect(d.canUndo()).toBe(true) // only the add so far

    const before = d.canUndo()
    d.apply([{ op: 'removeNode', id: 'ghost' }]) // refused: no such node
    expect(d.canUndo()).toBe(before)
  })

  it('emits a changed event the redraw can key off, on both undo and redo', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    const seen = []
    d.subscribe(event => seen.push(event.type))
    const { nodeId } = await d.addPlugin(IRI)
    d.setParameter(nodeId, 'mix', 0.5)
    seen.length = 0

    await d.undo()
    expect(seen).toContain('changed')
    seen.length = 0
    await d.redo()
    expect(seen).toContain('changed')
  })
})

describe('the opaque relay to a plugin\'s own interface', () => {
  it('posts a payload to that node\'s processor only', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = await d.addPlugin(IRI)
    await d.addPlugin(IRI)
    expect(d.relayToPlugin(a.nodeId, { x: 1 })).toBe(true)
    expect(engine.calls.filter(c => c[0] === 'post')).toEqual([['post', 'engine-1', { type: 'plugin', payload: { x: 1 } }]])
    expect(d.relayToPlugin('ghost', {})).toBe(false)
  })

  it('hears only plugin payloads, and only from that node', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = await d.addPlugin(IRI)
    const b = await d.addPlugin(IRI)
    const heard = []
    const stop = d.onPluginMessage(a.nodeId, payload => heard.push(payload))
    const send = (engineId, message) => { for (const h of engine.handlers.get(engineId) ?? []) h(message) }
    send('engine-1', { type: 'plugin', payload: 'mine' })
    send('engine-1', { type: 'events', events: [] })
    send('engine-2', { type: 'plugin', payload: 'theirs' })
    expect(heard).toEqual(['mine'])
    stop()
    send('engine-1', { type: 'plugin', payload: 'after' })
    expect(heard).toEqual(['mine'])
    expect(d.onPluginMessage('ghost', () => {})).toBeNull()
    expect(b.nodeId).toBeTruthy()
  })
})

describe('undoing clips', () => {
  const note = (startBeat, pitch) => ({ startBeat, lengthBeats: 1, pitch, velocity: 100 })

  it('steps adding, editing and removing a clip back and forward', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    const { trackId } = await d.addPlugin(IRI)
    const id = d.apply([{ op: 'addClip', track: trackId, kind: 'midi', startBeat: 0, lengthBeats: 4 }]).results[0]
    d.apply([{ op: 'setClipNotes', id, notes: [note(0, 60), note(1, 62)] }])
    d.apply([{ op: 'setClip', id, startBeat: 8 }])
    d.apply([{ op: 'removeClip', id }])
    expect(d.project.clips).toEqual([])

    await d.undo()
    expect(d.project.clip(id)).toMatchObject({ startBeat: 8 })
    await d.undo()
    expect(d.project.clip(id).startBeat).toBe(0)
    await d.undo()
    expect(d.project.clip(id).notes).toEqual([])
    await d.undo()
    expect(d.project.clip(id)).toBeNull()

    await d.redo(); await d.redo()
    expect(d.project.clip(id).notes.map(n => n.pitch)).toEqual([60, 62])
  })

  it('brings a removed track back with its clips', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    const t = d.apply([{ op: 'addTrack', label: 'Loop' }]).results[0]
    d.apply([{ op: 'addClip', id: 'c', track: t, kind: 'audio', startBeat: 0, lengthBeats: 4, source: 'https://example.org/a.wav' }])
    d.apply([{ op: 'removeTrack', id: t }])
    expect(d.project.clips).toEqual([])
    await d.undo()
    expect(d.project.clip('c')).toMatchObject({ track: t, source: 'https://example.org/a.wav' })
  })
})

describe('undo and redo of the track view (docs/track-view-terms.md)', () => {
  it('steps master, sends, outputs, markers, regions and envelopes back and forward', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    d.apply([{ op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'b' }])
    const { nodeId } = await d.addPlugin(IRI, { track: 'a' })

    const before = JSON.stringify(d.project.snapshot())
    const result = d.apply([
      { op: 'setMaster', gain: 0.5 },
      { op: 'addSend', from: 'a', to: 'b', level: 0.3, tap: 'pre' },
      { op: 'setTrack', id: 'a', output: 'b' },
      { op: 'addMarker', atBeat: 4, label: 'Drop' },
      { op: 'addRegion', startBeat: 0, lengthBeats: 8 },
      { op: 'addEnvelope', target: { node: nodeId, symbol: 'mix' }, points: [{ atBeat: 0, value: 0.2 }] }
    ])
    expect(result.ok, result.message).toBe(true)
    const after = JSON.stringify(d.project.snapshot())

    await d.undo()
    expect(JSON.stringify(d.project.snapshot().master)).toBe(JSON.stringify(JSON.parse(before).master))
    expect(d.project.sends).toEqual([])
    expect(d.project.track('a').output).toBeNull()
    expect(d.project.markers).toEqual([])
    expect(d.project.regions).toEqual([])
    expect(d.project.envelopes).toEqual([])

    await d.redo()
    const redone = JSON.parse(JSON.stringify(d.project.snapshot()))
    const wanted = JSON.parse(after)
    for (const key of ['master', 'sends', 'markers', 'regions', 'envelopes']) expect(redone[key]).toEqual(wanted[key])
    expect(d.project.track('a').output).toBe('b')
  })

  it('undoes an envelope change by replacing it whole', async () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    d.apply([{ op: 'addTrack', id: 'a' }, { op: 'addEnvelope', target: { kind: 'tempo' }, points: [{ atBeat: 0, value: 100 }] }])
    d.apply([{ op: 'setEnvelope', id: 'envelope-1', points: [{ atBeat: 0, value: 100 }, { atBeat: 8, value: 140 }] }])
    await d.undo()
    expect(d.project.envelopes[0].points).toHaveLength(1)
  })

  it('refuses a send that would close a loop, through the dispatcher too', () => {
    const d = new OpDispatcher({ engine: fakeEngine() })
    d.apply([{ op: 'addTrack', id: 'a' }, { op: 'addTrack', id: 'b' }, { op: 'addSend', from: 'a', to: 'b' }])
    const result = d.apply([{ op: 'addSend', from: 'b', to: 'a' }])
    expect(result.ok).toBe(false)
    expect(result.message).toMatch(/feed itself/)
  })
})

describe('bypass', () => {
  const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
  const setup = () => {
    const dispatcher = new OpDispatcher()
    dispatcher.apply([{ op: 'addTrack', id: 't' }, ...['a', 'b', 'c'].map(id => ({ op: 'addNode', id, track: 't', pluginIri: 'https://example.org/p/' }))])
    dispatcher.apply([
      { op: 'addConnection', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO },
      { op: 'addConnection', from: { node: 'b', portIndex: 0 }, to: { node: 'c', portIndex: 0 }, signalKind: AUDIO }
    ])
    return dispatcher
  }

  it('is an edit that can be undone, and leaves every connection in the model', async () => {
    const d = setup()
    expect(d.apply([{ op: 'setNode', id: 'b', bypassed: true }]).ok).toBe(true)
    expect(d.project.node('b').bypassed).toBe(true)
    expect(d.project.connections).toHaveLength(2)
    await d.undo()
    expect(d.project.node('b').bypassed).toBe(false)
    await d.redo()
    expect(d.project.node('b').bypassed).toBe(true)
  })

  it('refuses anything but true or false, and a node that is not there', () => {
    const d = setup()
    expect(d.apply([{ op: 'setNode', id: 'b', bypassed: 'yes' }]).message).toMatch(/true or false/)
    expect(d.apply([{ op: 'setNode', id: 'ghost', bypassed: true }]).message).toMatch(/no such node/)
  })
})
