// src/rdf/ProfileReader.js
//
// Turns a parsed plugin profile into the plain object the host works with.
//
// The reader is deliberately total: it reports what a profile says and does not
// decide whether that is acceptable. Acceptability is vocabs/shapes.ttl's job,
// through ShapeValidator, and having one answer to "is this valid" matters more
// than catching a problem half a step earlier.
import rdf from '@zazuko/env'
import { vocabulary as v, JIG, TRN } from './Vocabulary.js'

const { jig, trn, lv2, rdfs, foaf, units, rdf: rdfTerms } = v

const iri = value => rdf.namedNode(value)

/** Objects of `subject predicate ?o`, as an array of terms. */
function objects (dataset, subject, predicate) {
  return [...dataset.match(subject, iri(predicate), null)].map(q => q.object)
}

function one (dataset, subject, predicate) {
  return objects(dataset, subject, predicate)[0] ?? null
}

const asString = term => (term ? term.value : null)

/** Absent means false, which is the correct reading rather than a fallback
 * masking one: jig:userReplaceable is a claim a profile makes about itself,
 * and a profile that says nothing has made no claim. A present-but-garbage
 * value is still an error, the same discipline asNumber holds resources to. */
function asBoolean (term) {
  if (!term) return false
  if (term.value === 'true' || term.value === '1') return true
  if (term.value === 'false' || term.value === '0') return false
  throw new Error(`not a boolean: ${term.value}`)
}

function asNumber (term) {
  if (!term) return null
  const n = Number(term.value)
  // A literal that is not a number is a defect in the profile, not a zero.
  // Returning 0 here would be an inline fallback producing indeterminate
  // behaviour, which AGENTS.md forbids.
  if (!Number.isFinite(n)) throw new Error(`not a number: ${term.value}`)
  return n
}

const values = (dataset, subject, predicate) =>
  objects(dataset, subject, predicate).map(t => t.value)

/** Resolve a possibly relative location against a base. */
export function resolveLocation (location, baseIRI) {
  return new URL(location, baseIRI).toString()
}

/**
 * Move a resource location from the profile's canonical base onto the place the
 * profile was actually fetched from.
 *
 * A profile states an explicit @base so that it means the same thing wherever
 * it is read, which makes `<cascade.wasm>` absolute against the canonical IRI
 * at parse time. But a host fetching from a mirror, a local checkout or a
 * staging host must fetch the module from where it got the profile, not from
 * the canonical origin, or nothing but the original site can serve a plugin.
 *
 * So identity stays canonical and retrieval follows the retrieval URL. Only a
 * location under the canonical base moves; one pointing at a CDN or another
 * origin is left exactly as written, because that is not a relative reference
 * and its author meant that host.
 */
export function rebaseLocation (location, canonical, retrieval) {
  if (!location || !canonical || !retrieval || canonical === retrieval) return location
  return location.startsWith(canonical)
    ? retrieval + location.slice(canonical.length)
    : location
}

function readResource (dataset, term, baseIRI, canonical) {
  if (!term) return null
  const location = one(dataset, term, jig.location)
  const resolved = location ? resolveLocation(location.value, baseIRI) : null
  return {
    iri: term.value,
    location: rebaseLocation(resolved, canonical, baseIRI),
    integrity: asString(one(dataset, term, jig.integrity)),
    mediaType: asString(one(dataset, term, jig.mediaType)),
    registeredName: asString(one(dataset, term, jig.registeredName)),
    wasmFeatures: values(dataset, term, jig.wasmFeature),
    userReplaceable: asBoolean(one(dataset, term, jig.userReplaceable))
  }
}

function readScalePoints (dataset, port) {
  return objects(dataset, port, lv2.scalePoint)
    .map(point => ({
      label: asString(one(dataset, point, rdfs.label)),
      value: asNumber(one(dataset, point, rdfTerms.value))
    }))
    .sort((a, b) => a.value - b.value)
}

/**
 * The control a port implies.
 *
 * Decided by the shape of the declaration and never by the profile naming a
 * widget, per contract section 5.3. A widget name would be a second source of
 * truth about a port the port already describes, and the two drift.
 */
