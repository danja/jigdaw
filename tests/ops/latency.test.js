// tests/ops/latency.test.js
//
// A processor reporting a new latency while audio flows (docs/latency.md
// section 2). The dispatcher observes the message, updates the node,
// recompiles the unchanged project, and retimes the compensation delays whose
// values moved, scheduled against fromFrame rather than arrival. A latency
// change is not an edit: no revision, no history, nothing to undo.
//
// The engine here records what it was asked to do, after
// tests/ops/OpDispatcher.test.js: the decision is the dispatcher's, and the
// retiming itself is tests/engine/Engine.test.js's.
import { describe, it, expect, vi } from 'vitest'
import { resolve } from 'node:path'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { Engine } from '../../src/engine/Engine.js'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { parseText } from '../../src/rdf/parse.js'
import { detectCapabilities } from '../../src/host/Capabilities.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { OfflineContext, OfflineWorkletNode, sitePlugins } from '../../src/testing/OfflineHost.js'

const IRI = 'https://strandz.it/jigdaw/plugins/lookahead/'
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'

function fakeEngine () {
  const entries = new Map()
  let counter = 0
  return {
    entries,
    retimed: [],
    async addPlugin (iri) {
      const id = `engine-${++counter}`
      const entry = {
        id,
        iri,
        node: { numberOfOutputs: 1, parameters: new Map() },
        profile: { label: 'Lookahead', audioInputs: 1, audioOutputs: 1, accepts: [], produces: [], ports: [] },
        ready: { latencyFrames: 0 }
      }
      entries.set(id, entry)
      return entry
    },
    get (id) {
      const entry = entries.get(id)
      if (!entry) throw new Error(`no such node: ${id}`)
      return entry
    },
    remove (id) { entries.delete(id) },
    tracks: new Set(),
    addTrack (id) { this.tracks.add(id) },
    removeTrack (id) { this.tracks.delete(id) },
    trackIds () { return [...this.tracks] },
    linkToTrack () {},
    channels: new Map(),
    setTrackChannel () {},
    links: [],
    handlers: new Map(),
    onMessage (id, handler) {
      if (!this.handlers.has(id)) this.handlers.set(id, new Set())
      this.handlers.get(id).add(handler)
      return () => this.handlers.get(id).delete(handler)
    },
    /** Deliver a processor message the way the port would. */
    fire (id, message) {
      for (const handler of this.handlers.get(id) ?? []) handler(message)
    },
    post () {},
    clearLinks () { this.links = [] },
    clearSends () {},
    addSend () {},
    setTrackOutput () {},
    setMaster () {},
    link (from, to, options = {}) { this.links.push({ from, to, ...options }) },
    defaultParameter () { return 0 },
    clampParameter (id, symbol, value) { return value },
    setParameter () { return 0 },
    frameTime (frame) { return frame / 48000 },
    retime (connection, delayFrames, { atTime } = {}) {
      this.retimed.push({ connection, delayFrames, atTime })
    }
  }
}

const edge = (from, to) => ({
  op: 'addConnection',
  from: { node: from, portIndex: 0 },
  to: { node: to, portIndex: 0 },
  signalKind: AUDIO
})

/** Two paths into one node: a through the latency-changing plugin, b direct. */
async function parallel () {
  const engine = fakeEngine()
  const d = new OpDispatcher({ engine })
  const a = await d.addPlugin(IRI)
  const b = await d.addPlugin(IRI)
  const c = await d.addPlugin(IRI)
  const [aId, bId, cId] = [a.nodeId, b.nodeId, c.nodeId]
  d.apply([edge(aId, cId), edge(bId, cId)])
  const connA = d.project.connections.find(cn => cn.from.node === aId).id
  const connB = d.project.connections.find(cn => cn.from.node === bId).id
  return { engine, d, a, b, c, connA, connB }
}

