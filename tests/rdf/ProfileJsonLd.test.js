// tests/rdf/ProfileJsonLd.test.js
//
// The profile a plugin's own editor receives in `init` (docs/messaging.md 2.2). A frame is someone else's
// code, so this holds it to what an editor draws from, and holds the bridge's reading of it to the host's
// own widget rule.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { profileAsJsonLd } from '../../src/rdf/ProfileJsonLd.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')

async function dynamix () {
  const iri = JSON.parse(readFileSync(resolve(root, 'plugins/dynamix/profile.json'), 'utf8')).iri
  return readProfile(await parseTurtleFile(resolve(root, 'plugins/dynamix/profile.ttl')), iri)
}

describe('profileAsJsonLd', () => {
  it('refuses a profile with no iri', () => {
    expect(() => profileAsJsonLd({ ports: [] })).toThrow(/iri/)
  })

  it('carries a port\'s unit, port properties and named values', async () => {
    const ld = profileAsJsonLd(await dynamix())
    const port = symbol => ld.port.find(p => p.symbol === symbol)
    expect(port('threshold').unit).toBe('http://lv2plug.in/ns/extensions/units#db')
    expect(port('comp_enable').portProperty).toContain('http://lv2plug.in/ns/lv2core#toggled')
    expect(port('comp_mode').scalePoint).toEqual([{ label: 'Compressor', value: 0 }, { label: 'Expander', value: 1 }])
  })

  it('carries a port\'s comment when it has one, and omits it when it has none', async () => {
    const ld = profileAsJsonLd({ iri: 'https://example.org/p/', ports: [
      { iri: 'https://example.org/p/#a', symbol: 'a', name: 'A', minimum: 0, maximum: 1, defaultValue: 0, comment: 'Does a thing.', scalePoints: [] },
      { iri: 'https://example.org/p/#b', symbol: 'b', name: 'B', minimum: 0, maximum: 1, defaultValue: 0, comment: null, scalePoints: [] }
    ] })
    expect(ld.port[0].comment).toBe('Does a thing.')
    expect('comment' in JSON.parse(JSON.stringify(ld.port[1]))).toBe(false)
    expect(ld['@context'].comment).toBeDefined()
  })

  it('leaves a port with none of these without them', async () => {
    const ld = profileAsJsonLd(await dynamix())
    const ratio = ld.port.find(p => p.symbol === 'ratio')
    expect(ratio.unit).toBeUndefined()
    expect(ratio.portProperty).toEqual([])
    expect(ratio.scalePoint).toEqual([])
  })

  it('maps every key it emits to a term in its context', async () => {
    const ld = profileAsJsonLd(await dynamix())
    const keys = new Set(ld.port.flatMap(p => Object.keys(p)))
    keys.add('port')
    for (const key of keys) {
      if (key === '@id') continue
      expect(ld['@context'][key], `no context term for ${key}`).toBeDefined()
    }
  })
})
