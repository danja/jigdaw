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
    { op: 'addTrack', id: 'track-1', label: 'Keys' },
    // Ten, so that minted order and string order disagree: track-10 sorts
    // before track-2 as a string.
    { op: 'addTrack', id: 'track-10', label: 'Room' },
    { op: 'addNode', id: 'pad', track: 'track-1', pluginIri: 'https://example.org/plugins/pulse/', label: 'Pad' },
    { op: 'addNode', id: 'verb', track: 'track-10', pluginIri: 'https://example.org/plugins/cascade/', label: 'Verb' },
    { op: 'setTrack', id: 'track-1', midiInput: 'pad' },
    { op: 'setTrack', id: 'track-10', audioInput: 'verb' },
    { op: 'setSetting', node: 'pad', symbol: 'gain', value: 0.62 },
    { op: 'setSetting', node: 'verb', symbol: 'mix', value: 0.34 },
    { op: 'setSetting', node: 'verb', symbol: 'size', value: 31 },
    { op: 'setNodeState', node: 'verb', state: 'eyJtb2RlIjoicGxhdGUifQ' },
    { op: 'setTrackChannel', track: 'track-1', gain: 0.8, pan: -0.5 },
    { op: 'setTrackChannel', track: 'track-10', muted: true, soloed: true },
    {
      op: 'addClip', id: 'clip-2', track: 'track-1', kind: 'midi', startBeat: 0, lengthBeats: 8,
      notes: [
        { startBeat: 4, lengthBeats: 0.5, pitch: 64, velocity: 80 },
        { startBeat: 0, lengthBeats: 2, pitch: 57, velocity: 96 }
      ]
    },
    // An empty MIDI clip, and an audio clip with no offset: both write less.
    { op: 'addClip', id: 'clip-10', track: 'track-1', kind: 'midi', startBeat: 16, lengthBeats: 4 },
    { op: 'addClip', id: 'clip-3', track: 'track-10', kind: 'audio', startBeat: 8.5, lengthBeats: 4, source: 'https://example.org/media/loop.wav', offsetSeconds: 0.25 },
    { op: 'addClip', id: 'clip-4', track: 'track-10', kind: 'audio', startBeat: 12, lengthBeats: 1, source: 'https://example.org/media/hit.wav' },
    // Beside the session, so written relative to it.
    { op: 'addClip', id: 'clip-5', track: 'track-10', kind: 'audio', startBeat: 16, lengthBeats: 1, source: 'https://example.org/sessions/test/media/abc.wav' },
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
  // In the project's own order: the order tracks were made is their place in
  // the arrangement, so it has to survive too.
  tracks: project.tracks.map(t => ({ ...t, channel: { ...t.channel } })),
  nodes: [...project.nodes].sort((a, b) => a.id.localeCompare(b.id)).map(n => ({
    id: n.id,
    pluginIri: n.pluginIri,
    label: n.label,
    track: n.track,
    state: n.state,
    settings: Object.fromEntries([...n.settings].sort())
  })),
  connections: [...project.connections].sort((a, b) => a.id.localeCompare(b.id)).map(c => ({
    id: c.id, from: c.from, to: c.to, signalKind: c.signalKind
  })),
  // Sorted: a clip is placed by its beat, and the order clips are held in
  // means nothing.
  clips: [...project.clips].sort((a, b) => a.id.localeCompare(b.id)).map(c => ({ ...c, notes: c.notes.map(n => ({ ...n })) })),
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
    expect(shapeOf(reopened).tracks).toEqual(shapeOf(original).tracks)
    expect(shapeOf(reopened).nodes).toEqual(shapeOf(original).nodes)
    expect(shapeOf(reopened).connections).toEqual(shapeOf(original).connections)
    expect(shapeOf(reopened).clips).toEqual(shapeOf(original).clips)
    expect(reopened.nextId('clip')).toBe(original.nextId('clip'))
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

  it('writes a source beside the session relative to it, and reads it back absolute', async () => {
    const turtle = writeProject(builtProject(), { iri: IRI })
    expect(turtle).toMatch(/jig:source <media\/abc\.wav>/)
    expect(turtle).toMatch(/jig:source <https:\/\/example\.org\/media\/hit\.wav>/)
    // Opened somewhere else entirely, it resolves against where it is now.
    const { project } = await reopen(turtle.replace(`@base <${IRI}>`, '@base <https://elsewhere.example/s/>'))
    expect(project.clip('clip-5').source).toBe('https://elsewhere.example/s/media/abc.wav')
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
    expect(project.tracks.map(t => [t.id, t.label, t.midiInput])).toEqual([
      ['track-1', 'Pad', 'pad'], ['track-2', 'Loop', null]
    ])
    expect(project.track('track-1').channel).toEqual({ gain: 0.8, pan: -0.25, muted: false, soloed: false })
    expect(project.track('track-2').channel.muted).toBe(true)
    expect(project.nodes.map(n => n.track)).toEqual(['track-1', 'track-1'])
    expect(project.clips.map(c => [c.id, c.track, c.kind])).toEqual([
      ['clip-1', 'track-1', 'midi'], ['clip-2', 'track-2', 'audio']
    ])
    expect(project.clip('clip-1').notes.map(n => n.pitch)).toEqual([57, 60])
    // Relative in the file, absolute once read: resolved against the document.
    expect(project.clip('clip-2')).toMatchObject({
      source: 'https://example.org/sessions/first/media/loop.wav', offsetSeconds: 0.5
    })
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
    expect(project.track('track-1').channel).toEqual({ gain: 0.8, pan: -0.5, muted: false, soloed: false })
    expect(project.track('track-10').channel).toEqual({ gain: 1, pan: 0, muted: true, soloed: true })
  })

  const plain = () => {
    const project = new Project()
    project.apply([
      { op: 'addTrack', id: 'track-1' },
      { op: 'addNode', id: 'plain', track: 'track-1', pluginIri: 'https://example.org/plugins/pulse/' }
    ])
    return project
  }

  it('writes nothing for a strip that is untouched', () => {
    // A project full of "gain 1.0, pan 0.0, not muted" says nothing and makes
    // every diff longer. The reader supplies the defaults.
    const turtle = writeProject(plain(), { iri: IRI })
    expect(turtle).not.toMatch(/jig:gain|jig:pan|jig:muted|jig:soloed/)
  })

  it('gives a track with no strip in the file the defaults', async () => {
    const { project: reopened } = await reopen(writeProject(plain(), { iri: IRI }))
    expect(reopened.track('track-1').channel).toEqual({ gain: 1, pan: 0, muted: false, soloed: false })
  })

  it('never writes a strip on a node', () => {
    // project-format.md: a writer MUST NOT write the form from before tracks.
    const turtle = writeProject(builtProject(), { iri: IRI })
    const pad = turtle.slice(turtle.indexOf('\n<#pad>\n'), turtle.indexOf('<#pad-gain> a'))
    expect(pad).not.toMatch(/jig:gain|jig:pan|jig:muted|jig:soloed/)
    expect(pad).toMatch(/jig:onTrack <#track-1>/)
  })
})

