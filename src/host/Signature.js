// src/host/Signature.js
//
// Signing a profile, and saying honestly what a signature proves.
//
// docs/plugin-bundles.md sections 5 and 6. Three layers, and each is worth
// something on its own:
//
//   The canonical digest is one value over the whole profile, so a rewritten
//   profile is detectable even though the resource digests inside it were
//   rewritten with it. Unsigned, it is still useful: two people can compare it.
//
//   The provenance record says who made the bundle and when. Unsigned it is a
//   claim, and a host says so rather than rendering it as fact.
//
//   The proof binds the digest and the provenance to a key. It turns the claim
//   into something only the holder of that key could have made.
//
// What it does not do, and what the host must say out loud: a valid signature
// by an unknown key proves self consistency and nothing about who made it.
// Trust is the person's, and this module returns facts for them to decide on
// rather than a boolean called `trusted`.
//
// Ed25519 through WebCrypto, which node and every current browser implement, so
// the same code verifies in the page and at the command line.
import { profileForm, documentForm, proofConfigForm, proofsOf } from '../rdf/Canonical.js'
import { vocabulary } from '../rdf/Vocabulary.js'
import { digestOf } from './Integrity.js'
import { multibaseEncode, multibaseDecode, encodeMultikey, decodeMultikey } from './Multibase.js'

/**
 * The cryptosuite name, stated in every proof.
 *
 * Deliberately not `eddsa-rdfc-2022`. That suite signs the whole canonicalised
 * graph and this one omits jig:location, so a proof made here would fail a
 * conforming verifier of that suite and, worse, a proof made there would appear
 * to be checkable here. A suite that differs needs a name that differs.
 */
export const CRYPTOSUITE = 'jigdaw-eddsa-2026'

const ALGORITHM = 'Ed25519'
const encoder = new TextEncoder()

// ── Keys ───────────────────────────────────────────────────────────────────

export async function generateKeyPair ({ subtle = crypto.subtle } = {}) {
  const pair = await subtle.generateKey(ALGORITHM, true, ['sign', 'verify'])
  return {
    privateKey: pair.privateKey,
    publicKey: pair.publicKey,
    publicKeyMultibase: encodeMultikey(new Uint8Array(await subtle.exportKey('raw', pair.publicKey)))
  }
}

/** A private key as text, for a key file. This is secret material. */
export async function exportPrivateKey (privateKey, { subtle = crypto.subtle } = {}) {
  const pkcs8 = new Uint8Array(await subtle.exportKey('pkcs8', privateKey))
  return multibaseEncode(pkcs8)
}

export async function importPrivateKey (text, { subtle = crypto.subtle } = {}) {
  return subtle.importKey('pkcs8', multibaseDecode(text), ALGORITHM, true, ['sign'])
}

export async function importPublicKey (publicKeyMultibase, { subtle = crypto.subtle } = {}) {
  return subtle.importKey('raw', decodeMultikey(publicKeyMultibase), ALGORITHM, true, ['verify'])
}

// ── The bytes a signature is made over ────────────────────────────────────

const rawDigest = async (text, subtle) => new Uint8Array(await subtle.digest('SHA-384', encoder.encode(text)))

/**
 * The digest a bundle states as jig:canonicalDigest, over the plugin alone.
 */
export async function canonicalDigest (dataset, { subtle = crypto.subtle } = {}) {
  return digestOf(encoder.encode(profileForm(dataset)), 'sha384', { subtle })
}

/**
 * The input to Ed25519: the digest of the proof's own configuration, then the
 * digest of the document it is a proof of.
 *
 * Two hashes rather than one canonicalisation of everything, for the reason
 * eddsa-rdfc-2022 does the same: the proof states its own time and key, and a
 * signature cannot cover a graph it is inside. Hashing the proof's
 * configuration separately covers them without that circularity, and keeps one
 * signature independent of any other signature on the same bundle.
 */
export async function signingInput (dataset, proofIri, { subtle = crypto.subtle } = {}) {
  const config = await rawDigest(proofConfigForm(dataset, proofIri), subtle)
  const document = await rawDigest(documentForm(dataset), subtle)
  return new Uint8Array([...config, ...document])
}

// ── Signing ────────────────────────────────────────────────────────────────

/**
 * Sign, returning the sec:proofValue for a proof at `proofIri`.
 *
 * The dataset passed in MUST already contain that proof node's own statements,
 * because they are what proofConfigForm hashes. A graph without them produces a
 * signature over an empty configuration, which verifies and covers less than it
 * looks like it covers.
 */
