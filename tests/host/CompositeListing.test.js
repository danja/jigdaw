// tests/host/CompositeListing.test.js
//
// What a listing and a script need from a composite plugin, with the real loader over the real plugins: its own profile and
// capabilities with no code fetched (a collection), and every member's files verified when a script is about to run (Reel).
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { createPluginValidator } from '../../src/reel/Host.js'
import { LoadError, STEPS } from '../../src/host/LoadError.js'
import { parseText } from '../../src/rdf/parse.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { sitePlugins } from '../../src/testing/OfflineHost.js'
import { pinnedRack, servingAt, RACK_IRI } from '../../src/testing/CompositeFixtures.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'https://strandz.it/jigdaw/'

describe('a composite plugin as a listing and as a script sees it', () => {
  let validator
  let rack
  beforeAll(async () => {
    validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    rack = await pinnedRack(root)
  })

  function loaderFor (text = rack, { capabilities = new Set() } = {}) {
    const requests = []
    const site = sitePlugins(ORIGIN, resolve(root, 'plugins'))
    const base = servingAt(RACK_IRI, text, site.fetch)
    const fetch = async (url, ...rest) => { requests.push(url); return base(url, ...rest) }
    return { requests, loader: new PluginLoader({ fetch, parse: parseText, validator, capabilities, processorUrl: site.processorUrl }) }
  }

  describe('loadListing', () => {
    it('reads a composite as its own profile, with the controls it exposes, and fetches nothing else', async () => {
      const { loader, requests } = loaderFor()
      const { profile } = await loader.loadListing(RACK_IRI)
      expect(profile.composite).toBe(true)
      expect(profile.label).toBe('Stomp rack')
      expect(profile.ports.map(p => p.symbol).sort()).toEqual(['depth', 'drive', 'room'])
      expect(profile.module).toBeNull()
      expect(requests).toEqual([RACK_IRI])
    })

    it('reads a plain plugin exactly as loadProfile does', async () => {
      const { loader } = loaderFor()
      const listed = await loader.loadListing(`${ORIGIN}plugins/boost/`)
      const loaded = await loader.loadProfile(`${ORIGIN}plugins/boost/`)
      expect(listed).toEqual(loaded)
    })

    it('refuses a composite that needs what the host does not offer, by the capabilities step', async () => {
      const needy = rack.replace('trn:role trn:AudioEffect', 'trn:requires jig:MidiEvents ; trn:role trn:AudioEffect')
      const { loader } = loaderFor(needy)
      const failure = await loader.loadListing(RACK_IRI).catch(e => e)
      expect(failure).toBeInstanceOf(LoadError)
      expect(failure.step).toBe(STEPS.capabilities)
    })
  })

  describe('the script validator', () => {
    it('verifies every member\'s files and offers the script the controls the composite exposes', async () => {
      const { loader, requests } = loaderFor()
      const result = await createPluginValidator(loader)(RACK_IRI)
      expect(result.ok, result.message).toBe(true)
      expect(result.ports.map(p => p.symbol).sort()).toEqual(['depth', 'drive', 'room'])
      // The code of all three members was fetched and checked: boost's module and processor, tremolo's and cascade's.
      for (const file of ['boost/boost.wasm', 'boost/boost-processor.js', 'tremolo/tremolo-processor.js', 'cascade/cascade.wasm', 'cascade/cascade-processor.js']) {
        expect(requests.some(url => url.endsWith(file)), file).toBe(true)
      }
    })

    it('refuses a composite whose member file does not verify, naming the step', async () => {
      const { loader } = loaderFor()
      const original = loader.fetchVerified.bind(loader)
      loader.fetchVerified = (resource, options) => original({ ...resource, integrity: resource.location.endsWith('boost.wasm') ? `sha384-${'A'.repeat(64)}` : resource.integrity }, options)
      const result = await createPluginValidator(loader)(RACK_IRI)
      expect(result.ok).toBe(false)
      expect(result.step).toBe(STEPS.integrity)
    })

    it('does not fetch a member\'s code twice for a composite that has not changed', async () => {
      const { loader, requests } = loaderFor()
      const validate = createPluginValidator(loader)
      await validate(RACK_IRI)
      const after = requests.length
      await validate(RACK_IRI)
      const second = requests.slice(after)
      expect(second.some(url => /\.(wasm|js)$/.test(url))).toBe(false)
    })
  })
})
