// tests/host/PluginLoader.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import rdf from '@zazuko/env'
import ParserN3 from '@rdfjs/parser-n3'
import { PluginLoader, STEPS } from '../../src/host/PluginLoader.js'
import { shapeValidatorFromFile, validateFile } from '../../src/validate/files.js'
import { digestOf } from '../../src/host/Integrity.js'

const root = resolve(import.meta.dirname, '../..')
const parse = (text, baseIRI) =>
  rdf.dataset().import(new ParserN3({ factory: rdf, baseIRI }).import(Readable.from([text])))

const PROFILE_IRI = 'https://example.org/plugins/reference/'
const profileTurtle = readFileSync(resolve(root, 'examples/reference-profile.ttl'), 'utf8')

const bytesOf = s => new TextEncoder().encode(s)
const PROCESSOR_SOURCE = 'registerProcessor("reference", class {})'
const MODULE_BYTES = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00])

/** A fetch over an in-memory map, recording the order of requests. */
function fakeFetch (routes, log = []) {
  return async (url) => {
    log.push(url)
    const entry = routes[url]
    if (entry === undefined) throw new TypeError('Failed to fetch')
    if (typeof entry === 'number') return { ok: false, status: entry }
    return {
      ok: true,
      status: 200,
      text: async () => (typeof entry === 'string' ? entry : new TextDecoder().decode(entry)),
      arrayBuffer: async () => (typeof entry === 'string' ? bytesOf(entry) : entry).buffer
    }
  }
}

/** Digests recomputed so the fixtures stay self-consistent. */
async function realDigests (turtle) {
  return turtle
    .replace(/jig:integrity "sha384-[^"]+" \./g, () => 'PLACEHOLDER .')
}

describe('PluginLoader.loadProfile', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  const loaderFor = (routes, over = {}) =>
    new PluginLoader({ fetch: fakeFetch(routes), parse, validator, ...over })

  it('reads a valid profile and grants its capabilities', async () => {
    const { profile, granted } = await loaderFor({ [PROFILE_IRI]: profileTurtle }).loadProfile(PROFILE_IRI)
    expect(profile.label).toBe('Reference')
    expect(granted).toContain('http://purl.org/stuff/jigdaw/Persistence')
  })

  it('sends an Accept header asking for RDF', async () => {
    let seen = null
    const loader = new PluginLoader({
      fetch: async (url, init) => {
        seen = init?.headers?.accept
        return { ok: true, status: 200, text: async () => profileTurtle }
      },
      parse,
      validator
    })
    await loader.loadProfile(PROFILE_IRI)
    expect(seen).toContain('text/turtle')
  })

  it('blames the missing CORS header when a fetch fails at network level', async () => {
    // A cross-origin response without the header is unreadable, and this is by
    // far the most likely cause. Contract section 1.3.
    const error = await loaderFor({}).loadProfile(PROFILE_IRI).catch(e => e)
    expect(error.step).toBe(STEPS.fetchProfile)
    expect(error.message).toContain('Access-Control-Allow-Origin')
  })

  it('reports the status code on an HTTP error', async () => {
    const error = await loaderFor({ [PROFILE_IRI]: 404 }).loadProfile(PROFILE_IRI).catch(e => e)
    expect(error.step).toBe(STEPS.fetchProfile)
    expect(error.message).toContain('404')
  })

  it('reports unparseable RDF as a parse failure', async () => {
    const error = await loaderFor({ [PROFILE_IRI]: 'this is not turtle <<<' }).loadProfile(PROFILE_IRI).catch(e => e)
    expect(error.step).toBe(STEPS.parseProfile)
  })

  it('refuses a profile that does not validate, naming the constraint', async () => {
    const broken = readFileSync(resolve(root, 'examples/counterexample-profile.ttl'), 'utf8')
    const error = await loaderFor({ [PROFILE_IRI]: broken }).loadProfile(PROFILE_IRI).catch(e => e)
    expect(error.step).toBe(STEPS.validateProfile)
    expect(error.message).toMatch(/not a valid profile/)
  })

  it('refuses a document with no jig:WebPlugin', async () => {
    const project = readFileSync(resolve(root, 'examples/session-project.ttl'), 'utf8')
    const error = await loaderFor({ [PROFILE_IRI]: project }, { validator: null })
      .loadProfile(PROFILE_IRI).catch(e => e)
    expect(error.step).toBe(STEPS.parseProfile)
    expect(error.message).toMatch(/no jig:WebPlugin/)
  })

  it('refuses a plugin whose requirement the host cannot meet', async () => {
    const demanding = profileTurtle.replace(
      'trn:requires jig:Persistence ;',
      'trn:requires jig:Persistence, jig:SharedMemory ;')
    const error = await loaderFor({ [PROFILE_IRI]: demanding }).loadProfile(PROFILE_IRI).catch(e => e)
    expect(error.step).toBe(STEPS.capabilities)
    expect(error.message).toContain('jig:SharedMemory')
  })

  it('checks capabilities before fetching any code', async () => {
    // Contract section 2.1. The whole point: no download, no untrusted code run.
    const log = []
    const demanding = profileTurtle.replace(
      'trn:requires jig:Persistence ;',
      'trn:requires jig:Persistence, jig:SharedMemory ;')
    const loader = new PluginLoader({
      fetch: fakeFetch({ [PROFILE_IRI]: demanding }, log), parse, validator
    })
    await loader.loadProfile(PROFILE_IRI).catch(() => {})
    expect(log).toEqual([PROFILE_IRI])
  })
})

