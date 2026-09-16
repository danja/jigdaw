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

export const STEPS = Object.freeze({
  fetchProfile: 'fetch-profile',
  parseProfile: 'parse-profile',
  validateProfile: 'validate-profile',
  capabilities: 'capabilities',
  fetchResource: 'fetch-resource',
  integrity: 'integrity',
  compileModule: 'compile-module',
  registerProcessor: 'register-processor',
  constructNode: 'construct-node',
  ready: 'ready'
})
