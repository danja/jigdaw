// tests/compiler/GraphCompiler.test.js
import { describe, it, expect } from 'vitest'
import { Project } from '../../src/model/Project.js'
import { compileGraph, stronglyConnected } from '../../src/compiler/GraphCompiler.js'

const IRI = 'https://strandz.it/jigdaw/plugins/cascade/'
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const MIDI = 'http://purl.org/stuff/transmissions/Midi'

/** Build a project from ids and edges, so a test reads as a graph. */
function graph (ids, edges) {
  const project = new Project()
  project.apply(ids.map(id => ({ op: 'addNode', id, pluginIri: IRI })))
  if (edges.length > 0) {
    project.apply(edges.map(([from, to, over = {}]) => ({
      op: 'addConnection',
      from: { node: from, portIndex: 0 },
      to: { node: to, portIndex: over.toPort ?? 0 },
      signalKind: over.kind ?? AUDIO,
      delayFrames: over.delayFrames ?? 0
    })))
  }
  return project
}

const latencies = map => id => map[id] ?? 0

describe('stronglyConnected', () => {
  it('finds a simple loop', () => {
    const edges = { a: ['b'], b: ['c'], c: ['a'] }
    const components = stronglyConnected(['a', 'b', 'c'], id => edges[id] ?? [])
    expect(components).toHaveLength(1)
    expect(components[0].sort()).toEqual(['a', 'b', 'c'])
  })

  it('separates independent nodes', () => {
    const edges = { a: ['b'], b: [] }
    expect(stronglyConnected(['a', 'b'], id => edges[id] ?? [])).toHaveLength(2)
  })

  it('handles a graph deep enough to overflow a recursive implementation', () => {
    // Iterative on purpose: a stack overflow during compilation reads as a
    // crash rather than as the project being large.
    const ids = Array.from({ length: 20000 }, (_, i) => `n${i}`)
    const next = id => {
      const i = Number(id.slice(1))
      return i + 1 < ids.length ? [`n${i + 1}`] : []
    }
    expect(stronglyConnected(ids, next)).toHaveLength(20000)
  })
})

describe('ordering and latency compensation', () => {
  it('orders a chain', () => {
    const result = compileGraph(graph(['a', 'b', 'c'], [['a', 'b'], ['b', 'c']]))
    expect(result.ok).toBe(true)
    expect(result.order).toEqual(['a', 'b', 'c'])
  })

  it('delays the fast path so parallel paths arrive together', () => {
    // The case that has no visible symptom: two paths from one source, mixed
    // back together, one of them 512 frames late.
    const project = graph(['src', 'slow', 'fast', 'mix'],
      [['src', 'slow'], ['src', 'fast'], ['slow', 'mix'], ['fast', 'mix', { toPort: 1 }]])
    const result = compileGraph(project, { latencyOf: latencies({ slow: 512 }) })

    expect(result.compensation).toHaveLength(1)
    expect(result.compensation[0].delayFrames).toBe(512)
    // The compensated edge is the one from the plugin with no latency.
    const compensated = project.connection(result.compensation[0].connection)
    expect(compensated.from.node).toBe('fast')
  })

  it('reports the latency the graph really has, rather than claiming zero', () => {
    // Compensation aligns paths; it does not abolish delay.
    const project = graph(['a', 'b'], [['a', 'b']])
    expect(compileGraph(project, { latencyOf: latencies({ a: 256, b: 128 }) }).totalLatency).toBe(384)
  })

  it('adds nothing when every path is already aligned', () => {
    const project = graph(['src', 'l', 'r', 'mix'],
      [['src', 'l'], ['src', 'r'], ['l', 'mix'], ['r', 'mix', { toPort: 1 }]])
    expect(compileGraph(project, { latencyOf: latencies({ l: 128, r: 128 }) }).compensation).toEqual([])
  })

  it('accumulates along the longest path, not the last one seen', () => {
    const project = graph(['src', 'a', 'b', 'c', 'mix'],
      [['src', 'a'], ['a', 'b'], ['b', 'mix'], ['src', 'c'], ['c', 'mix', { toPort: 1 }]])
    const result = compileGraph(project, { latencyOf: latencies({ a: 100, b: 200, c: 50 }) })
    expect(result.arrival.get('mix')).toBe(300)
    expect(result.compensation[0].delayFrames).toBe(250)
  })
})