export async function signProfile (dataset, proofIri, privateKey, { subtle = crypto.subtle } = {}) {
  const input = await signingInput(dataset, proofIri, { subtle })
  return multibaseEncode(new Uint8Array(await subtle.sign(ALGORITHM, privateKey, input)))
}

// ── Verifying ──────────────────────────────────────────────────────────────

const one = (dataset, subject, predicate) => {
  for (const quad of dataset) {
    if (quad.subject.value === subject && quad.predicate.value === predicate) return quad.object
  }
  return null
}

const originOf = iri => { try { return new URL(iri).origin } catch { return null } }

/**
 * Everything a host needs to decide, and nothing decided for it.
 *
 * `resolveKey` is how a host fetches a verification method rather than trusting
 * the copy in the bundle. Without it the inline key is used, and `keySource`
 * says so: an inline key makes a proof self consistent and says nothing about
 * who holds it. With it, a mismatch between the fetched key and the inline one
 * is a hard failure, because that is somebody claiming a key they do not have.
 */
export async function verifyProfile (dataset, profileIri, {
  resolveKey = null, subtle = crypto.subtle
} = {}) {
  const { jig, sec, prov, dcterms } = vocabulary

  const digest = await canonicalDigest(dataset, { subtle })
  const bundle = [...dataset].find(q =>
    q.predicate.value === vocabulary.rdf.type && q.object.value === jig.Bundle)?.subject.value ?? null
  const declared = bundle ? one(dataset, bundle, jig.canonicalDigest)?.value ?? null : null

  const proofs = []
  for (const proofIri of proofsOf(dataset, profileIri)) {
    const proof = {
      iri: proofIri,
      cryptosuite: one(dataset, proofIri, sec.cryptosuite)?.value ?? null,
      verificationMethod: one(dataset, proofIri, sec.verificationMethod)?.value ?? null,
      created: one(dataset, proofIri, dcterms.created)?.value ?? null,
      proofValue: one(dataset, proofIri, sec.proofValue)?.value ?? null,
      keySource: 'inline',
      valid: false,
      reason: null
    }
    proof.sameAuthority = proof.verificationMethod != null &&
      originOf(proof.verificationMethod) != null &&
      originOf(proof.verificationMethod) === originOf(profileIri)

    try {
      if (proof.cryptosuite !== CRYPTOSUITE) {
        throw new Error(`unknown cryptosuite ${JSON.stringify(proof.cryptosuite)}, expected ${CRYPTOSUITE}`)
      }
      if (!proof.verificationMethod) throw new Error('the proof names no sec:verificationMethod')
      if (!proof.proofValue) throw new Error('the proof carries no sec:proofValue')

      let multibase = one(dataset, proof.verificationMethod, sec.publicKeyMultibase)?.value ?? null
      if (resolveKey) {
        const fetched = await resolveKey(proof.verificationMethod)
        if (!fetched) throw new Error(`${proof.verificationMethod} could not be dereferenced, so the key in the bundle is the only copy`)
        if (multibase && fetched !== multibase) {
          throw new Error(`the key in the bundle is not the key published at ${proof.verificationMethod}`)
        }
        multibase = fetched
        proof.keySource = 'dereferenced'
      }
      if (!multibase) throw new Error(`no sec:publicKeyMultibase for ${proof.verificationMethod}`)
      proof.publicKeyMultibase = multibase

      const key = await importPublicKey(multibase, { subtle })
      const input = await signingInput(dataset, proofIri, { subtle })
      proof.valid = await subtle.verify(ALGORITHM, key, multibaseDecode(proof.proofValue), input)
      if (!proof.valid) proof.reason = 'the signature does not match the profile it is attached to'
    } catch (error) {
      proof.valid = false
      proof.reason = error.message
    }
    proofs.push(proof)
  }

  const attribution = bundle
    ? (one(dataset, bundle, prov.wasGeneratedBy)?.value ?? null)
    : null

  return {
    digest,
    declared,
    // null rather than true when nothing declared one: "no claim" and "a claim
    // that holds" are different answers and a host reports them differently.
    digestMatches: declared === null ? null : declared === digest,
    bundle,
    attribution,
    proofs,
    signed: proofs.length > 0,
    valid: proofs.length > 0 && proofs.every(p => p.valid)
  }
}
