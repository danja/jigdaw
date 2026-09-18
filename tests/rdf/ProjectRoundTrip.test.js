// tests/rdf/ProjectRoundTrip.test.js
//
// docs/project-format.md has been normative since phase 0 and nothing wrote it,
// so every claim in it was a claim about a file no code produced. These bind the
// document to the implementation in both directions.
//
// The round trip is the point. A writer alone can be self-consistently wrong and
// a reader alone has nothing to read; together, a project that does not survive
// the trip is a defect in one of them, and the shapes say which.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { Project } from '../../src/model/Project.js'
import { writeProject, writePositions } from '../../src/rdf/ProjectWriter.js'
import { readProject, readPositions, findProject } from '../../src/rdf/ProjectReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { vocabulary as v } from '../../src/rdf/Vocabulary.js'

const root = resolve(import.meta.dirname, '../..')
const IRI = 'https://example.org/sessions/test/'
const { trn } = v

/** A project with one of everything the format can express. */
function builtProject () {
  const project = new Project()
  project.apply([
    { op: 'addNode', id: 'pad', pluginIri: 'https://example.org/plugins/pulse/', label: 'Pad' },
    { op: 'addNode', id: 'verb', pluginIri: 'https://example.org/plugins/cascade/', label: 'Verb' },
    { op: 'setSetting', node: 'pad', symbol: 'gain', value: 0.62 },
    { op: 'setSetting', node: 'verb', symbol: 'mix', value: 0.34 },
    { op: 'setSetting', node: 'verb', symbol: 'size', value: 31 },
    { op: 'setNodeState', node: 'verb', state: 'eyJtb2RlIjoicGxhdGUifQ' },
    { op: 'setChannel', node: 'pad', gain: 0.8, pan: -0.5 },
    { op: 'setChannel', node: 'verb', muted: true, soloed: true },
    {
      op: 'addConnection',
      id: 'c1',
      from: { node: 'pad', portIndex: 0 },
      to: { node: 'verb', portIndex: 0 },
      signalKind: trn.Audio
    },
    {
      // A parameter edge names its port by symbol, not by index.
      op: 'addConnection',
      id: 'c2',
      from: { node: 'pad', portIndex: 0 },
      to: { node: 'verb', portSymbol: 'mix' },
      signalKind: trn.Audio
    },
    {
      op: 'setTransport',
      beatsPerBar: 3,
      beatUnit: 4,
      loopStart: 0,
      loopEnd: 32,
      loopEnabled: true,
      tempoPoints: [{ atBeat: 0, bpm: 96 }, { atBeat: 16, bpm: 104 }]
    }
  ])
  return project
}

