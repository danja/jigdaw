// tests/model/Project.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { Project, RevisionConflict, ChangeError } from '../../src/model/Project.js'

const IRI = 'https://strandz.it/jigdaw/plugins/cascade/'
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'

let project
beforeEach(() => { project = new Project() })

const addTwo = () => project.apply([
  { op: 'addNode', id: 'a', pluginIri: IRI },
  { op: 'addNode', id: 'b', pluginIri: IRI }
])

const connect = (extra = {}) => ({
  op: 'addConnection',
  from: { node: 'a', portIndex: 0 },
  to: { node: 'b', portIndex: 0 },
  signalKind: AUDIO,
  ...extra
})

describe('changesets', () => {
  it('applies a set of changes and bumps the revision once', () => {
    const result = addTwo()
    expect(result.revision).toBe(1)
    expect(project.nodes).toHaveLength(2)
    expect(result.results).toEqual(['a', 'b'])
  })

  it('mints ids when none are given', () => {
    const { results } = project.apply([{ op: 'addNode', pluginIri: IRI }])
    expect(results[0]).toMatch(/^node-\d+$/)
  })

  it('applies all of a changeset or none of it', () => {
    addTwo()
    const before = project.revision
    // The second change is bad. The first must not survive.
    expect(() => project.apply([
      { op: 'addNode', id: 'c', pluginIri: IRI },
      { op: 'addConnection', from: { node: 'c', portIndex: 0 }, to: { node: 'nope', portIndex: 0 }, signalKind: AUDIO }
    ])).toThrow(ChangeError)
    expect(project.node('c'), 'a half-applied changeset left a node behind').toBeNull()
    expect(project.revision).toBe(before)
  })

  it('names the change that failed and what was wrong', () => {
    addTwo()
    const error = (() => { try { project.apply([connect(), { op: 'removeNode', id: 'gone' }]) } catch (e) { return e } })()
    expect(error.index).toBe(1)
    expect(error.op).toBe('removeNode')
    expect(error.message).toContain('no such node: gone')
  })

  it('refuses an unknown operation rather than ignoring it', () => {
    expect(() => project.apply([{ op: 'teleport' }])).toThrow(/unknown operation/)
  })
})

describe('optimistic concurrency', () => {
  it('accepts a changeset naming the current revision', () => {
    addTwo()
    expect(project.apply([connect()], { expectedRevision: 1 }).revision).toBe(2)
  })

  it('refuses one naming a revision that has passed', () => {
    addTwo()
    project.apply([connect()])
    const error = (() => { try { project.apply([], { expectedRevision: 1 }) } catch (e) { return e } })()
    expect(error).toBeInstanceOf(RevisionConflict)
    expect(error.expected).toBe(1)
    expect(error.actual).toBe(2)
  })

  it('validates without committing under dryRun', () => {
    addTwo()
    const result = project.apply([connect()], { dryRun: true })
    expect(result.applied).toBe(false)
    expect(project.connections).toHaveLength(0)
    expect(project.revision).toBe(1)
  })

  it('still reports a failure under dryRun', () => {
    // Otherwise dryRun would say a broken chain was fine.
    expect(() => project.apply([connect()], { dryRun: true })).toThrow(ChangeError)
  })
})

describe('nodes', () => {
  it('requires a dereferenceable plugin IRI', () => {
    // What lets a project be reopened on a machine that has never seen it.
    // Loopback is covered separately below.
    for (const bad of ['cascade', 'file:///home/danny/cascade.wasm', 'http://insecure/p/']) {
      expect(() => project.apply([{ op: 'addNode', pluginIri: bad }]), bad).toThrow(/https IRI/)
    }
  })

  it('takes connections with it when removed', () => {
    addTwo()
    project.apply([connect()])
    project.apply([{ op: 'removeNode', id: 'a' }])
    // A connection to a node that is gone is not a connection, and the
    // compiler is allowed to assume the graph is compilable.
    expect(project.connections).toHaveLength(0)
  })
})