describe('PluginLoader.fetchVerified', () => {
  const processorUrl = `${PROFILE_IRI}reference-processor.js`

  it('returns bytes whose digest matches', async () => {
    const integrity = await digestOf(bytesOf(PROCESSOR_SOURCE))
    const loader = new PluginLoader({ fetch: fakeFetch({ [processorUrl]: PROCESSOR_SOURCE }), parse })
    const bytes = await loader.fetchVerified(
      { location: processorUrl, integrity }, { kind: 'processor' })
    expect(new TextDecoder().decode(bytes)).toBe(PROCESSOR_SOURCE)
  })

  it('refuses bytes that do not match, naming the resource', async () => {
    const wrongDigest = await digestOf(bytesOf('something else'))
    const loader = new PluginLoader({ fetch: fakeFetch({ [processorUrl]: PROCESSOR_SOURCE }), parse })
    const error = await loader
      .fetchVerified({ location: processorUrl, integrity: wrongDigest }, { kind: 'processor' })
      .catch(e => e)
    expect(error.step).toBe(STEPS.integrity)
    expect(error.message).toContain(processorUrl)
  })

  it('refuses a resource with no digest at all', async () => {
    const loader = new PluginLoader({ fetch: fakeFetch({ [processorUrl]: PROCESSOR_SOURCE }), parse })
    const error = await loader
      .fetchVerified({ location: processorUrl, integrity: null }, { kind: 'processor' })
      .catch(e => e)
    expect(error.step).toBe(STEPS.integrity)
  })
})

describe('PluginLoader.instantiate', () => {
  // Fakes standing in for the Web Audio API, which node does not have.
  class FakePort {
    constructor () { this.posted = []; this.onmessage = null }
    postMessage (m) {
      this.posted.push(m)
      if (m.type === 'init') queueMicrotask(() => this.onmessage?.({ data: this.reply ?? { type: 'ready', latencyFrames: 0 } }))
    }
  }
  class FakeNode {
    constructor (context, name, options) {
      FakeNode.last = this
      this.name = name; this.options = options; this.port = new FakePort()
      if (name === 'wrong') throw new Error(`Unknown processor "${name}"`)
    }
  }
  const fakeContext = (added = []) => ({
    sampleRate: 48000,
    audioWorklet: { addModule: async url => { added.push(url) } }
  })

  async function loadedProfile () {
    const loader = new PluginLoader({ fetch: fakeFetch({ [PROFILE_IRI]: profileTurtle }), parse })
    return loader.loadProfile(PROFILE_IRI)
  }

  async function routesFor () {
    return {
      [`${PROFILE_IRI}reference-processor.js`]: PROCESSOR_SOURCE,
      [`${PROFILE_IRI}reference.wasm`]: MODULE_BYTES
    }
  }

  function patchDigests (profile, processorIntegrity, moduleIntegrity) {
    return {
      ...profile,
      processor: { ...profile.processor, integrity: processorIntegrity },
      module: { ...profile.module, integrity: moduleIntegrity }
    }
  }

  it('constructs the node with the shape the profile declares, and awaits ready', async () => {
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES))
    const added = []
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse,
      compile: async () => ({ fakeModule: true })
    })

    const { node, ready, descriptors } = await loader.instantiate(
      patched, granted, fakeContext(added), { AudioWorkletNode: FakeNode })

    expect(node.name).toBe('reference')
    expect(node.options.numberOfInputs).toBe(1)
    expect(node.options.numberOfOutputs).toBe(1)
    expect(node.options.outputChannelCount).toEqual([2])
    expect(node.options.processorOptions.capabilities).toEqual(granted)
    expect(added).toHaveLength(1)
    expect(ready.latencyFrames).toBe(0)
    expect(descriptors.map(d => d.name)).toContain('mix')
  })

  it('posts the compiled module rather than the bytes', async () => {
    // Contract section 3.3. A WebAssembly.Module carries already compiled code,
    // so the processor instantiates synchronously and compilation never
    // touches the audio thread.
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES))
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, compile: async () => ({ fakeModule: true })
    })
    const { node } = await loader.instantiate(patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })
    const init = node.port.posted.find(m => m.type === 'init')
    expect(init.module).toEqual({ fakeModule: true })
    expect(init.sampleRate).toBe(48000)
  })

  it('reports a module that does not compile against the module, not the processor', async () => {
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES))
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse,
      compile: async () => { throw new Error('unexpected opcode') }
    })
    const error = await loader.instantiate(patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })
      .catch(e => e)
    expect(error.step).toBe(STEPS.compileModule)
    expect(error.message).toContain('reference.wasm')
  })

  it('explains a registered-name mismatch, which is otherwise cryptic', async () => {
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES))
    patched.processor = { ...patched.processor, registeredName: 'wrong' }
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, compile: async () => ({})
    })
    const error = await loader.instantiate(patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })
      .catch(e => e)
    expect(error.step).toBe(STEPS.constructNode)
    expect(error.message).toContain('may register a different name')
  })

  it('surfaces an error message from the processor instead of hanging', async () => {
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES))
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, compile: async () => ({})
    })
    class FailingNode extends FakeNode {
      constructor (...args) { super(...args); this.port.reply = { type: 'error', phase: 'instantiate', message: 'out of memory' } }
    }
    const error = await loader.instantiate(patched, granted, fakeContext(), { AudioWorkletNode: FailingNode })
      .catch(e => e)
    expect(error.step).toBe(STEPS.ready)
    expect(error.message).toContain('out of memory')
  })
})