export function widgetFor (port) {
  const twoScalePoints = port.scalePoints.length === 2
  if (port.toggled || (port.enumeration && twoScalePoints)) return 'switch'
  if (port.enumeration && port.scalePoints.length > 2) return 'selector'
  return 'dial'
}

function readPort (dataset, term) {
  const properties = values(dataset, term, lv2.portProperty)
  const port = {
    iri: term.value,
    symbol: asString(one(dataset, term, lv2.symbol)),
    name: asString(one(dataset, term, lv2.name)),
    defaultValue: asNumber(one(dataset, term, lv2.default)),
    minimum: asNumber(one(dataset, term, lv2.minimum)),
    maximum: asNumber(one(dataset, term, lv2.maximum)),
    unit: asString(one(dataset, term, units.unit)),
    toggled: properties.includes(lv2.toggled),
    enumeration: properties.includes(lv2.enumeration),
    scalePoints: readScalePoints(dataset, term),
    // k-rate is the default. An a-rate parameter costs a 128 element
    // Float32Array per quantum whether or not anything modulates it.
    automationRate: one(dataset, term, jig.automationRate)?.value === jig.ARate ? 'a-rate' : 'k-rate'
  }
  port.widget = widgetFor(port)
  return port
}

/**
 * Find the profile's subject: the one thing typed jig:WebPlugin.
 *
 * A document with several is ambiguous and is refused rather than guessed at,
 * because picking the first would make the answer depend on serialisation
 * order.
 */
export function findSubject (dataset) {
  const subjects = [...dataset.match(null, iri(rdfTerms.type), iri(jig.WebPlugin))]
    .map(q => q.subject)
  if (subjects.length === 0) {
    // A foreign plugin is a common enough case to name. Contract section 12.4
    // means a project never loads one on open, so this message is what a person
    // sees when a saved session refers to one, and "no jig:WebPlugin" would send
    // them looking for a defect in a profile that is correct.
    const foreign = [...dataset.match(null, iri(rdfTerms.type), iri(jig.ForeignPlugin))]
    if (foreign.length > 0) {
      throw new Error(
        'this is a foreign plugin (contract section 12). It runs with this page\'s privileges ' +
        'and is not loaded without being asked for, and never on opening a project.')
    }
    throw new Error('no jig:WebPlugin in this document. A profile that does not declare itself loadable is a valid catalogue entry, but it cannot be run here.')
  }
  if (subjects.length > 1) {
    throw new Error(`${subjects.length} jig:WebPlugin subjects in one document; expected one`)
  }
  return subjects[0]
}

/**
 * Which kind of plugin a document describes, without reading either.
 *
 * A host has to choose a loading path before it can read anything, and the two
 * paths are not interchangeable: contract section 12 makes the classes disjoint
 * precisely so this question always has one answer. 'neither' is an ordinary
 * catalogue entry, which is a valid thing to hold and not a loadable one.
 */
export function kindOf (dataset) {
  const has = type => [...dataset.match(null, iri(rdfTerms.type), iri(type))].length > 0
  const native = has(jig.WebPlugin)
  const foreign = has(jig.ForeignPlugin)
  if (native && foreign) {
    throw new Error(
      'this document declares both jig:WebPlugin and jig:ForeignPlugin. They are disjoint: ' +
      'a native plugin cannot reach the host document and a foreign one can, so a profile ' +
      'claiming both is claiming a guarantee it does not have. Contract section 12.2.')
  }
  return native ? 'native' : foreign ? 'foreign' : 'neither'
}

/**
 * Read a foreign plugin. Contract section 12.
 *
 * Deliberately a separate function from readProfile rather than a branch inside
 * it. The two describe different things: this one has no module, no processor
 * and no capabilities, because none of those are knowable about code the host
 * does not define the shape of.
 */