/** Everything about a project that the format is supposed to carry. */
const shapeOf = project => ({
  revision: project.revision,
  nodes: [...project.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(n => ({
    id: n.id,
    pluginIri: n.pluginIri,
    label: n.label,
    state: n.state,
    channel: { ...n.channel },
    settings: Object.fromEntries([...n.settings].sort())
  })),
  connections: [...project.connections].sort((a, b) => a.id.localeCompare(b.id)).map(c => ({
    id: c.id, from: c.from, to: c.to, signalKind: c.signalKind
  })),
  transport: {
    beatsPerBar: project.transport.beatsPerBar,
    beatUnit: project.transport.beatUnit,
    loopStart: project.transport.loopStart,
    loopEnd: project.transport.loopEnd,
    loopEnabled: project.transport.loopEnabled,
    tempoPoints: project.transport.tempoPoints
  }
})

async function reopen (turtle, baseIRI = IRI) {
  const dataset = await parseText(turtle, baseIRI)
  const read = readProject(dataset)
  const project = new Project()
  project.apply(read.changes)
  return { read, project }
}

describe('a project survives being written and read back', () => {
  it('comes back the same, ids and all', async () => {
    const original = builtProject()
    const { project: reopened } = await reopen(writeProject(original, { iri: IRI }))

    // Ids included: a project whose nodes are renamed on every save has broken
    // every reference anyone kept to them.
    expect(shapeOf(reopened).nodes).toEqual(shapeOf(original).nodes)
    expect(shapeOf(reopened).connections).toEqual(shapeOf(original).connections)
    expect(shapeOf(reopened).transport).toEqual(shapeOf(original).transport)
  })

  it('is byte identical when written twice', () => {
    // The format requires determinism, so that a diff shows what changed rather
    // than how it was written.
    const project = builtProject()
    expect(writeProject(project, { iri: IRI })).toBe(writeProject(project, { iri: IRI }))
  })

  it('writes the same bytes from a project rebuilt in a different order', async () => {
    const original = builtProject()
    const once = writeProject(original, { iri: IRI })
    const { project: again } = await reopen(once)
    // Insertion order differs after a reload; sorted output must not.
    expect(writeProject(again, { iri: IRI })).toBe(once)
  })

  it('keeps a float a float', async () => {
    // Turtle makes 1 an integer and 1.0 a decimal. A size of 31 that returns as
    // an integer is a different term in the graph and a spurious diff.
    const turtle = writeProject(builtProject(), { iri: IRI })
    expect(turtle).toMatch(/jig:value 31\.0/)
    const { project } = await reopen(turtle)
    expect(project.node('verb').settings.get('size')).toBe(31)
  })

  it('carries the plugin IRIs, which is what makes it portable', async () => {
    const { project } = await reopen(writeProject(builtProject(), { iri: IRI }))
    expect(project.nodes.map(n => n.pluginIri).sort()).toEqual([
      'https://example.org/plugins/cascade/',
      'https://example.org/plugins/pulse/'
    ])
  })
})

describe('what it writes satisfies the normative shapes', () => {
  let validator
  beforeAll(async () => {
    validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
  })

  it('produces no violations', async () => {
    const turtle = writeProject(builtProject(), { iri: IRI })
    const report = await validator.validate(await parseText(turtle, IRI))
    const seen = report.violations.map(x => `${x.focusNode} ${x.path ?? '(node)'}: ${x.message}`)
    expect(seen, `violations:\n  ${seen.join('\n  ')}`).toEqual([])
    expect(report.conforms).toBe(true)
  })
})

describe('the worked example in examples/ is readable', () => {
  it('reads, and rebuilds into a project', async () => {
    // The example predates the reader. If the reader cannot open the file the
    // documentation points people at, one of the two is wrong.
    const file = resolve(root, 'examples/session-project.ttl')
    const base = 'https://example.org/sessions/first/'
    const dataset = await parseText(await readFile(file, 'utf8'), base)
    const read = readProject(dataset)

    expect(read.revision).toBe(7)
    expect(read.label).toBe('First')

    const project = new Project()
    project.apply(read.changes)
    expect(project.nodes.map(n => n.id).sort()).toEqual(['pad', 'verb'])
    expect(project.connections.map(c => c.id).sort()).toEqual(['c1', 'c2'])
    expect(project.node('verb').settings.get('mix')).toBe(0.34)
    expect(project.node('verb').state).toBe('eyJtb2RlIjoicGxhdGUiLCJzZWVkIjo0MTF9')
    expect(project.transport.tempoPoints).toEqual([
      { atBeat: 0, bpm: 96 }, { atBeat: 16, bpm: 104 }
    ])
    // The second connection ends at a parameter, named by symbol.
    expect(project.connection('c2').to).toEqual({ node: 'verb', portSymbol: 'mix' })
  })
})

describe('editor metadata stays in its own graph', () => {
  it('is not in the project document', () => {
    const project = builtProject()
    project.moveNode('pad', 120, 40)
    // Dragging a node must not change the project, so its position must not be
    // in the project's serialisation.
    expect(writeProject(project, { iri: IRI })).not.toMatch(/jig:x|jig:y/)
  })

  it('round trips separately', async () => {
    const project = builtProject()
    project.moveNode('pad', 120, 40)
    const positions = readPositions(await parseText(writePositions(project, { iri: IRI }), IRI), IRI)
    expect(positions.get('pad')).toEqual({ x: 120, y: 40 })
  })
})

describe('a document that is not a project', () => {
  it('is refused rather than half read', async () => {
    const dataset = await parseText(await readFile(
      resolve(root, 'examples/counterexample-project.ttl'), 'utf8'), 'urn:test')
    // counterexample-project.ttl is a project, so it has one. The point here is
    // the other direction: a profile is not.
    expect(() => findProject(dataset)).not.toThrow()
  })

  it('refuses a profile', async () => {
    const dataset = await parseText(await readFile(
      resolve(root, 'examples/reference-profile.ttl'), 'utf8'), 'urn:test')
    expect(() => findProject(dataset)).toThrow(/declares no jig:Project/)
  })

  it('refuses a connection with no signal kind', async () => {
    const turtle = `
      @base <${IRI}> .
      @prefix jig: <http://purl.org/stuff/jigdaw/> .
      <> a jig:Project ; jig:revision 1 ; jig:node <#a> ; jig:connection <#c> .
      <#a> a jig:Node ; jig:plugin <https://example.org/p/> .
      <#c> a jig:Connection ; jig:from <#c-f> ; jig:to <#c-t> .
      <#c-f> a jig:Endpoint ; jig:endpointNode <#a> ; jig:portIndex 0 .
      <#c-t> a jig:Endpoint ; jig:endpointNode <#a> ; jig:portIndex 0 .`
    const dataset = await parseText(turtle, IRI)
    expect(() => readProject(dataset)).toThrow(/signalKind/)
  })

  it('refuses an endpoint that names its port twice', async () => {
    const turtle = `
      @base <${IRI}> .
      @prefix jig: <http://purl.org/stuff/jigdaw/> .
      @prefix trn: <http://purl.org/stuff/transmissions/> .
      <> a jig:Project ; jig:revision 1 ; jig:node <#a> ; jig:connection <#c> .
      <#a> a jig:Node ; jig:plugin <https://example.org/p/> .
      <#c> a jig:Connection ; jig:from <#c-f> ; jig:to <#c-t> ; jig:signalKind trn:Audio .
      <#c-f> a jig:Endpoint ; jig:endpointNode <#a> ; jig:portIndex 0 ; jig:portSymbol "mix" .
      <#c-t> a jig:Endpoint ; jig:endpointNode <#a> ; jig:portIndex 0 .`
    const dataset = await parseText(turtle, IRI)
    expect(() => readProject(dataset)).toThrow(/exactly one of jig:portIndex or jig:portSymbol/)
  })
})

describe('the channel strip survives the trip', () => {
  it('comes back with the mix it was saved with', async () => {
    const original = builtProject()
    const { project } = await reopen(writeProject(original, { iri: IRI }))
    expect(project.node('pad').channel).toEqual({ gain: 0.8, pan: -0.5, muted: false, soloed: false })
    expect(project.node('verb').channel).toEqual({ gain: 1, pan: 0, muted: true, soloed: true })
  })

  it('writes nothing for a strip that is untouched', () => {
    // A project full of "gain 1.0, pan 0.0, not muted" says nothing and makes
    // every diff longer. The reader supplies the defaults.
    const project = new Project()
    project.apply([{ op: 'addNode', id: 'plain', pluginIri: 'https://example.org/plugins/pulse/' }])
    const turtle = writeProject(project, { iri: IRI })
    expect(turtle).not.toMatch(/jig:gain|jig:pan|jig:muted|jig:soloed/)
  })

  it('gives a node with no strip in the file the defaults', async () => {
    const project = new Project()
    project.apply([{ op: 'addNode', id: 'plain', pluginIri: 'https://example.org/plugins/pulse/' }])
    const { project: reopened } = await reopen(writeProject(project, { iri: IRI }))
    expect(reopened.node('plain').channel).toEqual({ gain: 1, pan: 0, muted: false, soloed: false })
  })

  it('still satisfies the shapes with a strip on it', async () => {
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const report = await validator.validate(
      await parseText(writeProject(builtProject(), { iri: IRI }), IRI))
    const seen = report.violations.map(v => `${v.focusNode} ${v.path ?? '(node)'}: ${v.message}`)
    expect(seen, `violations:\n  ${seen.join('\n  ')}`).toEqual([])
  })
})
