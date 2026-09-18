// src/host/ForeignSupport.js
//
// The foreign plugin side of a host, as one object the dispatcher can hold.
// Contract section 12.
//
// Optional by construction: a dispatcher built without one refuses every
// foreign plugin, which section 12 says is a conforming host and the safe
// default. Nothing here is reachable unless a host deliberately builds it.
//
// It owns the consent record, because consent outlives any single load and has
// to be the same record the surface writes to when a person says yes.
import { parseText } from '../rdf/parse.js'
import { kindOf, readForeignProfile } from '../rdf/ProfileReader.js'
import { ForeignTrust } from './ForeignTrust.js'
import { loadForeignPlugin } from './ForeignPlugin.js'
import { LoadError, STEPS } from './LoadError.js'

const PROFILE_ACCEPT = 'text/turtle, application/ld+json;q=0.9, */*;q=0.1'

export class ForeignSupport {
  #fetch
  #validator
  #origin

  constructor ({
    fetch = (...args) => globalThis.fetch(...args),
    validator = null,
    trust = new ForeignTrust(),
    origin = null
  } = {}) {
    this.#fetch = fetch
    this.#validator = validator
    this.#origin = origin
    this.trust = trust
  }

  /**
   * Fetch a profile and say which kind it is, without loading anything.
   *
   * A surface uses this to decide whether it is about to ask a person a
   * question, before it asks.
   */
  async classify (iri) {
    const response = await this.#fetch(iri, { headers: { accept: PROFILE_ACCEPT } })
    if (!response.ok) {
      throw new LoadError(STEPS.fetchProfile, `${iri} returned ${response.status}`)
    }
    const dataset = await parseText(await response.text(), iri)
    return { kind: kindOf(dataset), dataset }
  }

  /** The profile of a foreign plugin, validated, without running anything. */
  async profileOf (iri) {
    const { kind, dataset } = await this.classify(iri)
    if (kind !== 'foreign') {
      throw new LoadError(STEPS.parseProfile, `${iri} is not a foreign plugin`)
    }
    if (this.#validator) {
      const report = await this.#validator.validate(dataset)
      if (!report.conforms) {
        const seen = report.violations.map(v => `${v.focusNode} ${v.path ?? '(node)'}`)
        throw new LoadError(STEPS.validateProfile,
          `${iri} does not validate:\n  - ${seen.join('\n  - ')}`)
      }
    }
    return readForeignProfile(dataset, { baseIRI: iri })
  }

  /**
   * Everything the engine needs to adopt one.
   *
   * Throws ConsentRequired when this container has not been agreed to, which
   * the dispatcher turns into a result a surface can act on.
   */
  async add (iri, context) {
    const profile = await this.profileOf(iri)
    return loadForeignPlugin(profile, context, {
      trust: this.trust,
      origin: this.#origin,
      fetch: this.#fetch
    })
  }
}