describe('feedback', () => {
  it('refuses a cycle carrying no delay, and names it', () => {
    // Web Audio outputs silence for such a cycle. Going quiet is the worst
    // available failure, so this is refused instead.
    const result = compileGraph(graph(['a', 'b'], [['a', 'b'], ['b', 'a']]))
    expect(result.ok).toBe(false)
    expect(result.errors[0].kind).toBe('undelayed-cycle')
    expect(result.errors[0].nodes.sort()).toEqual(['a', 'b'])
    expect(result.errors[0].message).toContain('silence')
  })

  it('refuses a node fed from its own output', () => {
    expect(compileGraph(graph(['a'], [['a', 'a']])).ok).toBe(false)
  })

  it('accepts a cycle once a full quantum of delay is in it', () => {
    const project = graph(['a', 'b'], [['a', 'b'], ['b', 'a', { delayFrames: 128 }]])
    const result = compileGraph(project, { quantum: 128 })
    expect(result.ok).toBe(true)
    expect(result.cycles).toHaveLength(1)
  })

  it('counts a plugin own latency towards the delay in a loop', () => {
    const project = graph(['a', 'b'], [['a', 'b'], ['b', 'a']])
    expect(compileGraph(project, { latencyOf: latencies({ a: 256 }) }).ok).toBe(true)
  })

  it('refuses a cycle carrying some delay but less than a quantum', () => {
    const project = graph(['a', 'b'], [['a', 'b'], ['b', 'a', { delayFrames: 64 }]])
    const result = compileGraph(project, { quantum: 128 })
    expect(result.ok).toBe(false)
    expect(result.errors[0].message).toContain('64 frames')
  })

  it('never compensates an edge inside a cycle', () => {
    // The delay in a feedback loop is the effect the user asked for. To align
    // a cycle with itself is to ask for the signal before it exists.
    const project = graph(['a', 'b'], [['a', 'b'], ['b', 'a', { delayFrames: 256 }]])
    const result = compileGraph(project, { latencyOf: latencies({ a: 64 }) })
    expect(result.ok).toBe(true)
    expect(result.compensation).toEqual([])
  })

  it('still compensates the acyclic part of a graph that contains a loop', () => {
    const project = graph(['src', 'loopA', 'loopB', 'dry', 'mix'], [
      ['loopA', 'loopB'], ['loopB', 'loopA', { delayFrames: 256 }],
      ['src', 'loopA'], ['loopB', 'mix'], ['src', 'dry'], ['dry', 'mix', { toPort: 1 }]
    ])
    const result = compileGraph(project, { latencyOf: latencies({ loopA: 512 }) })
    expect(result.ok).toBe(true)
    expect(result.compensation.length).toBeGreaterThan(0)
  })
})

describe('signal kinds', () => {
  it('ignores MIDI edges when looking for Web Audio cycles', () => {
    // MIDI is host-routed over message ports and creates no Web Audio edge, so
    // it cannot produce the silence that rule exists to prevent.
    const project = graph(['a', 'b'], [['a', 'b', { kind: MIDI }], ['b', 'a', { kind: MIDI }]])
    expect(compileGraph(project).ok).toBe(true)
  })
})

describe('an empty project', () => {
  it('compiles to nothing rather than failing', () => {
    const result = compileGraph(new Project())
    expect(result.ok).toBe(true)
    expect(result.order).toEqual([])
    expect(result.totalLatency).toBe(0)
  })
})
