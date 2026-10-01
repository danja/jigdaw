// tests/rdf/ScriptsRoundTrip.test.js
//
// A script saved with a session, written and read back. The text must survive whatever it holds, the document
// must be one the shapes accept and the canonical form can sign (no blank nodes), and nothing here may run a
// script. A script is typed code, so the awkward characters are the point: quotes, backslashes, line breaks,
// triple quotes and a unicode line separator that Turtle's own grammar has views about.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { Project } from '../../src/model/Project.js'
import { writeScripts } from '../../src/rdf/ProjectWriter.js'
import { readScripts } from '../../src/rdf/ProjectReader.js'
import { parseText } from '../../src/rdf/parse.js'
import { canonicalForm } from '../../src/rdf/Canonical.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { vocabulary as v } from '../../src/rdf/Vocabulary.js'

const root = resolve(import.meta.dirname, '../..')
const IRI = 'https://example.org/sessions/test/'
const AT = '2026-10-01T12:00:00Z'

let validator
beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

const written = (scripts, over = {}) => {
  const p = new Project()
  for (const [id, s] of Object.entries(scripts)) p.scripts.set(id, s)
  return { project: p, text: writeScripts(p, { iri: IRI, savedAt: AT, ...over }) }
}

describe('writing scripts', () => {
  it('writes nothing for a session with none, so it stays one Turtle file', () => {
    expect(writeScripts(new Project(), { iri: IRI })).toBeNull()
  })

  it('needs the session IRI', () => {
    expect(() => writeScripts(new Project(), {})).toThrow(/needs the project IRI/)
  })

  it('is byte-identical for the same scripts and the same time, in any order they were saved in', () => {
    const a = written({ one: { source: 'x' }, two: { source: 'y' } }).text
    const b = written({ two: { source: 'y' }, one: { source: 'x' } }).text
    expect(a).toBe(b)
  })

  it('names each script as a fragment of the session, and states its language and its time', () => {
    const { text } = written({ script: { source: 'a.mix = 1', label: 'Main' } })
    expect(text).toContain('@base <https://example.org/sessions/test/> .')
    expect(text).toContain('<#script> a jig:Script')
    expect(text).toContain('jig:scriptLanguage jig:Reel')
    expect(text).toContain('rdfs:label "Main"')
    expect(text).toContain('dcterms:modified "2026-10-01T12:00:00Z"^^xsd:dateTime')
  })
})

describe('reading them back', () => {
  const TEXTS = {
    plain: 'a.mix = 1',
    comments: '# note\n\nload a = https://example.org/p/#frag   # trailing\n',
    quotes: 'a = "quoted" \'single\' and """triple""" and \'\'\'more\'\'\'',
    backslashes: 'C:\\path\\n \\ \\\\ \\u0041 \\"',
    controls: 'tab\there\r\nwindows\nunix\u0000nul\u0007bell',
    unicode: 'caf\u00e9 \u65e5\u672c\u8a9e \ud83c\udfb5 \u2028 \u2029 \u00a0',
    long: 'x = 1\n'.repeat(5000),
    onlyWhitespace: '   \n\t\n'
  }

  for (const [name, source] of Object.entries(TEXTS)) {
    it(`gives back exactly what was written: ${name}`, async () => {
      const { text } = written({ script: { source } })
      const read = readScripts(await parseText(text, IRI), IRI)
      expect(read).toHaveLength(1)
      expect(read[0].source).toBe(source)
    })
  }

  it('gives back the id, label, language and time', async () => {
    const { text } = written({ script: { source: 'x', label: 'Main' } })
    const [s] = readScripts(await parseText(text, IRI), IRI)
    expect(s).toEqual({ id: 'script', label: 'Main', language: v.jig.Reel, source: 'x', savedAt: AT })
  })

  it('gives back several, in id order', async () => {
    const { text } = written({ b: { source: '2' }, a: { source: '1' } })
    expect(readScripts(await parseText(text, IRI), IRI).map(s => s.id)).toEqual(['a', 'b'])
  })

  it('loads into a project, and writes the same again', async () => {
    const { text } = written({ script: { source: 'a.mix = 1', label: 'Main' } })
    const p = new Project()
    p.scripts.load(readScripts(await parseText(text, IRI), IRI))
    expect(writeScripts(p, { iri: IRI, savedAt: AT })).toBe(text)
  })

  it('refuses a script with no source and one with no language, and a subject that is not the session\'s', async () => {
    const head = `@base <${IRI}> .\n@prefix jig: <http://purl.org/stuff/jigdaw/> .\n`
    await expect(async () => readScripts(await parseText(`${head}<#s> a jig:Script ; jig:scriptLanguage jig:Reel .`, IRI), IRI)).rejects.toThrow(/no source/)
    await expect(async () => readScripts(await parseText(`${head}<#s> a jig:Script ; jig:scriptSource "x" .`, IRI), IRI)).rejects.toThrow(/no language/)
    await expect(async () => readScripts(await parseText(`${head}<https://elsewhere.example/s> jig:scriptSource "x" ; jig:scriptLanguage jig:Reel .`, IRI), IRI)).rejects.toThrow()
  })
})

