// tests/catalogue/Catalogue.test.js
import { describe, it, expect } from 'vitest'
import { Catalogue, FACET_NAMES } from '../../src/catalogue/Catalogue.js'
import { QueryService } from '../../src/catalogue/QueryService.js'
import { iri, literal, integer } from '../../src/catalogue/terms.js'

/** A fetch that records the SPARQL it was given and answers with bindings. */
function fakeEndpoint (bindings = []) {
  const sent = []
  const fetch = async (url, init) => {
    sent.push({ url, body: init.body })
    return { ok: true, status: 200, json: async () => ({ results: { bindings } }) }
  }
  return { fetch, sent }
}

const row = over => ({
  plugin: { value: 'http://purl.org/stuff/plugin-universe/plugin/aether-1' },
  label: { value: 'Aether' },
  comment: { value: 'A reverb.' },
  vendor: { value: 'Dougal' },
  web: { value: 'false' },
  roles: { value: 'http://purl.org/stuff/transmissions/AudioEffect' },
  formats: { value: 'http://purl.org/stuff/transmissions/VST3|http://purl.org/stuff/transmissions/LV2' },
  ...over
})

describe('terms', () => {
  it('brackets an IRI and refuses one that could break out', () => {
    expect(iri('https://a.example/x')).toBe('<https://a.example/x>')
    for (const bad of ['not an iri', 'https://a.example/x> . ?s ?p ?o . <', 'javascript:alert(1)']) {
      expect(() => iri(bad), bad).toThrow()
    }
  })

  it('escapes the characters that end a literal', () => {
    expect(literal('a"b')).toBe('"a\\"b"')
    expect(literal('a\\b')).toBe('"a\\\\b"')
    expect(literal('a\nb')).toBe('"a\\nb"')
  })

  it('refuses a limit that is not a non-negative integer', () => {
    expect(integer(30)).toBe('30')
    for (const bad of [-1, 1.5, 'all', NaN]) expect(() => integer(bad), String(bad)).toThrow()
  })
})

describe('QueryService', () => {
  const queries = new QueryService()

  it('loads a query from a file rather than a template literal', async () => {
    const text = await queries.load('catalogue/search')
    expect(text).toContain('SELECT')
    expect(text).toContain('trn:PluginProfile')
  })

  it('refuses a name that is not <category>/<name>', async () => {
    for (const bad of ['search', '../../etc/passwd', 'catalogue/../secret', 'Catalogue/Search']) {
      await expect(queries.load(bad), bad).rejects.toThrow()
    }
  })

  it('fills every placeholder', async () => {
    const sparql = await queries.build('catalogue/search', { filters: '', limit: '10' })
    expect(sparql).not.toContain('${')
    expect(sparql).toContain('LIMIT 10')
  })

  it('refuses to build with a placeholder unsupplied', async () => {
    // An unfilled placeholder is an error, not an empty string: a query with a
    // silently empty graph name still runs and returns the wrong thing.
    await expect(queries.build('catalogue/search', { limit: '10' })).rejects.toThrow(/no value for filters/)
  })

  it('refuses a value the query does not use', async () => {
    // Both directions. A surplus value means the query and its caller have
    // drifted, which is worth knowing before the result is wrong.
    await expect(queries.build('catalogue/search', { filters: '', limit: '10', extra: 'x' }))
      .rejects.toThrow(/extra supplied but not used/)
  })
})

describe('search', () => {
  it('maps a result row into something a panel can render', async () => {
    const { fetch } = fakeEndpoint([row()])
    const [result] = await new Catalogue({ fetch }).search({ text: 'reverb' })
    expect(result.label).toBe('Aether')
    expect(result.web).toBe(false)
    // Compacted, as transmission does, so an agent sees a readable value.
    expect(result.roles).toEqual(['AudioEffect'])
    expect(result.formats).toEqual(['VST3', 'LV2'])
  })

  it('marks a plugin this host can actually run', async () => {
    const { fetch } = fakeEndpoint([row({ web: { value: 'true' } })])
    const [result] = await new Catalogue({ fetch }).search({})
    expect(result.web).toBe(true)
  })

  it('searches name, description and vendor together', async () => {
    // Someone searching for "reverb" may be thinking of any of the three.
    const { fetch, sent } = fakeEndpoint()
    await new Catalogue({ fetch }).search({ text: 'Aether' })
    expect(sent[0].body).toContain('?label')
    expect(sent[0].body).toContain('?comment')
    expect(sent[0].body).toContain('?vendor')
    // Lowercased on both sides, so the match is case insensitive.
    expect(sent[0].body).toContain('"aether"')
  })

  it('expands a bare facet value into the transmissions namespace', async () => {
    const { fetch, sent } = fakeEndpoint()
    await new Catalogue({ fetch }).search({ accepts: 'Midi' })
    expect(sent[0].body).toContain('<http://purl.org/stuff/transmissions/Midi>')
  })

  it('takes a full IRI for a facet as well', async () => {
    const { fetch, sent } = fakeEndpoint()
    await new Catalogue({ fetch }).search({ role: 'http://example.org/Weird' })
    expect(sent[0].body).toContain('<http://example.org/Weird>')
  })

  it('refuses a facet it does not know', async () => {
    const { fetch } = fakeEndpoint()
    await expect(new Catalogue({ fetch }).search({ nonesuch: 'x' })).rejects.toThrow(/no such facet/)
  })

  it('caps the limit rather than passing a huge one upstream', async () => {
    const { fetch, sent } = fakeEndpoint()
    await new Catalogue({ fetch }).search({ limit: 100000 })
    expect(sent[0].body).toContain('LIMIT 200')
  })

  it('cannot be broken out of by a search term', async () => {
    const { fetch, sent } = fakeEndpoint()
    await new Catalogue({ fetch }).search({ text: 'a") } INSERT { ?s ?p ?o } #' })
    // The quote is escaped, so the injected brace never closes the WHERE.
    expect(sent[0].body).not.toContain('INSERT { ?s ?p ?o }')
    expect(sent[0].body).toContain('\\"')
  })

  it('reports an endpoint that is down as such', async () => {
    const fetch = async () => ({ ok: false, status: 503 })
    await expect(new Catalogue({ fetch }).search({})).rejects.toThrow(/returned 503/)
  })

  it('exports its facet names as one list', () => {
    // One list, exported, rather than a list repeated wherever it is needed.
    expect(FACET_NAMES).toContain('accepts')
    expect(FACET_NAMES).toContain('produces')
    expect(FACET_NAMES).toContain('role')
  })
})

describe('describe', () => {
  it('groups properties and compacts their values', async () => {
    const { fetch } = fakeEndpoint([
      { p: { value: 'http://purl.org/stuff/transmissions/role' }, o: { value: 'http://purl.org/stuff/transmissions/AudioEffect' } },
      { p: { value: 'http://purl.org/stuff/transmissions/role' }, o: { value: 'http://purl.org/stuff/transmissions/AudioMixer' } }
    ])
    const result = await new Catalogue({ fetch }).describe('https://a.example/p/')
    expect(result.properties.role).toEqual(['AudioEffect', 'AudioMixer'])
  })

  it('refuses an IRI that is not one', async () => {
    const { fetch } = fakeEndpoint()
    await expect(new Catalogue({ fetch }).describe('> . ?s ?p ?o . <')).rejects.toThrow()
  })
})