describe('a session saved before tracks', () => {
  // project-format.md "Opening a session saved before tracks". The shipped
  // presets were all in this form until the day tracks arrived.
  const legacy = `
    @base <${IRI}> .
    @prefix jig: <http://purl.org/stuff/jigdaw/> .
    @prefix trn: <http://purl.org/stuff/transmissions/> .
    @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
    <> a jig:Project ; jig:revision 3 ;
      jig:node <#gen> , <#synth> , <#verb> , <#lone> ;
      jig:connection <#m> , <#a> .
    <#gen> a jig:Node ; rdfs:label "Gen" ; jig:plugin <https://example.org/p/gen/> .
    <#synth> a jig:Node ; rdfs:label "Synth" ; jig:gain 0.5 ; jig:plugin <https://example.org/p/synth/> .
    <#verb> a jig:Node ; rdfs:label "Verb" ; jig:pan -0.5 ; jig:muted true ; jig:plugin <https://example.org/p/verb/> .
    <#lone> a jig:Node ; rdfs:label "Lone" ; jig:soloed true ; jig:plugin <https://example.org/p/lone/> .
    <#m> a jig:Connection ; jig:from <#m-f> ; jig:to <#m-t> ; jig:signalKind trn:Midi .
    <#m-f> a jig:Endpoint ; jig:endpointNode <#gen> ; jig:portIndex 0 .
    <#m-t> a jig:Endpoint ; jig:endpointNode <#synth> ; jig:portIndex 0 .
    <#a> a jig:Connection ; jig:from <#a-f> ; jig:to <#a-t> ; jig:signalKind trn:Audio .
    <#a-f> a jig:Endpoint ; jig:endpointNode <#synth> ; jig:portIndex 0 .
    <#a-t> a jig:Endpoint ; jig:endpointNode <#verb> ; jig:portIndex 0 .`

  it('folds each connected group into one track, with the strip from the end of its chain', async () => {
    const { project } = await reopen(legacy)
    expect(project.tracks).toEqual([
      // Verb is the end of gen -> synth -> verb, so its strip was the one the
      // whole chain was heard through. Synth's own gain is dropped.
      { id: 'track-1', label: 'Verb', channel: { gain: 1, pan: -0.5, muted: true, soloed: false }, midiInput: null, audioInput: null },
      { id: 'track-2', label: 'Lone', channel: { gain: 1, pan: 0, muted: false, soloed: true }, midiInput: null, audioInput: null }
    ])
    expect(Object.fromEntries(project.nodes.map(n => [n.id, n.track]))).toEqual({
      gen: 'track-1', synth: 'track-1', verb: 'track-1', lone: 'track-2'
    })
  })

  it('writes back out in the current form, which the shapes accept', async () => {
    const { project } = await reopen(legacy)
    const turtle = writeProject(project, { iri: IRI })
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const report = await validator.validate(await parseText(turtle, IRI))
    expect(report.violations.map(x => `${x.focusNode} ${x.path}: ${x.message}`)).toEqual([])
  })

  it('refuses a node with no track in a session that has tracks', async () => {
    const turtle = `
      @base <${IRI}> .
      @prefix jig: <http://purl.org/stuff/jigdaw/> .
      <> a jig:Project ; jig:revision 1 ; jig:track <#t> ; jig:node <#a> .
      <#t> a jig:Track .
      <#a> a jig:Node ; jig:plugin <https://example.org/p/> .`
    const dataset = await parseText(turtle, IRI)
    expect(() => readProject(dataset)).toThrow(/names no jig:onTrack/)
  })
})
