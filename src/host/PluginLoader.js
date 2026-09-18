// src/host/PluginLoader.js
//
// Contract section 3.1, in order, aborting at the first failure.
//
// Every dependency is injected. That is not testing ceremony: it is what lets
// the same loader run against a real AudioContext in a browser and against
// fakes in a suite, so the ordering this file exists to enforce is actually
// exercised rather than asserted about.
import { readProfile } from '../rdf/ProfileReader.js'
import { verifyIntegrity } from './Integrity.js'
import { negotiate, explainMissing, detectCapabilities } from './Capabilities.js'
import { LoadError, STEPS } from './LoadError.js'
import { instantiate } from './Instantiate.js'

const PROFILE_ACCEPT = 'text/turtle, application/ld+json;q=0.9'

export class PluginLoader {
  #fetch
  #parse
  #validator
  #capabilities
  #validate
  #processorUrlFor

  /**
   * @param fetch       fetch implementation
   * @param parse       (text, baseIRI) => Promise<dataset>
   * @param validator   ShapeValidator, or null to skip shape validation
   * @param capabilities Set of capability IRIs this host offers
   * @param validate    bytes => boolean, a cheap check before posting
   */
  constructor ({
    // Bound, not taken by reference. A browser's fetch must be called with the
    // window as its receiver and throws "Illegal invocation" otherwise, while
    // node's does not care. So a detached reference passes every test here and
    // fails on the first real page load.
    fetch = (...args) => globalThis.fetch(...args),
    parse,
    validator = null,
    capabilities = detectCapabilities(),
    validate = bytes => WebAssembly.validate(bytes),
    processorUrl = null
  } = {}) {
    if (typeof fetch !== 'function') throw new Error('PluginLoader needs a fetch implementation')
    if (typeof parse !== 'function') throw new Error('PluginLoader needs a parse function')
    this.#fetch = fetch
    this.#parse = parse
    this.#validator = validator
    this.#capabilities = capabilities
    this.#validate = validate
    this.#processorUrlFor = processorUrl
  }

  /** Steps 1 to 3: fetch, parse, validate, and check capabilities. */
  async loadProfile (iri) {
    let response
    try {
      response = await this.#fetch(iri, { headers: { accept: PROFILE_ACCEPT } })
    } catch (cause) {
      // Report what actually happened, then the likely cause. Asserting the
      // cause outright was wrong: this message blamed a missing
      // Access-Control-Allow-Origin on a request that was same-origin, while
      // the real fault was a detached fetch throwing a TypeError, and the
      // message sent the reader to look at nginx.
      throw new LoadError(STEPS.fetchProfile,
        `could not fetch ${iri}: ${cause?.message ?? cause}. ` +
        'If the profile is on another origin, it must be served with Access-Control-Allow-Origin.',
        { cause, iri })
    }
    if (!response.ok) {
      throw new LoadError(STEPS.fetchProfile, `${iri} returned ${response.status}`, { iri })
    }

    const text = await response.text()

    let dataset
    try {
      // The syntax is determined by looking at the content, not by trusting the
      // media type: a .ttl served as text/plain is what most static hosts and
      // GitHub's raw view return. Contract section 1.2.
      dataset = await this.#parse(text, iri)
    } catch (cause) {
      throw new LoadError(STEPS.parseProfile, `${iri} is not parseable RDF: ${cause.message}`, { cause, iri })
    }

    if (this.#validator) {
      const report = await this.#validator.validate(dataset)
      if (!report.conforms) {
        const first = report.violations[0]
        throw new LoadError(STEPS.validateProfile,
          `${iri} is not a valid profile: ${first.message} (at ${first.focusNode}${first.path ? ` ${first.path}` : ''})`,
          { iri })
      }
    }

    let profile
    try {
      profile = readProfile(dataset, { baseIRI: iri })
    } catch (cause) {
      throw new LoadError(STEPS.parseProfile, cause.message, { cause, iri })
    }

    // Contract section 2.1: evaluated BEFORE any code is fetched.
    const negotiation = negotiate(profile, this.#capabilities)
    if (!negotiation.satisfied) {
      throw new LoadError(STEPS.capabilities, explainMissing(profile, negotiation.missing), { iri })
    }

    return { profile, granted: negotiation.granted }
  }

  /** Steps 4 and 5 for one resource: fetch it and verify its digest. */
  async fetchVerified (resource, { kind }) {
    if (!resource?.location) {
      throw new LoadError(STEPS.fetchResource, `the profile declares no location for its ${kind}`)
    }

    let response
    try {
      response = await this.#fetch(resource.location)
    } catch (cause) {
      throw new LoadError(STEPS.fetchResource,
        `could not fetch the ${kind} at ${resource.location}: ${cause?.message ?? cause}. ` +
        'If it is on another origin, it must be served with Access-Control-Allow-Origin.',
        { cause })
    }
    if (!response.ok) {
      throw new LoadError(STEPS.fetchResource, `the ${kind} at ${resource.location} returned ${response.status}`)
    }

    const bytes = new Uint8Array(await response.arrayBuffer())

    try {
      await verifyIntegrity(bytes, resource.integrity)
    } catch (cause) {
      // There is no continue-anyway path. Contract section 3.2.
      throw new LoadError(STEPS.integrity, `the ${kind} at ${resource.location} failed verification: ${cause.message}`, { cause })
    }

    return bytes
  }

  /**
   * Steps 4 to 8. Returns a connected-ready AudioWorkletNode.
   *
   * The node is NOT connected to anything here. Contract section 3.1 forbids
   * connecting before ready, and this returns after ready, so the caller
   * connects. Doing it here would take the decision away from the graph.
   *
   * The work lives in Instantiate.js, which knows nothing about RDF so that a
   * caller holding an already-resolved profile can use it without pulling a
   * Turtle parser into a browser bundle. This stays the front door.
   */
  instantiate (profile, granted, context, { AudioWorkletNode = globalThis.AudioWorkletNode } = {}) {
    return instantiate(profile, granted, context, {
      fetchVerified: (resource, options) => this.fetchVerified(resource, options),
      AudioWorkletNode,
      validate: this.#validate,
      processorUrl: this.#processorUrlFor
    })
  }
}

export { LoadError, STEPS }
