// tests/rdf/ProvenanceDocument.test.js
//
// The record has to mean the same thing in two places: as a file beside a
// profile, and appended to a flattened profile that has its own @base. That is
// one property and it is the only reason every node in it is written as an
// absolute IRI, so it is the property this file spends most of its time on.
import { describe, it, expect } from 'vitest'
import { parseText } from '../../src/rdf/parse.js'
import {
  writeProvenance, readProvenance, provenanceNodes, provenanceIriFor
} from '../../src/rdf/ProvenanceDocument.js'
import { vocabulary } from '../../src/rdf/Vocabulary.js'

const PROFILE_IRI = 'https://example.org/plugins/t/'

const record = {
  profileIri: PROFILE_IRI,
  form: vocabulary.jig.Archive,
  canonicalDigest: 'sha384-aaa',
  endedAtTime: new Date('2026-09-18T11:00:00Z'),
  tool: 'http://purl.org/stuff/jigdaw/tool/bundle'
}

describe('a provenance record', () => {
  it('sits beside the profile unless somebody says otherwise', () => {
    expect(provenanceIriFor(PROFILE_IRI)).toBe(`${PROFILE_IRI}provenance.ttl`)
    expect(provenanceNodes(provenanceIriFor(PROFILE_IRI)).proof)
      .toBe(`${PROFILE_IRI}provenance.ttl#proof`)
  })

  it('means the same thing whatever base it is read against', async () => {
    // The flattened form appends it to a profile whose @base is the plugin IRI,
    // and an archive is read with no base worth the name. If the nodes were
    // relative, the same bytes would describe three different bundles.
    const text = writeProvenance(record)
    const bases = ['urn:jigdaw:nothing', PROFILE_IRI, 'file:///tmp/x/']
    const read = await Promise.all(bases.map(async base =>
      readProvenance(await parseText(text, base))))
    for (const one of read) {
      expect(one).toEqual(read[0])
      expect(one.bundle).toBe(`${PROFILE_IRI}provenance.ttl#bundle`)
    }
  })

  it('is written somewhere else when a third party makes the bundle', async () => {
    // A mirror minting nodes in the author's fragment space would be making
    // statements at an IRI it has no authority over.
    const text = writeProvenance({ ...record, documentIri: 'https://mirror.example/copies/t.ttl' })
    const back = readProvenance(await parseText(text, 'urn:jigdaw:nothing'))
    expect(back.bundle).toBe('https://mirror.example/copies/t.ttl#bundle')
    expect(back.of).toBe(PROFILE_IRI)
  })

  it('is the same bytes twice for the same record', async () => {
    expect(writeProvenance(record)).toBe(writeProvenance(record))
  })

  it('refuses to write a record with nothing in it', () => {
    for (const missing of ['profileIri', 'form', 'canonicalDigest', 'tool']) {
      const broken = { ...record, [missing]: undefined }
      expect(() => writeProvenance(broken), missing).toThrow()
    }
  })

  it('leaves the signature out until there is one', async () => {
    // How the two-pass signing works: this is the graph that gets signed, and
    // it already contains the created time and the key that the signature has
    // to cover.
    const text = writeProvenance({
      ...record,
      proof: {
        cryptosuite: 'jigdaw-eddsa-2026',
        verificationMethod: 'https://example.org/keys/a#ed25519',
        publicKeyMultibase: 'z6Mkaaa',
        created: new Date('2026-09-18T11:00:00Z'),
        proofValue: null
      }
    })
    expect(text).toContain('sec:cryptosuite')
    expect(text).toContain('sec:publicKeyMultibase')
    expect(text).not.toContain('sec:proofValue')

    const dataset = await parseText(text, 'urn:jigdaw:nothing')
    const proof = [...dataset].filter(q => q.subject.value.endsWith('#proof'))
    expect(proof.length).toBeGreaterThan(3)
  })

  it('reads as nothing when a document carries no record', async () => {
    const dataset = await parseText('<https://example.org/a> <https://example.org/b> "c" .', 'urn:x')
    expect(readProvenance(dataset)).toBeNull()
  })
})
