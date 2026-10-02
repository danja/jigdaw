// tests/rdf/CompositeWriter.test.js
//
// The writer and the reader are two halves of one format, and a half with no other is a claim about a file nobody opens. So what is
// written is read back, validated against the shapes, and checked by the rules the shapes cannot say.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { writeComposite } from '../../src/rdf/CompositeWriter.js'
import { readComposite, checkComposite } from '../../src/rdf/CompositeReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const IRI = 'https://example.org/racks/written/'
const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const PIN = `sha384-${'A'.repeat(64)}`

const spec = () => ({
  iri: IRI,
  label: 'A "quoted" rack',
  comment: 'Two members.\nSecond line.',
  vendor: 'someone',
  roles: ['http://purl.org/stuff/transmissions/AudioEffect'],
  accepts: [AUDIO],
  produces: [AUDIO],
  audioInputs: 1,
  audioOutputs: 1,
  members: [
    { id: 'boost', plugin: 'https://strandz.it/jigdaw/plugins/boost/', pinnedDigest: PIN, settings: [{ symbol: 'gain', value: 0.5 }] },
    { id: 'trem', plugin: 'https://strandz.it/jigdaw/plugins/tremolo/', pinnedDigest: PIN }
  ],
  connections: [
    { from: { node: null, portIndex: 0 }, to: { node: 'boost', portIndex: 0 }, signalKind: AUDIO },
    { from: { node: 'boost', portIndex: 0 }, to: { node: 'trem', portIndex: 0 }, signalKind: AUDIO },
    { from: { node: 'trem', portIndex: 0 }, to: { node: null, portIndex: 0 }, signalKind: AUDIO }
  ],
  ports: [{ symbol: 'depth', name: 'Depth', minimum: 0, maximum: 1, defaultValue: 0.25, drives: [{ member: 'trem', symbol: 'depth' }] }]
})

describe('writeComposite', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  it('writes what the reader reads back, member for member and wire for wire', async () => {
    const composite = readComposite(await parseText(writeComposite(spec()), IRI))
    expect(composite.iri).toBe(IRI)
    expect(composite.label).toBe('A "quoted" rack')
    expect(composite.comment).toBe('Two members.\nSecond line.')
    expect(composite.audioInputs).toBe(1)
    expect(composite.audioOutputs).toBe(1)
    expect(composite.members.map(m => [m.id, m.plugin, m.pinnedDigest])).toEqual([
      [`${IRI}#boost`, 'https://strandz.it/jigdaw/plugins/boost/', PIN],
      [`${IRI}#trem`, 'https://strandz.it/jigdaw/plugins/tremolo/', PIN]
    ])
    expect(composite.members[0].settings).toEqual([{ symbol: 'gain', value: 0.5 }])
    expect(composite.connections).toHaveLength(3)
    expect(composite.connections[0].from).toEqual({ node: IRI, portIndex: 0 })
    expect(composite.connections[2].to).toEqual({ node: IRI, portIndex: 0 })
    expect(composite.ports.map(p => [p.symbol, p.name, p.minimum, p.maximum, p.defaultValue])).toEqual([['depth', 'Depth', 0, 1, 0.25]])
    expect(composite.ports[0].drives).toEqual([{ node: `${IRI}#trem`, portSymbol: 'depth' }])
  })

  it('writes a composite that validates against the shapes and passes the reader\'s own rules', async () => {
    const dataset = await parseText(writeComposite(spec()), IRI)
    const report = await validator.validate(dataset)
    expect(report.violations.map(v => `${v.focusNode} ${v.path ?? ''}: ${v.message}`)).toEqual([])
    expect(checkComposite(readComposite(dataset))).toEqual([])
  })

  it('is deterministic: the same composite is the same bytes', () => {
    expect(writeComposite(spec())).toBe(writeComposite(spec()))
  })

  it('writes no blank node, so the profile can be canonicalised and signed', async () => {
    const { canonicalForm } = await import('../../src/rdf/Canonical.js')
    const dataset = await parseText(writeComposite(spec()), IRI)
    // canonicalForm refuses a graph with a blank node, which is the whole point of the rule.
    expect(() => canonicalForm(dataset)).not.toThrow()
  })

  it('writes no pin for a member that has none, and no controls when there are none', async () => {
    const bare = spec()
    delete bare.members[1].pinnedDigest
    bare.ports = []
    const composite = readComposite(await parseText(writeComposite(bare), IRI))
    expect(composite.members[1].pinnedDigest).toBeNull()
    expect(composite.ports).toEqual([])
  })

  it('refuses a value that is not a number rather than writing something the reader will misread', () => {
    const bad = spec()
    bad.ports[0].defaultValue = Number.NaN
    expect(() => writeComposite(bad)).toThrow(/cannot write NaN/)
  })
})
