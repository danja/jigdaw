// tests/catalogue/LocalCatalogue.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { readFile, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LocalCatalogue } from '../../src/catalogue/LocalCatalogue.js'
import { parseTurtleFile } from '../../src/validate/files.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { pluginDirs } from '../../src/catalogue/PluginDirectories.js'

const root = resolve(import.meta.dirname, '../..')

describe('the plugins this host serves', () => {
  let catalogue
  beforeAll(() => { catalogue = new LocalCatalogue() })

  it('finds them without a store, a network, or an npm install', async () => {
    // Taken from the directory rather than written out here. A list in a test
    // that names the plugins is a list that goes stale the day one is added,
    // and the failure looks like the catalogue being wrong.
    //
    // Compared by IRI, read from each profile. It used to compare the label
    // against the directory name, which held for three plugins by coincidence
    // and broke on the fourth: plugins/8b8/ is labelled "8-Bit 8asterd". A
    // directory name is a path and a label is prose, and nothing requires
    // them to agree.
    const expected = []
    for (const name of await pluginDirs(join(root, 'plugins'))) {
      const file = join(root, 'plugins', name, 'profile.ttl')
      expected.push(readProfile(await parseTurtleFile(file)).iri)
    }
    const found = (await catalogue.search({})).map(e => e.iri)
    expect(found.sort()).toEqual(expected.sort())
    expect(found.length, 'no plugins found, so this checked nothing').toBeGreaterThan(0)
  })

  it('marks them loadable, because they are ours', async () => {
    for (const entry of await catalogue.search({})) expect(entry.web).toBe(true)
  })

  it('matches text against name, description and vendor', async () => {
    expect((await catalogue.search({ text: 'reverb' })).map(e => e.label)).toEqual(['Cascade', 'Ferrite'])
    expect((await catalogue.search({ text: 'synthesiser' })).map(e => e.label)).toEqual(['Pulse'])
    // Every plugin here is by the same vendor, so this matches all of them.
    expect((await catalogue.search({ text: 'danja' })).length)
      .toBe((await catalogue.search({})).length)
  })

  it('filters by facet, including the ones whose field is named differently', async () => {
    // role and format are singular as facets and plural as fields. Reading the
    // entry by the facet name meant those two silently matched nothing.
    expect((await catalogue.search({ role: 'Instrument' })).map(e => e.label).sort())
      .toEqual(['8-Bit 8asterd', 'DrumKit', 'Pulse'])
    expect((await catalogue.search({ role: 'AudioEffect' })).map(e => e.label).sort())
      .toEqual(['Boost', 'Cascade', 'Dynamix', 'Ferrite', 'JigDAW Gain Trim', 'JigDAW One-Pole Filter', 'JigDAW Soft Clipper', 'Quefrency', 'Squelch', 'Tremolo'])
    // BassGen accepts MIDI too: it can be steered from a keyboard. DrumKit
    // takes drum notes the same way a keyboard takes pitched ones.
    expect((await catalogue.search({ accepts: 'Midi' })).map(e => e.label).sort())
      .toEqual(['8-Bit 8asterd', 'BassGen', 'DrumKit', 'Pulse'])
    expect((await catalogue.search({ produces: 'Midi' })).map(e => e.label)).toEqual(['BassGen', 'DrumGen'])
  })

  it('takes a full IRI for a facet as well as a bare name', async () => {
    const full = await catalogue.search({ role: 'http://purl.org/stuff/transmissions/AudioEffect' })
    expect(full.map(e => e.label).sort())
      .toEqual(['Boost', 'Cascade', 'Dynamix', 'Ferrite', 'JigDAW Gain Trim', 'JigDAW One-Pole Filter', 'JigDAW Soft Clipper', 'Quefrency', 'Squelch', 'Tremolo'])
  })

  it('returns nothing rather than everything when nothing matches', async () => {
    expect(await catalogue.search({ text: 'zzzz' })).toEqual([])
    expect(await catalogue.search({ role: 'Nonesuch' })).toEqual([])
  })

  it('describes one of its own, and says nothing about a plugin it does not hold', async () => {
    const [cascade] = await catalogue.search({ text: 'reverb' })
    const described = await catalogue.describe(cascade.iri)
    expect(described.properties.role).toContain('AudioEffect')
    expect(described.properties.parameter).toContain('mix')
    // null, so the caller falls through to the wider catalogue.
    expect(await catalogue.describe('https://example.org/plugins/other/')).toBeNull()
  })
})

describe('the generated index', () => {
  it('describes the profiles that are actually on disk', async () => {
    // Generated and committed, so the server needs no RDF parser. That makes it
    // exactly the kind of pair that drifts: nothing connects a rebuilt profile
    // to the index the browser reads.
    const index = JSON.parse(await readFile(join(root, 'plugins/index.json'), 'utf8'))

    for (const entry of index.plugins) {
      const slug = entry.iri.replace(/\/$/, '').split('/').pop()
      const profile = readProfile(await parseTurtleFile(join(root, `plugins/${slug}/profile.ttl`), entry.iri))

      expect(profile.label, `${slug} label`).toBe(entry.label)
      expect(profile.iri, `${slug} iri`).toBe(entry.iri)
      expect(profile.ports.map(p => p.symbol).sort(), `${slug} parameters`)
        .toEqual([...entry.parameters].sort())
    }
    expect(index.plugins.length).toBeGreaterThan(0)
  })
})

describe('when the index is missing', () => {
  it('reports no local plugins rather than failing', async () => {
    // A browser that will not open because an index is absent is worse than
    // one with nothing in it: the host still serves, and still searches
    // upstream.
    const catalogue = new LocalCatalogue({ path: join(tmpdir(), 'jigdaw-no-such-index.json') })
    await expect(catalogue.search({})).resolves.toEqual([])
    await expect(catalogue.describe('https://x/')).resolves.toBeNull()
  })

  it('survives an index that is not valid JSON', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'jigdaw-index-'))
    const path = join(dir, 'index.json')
    await writeFile(path, 'not json at all')
    await expect(new LocalCatalogue({ path }).search({})).resolves.toEqual([])
  })
})