describe('connections', () => {
  it('needs a signalKind', () => {
    addTwo()
    expect(() => project.apply([connect({ signalKind: undefined })])).toThrow(/signalKind/)
  })

  it('needs exactly one way of naming each port', () => {
    addTwo()
    expect(() => project.apply([connect({ from: { node: 'a' } })])).toThrow(/exactly one/)
    expect(() => project.apply([connect({ from: { node: 'a', portIndex: 0, portSymbol: 'mix' } })])).toThrow(/exactly one/)
  })

  it('accepts a parameter target by symbol', () => {
    addTwo()
    expect(() => project.apply([connect({ to: { node: 'b', portSymbol: 'mix' } })])).not.toThrow()
  })

  it('refuses a duplicate of the same connection', () => {
    addTwo()
    project.apply([connect()])
    expect(() => project.apply([connect()])).toThrow(/already exists/)
  })

  it('refuses an endpoint naming a node that is not there', () => {
    addTwo()
    expect(() => project.apply([connect({ to: { node: 'ghost', portIndex: 0 } })])).toThrow(/no such node/)
  })
})

describe('transport', () => {
  it('keeps tempo points ordered by beat, whatever order they arrive in', () => {
    project.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 16, bpm: 104 }, { atBeat: 0, bpm: 96 }] }])
    expect(project.transport.tempoPoints.map(p => p.atBeat)).toEqual([0, 16])
  })

  it('refuses a stopped clock', () => {
    expect(() => project.apply([{ op: 'setTransport', tempoPoints: [{ atBeat: 0, bpm: 0 }] }])).toThrow(/greater than zero/)
  })

  it('refuses a loop that ends before it starts', () => {
    expect(() => project.apply([{ op: 'setTransport', loopEnabled: true, loopStart: 32, loopEnd: 8 }]))
      .toThrow(/start before it ends/)
  })
})

describe('editor metadata', () => {
  it('does not bump the revision when a node moves', () => {
    // Dragging a node must not invalidate a compiled audio graph. If position
    // and topology shared a revision, every layout change would look like a
    // project change and conflict with concurrent edits.
    addTwo()
    const before = project.revision
    project.moveNode('a', 120, 40)
    expect(project.revision).toBe(before)
    expect(project.position('a')).toEqual({ x: 120, y: 40 })
  })

  it('is discarded when the node is', () => {
    addTwo()
    project.moveNode('a', 1, 2)
    project.apply([{ op: 'removeNode', id: 'a' }])
    expect(project.position('a')).toEqual({ x: 0, y: 0 })
  })

  it('refuses to move a node that is not there', () => {
    expect(() => project.moveNode('ghost', 0, 0)).toThrow(/no such node/)
  })
})

describe('snapshot', () => {
  it('is plain data, detached from the project', () => {
    addTwo()
    project.apply([{ op: 'setSetting', node: 'a', symbol: 'mix', value: 0.4 }])
    const snapshot = project.snapshot()
    expect(snapshot.nodes[0].settings).toEqual({ mix: 0.4 })

    snapshot.nodes[0].settings.mix = 99
    expect(project.node('a').settings.get('mix')).toBe(0.4)
  })
})

describe('minting ids alongside ids it was given', () => {
  it('does not mint an id that is already in use', () => {
    // A project loaded from a file arrives carrying ids of the same shape the
    // counter produces. Without accounting for them the next minted id
    // collides, and the failure shows up on an unrelated later edit.
    project.apply([{ op: 'addNode', id: 'node-1', pluginIri: IRI }])
    const { results } = project.apply([{ op: 'addNode', pluginIri: IRI }])
    expect(results[0]).not.toBe('node-1')
    expect(project.nodes).toHaveLength(2)
  })

  it('keeps minting past the highest id it was given', () => {
    project.apply([
      { op: 'addNode', id: 'node-7', pluginIri: IRI },
      { op: 'addNode', id: 'node-3', pluginIri: IRI }
    ])
    expect(project.apply([{ op: 'addNode', pluginIri: IRI }]).results[0]).toBe('node-8')
  })

  it('does the same for connections', () => {
    project.apply([{ op: 'addNode', id: 'a', pluginIri: IRI }, { op: 'addNode', id: 'b', pluginIri: IRI }])
    project.apply([connect({ id: 'conn-5' })])
    const { results } = project.apply([connect({ to: { node: 'b', portIndex: 1 } })])
    expect(results[0]).toBe('conn-6')
  })
})

