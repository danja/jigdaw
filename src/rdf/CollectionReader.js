// src/rdf/CollectionReader.js
//
// Turns a parsed plugin collection into the plain object a host works with.
// docs/plugin-collections.md.
//
// Total in the same sense as ProfileReader: it reports what the document says,
// and whether that is acceptable is vocabs/shapes.ttl's question. The one thing
// it refuses is a document with no collection or with several, because then
// there is no single answer to "which collection is this" for it to report.
import rdf from '@zazuko/env'
import { vocabulary as v } from './Vocabulary.js'

const { jig, rdfs, dcterms, rdf: rdfTerms } = v

const iri = value => rdf.namedNode(value)
const first = (dataset, subject, predicate) =>
  [...dataset.match(subject, iri(predicate), null)][0]?.object.value ?? null

/**
 * @returns {{ iri, label, comment, members: Array<{ iri, label }> }}
 *   members sorted by label, since a collection states no order
 */
export function readCollection (dataset) {
  const subjects = [...dataset.match(null, iri(rdfTerms.type), iri(jig.PluginCollection))]
    .map(q => q.subject)
  if (subjects.length === 0) throw new Error('the document declares no jig:PluginCollection')
  if (subjects.length > 1) {
    throw new Error(`the document declares ${subjects.length} collections (${subjects.map(s => s.value).join(', ')}); a collection document holds one`)
  }
  const subject = subjects[0]

  const members = [...dataset.match(subject, iri(dcterms.hasPart), null)]
    .map(q => ({ iri: q.object.value, label: first(dataset, q.object, rdfs.label) }))
    .sort((a, b) => (a.label ?? a.iri).localeCompare(b.label ?? b.iri))

  return {
    iri: subject.value,
    label: first(dataset, subject, rdfs.label),
    comment: first(dataset, subject, rdfs.comment),
    members
  }
}
