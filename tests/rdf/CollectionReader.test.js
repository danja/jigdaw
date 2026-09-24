// tests/rdf/CollectionReader.test.js
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import { readCollection } from '../../src/rdf/CollectionReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { parseTurtleFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const PREFIXES = `
  @prefix jig: <http://purl.org/stuff/jigdaw/> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix dcterms: <http://purl.org/dc/terms/> .`

describe('readCollection', () => {
  it('reads the name, the description, and each member by IRI and name', async () => {
    const c = readCollection(await parseTurtleFile(resolve(root, 'examples/reference-collection.ttl')))
    expect(c.iri).toBe('https://example.org/collections/reverbs')
    expect(c.label).toBe('Reverbs')
    expect(c.comment).toMatch(/plates and springs/)
    // Sorted by name, since a collection states no order.
    expect(c.members).toEqual([
      { iri: 'https://plugins.example.net/plate/', label: 'Plate' },
      { iri: 'https://example.org/plugins/reference/', label: 'Reference' }
    ])
  })

  it('resolves relative members against the URL the document was fetched from', async () => {
    const c = readCollection(await parseText(`${PREFIXES}
      <> a jig:PluginCollection ; rdfs:label "Here" ; dcterms:hasPart <../plugins/pulse/> .
      <../plugins/pulse/> rdfs:label "Pulse" .`, 'https://host.example/collections/mine.ttl'))
    expect(c.members[0].iri).toBe('https://host.example/plugins/pulse/')
  })

  it('reports an unnamed member as null rather than inventing a name', async () => {
    const c = readCollection(await parseText(`${PREFIXES}
      <> a jig:PluginCollection ; rdfs:label "X" ; dcterms:hasPart <https://a.example/p/> .`,
    'https://a.example/c'))
    expect(c.members).toEqual([{ iri: 'https://a.example/p/', label: null }])
    expect(c.comment).toBeNull()
  })

  it('refuses a document with no collection', async () => {
    const dataset = await parseText(`${PREFIXES} <> rdfs:label "Not one" .`, 'https://a.example/c')
    expect(() => readCollection(dataset)).toThrow(/no jig:PluginCollection/)
  })

  it('refuses a document with two collections', async () => {
    const dataset = await parseTurtleFile(resolve(root, 'examples/counterexample-collection.ttl'))
    expect(() => readCollection(dataset)).toThrow(/2 collections/)
  })
})