describe('which plugin IRIs are loadable', () => {
  it('accepts https anywhere', () => {
    expect(() => project.apply([{ op: 'addNode', pluginIri: 'https://strandz.it/jigdaw/plugins/pulse/' }])).not.toThrow()
  })

  it('accepts http on loopback, which is how a plugin is developed', () => {
    // A browser treats http://localhost as a secure context because it cannot
    // be intercepted. Refusing it would mean the only way to develop a plugin
    // is to deploy it.
    for (const host of ['localhost:6017', '127.0.0.1:8748', 'jigdaw.localhost']) {
      expect(() => project.apply([{ op: 'addNode', pluginIri: `http://${host}/plugins/pulse/` }]), host).not.toThrow()
    }
  })

  it('refuses http anywhere else', () => {
    for (const bad of ['http://strandz.it/p/', 'http://192.168.1.10/p/', 'http://evil.com/localhost/p/']) {
      expect(() => project.apply([{ op: 'addNode', pluginIri: bad }]), bad).toThrow(/https IRI/)
    }
  })

  it('refuses anything that is not a fetchable URL', () => {
    for (const bad of ['pulse', 'file:///home/danny/p.wasm', 'javascript:alert(1)', '']) {
      expect(() => project.apply([{ op: 'addNode', pluginIri: bad }]), bad).toThrow()
    }
  })
})

describe('removing a node from the middle', () => {
  const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
  const MIDI = 'http://purl.org/stuff/transmissions/Midi'
  const iri = n => `https://example.org/plugins/${n}/`

  function chain () {
    const project = new Project()
    project.apply([
      { op: 'addNode', id: 'a', pluginIri: iri('a') },
      { op: 'addNode', id: 'b', pluginIri: iri('b') },
      { op: 'addNode', id: 'c', pluginIri: iri('c') },
      { op: 'addConnection', id: 'ab', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO },
      { op: 'addConnection', id: 'bc', from: { node: 'b', portIndex: 0 }, to: { node: 'c', portIndex: 0 }, signalKind: AUDIO }
    ])
    return project
  }

  it('severs the path by default, because a changeset means what it says', () => {
    const project = chain()
    project.apply([{ op: 'removeNode', id: 'b' }])
    expect(project.connections).toEqual([])
  })

  it('rejoins the neighbours when asked to heal', () => {
    // Without this, pressing Remove on the middle of a chain leaves two
    // fragments and nothing in the interface to put them back together.
    const project = chain()
    project.apply([{ op: 'removeNode', id: 'b', heal: true }])
    expect(project.connections).toHaveLength(1)
    expect(project.connections[0].from.node).toBe('a')
    expect(project.connections[0].to.node).toBe('c')
    expect(project.connections[0].signalKind).toBe(AUDIO)
  })

  it('heals each signal kind separately', () => {
    // A MIDI path and an audio path through the same node are two paths.
    const project = new Project()
    project.apply([
      { op: 'addNode', id: 'gen', pluginIri: iri('gen') },
      { op: 'addNode', id: 'mid', pluginIri: iri('mid') },
      { op: 'addNode', id: 'out', pluginIri: iri('out') },
      { op: 'addConnection', from: { node: 'gen', portIndex: 0 }, to: { node: 'mid', portIndex: 0 }, signalKind: MIDI },
      { op: 'addConnection', from: { node: 'mid', portIndex: 0 }, to: { node: 'out', portIndex: 0 }, signalKind: MIDI },
      { op: 'addConnection', from: { node: 'gen', portIndex: 0 }, to: { node: 'mid', portIndex: 0 }, signalKind: AUDIO },
      { op: 'addConnection', from: { node: 'mid', portIndex: 0 }, to: { node: 'out', portIndex: 0 }, signalKind: AUDIO }
    ])
    project.apply([{ op: 'removeNode', id: 'mid', heal: true }])
    expect(project.connections.map(c => c.signalKind).sort()).toEqual([AUDIO, MIDI].sort())
    for (const c of project.connections) {
      expect(c.from.node).toBe('gen')
      expect(c.to.node).toBe('out')
    }
  })

  it('does not guess when there is more than one answer', () => {
    // Two inputs and one output: rejoining both would invent a mix nobody asked
    // for, and picking one would be arbitrary.
    const project = new Project()
    project.apply([
      { op: 'addNode', id: 'a', pluginIri: iri('a') },
      { op: 'addNode', id: 'b', pluginIri: iri('b') },
      { op: 'addNode', id: 'mid', pluginIri: iri('mid') },
      { op: 'addNode', id: 'out', pluginIri: iri('out') },
      { op: 'addConnection', from: { node: 'a', portIndex: 0 }, to: { node: 'mid', portIndex: 0 }, signalKind: AUDIO },
      { op: 'addConnection', from: { node: 'b', portIndex: 0 }, to: { node: 'mid', portIndex: 1 }, signalKind: AUDIO },
      { op: 'addConnection', from: { node: 'mid', portIndex: 0 }, to: { node: 'out', portIndex: 0 }, signalKind: AUDIO }
    ])
    project.apply([{ op: 'removeNode', id: 'mid', heal: true }])
    expect(project.connections).toEqual([])
  })

  it('leaves the ends joined when they were already joined directly', () => {
    const project = chain()
    project.apply([{ op: 'addConnection', id: 'ac', from: { node: 'a', portIndex: 0 }, to: { node: 'c', portIndex: 0 }, signalKind: AUDIO }])
    const result = project.apply([{ op: 'removeNode', id: 'b', heal: true }])
    expect(result.applied).toBe(true)
    expect(project.connections).toHaveLength(1)
    expect(project.connections[0].id).toBe('ac')
  })

  it('heals nothing at the end of a chain, where there is nothing to rejoin', () => {
    const project = chain()
    project.apply([{ op: 'removeNode', id: 'c', heal: true }])
    expect(project.connections.map(c => c.id)).toEqual(['ab'])
  })
})

