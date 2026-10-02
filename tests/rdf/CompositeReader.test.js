// tests/rdf/CompositeReader.test.js
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { readComposite, checkComposite } from '../../src/rdf/CompositeReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { parseTurtleFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const load = name => parseTurtleFile(resolve(root, 'examples', name))

describe('readComposite', () => {
  // Members come back sorted by their own IRI (#boost, #trem, #verb), since a composite states no order.
  it('reads members, connections and exposed ports of the reference rack', async () => {
    const c = readComposite(await load('reference-composite.ttl'))
    const base = 'https://example.org/racks/stomp/'
    expect(c.iri).toBe(base)
    expect(c.label).toBe('Stomp rack')
    expect(c.audioInputs).toBe(1)
    expect(c.audioOutputs).toBe(1)
    expect(c.members.map(m => m.plugin)).toEqual([
      'https://strandz.it/jigdaw/plugins/boost/',
      'https://strandz.it/jigdaw/plugins/tremolo/',
      'https://strandz.it/jigdaw/plugins/cascade/'
    ])
    expect(c.members.find(m => m.id === `${base}#trem`).settings).toEqual([{ symbol: 'rate', value: 4.5 }])
    const intoRack = c.connections.find(x => x.id === `${base}#c-in`)
    expect(intoRack.from).toEqual({ node: base, portIndex: 0 })
    expect(intoRack.to).toEqual({ node: `${base}#boost`, portIndex: 0 })
    expect(c.ports.find(p => p.symbol === 'depth').drives).toEqual([{ node: `${base}#trem`, portSymbol: 'depth' }])
  })

  it('refuses a document with no composite, and one with two', async () => {
    const prefixes = '@prefix jig: <http://purl.org/stuff/jigdaw/> . @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .'
    await expect(parseText(`${prefixes} <> rdfs:label "No" .`, 'https://a.example/r/').then(readComposite)).rejects.toThrow(/no jig:CompositePlugin/)
    // The shapes counterexample declares two composites, so it has no single answer.
    const two = await load('counterexample-composite.ttl')
    expect(() => readComposite(two)).toThrow(/2 composites/)
  })
})

describe('checkComposite', () => {
  it('finds nothing wrong with the reference rack', async () => {
    expect(checkComposite(readComposite(await load('reference-composite.ttl')))).toEqual([])
  })

  it('finds every rule the shapes cannot say, once each, in the wiring counterexample', async () => {
    const problems = checkComposite(readComposite(await load('counterexample-composite-wiring.ttl')))
    const byRule = Object.groupBy(problems, p => p.rule)
    expect(Object.keys(byRule).sort()).toEqual(['boundary-count', 'member-is-composite', 'setting-on-driven', 'unknown-node', 'unknown-port'])
    // Input 3 is not declared, and output 1 has nothing connected.
    expect(byRule['boundary-count'].map(p => p.message).join('\n')).toMatch(/input 3/)
    expect(byRule['boundary-count'].map(p => p.message).join('\n')).toMatch(/output 1 has nothing/)
    // The ghost on a connection, and the ghost a control drives.
    expect(byRule['unknown-node']).toHaveLength(2)
    expect(byRule['setting-on-driven']).toHaveLength(1)
    expect(byRule['unknown-port']).toHaveLength(1)
  })
})
