// tests/ops/OpDispatcher.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'

const IRI = 'https://strandz.it/jigdaw/plugins/cascade/'
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'

/** An engine that records what it was asked to do. */
function fakeEngine ({ latency = 0, failWith = null } = {}) {
  const entries = new Map()
  let counter = 0
  return {
    calls: [],
    entries,
    async addPlugin (iri) {
      this.calls.push(['addPlugin', iri])
      if (failWith) throw Object.assign(new Error(failWith.message), { step: failWith.step })
      const id = `engine-${++counter}`
      const entry = { id, iri, profile: { label: 'Cascade', ports: [{ symbol: 'mix', minimum: 0, maximum: 1 }] }, ready: { latencyFrames: latency } }
      entries.set(id, entry)
      return entry
    },
    get (id) {
      const entry = entries.get(id)
      if (!entry) throw new Error(`no such node: ${id}`)
      return entry
    },
    remove (id) { this.calls.push(['remove', id]); entries.delete(id) },
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
  { op: 'addNode', id: 'a', pluginIri: IRI },
  { op: 'addNode', id: 'b', pluginIri: IRI }
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

describe('rebuilding the audio links', () => {
  const twoLoaded = async (engine) => {
    const d = new OpDispatcher({ engine })
    const a = await d.addPlugin(IRI)
    const b = await d.addPlugin(IRI)
    return { d, a: a.nodeId, b: b.nodeId }
  }

  it('links the engine nodes a connection names', async () => {
    const engine = fakeEngine()
    const { d, a, b } = await twoLoaded(engine)
    d.apply([edge(a, b)])
    expect(engine.links).toEqual([{ from: 'engine-1', to: 'engine-2', fromOutput: 0, toInput: 0, delayFrames: 0 }])
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
    expect(engine.links).toEqual([])
  })

  it('skips a connection whose nodes are not both loaded', async () => {
    // Normal while loading: the model can name a node the engine has not
    // instantiated yet, and that is not an error.
    const engine = fakeEngine()
    const { d, a } = await twoLoaded(engine)
    d.apply([{ op: 'addNode', id: 'unloaded', pluginIri: IRI }])
    d.apply([edge(a, 'unloaded')])
    expect(engine.links).toEqual([])
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
      remove: () => {}, clearLinks: () => {}, link: () => {},
      get: () => ({ profile: { produces: [] } }), onMessage: () => () => {}
    }
    const d = new OpDispatcher({ engine })
    const added = await d.addPlugin('https://example.org/plugins/pulse/', { id: 'verb', label: 'Verb' })
    expect(added.nodeId).toBe('verb')
    expect(d.project.node('verb').label).toBe('Verb')
  })
})