describe('reordering a node', () => {
  const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
  const MIDI = 'http://purl.org/stuff/transmissions/Midi'
  const iri = n => `https://example.org/plugins/${n}/`

  function chain () {
    const project = new Project()
    project.apply([
      { op: 'addNode', id: 'a', pluginIri: iri('a') },
      { op: 'addNode', id: 'b', pluginIri: iri('b') },
      { op: 'addNode', id: 'c', pluginIri: iri('c') },
      { op: 'addConnection', id: 'ab', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO },
      { op: 'addConnection', id: 'bc', from: { node: 'b', portIndex: 0 }, to: { node: 'c', portIndex: 0 }, signalKind: AUDIO }
    ])
    return project
  }

  it('moves the node and bumps the revision', () => {
    const project = chain()
    const before = project.revision
    const result = project.apply([{ op: 'reorderNode', id: 'c', index: 0 }])
    expect(result.applied).toBe(true)
    expect(project.revision).toBe(before + 1)
    expect(project.nodes.map(n => n.id)).toEqual(['c', 'a', 'b'])
  })

  it('refuses an unknown node, or a bad index', () => {
    const project = chain()
    expect(() => project.apply([{ op: 'reorderNode', id: 'nope', index: 0 }])).toThrow(/no such node/)
    expect(() => project.apply([{ op: 'reorderNode', id: 'a', index: -1 }])).toThrow(/index/)
    expect(() => project.apply([{ op: 'reorderNode', id: 'a' }])).toThrow(/index/)
  })

  it('does nothing to the wiring when the position does not actually change', () => {
    const project = chain()
    const result = project.apply([{ op: 'reorderNode', id: 'b', index: 1 }])
    expect(result.applied).toBe(true)
    expect(project.connections.map(c => c.id).sort()).toEqual(['ab', 'bc'])
  })

  it('heals the gap it leaves when moved out of the middle, same as removeNode', () => {
    const project = chain()
    project.apply([{ op: 'reorderNode', id: 'b', index: 2 }])
    expect(project.nodes.map(n => n.id)).toEqual(['a', 'c', 'b'])
    // a-b and b-c are gone; a is rejoined directly to c.
    expect(project.connections).toHaveLength(1)
    expect(project.connections[0]).toMatchObject({ from: { node: 'a' }, to: { node: 'c' }, signalKind: AUDIO })
  })

  it('does not splice into the direct link between its new neighbours', () => {
    // A first version guessed port 0 on the moved node for this. The model
    // has no profile to check a guessed port against (OpDispatcher.apply's
    // own comment says why), and a wrong guess is an uncaught error out of
    // the real Web Audio graph, not a caught, reported one: worse than
    // leaving the node unwired in its new position, for a person to
    // connect deliberately, same as a freshly added one.
    const project = new Project()
    project.apply([
      { op: 'addNode', id: 'a', pluginIri: iri('a') },
      { op: 'addNode', id: 'b', pluginIri: iri('b') },
      { op: 'addNode', id: 'c', pluginIri: iri('c') },
      { op: 'addConnection', id: 'ab', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 3 }, signalKind: AUDIO }
    ])
    project.apply([{ op: 'reorderNode', id: 'c', index: 1 }])
    expect(project.nodes.map(n => n.id)).toEqual(['a', 'c', 'b'])
    expect(project.connections).toHaveLength(1)
    expect(project.connections[0].id).toBe('ab')
  })

  it('heals each signal kind separately when moved out of the middle', () => {
    const project = new Project()
    project.apply([
      { op: 'addNode', id: 'a', pluginIri: iri('a') },
      { op: 'addNode', id: 'b', pluginIri: iri('b') },
      { op: 'addNode', id: 'c', pluginIri: iri('c') },
      { op: 'addConnection', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO },
      { op: 'addConnection', from: { node: 'b', portIndex: 0 }, to: { node: 'c', portIndex: 0 }, signalKind: AUDIO },
      { op: 'addConnection', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: MIDI },
      { op: 'addConnection', from: { node: 'b', portIndex: 0 }, to: { node: 'c', portIndex: 0 }, signalKind: MIDI }
    ])
    project.apply([{ op: 'reorderNode', id: 'b', index: 2 }])
    expect(project.nodes.map(n => n.id)).toEqual(['a', 'c', 'b'])
    expect(project.connections.map(c => c.signalKind).sort()).toEqual([AUDIO, MIDI].sort())
    for (const c of project.connections) {
      expect(c.from.node).toBe('a')
      expect(c.to.node).toBe('c')
    }
  })

  it('leaves connections between its new neighbours alone, however many there are', () => {
    const project = new Project()
    project.apply([
      { op: 'addNode', id: 'a', pluginIri: iri('a') },
      { op: 'addNode', id: 'b', pluginIri: iri('b') },
      { op: 'addNode', id: 'c', pluginIri: iri('c') },
      { op: 'addConnection', from: { node: 'a', portIndex: 0 }, to: { node: 'b', portIndex: 0 }, signalKind: AUDIO },
      { op: 'addConnection', from: { node: 'a', portIndex: 1 }, to: { node: 'b', portIndex: 1 }, signalKind: AUDIO }
    ])
    const before = project.connections.length
    project.apply([{ op: 'reorderNode', id: 'c', index: 1 }])
    expect(project.nodes.map(n => n.id)).toEqual(['a', 'c', 'b'])
    expect(project.connections).toHaveLength(before)
    for (const c of project.connections) expect(c.from.node).toBe('a')
  })

  it('leaves connections alone at either end, where there is nothing to inherit', () => {
    const project = chain()
    project.apply([{ op: 'reorderNode', id: 'a', index: 2 }])
    expect(project.nodes.map(n => n.id)).toEqual(['b', 'c', 'a'])
    // b-c is healed from having lost b's old predecessor (nothing, so no
    // heal fires), and a lands after c with nothing to splice into.
    expect(project.connections.map(c => c.id).sort()).toEqual(['bc'])
  })
})