describe('what the format guarantees', () => {
  it('conforms to the shapes', async () => {
    const { text } = written({ script: { source: 'a.mix = 1', label: 'Main' } })
    const report = await validator.validate(await parseText(text, IRI))
    expect(report.violations.map(x => x.message)).toEqual([])
    expect(report.conforms).toBe(true)
  })

  it('has no blank nodes, so it has a canonical form and can be signed', async () => {
    const { text } = written({ one: { source: 'x', label: 'A' }, two: { source: 'y' } })
    const dataset = await parseText(text, IRI)
    for (const quad of dataset) {
      expect(quad.subject.termType, 'a subject').not.toBe('BlankNode')
      expect(quad.object.termType, 'an object').not.toBe('BlankNode')
    }
    expect(() => canonicalForm(dataset)).not.toThrow()
  })

  it('refuses, by the shapes, a script with no source, with two, with an empty one, or with no language', async () => {
    const head = `@base <${IRI}> .\n@prefix jig: <http://purl.org/stuff/jigdaw/> .\n`
    const cases = {
      'no source': '<#s> a jig:Script ; jig:scriptLanguage jig:Reel .',
      'two sources': '<#s> a jig:Script ; jig:scriptLanguage jig:Reel ; jig:scriptSource "a", "b" .',
      'an empty source': '<#s> a jig:Script ; jig:scriptLanguage jig:Reel ; jig:scriptSource "" .',
      'no language': '<#s> a jig:Script ; jig:scriptSource "a" .',
      'a language that is not one': '<#s> a jig:Script ; jig:scriptLanguage <https://example.org/nope> ; jig:scriptSource "a" .',
      'a source that is not a string': '<#s> a jig:Script ; jig:scriptLanguage jig:Reel ; jig:scriptSource 3 .',
      'a bad time': '@prefix dcterms: <http://purl.org/dc/terms/> .\n<#s> a jig:Script ; jig:scriptLanguage jig:Reel ; jig:scriptSource "a" ; dcterms:modified "yesterday" .',
      'a blank node': '[] a jig:Script ; jig:scriptLanguage jig:Reel ; jig:scriptSource "a" .'
    }
    for (const [name, body] of Object.entries(cases)) {
      const report = await validator.validate(await parseText(`${head}${body}`, IRI))
      expect(report.conforms, name).toBe(false)
    }
  })

  it('names exactly the languages the ontology declares, so adding one in one place and not the other fails here', async () => {
    const { parseTurtleFile } = await import('../../src/validate/files.js')
    const onto = await parseTurtleFile(resolve(root, 'vocabs/jigdaw.ttl'), 'urn:onto')
    const RDF_TYPE = v.rdf.type
    const declared = [...onto.match(null, null, null)]
      .filter(q => q.predicate.value === RDF_TYPE && q.object.value === v.jig.ScriptLanguage)
      .map(q => q.subject.value)
      .sort()
    expect(declared.length, 'no languages declared, so this checked nothing').toBeGreaterThan(0)

    // The sh:in list of the shape, read from the shapes graph.
    const shapes = await parseTurtleFile(resolve(root, 'vocabs/shapes.ttl'), 'urn:shapes')
    const quads = [...shapes.match(null, null, null)]
    const bySubject = new Map()
    for (const q of quads) { if (!bySubject.has(q.subject.value)) bySubject.set(q.subject.value, []); bySubject.get(q.subject.value).push(q) }
    const SH_IN = 'http://www.w3.org/ns/shacl#in'
    const SH_PATH = 'http://www.w3.org/ns/shacl#path'
    const property = quads.find(q => q.predicate.value === SH_PATH && q.object.value === v.jig.scriptLanguage)
    const listHead = bySubject.get(property.subject.value).find(q => q.predicate.value === SH_IN).object
    const listed = []
    let node = listHead
    const FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first'
    const REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'
    const NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'
    while (node.value !== NIL) {
      const own = bySubject.get(node.value)
      listed.push(own.find(q => q.predicate.value === FIRST).object.value)
      node = own.find(q => q.predicate.value === REST).object
    }
    expect(listed.sort()).toEqual(declared)
  })
})
