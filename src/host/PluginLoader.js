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
import { parameterDescriptors } from './Parameters.js'
import { LoadError, STEPS } from './LoadError.js'

const PROFILE_ACCEPT = 'text/turtle, application/ld+json;q=0.9'

export class PluginLoader {
  #fetch
  #parse
  #validator
  #capabilities
  #compile
  #processorUrlFor

  /**
   * @param fetch       fetch implementation
   * @param parse       (text, baseIRI) => Promise<dataset>
   * @param validator   ShapeValidator, or null to skip shape validation
   * @param capabilities Set of capability IRIs this host offers
   * @param compile     bytes => Promise<WebAssembly.Module>
   */
  constructor ({
    fetch = globalThis.fetch,
    parse,
    validator = null,
    capabilities = detectCapabilities(),
    compile = bytes => WebAssembly.compile(bytes),
    processorUrl = null
  } = {}) {
    if (typeof fetch !== 'function') throw new Error('PluginLoader needs a fetch implementation')
    if (typeof parse !== 'function') throw new Error('PluginLoader needs a parse function')
    this.#fetch = fetch
    this.#parse = parse
    this.#validator = validator
    this.#capabilities = capabilities
    this.#compile = compile
    this.#processorUrlFor = processorUrl
  }

  /** Steps 1 to 3: fetch, parse, validate, and check capabilities. */
  async loadProfile (iri) {
    let response
    try {
      response = await this.#fetch(iri, { headers: { accept: PROFILE_ACCEPT } })
    } catch (cause) {
      // A network-level failure on a cross-origin request is what a missing
      // Access-Control-Allow-Origin looks like from JavaScript: the response is
      // unreadable rather than merely untrusted. Say so, because it is by far
      // the most likely cause and the fix is a header.
      throw new LoadError(STEPS.fetchProfile,
        `could not fetch ${iri}. A cross-origin profile must be served with Access-Control-Allow-Origin.`,
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
        `could not fetch the ${kind} at ${resource.location}. A cross-origin resource must be served with Access-Control-Allow-Origin.`,
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
   */
  async instantiate (profile, granted, context, { AudioWorkletNode = globalThis.AudioWorkletNode } = {}) {
    const processorBytes = await this.fetchVerified(profile.processor, { kind: 'processor' })

    let compiledModule = null
    if (profile.module) {
      const moduleBytes = await this.fetchVerified(profile.module, { kind: 'module' })
      try {
        // Compiled on this thread. A WebAssembly.Module is structured
        // cloneable and carries the already compiled code, so the processor
        // instantiates synchronously and never awaits. Contract section 3.3.
        compiledModule = await this.#compile(moduleBytes)
      } catch (cause) {
        throw new LoadError(STEPS.compileModule,
          `the WebAssembly module at ${profile.module.location} did not compile: ${cause.message}`,
          { cause })
      }
    }

    const processorUrl = await this.#processorUrl(processorBytes, profile.processor.location)
    try {
      await context.audioWorklet.addModule(processorUrl)
    } catch (cause) {
      throw new LoadError(STEPS.registerProcessor,
        `the processor at ${profile.processor.location} failed to register: ${cause.message}`,
        { cause })
    }

    const name = profile.processor.registeredName
    if (!name) {
      throw new LoadError(STEPS.constructNode,
        'the profile declares no jig:registeredName, and a worklet cannot be asked what it registered')
    }

    let node
    try {
      node = new AudioWorkletNode(context, name, {
        numberOfInputs: profile.audioInputs,
        numberOfOutputs: profile.audioOutputs,
        outputChannelCount: profile.audioOutputs > 0
          ? Array(profile.audioOutputs).fill(profile.outputChannels)
          : undefined,
        parameterData: {},
        processorOptions: {
          capabilities: granted,
          sampleRate: context.sampleRate,
          quantum: profile.renderQuantum ?? 128
        }
      })
    } catch (cause) {
      throw new LoadError(STEPS.constructNode,
        `could not construct "${name}": ${cause.message}. The processor module may register a different name.`,
        { cause })
    }

    const ready = await this.#init(node, compiledModule, granted, context, profile)

    // Derived here so a descriptor mismatch is reported against the profile
    // rather than surfacing later as a missing AudioParam.
    const descriptors = parameterDescriptors(profile.ports)

    return { node, ready, descriptors }
  }

  /** Post init and await ready. Contract section 3.1 step 7. */
  #init (node, compiledModule, granted, context, profile) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        node.port.onmessage = null
        reject(new LoadError(STEPS.ready,
          `"${profile.processor.registeredName}" did not report ready. A processor must post { type: "ready" } once its buffers exist.`))
      }, 10000)

      node.port.onmessage = event => {
        const message = event.data
        if (message?.type === 'ready') {
          clearTimeout(timeout)
          node.port.onmessage = null
          resolve({ latencyFrames: message.latencyFrames ?? 0, tailFrames: message.tailFrames ?? null })
        } else if (message?.type === 'error') {
          clearTimeout(timeout)
          node.port.onmessage = null
          reject(new LoadError(STEPS.ready, `${message.phase ?? 'instantiate'}: ${message.message}`))
        }
      }

      node.port.postMessage({
        type: 'init',
        module: compiledModule,
        capabilities: granted,
        sampleRate: context.sampleRate,
        quantum: profile.renderQuantum ?? 128
      })
    })
  }

  /**
   * A URL addModule can load, with the verified bytes rather than a second
   * fetch.
   *
   * Contract section 3.2: where the browser does not support the integrity
   * option on addModule, the host fetches and verifies itself and hands over a
   * blob URL. Re-fetching by URL would verify one response and execute another.
   */
  async #processorUrl (bytes, originalUrl) {
    // Injectable because a host without Blob URLs, such as an offline test
    // harness, still has to give addModule something it can load. Overriding
    // it does not skip verification: the bytes handed here are the verified
    // ones either way.
    if (this.#processorUrlFor) return this.#processorUrlFor(bytes, originalUrl)
    if (typeof Blob === 'undefined' || typeof URL.createObjectURL !== 'function') {
      return originalUrl
    }
    return URL.createObjectURL(new Blob([bytes], { type: 'text/javascript' }))
  }
}

export { LoadError, STEPS }
