// src/rdf/Canonical.js
//
// The canonical form of a profile: the bytes a digest is taken over and a
// signature is made over, defined on the graph rather than on the document.
//
// docs/plugin-bundles.md section 5. Every file a bundle carries is already
// tamper evident, because the profile states its digest. The profile itself was
// not, and a digest of the profile document's bytes would not have closed it:
// the same plugin is legitimately delivered as three different byte sequences,
// flattened, archived, and served from its origin, and a digest that changes
// between them says nothing a recipient can use.
//
// So the form is graph based. Two omissions make it stable across those three,
// and both are rules the format already states elsewhere:
//
//   jig:location is omitted, because a bundle is a retrieval origin and not an
//   identity. That is the same rule rebaseLocation implements for mirrors. It
//   is safe to omit precisely because every resource also carries a
//   jig:integrity, which is NOT omitted: a rewritten location can only point at
//   bytes that match the signed digest, or the load fails.
//
//   The proof node's own triples are omitted, because a signature cannot cover
//   itself.
//
// This is the blank node free subset of RDFC-1.0 (https://www.w3.org/TR/rdf-canon/),
// where canonicalisation reduces to serialising N-Triples and sorting them in
// code point order. JigDAW profiles have no blank nodes, by the convention in
// AGENTS.md and by sh:nodeKind sh:IRI in the shapes, and a blank node here is
// refused rather than labelled: implementing a third of an algorithm and
// claiming the whole of it is how a signature comes to mean less than it says.
import { vocabulary } from './Vocabulary.js'

const XSD_STRING = 'http://www.w3.org/2001/XMLSchema#string'
const RDF_LANG_STRING = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString'

/**
 * Predicates left out of every canonical form.
 *
 * jig:location for the reason in the header. sec:proof because it is the list
 * of signatures on a thing, and a signature that covered the list of signatures
 * would be invalidated by the next person to countersign.
 */
export const OMITTED_PREDICATES = Object.freeze([vocabulary.jig.location, vocabulary.sec.proof])

const ESCAPES = { '\\': '\\\\', '"': '\\"', '\n': '\\n', '\r': '\\r', '\t': '\\t' }

/** N-Triples string escaping, including control characters as \uXXXX. */
function escapeLiteral (value) {
  let out = ''
  for (const char of value) {
    if (ESCAPES[char]) { out += ESCAPES[char]; continue }
    const code = char.codePointAt(0)
    out += code < 0x20 || code === 0x7f
      ? `\\u${code.toString(16).toUpperCase().padStart(4, '0')}`
      : char
  }
  return out
}

function term (node) {
  if (node.termType === 'BlankNode') {
    throw new Error(
      `cannot canonicalise a graph containing a blank node (_:${node.value}). ` +
      'A signed profile must name everything it says, so that the same statement ' +
      'serialises the same way twice. Skolemise it as a fragment of the document IRI.'
    )
  }
  if (node.termType === 'NamedNode') return `<${escapeLiteral(node.value)}>`
  if (node.termType === 'Literal') {
    const text = `"${escapeLiteral(node.value)}"`
    if (node.language) return `${text}@${node.language.toLowerCase()}`
    const datatype = node.datatype?.value
    if (!datatype || datatype === XSD_STRING || datatype === RDF_LANG_STRING) return text
    return `${text}^^<${escapeLiteral(datatype)}>`
  }
  throw new Error(`cannot canonicalise a ${node.termType} term`)
}

/** Code point order, which UTF-16 string comparison is not above U+FFFF. */
function byCodePoint (a, b) {
  const left = [...a]
  const right = [...b]
  for (let i = 0; i < Math.min(left.length, right.length); i++) {
    const difference = left[i].codePointAt(0) - right[i].codePointAt(0)
    if (difference !== 0) return difference
  }
  return left.length - right.length
}

/**
 * The canonical form of a dataset, as N-Triples sorted in code point order.
 *
 * `omitSubjects` is a list of IRI strings whose statements are left out. A
 * caller passes the proof node when signing, and the provenance record when
 * taking the digest the provenance record is about.
 */
