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

  it('calls fetch with a receiver, as a browser requires', async () => {
    // A browser's fetch throws "Illegal invocation" when called detached from
    // the window; node's does not care. A default of `fetch = globalThis.fetch`
    // therefore passes every test here and fails on the first real page load,
    // which is exactly what it did.
    const real = globalThis.fetch
    let calledWithReceiver = false
    globalThis.fetch = function (...args) {
      if (this !== globalThis && this !== undefined) throw new TypeError('Illegal invocation')
      // Mimic a browser: refuse a detached call.
      if (this === undefined) throw new TypeError('Illegal invocation')
      calledWithReceiver = true
      return Promise.resolve({ ok: true, status: 200, text: async () => profileTurtle })
    }
    try {
      const loader = new PluginLoader({ parse, validator })
      await loader.loadProfile(PROFILE_IRI)
      expect(calledWithReceiver).toBe(true)
    } finally {
      globalThis.fetch = real
    }
  })

  it('reports what actually went wrong, not a guess at the cause', async () => {
    // A cross-origin response without the header is unreadable, and this is by
    // far the most likely cause. Contract section 1.3.
    const error = await loaderFor({}).loadProfile(PROFILE_IRI).catch(e => e)
    expect(error.step).toBe(STEPS.fetchProfile)
    // The underlying failure, verbatim. Asserting a cause outright sent a
    // reader to look at nginx for a bug that was in this file.
    expect(error.message).toContain('Failed to fetch')
    expect(error.message).toContain('another origin')
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

  // The reference profile's <#plate-ir> asset is illustrative: nothing on
  // disk ever served plate.wav before instantiate() started fetching every
  // declared asset, and its jig:integrity is a placeholder rather than the
  // digest of any real bytes. These are real, servable bytes and the digest
  // patched to match them, the same reasoning patchDigests already applies
  // to the processor and the module below.
  const ASSET_BYTES = new TextEncoder().encode('fake-impulse-response')

  async function routesFor () {
    return {
      [`${PROFILE_IRI}reference-processor.js`]: PROCESSOR_SOURCE,
      [`${PROFILE_IRI}reference.wasm`]: MODULE_BYTES,
      [`${PROFILE_IRI}plate.wav`]: ASSET_BYTES
    }
  }

  function patchDigests (profile, processorIntegrity, moduleIntegrity, assetIntegrity) {
    return {
      ...profile,
      processor: { ...profile.processor, integrity: processorIntegrity },
      module: { ...profile.module, integrity: moduleIntegrity },
      assets: profile.assets.map(asset => ({ ...asset, integrity: assetIntegrity ?? asset.integrity }))
    }
  }

  it('gives a plugin with no audio ports an input, so the graph renders it', async () => {
    // Web Audio pulls from the destination. A node with no outputs and no
    // inputs is attached to nothing and its process() is never called, so a
    // MIDI generator declaring jig:audioOutputs 0 would simply never run. It is
    // given one input for the host to feed silence into.
    const { profile, granted } = await loadedProfile()
    const patched = {
      ...patchDigests(profile,
        await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES), await digestOf(ASSET_BYTES)),
      audioInputs: 0,
      audioOutputs: 0
    }
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, validate: () => true
    })

    const { node } = await loader.instantiate(
      patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })

    expect(node.options.numberOfOutputs).toBe(0)
    expect(node.options.numberOfInputs).toBe(1)
    expect(node.options.outputChannelCount).toBeUndefined()
    // The engine looks for this to decide whether to attach a driver.
    expect(node.jigdawNeedsDriving).toBe(true)
  })

  it('leaves a plugin that has audio ports alone', async () => {
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES), await digestOf(ASSET_BYTES))
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, validate: () => true
    })
    const { node } = await loader.instantiate(
      patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })
    expect(node.jigdawNeedsDriving).toBeUndefined()
  })

  it('constructs the node with the shape the profile declares, and awaits ready', async () => {
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES), await digestOf(ASSET_BYTES))
    const added = []
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse,
      validate: () => true
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

  it('posts bytes, never a compiled module', async () => {
    // Contract section 3.3. A WebAssembly.Module posted to an AudioWorklet is
    // silently never delivered, so the load times out naming nothing useful.
    // Measured in Chrome on 2026-09-17.
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES), await digestOf(ASSET_BYTES))
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, validate: () => true
    })
    const { node } = await loader.instantiate(patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })
    const init = node.port.posted.find(m => m.type === 'init')
    expect(init.module).toBeInstanceOf(ArrayBuffer)
    expect(init.module.byteLength).toBe(MODULE_BYTES.length)
    expect(init.sampleRate).toBe(48000)
  })

  it('fetches, verifies and delivers every declared asset, keyed by its fragment', async () => {
    // jig:asset was declared and read into profile.assets for a while before
    // anything actually forwarded the bytes to a running plugin. This is that
    // delivery: fetched and integrity-checked the same as the module and the
    // processor (section 3.2, no skip path), and posted alongside the module
    // bytes rather than left for a processor with no fetch of its own to go
    // and get somehow.
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES), await digestOf(ASSET_BYTES))
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, validate: () => true
    })
    const { node } = await loader.instantiate(patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })
    const init = node.port.posted.find(m => m.type === 'init')
    expect(init.assets['plate-ir']).toBeInstanceOf(ArrayBuffer)
    expect(new Uint8Array(init.assets['plate-ir'])).toEqual(ASSET_BYTES)
  })

  it('refuses an asset that fails integrity, the same as the module or the processor', async () => {
    const { profile, granted } = await loadedProfile()
    // Deliberately NOT patched: the profile's placeholder digest for
    // <#plate-ir> will not match the real bytes routesFor() serves.
    const patched = {
      ...profile,
      processor: { ...profile.processor, integrity: await digestOf(bytesOf(PROCESSOR_SOURCE)) },
      module: { ...profile.module, integrity: await digestOf(MODULE_BYTES) }
    }
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, validate: () => true
    })
    const error = await loader.instantiate(patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })
      .catch(e => e)
    expect(error.step).toBe(STEPS.integrity)
    expect(error.message).toContain('plate.wav')
  })

  it('reports invalid WebAssembly against the module, not the processor', async () => {
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES), await digestOf(ASSET_BYTES))
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse,
      validate: () => false
    })
    const error = await loader.instantiate(patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })
      .catch(e => e)
    expect(error.step).toBe(STEPS.compileModule)
    expect(error.message).toContain('reference.wasm')
  })

  it('explains a registered-name mismatch, which is otherwise cryptic', async () => {
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES), await digestOf(ASSET_BYTES))
    patched.processor = { ...patched.processor, registeredName: 'wrong' }
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, validate: () => true
    })
    const error = await loader.instantiate(patched, granted, fakeContext(), { AudioWorkletNode: FakeNode })
      .catch(e => e)
    expect(error.step).toBe(STEPS.constructNode)
    expect(error.message).toContain('may register a different name')
  })

  it('surfaces an error message from the processor instead of hanging', async () => {
    const { profile, granted } = await loadedProfile()
    const patched = patchDigests(profile,
      await digestOf(bytesOf(PROCESSOR_SOURCE)), await digestOf(MODULE_BYTES), await digestOf(ASSET_BYTES))
    const loader = new PluginLoader({
      fetch: fakeFetch(await routesFor()), parse, validate: () => true
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
