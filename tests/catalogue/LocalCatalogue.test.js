// tests/catalogue/LocalCatalogue.test.js
import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { LocalCatalogue } from '../../src/catalogue/LocalCatalogue.js'

const root = resolve(import.meta.dirname, '../..')

describe('the plugins this host serves', () => {
  let catalogue
  beforeAll(() => { catalogue = new LocalCatalogue({ dir: join(root, 'plugins') }) })

  it('finds them without a store or a network', async () => {
    const all = await catalogue.search({})
    expect(all.map(e => e.label).sort()).toEqual(['Cascade', 'Pulse'])
  })

  it('marks them loadable, because they are ours', async () => {
    for (const entry of await catalogue.search({})) {
      expect(entry.web).toBe(true)
      expect(entry.local).toBe(true)
    }
  })

  it('matches text against name, description and vendor', async () => {
    expect((await catalogue.search({ text: 'reverb' })).map(e => e.label)).toEqual(['Cascade'])
    expect((await catalogue.search({ text: 'synthesiser' })).map(e => e.label)).toEqual(['Pulse'])
    expect((await catalogue.search({ text: 'danja' })).length).toBe(2)
  })

  it('filters by facet, including the ones whose field is named differently', async () => {
    // role and format are singular as facets and plural as fields. Reading the
    // entry by the facet name meant those two silently matched nothing.
    expect((await catalogue.search({ role: 'Instrument' })).map(e => e.label)).toEqual(['Pulse'])
    expect((await catalogue.search({ role: 'AudioEffect' })).map(e => e.label)).toEqual(['Cascade'])
    expect((await catalogue.search({ accepts: 'Midi' })).map(e => e.label)).toEqual(['Pulse'])
    expect((await catalogue.search({ produces: 'Audio' })).length).toBe(2)
  })

  it('takes a full IRI for a facet as well as a bare name', async () => {
    const full = await catalogue.search({ role: 'http://purl.org/stuff/transmissions/AudioEffect' })
    expect(full.map(e => e.label)).toEqual(['Cascade'])
  })

  it('returns nothing rather than everything when nothing matches', async () => {
    expect(await catalogue.search({ text: 'zzzz' })).toEqual([])
    expect(await catalogue.search({ role: 'Nonesuch' })).toEqual([])
  })

  it('describes one of its own from the profile the host actually serves', async () => {
    const [cascade] = await catalogue.search({ text: 'reverb' })
    const described = await catalogue.describe(cascade.iri)
    expect(described.properties.role).toContain('AudioEffect')
    expect(described.properties.parameter).toContain('mix')
  })

  it('says nothing about a plugin it does not hold', async () => {
    // null, so the caller can fall through to the wider catalogue.
    expect(await catalogue.describe('https://example.org/plugins/other/')).toBeNull()
  })
})

describe('a directory with problems in it', () => {
  it('skips a profile that does not parse instead of failing entirely', async () => {
    // One broken plugin must not take the browser down with it.
    const dir = await mkdtemp(join(tmpdir(), 'jigdaw-local-'))
    await mkdir(join(dir, 'broken'), { recursive: true })
    await writeFile(join(dir, 'broken', 'profile.ttl'), 'this is not turtle <<<')
    await mkdir(join(dir, 'empty'), { recursive: true })

    const catalogue = new LocalCatalogue({ dir })
    await expect(catalogue.search({})).resolves.toEqual([])
  })

  it('reports nothing rather than throwing when there is no plugins directory', async () => {
    const catalogue = new LocalCatalogue({ dir: join(tmpdir(), 'jigdaw-does-not-exist') })
    await expect(catalogue.search({})).resolves.toEqual([])
  })
})