export function canonicalForm (dataset, { omitSubjects = [], onlySubject = null, omitPredicates = [] } = {}) {
  const omitted = new Set(omitSubjects)
  const lines = []
  for (const quad of dataset) {
    if (OMITTED_PREDICATES.includes(quad.predicate.value)) continue
    if (omitPredicates.includes(quad.predicate.value)) continue
    if (onlySubject !== null && quad.subject.value !== onlySubject) continue
    if (omitted.has(quad.subject.value)) continue
    lines.push(`${term(quad.subject)} ${term(quad.predicate)} ${term(quad.object)} .`)
  }
  if (lines.length === 0) {
    throw new Error('nothing to canonicalise: the graph is empty once the omissions are applied')
  }
  // Duplicate triples are one triple. A dataset is a set and a document may
  // state the same thing twice.
  return [...new Set(lines)].sort(byCodePoint).join('\n') + '\n'
}

/**
 * The nodes that carry a signature: each proof, and each key it names.
 *
 * Left out of everything that is signed. The proof node because a signature
 * cannot cover itself, and the key node because a second signer's key arriving
 * later must not invalidate the first signature.
 */
export function proofSubjects (dataset) {
  const { sec } = vocabulary
  const subjects = new Set()
  const proofs = [...dataset].filter(q => q.predicate.value === sec.proof).map(q => q.object.value)
  for (const proof of proofs) {
    subjects.add(proof)
    for (const quad of dataset) {
      if (quad.subject.value === proof && quad.predicate.value === sec.verificationMethod) {
        subjects.add(quad.object.value)
      }
    }
  }
  return [...subjects]
}

/**
 * The nodes that describe the bundle rather than the plugin.
 *
 * The flattened form carries its provenance in the same document as the
 * profile, so "the profile's graph" has to be a rule rather than a file. The
 * rule is the typed bundle node and the activity it names, found by following
 * named arcs, which is why the format gives both of them IRIs.
 */
export function bundleSubjects (dataset) {
  const { jig, prov, rdf } = vocabulary
  const subjects = new Set()
  for (const quad of dataset) {
    if (quad.predicate.value !== rdf.type || quad.object.value !== jig.Bundle) continue
    subjects.add(quad.subject.value)
    for (const other of dataset) {
      if (other.subject.value === quad.subject.value && other.predicate.value === prov.wasGeneratedBy) {
        subjects.add(other.object.value)
      }
    }
  }
  return [...subjects]
}

// ── The three forms the format is defined in terms of ──────────────────────

/**
 * The plugin alone. What jig:canonicalDigest is taken over.
 *
 * One value for the same plugin however it was delivered, which is what makes
 * it worth writing down and comparing. The provenance record is left out
 * because it is the thing that carries this value, and a digest cannot contain
 * itself.
 */
export const profileForm = dataset =>
  canonicalForm(dataset, { omitSubjects: [...bundleSubjects(dataset), ...proofSubjects(dataset)] })

/**
 * The plugin and the provenance record together. What a signature covers.
 *
 * The provenance is inside the signature on purpose. A record of who made a
 * bundle that anybody could rewrite without invalidating the signature would be
 * worse than none, because it would look checked.
 */
export const documentForm = dataset =>
  canonicalForm(dataset, { omitSubjects: proofSubjects(dataset) })

/**
 * One proof's own statements, minus the signature.
 *
 * Signed separately and hashed alongside the document, which is how
 * eddsa-rdfc-2022 covers a proof's own time and key without a signature having
 * to contain itself. Without it the created time and the verification method
 * would be decoration: anyone could rewrite them and the signature would still
 * verify.
 */
export const proofConfigForm = (dataset, proofIri) =>
  canonicalForm(dataset, { onlySubject: proofIri, omitPredicates: [vocabulary.sec.proofValue] })

/** Every proof node attached to a subject, in document order. */
export function proofsOf (dataset, subject) {
  return [...dataset]
    .filter(q => q.subject.value === subject && q.predicate.value === vocabulary.sec.proof)
    .map(q => q.object.value)
}
