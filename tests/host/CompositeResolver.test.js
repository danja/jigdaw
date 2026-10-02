// tests/host/CompositeResolver.test.js
//
// The real loader, parser and shapes over an in-memory fetch. What matters here is
// the log of requests: contract section 14 says no code is fetched until the whole
// tree has been checked, and a fake that did not record would let that slip.
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Readable } from 'node:stream'
import rdf from '@zazuko/env'
import ParserN3 from '@rdfjs/parser-n3'
import { PluginLoader } from '../../src/host/PluginLoader.js'
import { resolveComposite, pluginsOf, MINIMUM_DEPTH } from '../../src/host/CompositeResolver.js'
import { LoadError, STEPS } from '../../src/host/LoadError.js'
import { pluginForm } from '../../src/rdf/Canonical.js'
import { digestOf } from '../../src/host/Integrity.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const parse = (text, baseIRI) =>
  rdf.dataset().import(new ParserN3({ factory: rdf, baseIRI }).import(Readable.from([text])))
const read = path => readFileSync(resolve(root, path), 'utf8')

const RACK = 'https://example.org/racks/stomp/'
const BOOST = 'https://strandz.it/jigdaw/plugins/boost/'
const TREMOLO = 'https://strandz.it/jigdaw/plugins/tremolo/'
const CASCADE = 'https://strandz.it/jigdaw/plugins/cascade/'
const PLACEHOLDER_PIN = `sha384-${'A'.repeat(64)}`

const members = {
  [BOOST]: read('plugins/boost/profile.ttl'),
  [TREMOLO]: read('plugins/tremolo/profile.ttl'),
  [CASCADE]: read('plugins/cascade/profile.ttl')
}