export function readForeignProfile (dataset, { baseIRI } = {}) {
  const subjects = [...dataset.match(null, iri(rdfTerms.type), iri(jig.ForeignPlugin))].map(q => q.subject)
  if (subjects.length === 0) throw new Error('no jig:ForeignPlugin in this document')
  if (subjects.length > 1) throw new Error(`${subjects.length} jig:ForeignPlugin subjects in one document; expected one`)
  const subject = subjects[0]
  const base = baseIRI ?? subject.value

  const containerTerm = one(dataset, subject, jig.container)
  if (!containerTerm) throw new Error(`${subject.value} declares no jig:container, so there is nothing to verify`)

  return {
    kind: 'foreign',
    iri: subject.value,
    label: asString(one(dataset, subject, rdfs.label)),
    comment: asString(one(dataset, subject, rdfs.comment)),
    vendor: asString(one(dataset, subject, trn.vendor)),
    homepage: asString(one(dataset, subject, foaf.homepage)),
    roles: values(dataset, subject, trn.role),
    accepts: values(dataset, subject, trn.accepts),
    produces: values(dataset, subject, trn.produces),
    genres: values(dataset, subject, trn.genre),
    cautions: values(dataset, subject, trn.caution),

    foreignFormat: one(dataset, subject, jig.foreignFormat)?.value ?? null,
    entryPoint: asString(one(dataset, subject, jig.entryPoint)),
    container: {
      iri: containerTerm.value,
      location: resolveLocation(one(dataset, containerTerm, jig.location)?.value, base),
      mediaType: asString(one(dataset, containerTerm, jig.mediaType)),
      integrity: asString(one(dataset, containerTerm, jig.integrity))
    },

    // Declared ports let a catalogue show the plugin before anything is
    // fetched. What the host actually draws comes from the adapter at run time,
    // because the plugin is the authority on its own parameters and these are
    // a description of it written by whoever wrote the profile.
    ports: objects(dataset, subject, lv2.port).map(term => readPort(dataset, term))
  }
}

/**
 * Read a profile from a dataset.
 *
 * `baseIRI` is what relative locations resolve against, and defaults to the
 * subject. Passing it explicitly matters when a profile is served somewhere
 * other than its subject IRI.
 */
export function readProfile (dataset, { baseIRI } = {}) {
  const subject = findSubject(dataset)
  const base = baseIRI ?? subject.value

  const capabilities = values(dataset, subject, trn.requires)

  return {
    iri: subject.value,
    label: asString(one(dataset, subject, rdfs.label)),
    comment: asString(one(dataset, subject, rdfs.comment)),
    vendor: asString(one(dataset, subject, trn.vendor)),
    homepage: asString(one(dataset, subject, foaf.homepage)),

    roles: values(dataset, subject, trn.role),
    accepts: values(dataset, subject, trn.accepts),
    produces: values(dataset, subject, trn.produces),
    formats: values(dataset, subject, trn.format),
    genres: values(dataset, subject, trn.genre),
    cautions: values(dataset, subject, trn.caution),
    recommendedBefore: values(dataset, subject, trn.recommendedBefore),
    recommendedAfter: values(dataset, subject, trn.recommendedAfter),

    requires: capabilities,
    prefers: values(dataset, subject, jig.prefers),

    audioInputs: asNumber(one(dataset, subject, jig.audioInputs)) ?? 0,
    audioOutputs: asNumber(one(dataset, subject, jig.audioOutputs)) ?? 0,
    inputChannels: asNumber(one(dataset, subject, jig.inputChannels)) ?? 2,
    outputChannels: asNumber(one(dataset, subject, jig.outputChannels)) ?? 2,
    renderQuantum: asNumber(one(dataset, subject, jig.renderQuantum)),
    latencyFrames: asNumber(one(dataset, subject, jig.latencyFrames)) ?? 0,
    tailFrames: asNumber(one(dataset, subject, jig.tailFrames)),

    module: readResource(dataset, one(dataset, subject, jig.module), base, subject.value),
    processor: readResource(dataset, one(dataset, subject, jig.processor), base, subject.value),
    ui: readResource(dataset, one(dataset, subject, jig.ui), base, subject.value),
    assets: objects(dataset, subject, jig.asset).map(t => readResource(dataset, t, base, subject.value)),

    ports: objects(dataset, subject, lv2.port)
      .map(t => readPort(dataset, t))
      .sort((a, b) => (a.symbol ?? '').localeCompare(b.symbol ?? ''))
  }
}

export { JIG, TRN }
