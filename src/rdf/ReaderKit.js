// src/rdf/ReaderKit.js
//
// What the readers of a project's documents share: a dataset indexed by subject and predicate, so a lookup costs one step and not a scan of every
// triple, and the small readers of a term (a number, a value, the id a fragment of the project gives). ProjectReader, and the editor and script
// readers beside it, are built from these.

// A dataset indexed by subject then predicate, built once per dataset. Looking a triple up by scanning the
// whole dataset made a read cost the number of lookups times the number of triples, which is a pause of a minute
// and a half for a piece with a thousand notes (MISTAKES.md). The index keeps the order the dataset had, so what
// is read, and the ids and order of the changes made from it, are what they were.
const indexes = new WeakMap()

export function indexOf (dataset) {
  let index = indexes.get(dataset)
  if (!index) {
    index = new Map()
    for (const quad of dataset) {
      let predicates = index.get(quad.subject.value)
      if (!predicates) index.set(quad.subject.value, predicates = new Map())
      const list = predicates.get(quad.predicate.value)
      if (list) list.push(quad.object)
      else predicates.set(quad.predicate.value, [quad.object])
    }
    indexes.set(dataset, index)
  }
  return index
}

/** Every object of subject/predicate, as terms, in the dataset's order. */
export function objects (dataset, subject, predicate) {
  return [...(indexOf(dataset).get(subject)?.get(predicate) ?? [])]
}

export const one = (dataset, subject, predicate) => objects(dataset, subject, predicate)[0] ?? null
export const value = term => (term ? term.value : null)

export function number (term, what) {
  if (!term) return null
  const n = Number(term.value)
  if (!Number.isFinite(n)) throw new Error(`${what} is not a number: ${term.value}`)
  return n
}

/** The fragment of an IRI under the project, which is the id the model uses. */
export function idOf (iri, projectIri, what) {
  if (!iri) throw new Error(`${what} is missing`)
  const hash = iri.indexOf('#')
  if (hash < 0 || !iri.startsWith(projectIri.split('#')[0])) {
    // Skolemised as a fragment of the project IRI is the format's rule, and an
    // id from somewhere else would not round trip.
    throw new Error(`${what} is not a fragment of the project: ${iri}`)
  }
  return iri.slice(hash + 1)
}