/** A valid composite around the given members, wired in a line, with no controls. */
function rack (iri, ...memberPlugins) {
  const ids = memberPlugins.map((_, i) => `<#m${i}>`)
  const ends = []
  const wires = []
  const line = [['<>', 0], ...ids.map(id => [id, 0]), ['<>', 0]]
  for (let i = 0; i < line.length - 1; i++) {
    wires.push(`<#c${i}>`)
    ends.push(`<#c${i}> a jig:Connection ; jig:from <#c${i}-f> ; jig:to <#c${i}-t> ; jig:signalKind trn:Audio .
<#c${i}-f> a jig:Endpoint ; jig:endpointNode ${line[i][0]} ; jig:portIndex 0 .
<#c${i}-t> a jig:Endpoint ; jig:endpointNode ${line[i + 1][0]} ; jig:portIndex 0 .`)
  }
  return `@base <${iri}> .
@prefix jig: <http://purl.org/stuff/jigdaw/> . @prefix trn: <http://purl.org/stuff/transmissions/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> . @prefix foaf: <http://xmlns.com/foaf/0.1/> .
<> a jig:CompositePlugin , trn:PluginProfile ; rdfs:label "Rack" ; foaf:homepage <> ;
  trn:role trn:AudioEffect ; trn:accepts trn:Audio ; trn:produces trn:Audio ;
  jig:audioInputs 1 ; jig:audioOutputs 1 ;
  jig:member ${ids.join(' , ')} ; jig:connection ${wires.join(' , ')} .
${memberPlugins.map((p, i) => `<#m${i}> a jig:Member ; jig:plugin <${p}> .`).join('\n')}
${ends.join('\n')}
`
}

function fakeFetch (routes, log) {
  return async url => {
    log.push(url)
    const body = routes[url]
    if (body === undefined) throw new TypeError('Failed to fetch')
    if (typeof body === 'number') return { ok: false, status: body }
    return { ok: true, status: 200, text: async () => body }
  }
}

describe('resolveComposite', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  const setup = (routes, over = {}) => {
    const log = []
    const loader = new PluginLoader({ fetch: fakeFetch(routes, log), parse, validator, capabilities: new Set(), ...over })
    return { log, loader }
  }

  /** The reference rack with its placeholder pins replaced by the digests of the members as they are. */
  async function pinnedReference () {
    let text = read('examples/reference-composite.ttl')
    for (const [iri, turtle] of Object.entries(members)) {
      const digest = await digestOf(new TextEncoder().encode(pluginForm(await parse(turtle, iri), iri)), 'sha384')
      text = text.replace(new RegExp(`(plugins/${iri.split('/').at(-2)}/>\\s*;\\s*jig:pinnedDigest) "${PLACEHOLDER_PIN}"`), `$1 "${digest}"`)
    }
    return text
  }

  it('resolves the reference rack, checking every pin, and fetches profiles only', async () => {
    const { loader, log } = setup({ [RACK]: await pinnedReference(), ...members })
    const tree = await resolveComposite(RACK, { loader })

    expect(tree.kind).toBe('composite')
    expect(tree.members.map(m => m.plugin).sort()).toEqual([BOOST, CASCADE, TREMOLO])
    expect(tree.members.every(m => m.tree.kind === 'plugin' && m.tree.profile.label)).toBe(true)
    // The point of the order: the four requests are the four profiles, and nothing else.
    expect(log.sort()).toEqual([RACK, BOOST, CASCADE, TREMOLO].sort())
    expect(log.some(url => /\.(wasm|js|html)$/.test(url))).toBe(false)
  })

  it('refuses a pin that does not match, naming the member and both digests', async () => {
    // The reference file carries placeholder pins, which cannot match a real profile.
    const { loader } = setup({ [RACK]: read('examples/reference-composite.ttl'), ...members })
    const failure = await resolveComposite(RACK, { loader }).catch(e => e)
    expect(failure).toBeInstanceOf(LoadError)
    expect(failure.step).toBe(STEPS.composite)
    expect(failure.message).toContain(PLACEHOLDER_PIN)
    expect(failure.message).toMatch(/sha384-(?!A{64})/)
    expect(failure.message).toMatch(/plugins\/(boost|tremolo|cascade)\//)
  })

  it('accepts an unpinned member', async () => {
    const { loader } = setup({ [RACK]: rack(RACK, BOOST), ...members })
    const tree = await resolveComposite(RACK, { loader })
    expect(tree.members[0].tree.iri).toBe(BOOST)
  })

  it('pins a member by the IRI its profile states, so a mirror or a local copy passes the same pin', async () => {
    // Boost served from somewhere else: the URL it is fetched from is not its identity, which is the subject its
    // profile names (plugin-profiles.md, the @base rule). The pin is over that identity, so the same digest holds.
    const MIRROR = 'http://127.0.0.1:8748/plugins/boost/'
    const dataset = await parse(members[BOOST], BOOST)
    const digest = await digestOf(new TextEncoder().encode(pluginForm(dataset, BOOST)), 'sha384')
    const text = rack(RACK, MIRROR).replace(`jig:plugin <${MIRROR}> .`, `jig:plugin <${MIRROR}> ; jig:pinnedDigest "${digest}" .`)
    expect(text).toContain(digest)
    const { loader } = setup({ [RACK]: text, [MIRROR]: members[BOOST] })
    const tree = await resolveComposite(RACK, { loader })
    expect(tree.members[0].tree.profile.iri).toBe(BOOST)
    expect(tree.members[0].tree.iri).toBe(MIRROR)
  })

  it('fetches a plugin once however many members use it, and loads it once', async () => {
    const { loader, log } = setup({ [RACK]: rack(RACK, BOOST, BOOST), ...members })
    const tree = await resolveComposite(RACK, { loader })
    expect(tree.members).toHaveLength(2)
    expect(log.filter(u => u === BOOST)).toHaveLength(1)
    expect(pluginsOf(tree).map(p => p.iri)).toEqual([BOOST])
  })

  it('fails the whole composite when a member cannot be fetched, naming the composite and the member', async () => {
    const { loader } = setup({ [RACK]: rack(RACK, BOOST, TREMOLO), [BOOST]: members[BOOST], [TREMOLO]: 404 })
    const failure = await resolveComposite(RACK, { loader }).catch(e => e)
    expect(failure).toBeInstanceOf(LoadError)
    expect(failure.step).toBe(STEPS.fetchProfile)
    expect(failure.message).toContain(RACK)
    expect(failure.message).toContain('#m1')
    expect(failure.message).toContain(TREMOLO)
  })

  it('refuses a composite that contains itself through another, naming the way round', async () => {
    const A = 'https://example.org/racks/a/'
    const B = 'https://example.org/racks/b/'
    const { loader } = setup({ [A]: rack(A, B), [B]: rack(B, A) })
    const failure = await resolveComposite(A, { loader }).catch(e => e)
    expect(failure.step).toBe(STEPS.composite)
    // "contains itself", not the depth limit, which would also print a chain.
    expect(failure.message).toMatch(/contains itself/)
    expect(failure.message).toContain(`${A} > ${B} > ${A}`)
  })

  it('refuses a composite that lists itself directly', async () => {
    const { loader } = setup({ [RACK]: rack(RACK, RACK) })
    const failure = await resolveComposite(RACK, { loader }).catch(e => e)
    expect(failure.message).toMatch(/contains itself/)
  })

  describe('depth', () => {
    const chain = n => {
      const iris = Array.from({ length: n }, (_, i) => `https://example.org/racks/level${i}/`)
      const routes = Object.fromEntries(iris.map((iri, i) => [iri, rack(iri, i === n - 1 ? BOOST : iris[i + 1])]))
      return { iris, routes: { ...routes, ...members } }
    }

    it('nests composites in composites, and a host must manage the minimum', async () => {
      const { iris, routes } = chain(MINIMUM_DEPTH)
      const { loader } = setup(routes)
      const tree = await resolveComposite(iris[0], { loader, maxDepth: MINIMUM_DEPTH })
      expect(pluginsOf(tree).map(p => p.iri)).toEqual([BOOST])
    })

    it('refuses beyond its limit and says what the limit is', async () => {
      const { iris, routes } = chain(MINIMUM_DEPTH + 1)
      const { loader } = setup(routes)
      const failure = await resolveComposite(iris[0], { loader, maxDepth: MINIMUM_DEPTH }).catch(e => e)
      expect(failure.step).toBe(STEPS.composite)
      expect(failure.message).toContain(`limit is ${MINIMUM_DEPTH}`)
    })

    it('will not be configured below the minimum', async () => {
      const { loader } = setup({})
      await expect(resolveComposite(RACK, { loader, maxDepth: MINIMUM_DEPTH - 1 })).rejects.toThrow(/at least 4/)
    })
  })

  it('refuses a composite that requires what the host does not offer, before fetching any member', async () => {
    const needy = rack(RACK, BOOST).replace('trn:role trn:AudioEffect', 'trn:requires jig:MidiEvents ; trn:role trn:AudioEffect')
    const { loader, log } = setup({ [RACK]: needy, ...members })
    const failure = await resolveComposite(RACK, { loader }).catch(e => e)
    expect(failure.step).toBe(STEPS.capabilities)
    expect(failure.message).toMatch(/MidiEvents/)
    expect(log).toEqual([RACK])
  })

  it('refuses a composite the shapes accept and the reader does not, before fetching any member', async () => {
    const WIRED = 'https://example.org/racks/wired-wrongly/'
    const { loader, log } = setup({ [WIRED]: read('examples/counterexample-composite-wiring.ttl'), ...members })
    const failure = await resolveComposite(WIRED, { loader }).catch(e => e)
    expect(failure.step).toBe(STEPS.composite)
    expect(failure.message).toMatch(/not a sound composite/)
    expect(log).toEqual([WIRED])
  })

  it('refuses a document the shapes refuse, before reading it as a composite', async () => {
    const BROKEN = 'https://example.org/racks/broken/'
    const { loader } = setup({ [BROKEN]: read('examples/counterexample-composite.ttl') })
    const failure = await resolveComposite(BROKEN, { loader }).catch(e => e)
    expect(failure.step).toBe(STEPS.validateProfile)
  })

  it('a plain plugin resolves as itself', async () => {
    const { loader } = setup({ ...members })
    const tree = await resolveComposite(BOOST, { loader })
    expect(tree.kind).toBe('plugin')
    expect(tree.profile.label).toBe('Boost')
  })
})
