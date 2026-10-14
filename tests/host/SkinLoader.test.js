// tests/host/SkinLoader.test.js
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { parseText } from '../../src/rdf/parse.js'
import { loadSkin, prepareSkin, SkinLoadError } from '../../src/host/SkinLoader.js'
import { SVG_NS, SkinError } from '../../src/ui/SkinArtwork.js'

const { document } = parseHTML('<!doctype html><html><body></body></html>')
const BASE = 'https://example.org/p/'
const SKIN = `${BASE}skin.ttl`
const PIN = `sha384-${'A'.repeat(64)}`

const turtle = `
@prefix jig: <http://purl.org/stuff/jigdaw/> .
@base <${SKIN}> .
<> jig:artwork <#art> ; jig:control <#depth> .
<#art> a jig:Artwork ; jig:location <${BASE}panel.svg> ; jig:mediaType "image/svg+xml" ; jig:integrity "${PIN}" .
<#depth> a jig:LinearControl ; jig:boundSymbol "depth" ; jig:element "thumb" ; jig:trackElement "slot" .`

const profile = { skin: { location: SKIN, integrity: PIN }, ports: [{ symbol: 'depth', toggled: false, scalePoints: [], minimum: 0, maximum: 1 }, { symbol: 'rate', toggled: false, scalePoints: [], minimum: 0, maximum: 9 }] }

const el = (name, attrs = {}) => { const e = document.createElementNS(SVG_NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e }
const tree = () => { const root = el('svg', { viewBox: '0 0 1 1' }); root.append(el('g', { id: 'thumb' }), el('rect', { id: 'slot' })); return { documentElement: root } }

function deps (overrides = {}) {
  const asked = []
  return {
    asked,
    fetchVerified: async (resource, { kind }) => { asked.push([kind, resource.location]); return new TextEncoder().encode(kind === 'skin' ? turtle : '<svg/>') },
    parseTurtle: parseText,
    parseSvg: () => tree(),
    ...overrides
  }
}

describe('loadSkin', () => {
  it('fetches the skin then the artwork it names, both through the verifying fetch', async () => {
    const d = deps()
    const loaded = await loadSkin(profile, d)
    expect(d.asked).toEqual([['skin', SKIN], ['skin artwork', `${BASE}panel.svg`]])
    expect(loaded.skin.controls.map(c => c.boundSymbol)).toEqual(['depth'])
    expect(loaded.artwork.size).toBe(6)
  })

  it('fetches the artwork from where the skin was fetched, not from the canonical origin', async () => {
    const mirror = { skin: { location: 'http://127.0.0.1:8748/p/skin.ttl', integrity: PIN }, ports: profile.ports }
    const d = deps()
    await loadSkin(mirror, d)
    expect(d.asked).toEqual([['skin', 'http://127.0.0.1:8748/p/skin.ttl'], ['skin artwork', 'http://127.0.0.1:8748/p/panel.svg']])
  })

  it('leaves an artwork on another origin where the author put it', async () => {
    const cdn = turtle.replace(`<${BASE}panel.svg>`, '<https://cdn.example/panel.svg>')
    const d = deps({ fetchVerified: async (r, { kind }) => { d.asked.push([kind, r.location]); return new TextEncoder().encode(kind === 'skin' ? cdn : '<svg/>') } })
    const mirror = { skin: { location: 'http://127.0.0.1:8748/p/skin.ttl', integrity: PIN }, ports: profile.ports }
    await loadSkin(mirror, d)
    expect(d.asked[1]).toEqual(['skin artwork', 'https://cdn.example/panel.svg'])
  })

  it('keeps the artwork location as written for a skin carried as a data: URI', async () => {
    const flat = { skin: { location: 'data:text/turtle;base64,AAAA', integrity: PIN }, ports: profile.ports }
    const d = deps()
    await loadSkin(flat, d)
    expect(d.asked[1]).toEqual(['skin artwork', `${BASE}panel.svg`])
  })

  it('refuses a profile with no skin', async () => {
    await expect(loadSkin({ skin: null }, deps())).rejects.toThrow(SkinLoadError)
  })

  it('does not go on to the artwork when the skin fails verification', async () => {
    const d = deps({ fetchVerified: async () => { throw new Error('failed verification') } })
    await expect(loadSkin(profile, d)).rejects.toThrow('failed verification')
  })

  it('does not parse an artwork that failed verification', async () => {
    let parsed = false
    const d = deps({
      fetchVerified: async (r, { kind }) => { if (kind === 'skin artwork') throw new Error('digest mismatch'); return new TextEncoder().encode(turtle) },
      parseSvg: () => { parsed = true; return tree() }
    })
    await expect(loadSkin(profile, d)).rejects.toThrow('digest mismatch')
    expect(parsed).toBe(false)
  })

  it('names the skin when it is not Turtle', async () => {
    const d = deps({ fetchVerified: async () => new TextEncoder().encode('this is not turtle {{{') })
    await expect(loadSkin(profile, d)).rejects.toThrow(/skin at .* could not be read/)
  })

  it('names the artwork when it is not well formed', async () => {
    const d = deps({ parseSvg: () => { throw new SkinError('the artwork is not well formed XML: mismatch') } })
    await expect(loadSkin(profile, d)).rejects.toThrow(/artwork at .*panel.svg: the artwork is not well formed XML/)
  })

  it('refuses a skin that names no artwork digest', async () => {
    const bare = turtle.replace(` ; jig:integrity "${PIN}"`, '')
    const d = deps({ fetchVerified: async () => new TextEncoder().encode(bare) })
    await expect(loadSkin(profile, d)).rejects.toThrow(/no artwork with a location and a digest/)
  })
})

describe('prepareSkin', () => {
  it('builds artwork nodes with the panel\'s own id prefix and keeps the controls that agree', async () => {
    const loaded = await loadSkin(profile, deps())
    const a = prepareSkin(loaded, profile, { document, prefix: 'one-' })
    const b = prepareSkin(loaded, profile, { document, prefix: 'two-' })
    expect(a.controls.map(c => c.boundSymbol)).toEqual(['depth'])
    expect(a.elements.get('thumb').getAttribute('id')).toBe('one-thumb')
    expect(b.elements.get('thumb').getAttribute('id')).toBe('two-thumb')
    expect(a.svg).not.toBe(b.svg)
  })

  it('reports what it left out', async () => {
    const loaded = await loadSkin(profile, deps())
    const noDepth = { ports: profile.ports.filter(p => p.symbol !== 'depth') }
    const result = prepareSkin(loaded, noDepth, { document, prefix: 'x-' })
    expect(result.controls).toEqual([])
    expect(result.omitted[0].reason).toContain('declares no port "depth"')
  })
})
