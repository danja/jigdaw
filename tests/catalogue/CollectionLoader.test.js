// tests/catalogue/CollectionLoader.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { CollectionLoader, CollectionError, COLLECTION_STEPS } from '../../src/catalogue/CollectionLoader.js'
import { PluginLoader, STEPS } from '../../src/host/PluginLoader.js'
import { parseText } from '../../src/rdf/parse.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { shapeValidatorFromFile, parseTurtleFile } from '../../src/validate/files.js'
import { pluginDirs } from '../../src/catalogue/PluginDirectories.js'
import { vocabulary as v, TRN } from '../../src/rdf/Vocabulary.js'

const root = resolve(import.meta.dirname, '../..')
const ORIGIN = 'http://localhost:8080'
const PREFIXES = `
  @prefix jig: <http://purl.org/stuff/jigdaw/> .
  @prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
  @prefix dcterms: <http://purl.org/dc/terms/> .`

/**
 * A fetch over a map of URL to body, recording every request. It refuses a
 * URL it does not know as a network failure, which is what a real fetch does,
 * so a request the loader should never make fails loudly rather than passing.
 */
function fakeFetch (routes, seen = []) {
  return async (url, init) => {
    seen.push({ url, accept: init?.headers?.accept ?? null })
    const body = routes[url]
    if (body === undefined) throw new TypeError('Failed to fetch')
    if (typeof body === 'number') return { ok: false, status: body }
    return { ok: true, status: 200, text: async () => body }
  }
}

/** Every capability a browser host can offer, so no shipped plugin is refused
 * for something this machine lacks rather than for something it declares. */
const EVERYTHING = new Set([
  v.trn.HostTransport, v.jig.MidiEvents, v.jig.MidiOut, v.jig.SharedMemory,
  v.jig.CrossOriginIsolation, v.jig.OfflineRender, v.jig.Persistence,
  v.jig.Simd128, v.jig.Threads, v.jig.BulkMemory, v.jig.ExceptionHandling
])