describe('a latency message', () => {
  it('updates the node and realigns the parallel path', async () => {
    const { engine, d, a, connB } = await parallel()
    expect(d.compile().compensation).toEqual([])

    engine.fire(a.entry.id, { type: 'latency', latencyFrames: 512, fromFrame: 96000 })
    expect(engine.get(a.entry.id).ready.latencyFrames).toBe(512)
    expect(d.compile().compensation).toEqual([{ connection: connB, delayFrames: 512 }])
  })

  it('schedules the delay change against fromFrame, not against arrival', async () => {
    // fromFrame 96000 is two seconds into the stream. Arrival has no clock
    // here at all, so a host scheduling against arrival could only schedule
    // now; the retime below carries the frame's own time instead.
    const { engine, d, a, connB } = await parallel()
    engine.fire(a.entry.id, { type: 'latency', latencyFrames: 512, fromFrame: 96000 })
    expect(engine.retimed).toEqual([{ connection: connB, delayFrames: 512, atTime: 2 }])
  })

  it('retimes back when the latency falls again', async () => {
    const { engine, d, a, connB } = await parallel()
    engine.fire(a.entry.id, { type: 'latency', latencyFrames: 512, fromFrame: 96000 })
    engine.fire(a.entry.id, { type: 'latency', latencyFrames: 0, fromFrame: 192000 })
    expect(engine.get(a.entry.id).ready.latencyFrames).toBe(0)
    expect(d.compile().compensation).toEqual([])
    expect(engine.retimed.at(-1)).toEqual({ connection: connB, delayFrames: 0, atTime: 4 })
  })

  it('is not an edit: no revision, no history, nothing to undo', async () => {
    const { engine, d, a } = await parallel()
    const revision = d.revision
    const heard = []
    d.subscribe(event => heard.push(event))
    engine.fire(a.entry.id, { type: 'latency', latencyFrames: 512, fromFrame: 96000 })
    expect(d.revision).toBe(revision)
    expect(heard.map(e => e.type)).toEqual(['latency'])
    expect(heard[0]).toMatchObject({ nodeId: a.nodeId, latencyFrames: 512, fromFrame: 96000 })
  })

  it('ignores a message with no usable figure, and says what was wrong', async () => {
    const { engine, d, a } = await parallel()
    const errors = []
    const shout = console.error
    console.error = (...args) => errors.push(args.join(' '))
    try {
      engine.fire(a.entry.id, { type: 'latency', latencyFrames: -1, fromFrame: 96000 })
      engine.fire(a.entry.id, { type: 'latency', latencyFrames: 512 })
    } finally {
      console.error = shout
    }
    expect(engine.get(a.entry.id).ready.latencyFrames).toBe(0)
    expect(engine.retimed).toEqual([])
    expect(d.compile().compensation).toEqual([])
    expect(errors).toHaveLength(2)
    expect(errors[0]).toMatch(/Lookahead.*latency/)
    expect(errors[1]).toMatch(/Lookahead.*fromFrame/)
  })

  it('ignores anything that is not a latency message', async () => {
    const { engine, d, a } = await parallel()
    engine.fire(a.entry.id, { type: 'plugin', payload: { gain: 0.5 } })
    expect(engine.get(a.entry.id).ready.latencyFrames).toBe(0)
    expect(engine.retimed).toEqual([])
  })

  it('does nothing for a node that is gone', async () => {
    const engine = fakeEngine()
    const d = new OpDispatcher({ engine })
    const a = await d.addPlugin(IRI)
    await d.apply([{ op: 'removeNode', id: a.nodeId }])
    expect(() => engine.fire(a.entry.id, { type: 'latency', latencyFrames: 512, fromFrame: 0 })).not.toThrow()
    expect(engine.retimed).toEqual([])
  })
})

describe('a latency change through the real graph', () => {
  // The same clauses with nothing faked but the audio context: the real
  // Lookahead reports, the real dispatcher recompiles, and the real engine
  // schedules the new delay. Audio never flows through the fake delay node
  // (OfflineHost documents that), so the assertions are the figure the node
  // holds, the compiler's alignment, and the scheduled switch.
  const root = resolve(import.meta.dirname, '../..')
  const LOOKAHEAD = 'https://strandz.it/jigdaw/plugins/lookahead/'
  const DRY = 'https://strandz.it/jigdaw/plugins/squelch/'
  const MIX = 'https://strandz.it/jigdaw/plugins/tremolo/'

  async function liveGraph () {
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const site = sitePlugins('https://strandz.it/jigdaw/', resolve(root, 'plugins'))
    const loader = new PluginLoader({
      fetch: site.fetch,
      parse: parseText,
      validator,
      capabilities: detectCapabilities({}),
      processorUrl: site.processorUrl
    })
    const context = new OfflineContext({ sampleRate: 48000 })
    const engine = new Engine({ context, loader, AudioWorkletNode: OfflineWorkletNode })
    const d = new OpDispatcher({ engine })
    const wet = await d.addPlugin(LOOKAHEAD)
    const dry = await d.addPlugin(DRY)
    const mix = await d.addPlugin(MIX)
    d.apply([edge(wet.nodeId, mix.nodeId), edge(dry.nodeId, mix.nodeId)])
    return { context, engine, d, wet, dry, mix }
  }

  it('realigns the parallel path after the change takes effect', async () => {
    const { context, engine, d, wet, dry, mix } = await liveGraph()
    expect(d.compile().compensation).toEqual([])
    expect(context.delays).toEqual([])

    const heard = []
    d.subscribe(event => { if (event.type === 'latency') heard.push(event) })
    d.setParameter(wet.nodeId, 'position', 512)
    const zeros = new Float32Array(128)
    d.engineNode(wet.nodeId).node.render([zeros, zeros])
    await new Promise(resolve => setTimeout(resolve, 0))

    expect(heard).toHaveLength(1)
    const { latencyFrames, fromFrame } = heard[0]
    expect(latencyFrames).toBe(512)
    expect(d.engineNode(wet.nodeId).ready.latencyFrames).toBe(512)

    const dryConn = d.project.connections.find(c => c.from.node === dry.nodeId).id
    expect(d.compile().compensation).toEqual([{ connection: dryConn, delayFrames: 512 }])
    expect(context.delays).toHaveLength(1)
    expect(context.delays[0].delayTime.scheduled).toEqual([{ value: 512 / 48000, time: fromFrame / 48000 }])
    expect(context.delays[0].connections[0].destination).toBe(d.engineNode(mix.nodeId).node)
    expect(engine.get(d.engineNode(dry.nodeId).id)).toBeDefined()
  })
})
