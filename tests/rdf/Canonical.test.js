// tests/rdf/Canonical.test.js
//
// The canonical form is the thing a digest and a signature are actually about,
// so every property it claims is a property somebody will rely on without
// checking. Each one is asserted here against a graph written two ways.
//
// The last case in this file is the reason the rule exists at all: signing a
// real plugin failed on the first attempt because bin/write-profile.js emitted
// scale points as blank nodes, in a repository whose conventions forbid them.
// The convention was three years of prose and nothing checked it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseText } from '../../src/rdf/parse.js'
import {
  canonicalForm, profileForm, documentForm, proofConfigForm,
  proofSubjects, bundleSubjects, proofsOf, OMITTED_PREDICATES
} from '../../src/rdf/Canonical.js'
import { vocabulary } from '../../src/rdf/Vocabulary.js'

const root = resolve(import.meta.dirname, '../..')
const BASE = 'https://example.org/plugins/t/'

const graph = text => parseText(text, BASE)

const PROFILE = `
  @base <${BASE}> .
  @prefix jig: <http://purl.org/stuff/jigdaw/> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  <> a jig:WebPlugin ; rdfs:label "T" ; jig:module <#module> .
  <#module> a jig:Module ; jig:location <t.wasm> ; jig:integrity "sha384-aaa" .`

describe('the canonical form', () => {
  it('is the same for two documents that say the same thing differently', async () => {
    // Prefixes, ordering, whitespace and the choice between a relative and an
    // absolute IRI are all properties of a document and none of them are
    // properties of what it says. A digest over the bytes would disagree here
    // and that is why this one is not over the bytes.
    const other = `
      @prefix j: <http://purl.org/stuff/jigdaw/> .
      @prefix r: <http://www.w3.org/2000/01/rdf-schema#> .
      <${BASE}#module> j:integrity "sha384-aaa" ; j:location <${BASE}t.wasm> ; a j:Module .
      <${BASE}> j:module <${BASE}#module> ; r:label "T" ; a j:WebPlugin .`
    expect(canonicalForm(await graph(other))).toBe(canonicalForm(await graph(PROFILE)))
  })

  it('leaves out jig:location, so a bundle and its origin agree', async () => {
    // The property the whole design rests on: the same plugin delivered
    // flattened, archived and served has one digest. Safe only because
    // jig:integrity is NOT left out, which the second assertion pins.
    const inlined = PROFILE.replace('<t.wasm>', '<data:application/wasm;base64,AGFzbQ>')
    expect(canonicalForm(await graph(inlined))).toBe(canonicalForm(await graph(PROFILE)))
    expect(OMITTED_PREDICATES).toContain(vocabulary.jig.location)

    const tampered = PROFILE.replace('sha384-aaa', 'sha384-bbb')
    expect(canonicalForm(await graph(tampered))).not.toBe(canonicalForm(await graph(PROFILE)))
  })

  it('refuses a blank node rather than labelling one', async () => {
    const withBlank = PROFILE + '\n<#module> rdfs:seeAlso [ rdfs:label "x" ] .'
    await expect(async () => canonicalForm(await graph(withBlank)))
      .rejects.toThrow(/blank node/)
  })

  it('refuses an empty graph, rather than digesting nothing', async () => {
    expect(() => canonicalForm([])).toThrow(/nothing to canonicalise/)
  })

  it('counts a triple stated twice once', async () => {
    const twice = PROFILE + `\n<${BASE}> <http://www.w3.org/2000/01/rdf-schema#label> "T" .`
    expect(canonicalForm(await graph(twice))).toBe(canonicalForm(await graph(PROFILE)))
  })

  it('sorts in code point order, not UTF-16 order', () => {
    // They differ above U+FFFF: a surrogate pair sorts below U+E000 in UTF-16
    // and above it by code point. A verifier written in another language would
    // use code point order, and a signature the two disagree about is a
    // signature that fails on somebody else's machine and nowhere here.
    const quad = object => ({
      subject: { termType: 'NamedNode', value: 'https://example.org/s' },
      predicate: { termType: 'NamedNode', value: 'https://example.org/p' },
      object: { termType: 'Literal', value: object, datatype: { value: 'http://www.w3.org/2001/XMLSchema#string' } }
    })
    const lines = canonicalForm([quad('\u{1F600}'), quad('')]).trim().split('\n')
    expect(lines[0]).toContain('')
    expect(lines[1]).toContain('\u{1F600}')
  })
})

