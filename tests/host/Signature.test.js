// tests/host/Signature.test.js
//
// A signature that verifies proves nothing on its own: a verifier that returns
// true for everything passes a round trip test perfectly. So every test here
// that signs something is paired with one that changes something and expects
// the signature to notice, and the pairs are chosen to cover each of the three
// things the format claims a signature covers: the profile, the provenance
// record, and the proof's own time and key.
//
// No key material is committed. Every key here is generated in memory for the
// test that uses it, which is also the answer to AGENTS.md on fixtures that
// look like credentials.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { parseText } from '../../src/rdf/parse.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import {
  generateKeyPair, signProfile, verifyProfile, canonicalDigest, signingInput,
  exportPrivateKey, importPrivateKey, importPublicKey, CRYPTOSUITE
} from '../../src/host/Signature.js'
import { writeProvenance, provenanceNodes, readProvenance } from '../../src/rdf/ProvenanceDocument.js'
import { vocabulary } from '../../src/rdf/Vocabulary.js'

const root = resolve(import.meta.dirname, '../..')
const PROFILE_IRI = 'https://example.org/plugins/reference/'
const DOCUMENT_IRI = `${PROFILE_IRI}provenance.ttl`
const METHOD = 'https://example.org/keys/reference#ed25519'

/** Profile plus provenance as one array of quads, which is what a host has. */
async function graphFor (profileText, record) {
  const profile = await parseText(profileText, 'urn:jigdaw:test')
  const provenance = await parseText(writeProvenance(record), DOCUMENT_IRI)
  return [...profile, ...provenance]
}

describe('signing a profile', () => {
  let profileText
  let key
  let record
  let signed

  beforeAll(async () => {
    profileText = await readFile(resolve(root, 'examples/reference-profile.ttl'), 'utf8')
    key = await generateKeyPair()

    record = {
      profileIri: PROFILE_IRI,
      documentIri: DOCUMENT_IRI,
      form: vocabulary.jig.Archive,
      canonicalDigest: await canonicalDigest(await parseText(profileText, 'urn:jigdaw:test')),
      endedAtTime: new Date('2026-09-18T11:00:00Z'),
      tool: 'http://purl.org/stuff/jigdaw/tool/bundle',
      attributedTo: 'https://example.org/people/reference#me',
      proof: {
        cryptosuite: CRYPTOSUITE,
        verificationMethod: METHOD,
        publicKeyMultibase: key.publicKeyMultibase,
        created: new Date('2026-09-18T11:00:00Z'),
        proofValue: null
      }
    }
    // Two passes, which is how the proof's own time and key get covered: the
    // first writes everything but the signature, the second puts the signature
    // into the graph it was taken over.
    const unsigned = await graphFor(profileText, record)
    record.proof.proofValue = await signProfile(
      unsigned, provenanceNodes(DOCUMENT_IRI).proof, key.privateKey
    )
    signed = await graphFor(profileText, record)
  })

  it('verifies, and says which key it verified against', async () => {
    const report = await verifyProfile(signed, PROFILE_IRI)
    expect(report.valid).toBe(true)
    expect(report.proofs).toHaveLength(1)
    expect(report.proofs[0].verificationMethod).toBe(METHOD)
    expect(report.proofs[0].keySource).toBe('inline')
  })

  it('says the digest the record states is the digest the profile has', async () => {
    const report = await verifyProfile(signed, PROFILE_IRI)
    expect(report.digestMatches).toBe(true)
    expect(report.declared).toBe(report.digest)
  })

  it('notices a changed profile', async () => {
    const tampered = await graphFor(profileText.replace('"Reference', '"Deference'), record)
    const report = await verifyProfile(tampered, PROFILE_IRI)
    expect(report.valid).toBe(false)
    expect(report.digestMatches).toBe(false)
  })

  it('notices a rewritten provenance record', async () => {
    // The reason provenance is inside the signature. Unsigned, this rewrite
    // would be invisible and the record would still look checked.
    const moved = { ...record, attributedTo: 'https://evil.example/#me' }
    const report = await verifyProfile(await graphFor(profileText, moved), PROFILE_IRI)
    expect(report.valid).toBe(false)
    // The profile itself is untouched, so the digest still holds. Two separate
    // answers, which is why the report gives two.
    expect(report.digestMatches).toBe(true)
  })

  it('notices a rewritten proof time or verification method', async () => {
    // The reason for the two-hash construction. A signature over the document
    // alone would leave both of these rewritable.
    for (const change of [
      { ...record.proof, created: new Date('2020-01-01T00:00:00Z') },
      { ...record.proof, verificationMethod: 'https://evil.example/keys/1' }
    ]) {
      const report = await verifyProfile(
        await graphFor(profileText, { ...record, proof: change }), PROFILE_IRI)
      expect(report.valid).toBe(false)
    }
  })

  it('does not notice a changed jig:location, and the digests are why', async () => {
    // Stated as a test because it is a deliberate hole and a reader will
    // otherwise assume it is a defect. A mirror rewrites locations; that must
    // not break a signature. It is safe because jig:integrity is signed, so a
    // rewritten location can only point at the bytes the signature covers.
    const moved = profileText.replace('jig:location <reference.wasm>', 'jig:location <https://mirror.example/reference.wasm>')
    expect(moved).not.toBe(profileText)
    const report = await verifyProfile(await graphFor(moved, record), PROFILE_IRI)
    expect(report.valid).toBe(true)
    expect(report.digestMatches).toBe(true)
  })

  it('refuses a proof that names a cryptosuite it cannot check', async () => {
    // Worse than an unsigned bundle, because an unchecked proof looks checked.
    const other = { ...record, proof: { ...record.proof, cryptosuite: 'eddsa-rdfc-2022' } }
    const report = await verifyProfile(await graphFor(profileText, other), PROFILE_IRI)
    expect(report.valid).toBe(false)
    expect(report.proofs[0].reason).toMatch(/unknown cryptosuite/)
  })

  it('prefers the published key over the copy in the bundle, and refuses a disagreement', async () => {
    const asPublished = await verifyProfile(signed, PROFILE_IRI, {
      resolveKey: async iri => iri === METHOD ? key.publicKeyMultibase : null
    })
    expect(asPublished.valid).toBe(true)
    expect(asPublished.proofs[0].keySource).toBe('dereferenced')

    // Somebody claiming a key they do not hold. The signature would verify
    // against the copy they supplied, which is exactly why the copy is not
    // authority for anything.
    const impostor = await generateKeyPair()
    const caught = await verifyProfile(signed, PROFILE_IRI, {
      resolveKey: async () => impostor.publicKeyMultibase
    })
    expect(caught.valid).toBe(false)
    expect(caught.proofs[0].reason).toMatch(/not the key published/)
  })

  it('reports an unsigned bundle as unsigned rather than as failing', async () => {
    const { proof, ...unsigned } = record
    const report = await verifyProfile(await graphFor(profileText, unsigned), PROFILE_IRI)
    expect(report.signed).toBe(false)
    expect(report.valid).toBe(false)
    expect(report.digestMatches).toBe(true)
  })

  it('reports a profile with no bundle at all as making no claim', async () => {
    // null and false are different answers: no digest was claimed, rather than
    // one was claimed and is wrong.
    const alone = await parseText(profileText, 'urn:jigdaw:test')
    const report = await verifyProfile(alone, PROFILE_IRI)
    expect(report.declared).toBeNull()
    expect(report.digestMatches).toBeNull()
    expect(report.signed).toBe(false)
  })

  it('is a document the shapes accept', async () => {
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const report = await validator.validate(await parseText(writeProvenance(record), DOCUMENT_IRI))
    const seen = report.violations.map(v => `${v.focusNode} ${v.path ?? '(node)'}`)
    expect(seen, `violations:\n  ${seen.join('\n  ')}`).toEqual([])
  })

  it('reads back as the record that was written', async () => {
    const back = readProvenance(signed)
    expect(back.of).toBe(PROFILE_IRI)
    expect(back.form).toBe(vocabulary.jig.Archive)
    expect(back.attributedTo).toBe('https://example.org/people/reference#me')
    expect(back.endedAtTime).toBe('2026-09-18T11:00:00.000Z')
  })
})

