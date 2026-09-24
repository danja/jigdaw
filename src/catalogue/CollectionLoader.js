// src/catalogue/CollectionLoader.js
//
// Opening a plugin collection: docs/plugin-collections.md section 3.
//
// The collection document is fetched, parsed and validated, and refused whole
// if any of that fails. Then each member's profile is checked through the
// injected `verify`, which in a host is PluginLoader.loadProfile: contract
// section 3.1 steps 1 and 2, the profile and its capabilities, and nothing
// after. No module, processor or asset is fetched here. Those are fetched and
// verified when a person actually loads the plugin, which a host has to do then
// regardless, so fetching them now would download code nobody may use and
// prove nothing about the bytes that arrive later.
//
// Members are independent. One that fails is reported with the step and the
// reason, and the rest are unaffected.
import { readCollection } from '../rdf/CollectionReader.js'

const COLLECTION_ACCEPT = 'text/turtle'

export const COLLECTION_STEPS = Object.freeze({
  fetch: 'fetch-collection',
  parse: 'parse-collection',
  validate: 'validate-collection'
})

/** A failure of the collection document itself, as opposed to one member. */
export class CollectionError extends Error {
  constructor (step, message, { cause, url } = {}) {
    super(message, { cause })
    this.name = 'CollectionError'
    this.step = step
    this.url = url ?? null
  }
}

export class CollectionLoader {
  #fetch
  #parse
  #validator
  #verify
  #concurrency

  /**
   * @param fetch       fetch implementation
   * @param parse       (text, baseIRI) => Promise<dataset>
   * @param validator   ShapeValidator over vocabs/shapes.ttl
   * @param verify      iri => Promise<{ profile }>, throwing a LoadError
   * @param concurrency most member profiles fetched at once
   */
  constructor ({
    // Bound rather than taken by reference: see PluginLoader.
    fetch = (...args) => globalThis.fetch(...args),
    parse,
    validator,
    verify,
    concurrency = 6
  } = {}) {
    if (typeof parse !== 'function') throw new Error('CollectionLoader needs a parse function')
    if (!validator) throw new Error('CollectionLoader needs a shape validator')
    if (typeof verify !== 'function') throw new Error('CollectionLoader needs a verify function')
    if (!(Number.isInteger(concurrency) && concurrency > 0)) throw new Error(`concurrency must be a positive integer, not ${concurrency}`)
    this.#fetch = fetch
    this.#parse = parse
    this.#validator = validator
    this.#verify = verify
    this.#concurrency = concurrency
  }

  /** Section 3.1: the document, refused whole at the first failure. */
  async read (url) {
    let response
    try {
      response = await this.#fetch(url, { headers: { accept: COLLECTION_ACCEPT } })
    } catch (cause) {
      throw new CollectionError(COLLECTION_STEPS.fetch,
        `could not fetch ${url}: ${cause?.message ?? cause}. ` +
        'If the collection is on another origin, it must be served with Access-Control-Allow-Origin.',
        { cause, url })
    }
    if (!response.ok) throw new CollectionError(COLLECTION_STEPS.fetch, `${url} returned ${response.status}`, { url })

    let dataset
    try {
      // Resolved against the URL fetched, so a collection with no @base can
      // name plugins served beside it by relative reference.
      dataset = await this.#parse(await response.text(), url)
    } catch (cause) {
      throw new CollectionError(COLLECTION_STEPS.parse, `${url} is not parseable Turtle: ${cause.message}`, { cause, url })
    }

    const report = await this.#validator.validate(dataset)
    if (!report.conforms) {
      const v = report.violations[0]
      throw new CollectionError(COLLECTION_STEPS.validate,
        `${url} is not a valid collection: ${v.message} (at ${v.focusNode}${v.path ? ` ${v.path}` : ''})`, { url })
    }

    try {
      return { collection: readCollection(dataset), warnings: report.warnings }
    } catch (cause) {
      throw new CollectionError(COLLECTION_STEPS.validate, `${url}: ${cause.message}`, { cause, url })
    }
  }

  /** Section 3.2: one member, never throwing. */
  async check (member) {
    try {
      const { profile } = await this.#verify(member.iri)
      const notes = []
      // Section 3.3. The listed IRI is where the profile was fetched from and
      // the profile's own subject is the plugin's identity. They differ for a
      // mirror, which is legitimate, and for a plugin that has moved, which the
      // collection's author would want to know about.
      if (profile.iri !== member.iri) notes.push(`names itself ${profile.iri}`)
      if (member.label !== null && profile.label !== member.label) {
        notes.push(`listed as "${member.label}", named "${profile.label}" by its profile`)
      }
      return {
        iri: member.iri,
        listedLabel: member.label,
        ok: true,
        profile,
        notes
      }
    } catch (error) {
      return {
        iri: member.iri,
        listedLabel: member.label,
        ok: false,
        step: error.step ?? null,
        message: error.message
      }
    }
  }

  /**
   * Read the collection, then check every member, at most `concurrency` at a
   * time so a collection of hundreds does not open hundreds of requests.
   * Members come back in the collection's order, sorted by listed name.
   */
  async load (url) {
    const { collection, warnings } = await this.read(url)
    const results = new Array(collection.members.length)
    let next = 0
    const worker = async () => {
      while (next < collection.members.length) {
        const i = next++
        results[i] = await this.check(collection.members[i])
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.#concurrency, collection.members.length) }, worker))
    return { url, collection, warnings, members: results }
  }
}