const PROVENANCE = `
  @prefix jig: <http://purl.org/stuff/jigdaw/> .
  @prefix prov: <http://www.w3.org/ns/prov#> .
  @prefix sec: <https://w3id.org/security#> .
  @prefix xsd: <http://www.w3.org/2001/XMLSchema#> .
  <${BASE}provenance.ttl#bundle> a jig:Bundle ;
      prov:wasDerivedFrom <${BASE}> ;
      jig:bundleForm jig:Archive ;
      jig:canonicalDigest "sha384-zzz" ;
      prov:wasGeneratedBy <${BASE}provenance.ttl#bundling> .
  <${BASE}provenance.ttl#bundling> a jig:Bundling ;
      prov:used <${BASE}> ;
      prov:endedAtTime "2026-09-18T10:00:00.000Z"^^xsd:dateTime ;
      prov:wasAssociatedWith <http://purl.org/stuff/jigdaw/tool/bundle> .
  <${BASE}> sec:proof <${BASE}provenance.ttl#proof> .
  <${BASE}provenance.ttl#proof> a sec:DataIntegrityProof ;
      sec:cryptosuite "jigdaw-eddsa-2026" ;
      sec:verificationMethod <https://example.org/keys/a#ed25519> ;
      sec:proofValue "zSIG" .
  <https://example.org/keys/a#ed25519> a sec:Multikey ; sec:publicKeyMultibase "z6Mkaaa" .`

describe('the three forms', () => {
  // A plain array, because everything that reads a graph here only iterates.
  const build = async () => [...await graph(PROFILE), ...await graph(PROVENANCE)]

  it('finds the provenance nodes by following arcs, not by guessing', async () => {
    const all = await build()
    expect(bundleSubjects(all).sort()).toEqual([
      `${BASE}provenance.ttl#bundle`, `${BASE}provenance.ttl#bundling`
    ])
    expect(proofSubjects(all).sort()).toEqual([
      'https://example.org/keys/a#ed25519', `${BASE}provenance.ttl#proof`
    ])
    expect(proofsOf(all, BASE)).toEqual([`${BASE}provenance.ttl#proof`])
  })

  it('gives the plugin alone one form whether or not it is in a bundle', async () => {
    // What jig:canonicalDigest names. Appending a provenance record to a
    // profile must not change the digest that record carries, or the flattened
    // form could never state a digest of itself.
    expect(profileForm(await build())).toBe(profileForm(await graph(PROFILE)))
  })

  it('puts the provenance inside what a signature covers', async () => {
    // Otherwise a record of who made a bundle could be rewritten by anybody
    // without breaking the signature, which is worse than no record because it
    // would look checked.
    const document = documentForm(await build())
    expect(document).toContain('prov#wasGeneratedBy')
    expect(document).toContain('jigdaw/canonicalDigest')
  })

  it('leaves every proof and key out of what a signature covers', async () => {
    // A signature cannot cover itself, and a second signer arriving later must
    // not invalidate the first. Both are the same omission.
    const document = documentForm(await build())
    expect(document).not.toContain('proofValue')
    expect(document).not.toContain('publicKeyMultibase')
    expect(document).not.toContain('security#proof>')
  })

  it('covers the proof time and key through the proof configuration', async () => {
    // The other half of the two-hash construction. Without it the created time
    // and the verification method would be decoration.
    const config = proofConfigForm(await build(), `${BASE}provenance.ttl#proof`)
    expect(config).toContain('verificationMethod')
    expect(config).toContain('cryptosuite')
    expect(config).not.toContain('proofValue')
  })
})

describe('every Turtle document in this repository', () => {
  // The guard the blank node rule never had. AGENTS.md has forbidden a blank
  // node for anything addressable since phase 0, and bin/write-profile.js was
  // emitting three of them per enumerated port the whole time. Nothing noticed
  // until a signature needed a canonical form, which is exactly the shape of
  // failure that file warns about: a rule worth stating is worth a test.
  //
  // vocabs/shapes.ttl is exempt and is the only exemption. SHACL property
  // shapes are blank nodes by convention, nothing dereferences them, and no
  // shapes file is ever signed.
  const EXEMPT = new Set(['vocabs/shapes.ttl'])

  it('canonicalises, which is to say contains no blank node', async () => {
    const { execFileSync } = await import('node:child_process')
    const tracked = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'],
      { cwd: root, encoding: 'utf8' }).split('\n').filter(f => f.endsWith('.ttl'))

    expect(tracked.length, 'no Turtle files found, so this checked nothing').toBeGreaterThan(5)

    const offenders = []
    for (const file of tracked) {
      if (EXEMPT.has(file)) continue
      const dataset = await parseText(readFileSync(join(root, file), 'utf8'), `urn:jigdaw:${file}`)
      try { canonicalForm(dataset) } catch (error) { offenders.push(`${file}: ${error.message}`) }
    }
    expect(offenders, `cannot be canonicalised:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})