describe('the signing input', () => {
  it('is two digests, the proof configuration then the document', async () => {
    // Pinned because it is the interoperability surface. Anything that verifies
    // a JigDAW proof in another language has to build these bytes the same way,
    // and a change here is a change to the format rather than a refactor.
    const key = await generateKeyPair()
    const profile = await parseText(
      await readFile(resolve(root, 'examples/reference-profile.ttl'), 'utf8'), 'urn:jigdaw:test')
    const record = {
      profileIri: PROFILE_IRI,
      documentIri: DOCUMENT_IRI,
      form: vocabulary.jig.Archive,
      canonicalDigest: await canonicalDigest(profile),
      endedAtTime: new Date('2026-09-18T11:00:00Z'),
      tool: 'http://purl.org/stuff/jigdaw/tool/bundle',
      proof: {
        cryptosuite: CRYPTOSUITE,
        verificationMethod: METHOD,
        publicKeyMultibase: key.publicKeyMultibase,
        created: new Date('2026-09-18T11:00:00Z'),
        proofValue: null
      }
    }
    const graph = [...profile, ...await parseText(writeProvenance(record), DOCUMENT_IRI)]
    const input = await signingInput(graph, provenanceNodes(DOCUMENT_IRI).proof)
    expect(input).toHaveLength(96)
  })
})

describe('a key', () => {
  it('survives being written down and read back', async () => {
    const key = await generateKeyPair()
    const text = await exportPrivateKey(key.privateKey)
    expect(text).toMatch(/^z/)

    const reloaded = await importPrivateKey(text)
    const message = new TextEncoder().encode('t')
    const signature = await crypto.subtle.sign('Ed25519', reloaded, message)
    const publicKey = await importPublicKey(key.publicKeyMultibase)
    expect(await crypto.subtle.verify('Ed25519', publicKey, signature, message)).toBe(true)
  })
})
