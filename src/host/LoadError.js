// src/host/LoadError.js

/**
 * A failure at a named step of contract section 3.1.
 *
 * The step matters. Contract section 10.1 requires a failure to name what
 * failed and what would fix it, and an agent or a person gets "no CORS header
 * on the processor" rather than "could not load" only if the step survives to
 * the message.
 */
export class LoadError extends Error {
  constructor (step, message, { cause, iri } = {}) {
    super(message, { cause })
    this.name = 'LoadError'
    this.step = step
    this.iri = iri ?? null
  }

  toString () {
    return `${this.name} [${this.step}]: ${this.message}`
  }
}

/**
 * Thrown by PluginLoader.loadProfile for a composite plugin, carrying the fetched document so the
 * caller that goes on to resolve the tree does not fetch it again. A subclass because it is not a failure
 * of a plugin that cannot load: it is the answer to "what kind of thing is at this IRI".
 */
export class CompositeFound extends LoadError {
  constructor (iri, dataset) {
    super('composite', `${iri} is a composite plugin, which is resolved as a tree and not read as one plugin`, { iri })
    this.name = 'CompositeFound'
    this.dataset = dataset
  }
}

export const STEPS = Object.freeze({
  fetchProfile: 'fetch-profile',
  parseProfile: 'parse-profile',
  validateProfile: 'validate-profile',
  capabilities: 'capabilities',
  composite: 'composite',
  fetchResource: 'fetch-resource',
  integrity: 'integrity',
  compileModule: 'compile-module',
  registerProcessor: 'register-processor',
  constructNode: 'construct-node',
  ready: 'ready'
})
