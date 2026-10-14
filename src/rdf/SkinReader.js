// src/rdf/SkinReader.js
//
// Reads a skin document (docs/svg-skins.md) into a plain object, and checks the
// rules that span files, which vocabs/shapes.ttl cannot say: the artwork and
// the profile are separate documents, and nothing else connects a binding to
// either.
//
// Reading is total: it reports what the document says. checkSkin is separate,
// and returns what to leave out and why instead of throwing, because a control
// nobody can use is left out rather than drawn dead, and the others still work.
import rdf from '@zazuko/env'
import { vocabulary as v } from './Vocabulary.js'

const { jig, rdf: rdfTerms } = v

const KINDS = new Map([
  [jig.RotaryControl, 'rotary'],
  [jig.LinearControl, 'linear'],
  [jig.ToggleControl, 'toggle'],
  [jig.SelectorControl, 'selector'],
  [jig.ReadoutControl, 'readout']
])

const iri = value => rdf.namedNode(value)
const objects = (dataset, subject, predicate) =>
  [...dataset.match(typeof subject === 'string' ? iri(subject) : subject, iri(predicate), null)].map(q => q.object)
const first = (dataset, subject, predicate) => objects(dataset, subject, predicate)[0]?.value ?? null
const number = value => (value === null ? null : Number(value))

/**
 * @param {import('@rdfjs/types').DatasetCore} dataset the parsed skin document
 * @returns {{ iri, artwork: { iri, location, integrity, mediaType } | null, controls: object[] }}
 *   controls: { id, kind, boundSymbol, element, hitElement, pivotElement, trackElement, angleMin, angleMax },
 *   sorted by id since a skin states no order
 */
export function readSkin (dataset) {
  // The document's own subject is found rather than passed in: a skin carried as a data: URI (a flattened
  // bundle) is still about the IRI its @base gives it, and a caller that guessed from the location would not find it.
  const subjects = [...new Set([...dataset.match(null, iri(jig.artwork), null)].map(q => q.subject.value))]
  if (subjects.length > 1) throw new Error(`a skin document describes one skin; this one has jig:artwork on ${subjects.join(', ')}`)
  const documentIri = subjects[0] ?? null
  if (documentIri === null) return { iri: null, artwork: null, controls: [] }
  const doc = iri(documentIri)
  const art = objects(dataset, doc, jig.artwork)[0] ?? null

  const controls = objects(dataset, doc, jig.control).map(node => {
    const kinds = objects(dataset, node, rdfTerms.type).map(t => KINDS.get(t.value)).filter(Boolean)
    return {
      id: node.value,
      kind: kinds[0] ?? null,
      boundSymbol: first(dataset, node, jig.boundSymbol),
      element: first(dataset, node, jig.element),
      hitElement: first(dataset, node, jig.hitElement),
      pivotElement: first(dataset, node, jig.pivotElement),
      trackElement: first(dataset, node, jig.trackElement),
      angleMin: number(first(dataset, node, jig.angleMin)),
      angleMax: number(first(dataset, node, jig.angleMax))
    }
  }).sort((a, b) => a.id.localeCompare(b.id))

  return {
    iri: documentIri,
    artwork: art === null ? null : {
      iri: art.value,
      location: first(dataset, art, jig.location),
      integrity: first(dataset, art, jig.integrity),
      mediaType: first(dataset, art, jig.mediaType)
    },
    controls
  }
}

// How many positions a port has, for a control that shows one child group per position.
function stepsOf (port) {
  if (port.toggled) return 2
  if (port.scalePoints.length > 0) return port.scalePoints.length
  const span = port.maximum - port.minimum
  return Number.isInteger(span) ? span + 1 : null
}

/**
 * @param {{ controls: object[] }} skin from readSkin
 * @param {{ ids: Map<string, number> }} artwork from buildArtwork: each element id and its child element count
 * @param {{ symbol, toggled, scalePoints, minimum, maximum }[]} ports the plugin's ports, from readPort
 * @returns {{ keep: object[], omitted: { control: string, reason: string }[], unbound: string[] }}
 *   keep: the controls that can be drawn, in the skin's order
 *   omitted: the others, each with the reason to report
 *   unbound: symbols of ports no kept control sets (a readout does not set one); the host draws these as a generated group
 */
export function checkSkin (skin, artwork, ports) {
  const bySymbol = new Map(ports.map(p => [p.symbol, p]))
  const omitted = []
  const keep = []
  const bound = new Set()

  for (const control of skin.controls) {
    const refuse = reason => omitted.push({ control: control.id, reason })
    const port = bySymbol.get(control.boundSymbol)

    if (control.kind === null) { refuse('it has no control class'); continue }
    if (!port) { refuse(`the plugin declares no port "${control.boundSymbol}"`); continue }
    // A readout only shows a value, so it may sit beside the one control that sets the port.
    const sets = control.kind !== 'readout'
    if (sets && bound.has(control.boundSymbol)) { refuse(`port "${control.boundSymbol}" is already bound by an earlier control`); continue }

    const named = [['jig:element', control.element], ['jig:hitElement', control.hitElement],
      ['jig:pivotElement', control.pivotElement], ['jig:trackElement', control.trackElement]]
    const missing = named.filter(([, id]) => id !== null && !artwork.ids.has(id)).map(([term, id]) => `${term} "${id}"`)
    if (control.element === null) missing.push('jig:element (none given)')
    if (missing.length) { refuse(`the artwork has no element for ${missing.join(', ')}`); continue }

    if (control.kind === 'toggle') {
      const children = artwork.ids.get(control.element)
      if (children !== 2) { refuse(`a toggle needs 2 child groups and "${control.element}" has ${children}`); continue }
    }
    if (control.kind === 'selector') {
      const steps = stepsOf(port)
      const children = artwork.ids.get(control.element)
      if (steps === null) { refuse(`port "${port.symbol}" has no whole number of steps to choose between`); continue }
      if (children !== steps) { refuse(`a selector for "${port.symbol}" needs ${steps} child groups and "${control.element}" has ${children}`); continue }
    }

    if (sets) bound.add(control.boundSymbol)
    keep.push(control)
  }

  return { keep, omitted, unbound: ports.map(p => p.symbol).filter(s => !bound.has(s)) }
}