describe('CollectionLoader', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  const loaderFor = (routes, { seen, verify, concurrency } = {}) => {
    const fetch = fakeFetch(routes, seen)
    const plugins = new PluginLoader({ fetch, parse: parseText, validator, capabilities: EVERYTHING })
    return new CollectionLoader({
      fetch,
      parse: parseText,
      validator,
      verify: verify ?? (iri => plugins.loadProfile(iri)),
      ...(concurrency ? { concurrency } : {})
    })
  }

  it('refuses to be built without what it needs', () => {
    expect(() => new CollectionLoader({ validator, verify: () => {} })).toThrow(/parse/)
    expect(() => new CollectionLoader({ parse: parseText, verify: () => {} })).toThrow(/validator/)
    expect(() => new CollectionLoader({ parse: parseText, validator })).toThrow(/verify/)
    expect(() => new CollectionLoader({ parse: parseText, validator, verify: () => {}, concurrency: 0 })).toThrow(/concurrency/)
  })

  describe('the shipped collection', () => {
    // web/collections/jigdaw.ttl served from localhost, with every plugin's
    // real profile served beside it: the page's own path, end to end.
    const URL_ = `${ORIGIN}/collections/jigdaw.ttl`
    let result, seen, dirs

    beforeAll(async () => {
      dirs = await pluginDirs(join(root, 'plugins'))
      const routes = { [URL_]: await readFile(join(root, 'web/collections/jigdaw.ttl'), 'utf8') }
      for (const name of dirs) {
        routes[`${ORIGIN}/plugins/${name}/`] = await readFile(join(root, 'plugins', name, 'profile.ttl'), 'utf8')
      }
      seen = []
      result = await loaderFor(routes, { seen }).load(URL_)
    })

    it('lists every plugin directory, and nothing else', () => {
      // Taken from the directory, so adding a plugin without adding it to the
      // collection fails here rather than going unnoticed.
      const listed = result.members.map(m => m.iri).sort()
      expect(listed).toEqual(dirs.map(name => `${ORIGIN}/plugins/${name}/`).sort())
      expect(listed.length, 'no plugins, so this checked nothing').toBeGreaterThan(0)
    })

    it('finds every member valid and runnable', () => {
      const failed = result.members.filter(m => !m.ok).map(m => `${m.iri}: [${m.step}] ${m.message}`)
      expect(failed).toEqual([])
    })

    it('names each plugin as its own profile does', async () => {
      for (const member of result.members) {
        expect(member.notes.filter(n => n.startsWith('listed as')), member.iri).toEqual([])
      }
    })

    it('notes that a plugin served locally names itself by its canonical IRI', async () => {
      const pulse = result.members.find(m => m.iri === `${ORIGIN}/plugins/pulse/`)
      const canonical = readProfile(await parseTurtleFile(join(root, 'plugins/pulse/profile.ttl'))).iri
      expect(pulse.profile.iri).toBe(canonical)
      expect(pulse.notes).toContain(`names itself ${canonical}`)
    })

    it('fetches the document and the profiles, and no code', () => {
      // Section 3.2: a module, a processor or an asset is fetched when a person
      // loads the plugin, never when a collection is opened.
      const expected = [URL_, ...dirs.map(name => `${ORIGIN}/plugins/${name}/`)].sort()
      expect(seen.map(s => s.url).sort()).toEqual(expected)
      expect(seen.find(s => s.url === URL_).accept).toBe('text/turtle')
    })
  })

  it('refuses a collection it cannot fetch, naming the step', async () => {
    const url = 'https://a.example/missing'
    await expect(loaderFor({ [url]: 404 }).load(url)).rejects.toMatchObject({
      name: 'CollectionError', step: COLLECTION_STEPS.fetch, message: expect.stringContaining('404')
    })
    await expect(loaderFor({}).load(url)).rejects.toMatchObject({
      step: COLLECTION_STEPS.fetch, message: expect.stringContaining('Access-Control-Allow-Origin')
    })
  })

  it('refuses a collection that is not Turtle', async () => {
    const url = 'https://a.example/c'
    await expect(loaderFor({ [url]: '<html>not this</html>' }).load(url))
      .rejects.toMatchObject({ step: COLLECTION_STEPS.parse })
  })

  it('refuses an invalid collection whole, before fetching any member', async () => {
    const url = 'https://a.example/c'
    const seen = []
    const body = `${PREFIXES}
      <> a jig:PluginCollection ; rdfs:label "X" ; dcterms:hasPart <https://a.example/p/> .`
    const error = await loaderFor({ [url]: body }, { seen }).load(url).catch(e => e)
    expect(error).toBeInstanceOf(CollectionError)
    expect(error.step).toBe(COLLECTION_STEPS.validate)
    expect(error.message).toMatch(/must be named/)
    expect(seen.map(s => s.url)).toEqual([url])
  })

  it('refuses a document that holds no collection', async () => {
    const url = 'https://a.example/c'
    await expect(loaderFor({ [url]: `${PREFIXES} <> rdfs:label "X" .` }).load(url))
      .rejects.toMatchObject({ step: COLLECTION_STEPS.validate, message: expect.stringMatching(/no jig:PluginCollection/) })
  })

  it('passes on a missing description as a warning, and still opens', async () => {
    const url = 'https://a.example/c'
    const body = `${PREFIXES}
      <> a jig:PluginCollection ; rdfs:label "X" ; dcterms:hasPart <https://a.example/p/> .
      <https://a.example/p/> rdfs:label "P" .`
    const verify = async iri => ({ profile: { iri, label: 'P' } })
    const result = await loaderFor({ [url]: body }, { verify }).load(url)
    expect(result.warnings.map(w => w.path)).toEqual(['http://www.w3.org/2000/01/rdf-schema#comment'])
    expect(result.members[0].ok).toBe(true)
  })

  describe('members', () => {
    const url = 'https://a.example/c'
    const profile = readFile(join(root, 'examples/reference-profile.ttl'), 'utf8')
    const body = `${PREFIXES}
      <> a jig:PluginCollection ; rdfs:label "Mixed" ; rdfs:comment "Some good, some not." ;
        dcterms:hasPart <https://example.org/plugins/reference/> , <https://a.example/gone/> ,
                        <https://a.example/broken/> , <https://a.example/greedy/> .
      <https://example.org/plugins/reference/> rdfs:label "Renamed" .
      <https://a.example/gone/> rdfs:label "Gone" .
      <https://a.example/broken/> rdfs:label "Broken" .
      <https://a.example/greedy/> rdfs:label "Greedy" .`

    let result
    beforeAll(async () => {
      const text = await profile
      // Needs a capability no host offers, so it is refused at step 2.
      const greedy = text
        .replace('@base <https://example.org/plugins/reference/>', '@base <https://a.example/greedy/>')
        .replace('trn:requires jig:Persistence ;', 'trn:requires jig:Persistence , <http://purl.org/stuff/jigdaw/Nothing> ;')
      const loader = new CollectionLoader({
        fetch: fakeFetch({ [url]: body }),
        parse: parseText,
        validator,
        verify: iri => new PluginLoader({
          fetch: fakeFetch({
            'https://example.org/plugins/reference/': text,
            'https://a.example/gone/': 410,
            'https://a.example/broken/': '@prefix : <x> . this is not turtle',
            'https://a.example/greedy/': greedy
          }),
          parse: parseText,
          validator,
          capabilities: new Set([`${TRN}HostTransport`, v.jig.Persistence, v.jig.Simd128, v.jig.BulkMemory])
        }).loadProfile(iri)
      })
      result = await loader.load(url)
    })

    it('reports each failure with its step, and keeps the rest', () => {
      const by = label => result.members.find(m => m.listedLabel === label)
      expect(by('Renamed').ok, by('Renamed').message).toBe(true)
      expect(by('Gone')).toMatchObject({ ok: false, step: STEPS.fetchProfile })
      expect(by('Gone').message).toMatch(/410/)
      expect(by('Broken')).toMatchObject({ ok: false, step: STEPS.parseProfile })
      expect(by('Greedy')).toMatchObject({ ok: false, step: STEPS.capabilities })
    })

    it('lets the profile govern the name, and says where the two differ', () => {
      const member = result.members.find(m => m.listedLabel === 'Renamed')
      expect(member.profile.label).toBe('Reference')
      expect(member.notes).toEqual(['listed as "Renamed", named "Reference" by its profile'])
    })
  })

  it('checks no more members at once than it was told to', async () => {
    const url = 'https://a.example/c'
    const members = Array.from({ length: 10 }, (_, i) => `https://a.example/p${i}/`)
    const body = `${PREFIXES}
      <> a jig:PluginCollection ; rdfs:label "Many" ; rdfs:comment "Ten." ;
        dcterms:hasPart ${members.map(m => `<${m}>`).join(' , ')} .
      ${members.map((m, i) => `<${m}> rdfs:label "P${i}" .`).join('\n')}`
    let inFlight = 0
    let most = 0
    const verify = async iri => {
      most = Math.max(most, ++inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight--
      return { profile: { iri, label: `P${members.indexOf(iri)}` } }
    }
    const result = await loaderFor({ [url]: body }, { verify, concurrency: 3 }).load(url)
    expect(most).toBe(3)
    expect(result.members.every(m => m.ok)).toBe(true)
    expect(result.members).toHaveLength(10)
  })
})
