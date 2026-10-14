// tests/rdf/SkinReader.test.js
import { describe, it, expect } from 'vitest'
import { parseText } from '../../src/rdf/parse.js'
import { readSkin, checkSkin } from '../../src/rdf/SkinReader.js'

const BASE = 'https://example.org/plugins/tremolo/skin.ttl'
const PIN = `sha384-${'A'.repeat(64)}`

const text = `
@prefix jig: <http://purl.org/stuff/jigdaw/> .
@base <${BASE}> .
<> jig:artwork <#art> ; jig:control <#depth>, <#rate>, <#mode> .
<#art> a jig:Artwork ; jig:location <panel.svg> ; jig:mediaType "image/svg+xml" ; jig:integrity "${PIN}" .
<#rate> a jig:RotaryControl ; jig:boundSymbol "rate" ; jig:element "rate-knob" ; jig:pivotElement "rate-hub" ;
        jig:angleMin -135 ; jig:angleMax 135 .
<#depth> a jig:LinearControl ; jig:boundSymbol "depth" ; jig:element "depth-thumb" ; jig:trackElement "depth-slot" .
<#mode> a jig:SelectorControl ; jig:boundSymbol "mode" ; jig:element "mode-steps" .
`

const ports = [
  { symbol: 'rate', toggled: false, scalePoints: [], minimum: 0.1, maximum: 20 },
  { symbol: 'depth', toggled: false, scalePoints: [], minimum: 0, maximum: 1 },
  { symbol: 'mode', toggled: false, scalePoints: [{}, {}, {}], minimum: 0, maximum: 2 },
  { symbol: 'bypass', toggled: true, scalePoints: [], minimum: 0, maximum: 1 }
]
const ids = () => new Map([['rate-knob', 0], ['rate-hub', 0], ['depth-thumb', 0], ['depth-slot', 0], ['mode-steps', 3]])

describe('readSkin', () => {
  it('reads the artwork and every control, sorted by IRI', async () => {
    const skin = readSkin(await parseText(text, BASE))
    expect(skin.artwork).toEqual({ iri: `${BASE}#art`, location: `${BASE.replace('skin.ttl', 'panel.svg')}`, integrity: PIN, mediaType: 'image/svg+xml' })
    expect(skin.controls.map(c => [c.id.split('#')[1], c.kind, c.boundSymbol, c.element])).toEqual([
      ['depth', 'linear', 'depth', 'depth-thumb'],
      ['mode', 'selector', 'mode', 'mode-steps'],
      ['rate', 'rotary', 'rate', 'rate-knob']
    ])
    const rate = skin.controls.find(c => c.boundSymbol === 'rate')
    expect([rate.pivotElement, rate.angleMin, rate.angleMax]).toEqual(['rate-hub', -135, 135])
    expect(skin.controls.find(c => c.kind === 'linear').trackElement).toBe('depth-slot')
  })

  it('reads a document with no artwork and no controls as empty rather than throwing', async () => {
    const skin = readSkin(await parseText('@prefix jig: <http://purl.org/stuff/jigdaw/> .\n<> a jig:Skin .', BASE))
    expect(skin.artwork).toBeNull()
    expect(skin.controls).toEqual([])
  })

  it('finds the skin by its jig:artwork, wherever the document was fetched from', async () => {
    // A flattened bundle carries the file as a data: URI; its @base still says what it is about.
    const skin = readSkin(await parseText(text, 'data:text/turtle;base64,AAAA'))
    expect(skin.iri).toBe(BASE)
    expect(skin.controls).toHaveLength(3)
  })

  it('refuses a document that describes two skins, rather than choosing one', async () => {
    const two = text + '\n<https://example.org/other> jig:artwork <#art> .'
    const dataset = await parseText(two, BASE)
    expect(() => readSkin(dataset)).toThrow(/describes one skin/)
  })
})

describe('checkSkin', () => {
  const read = async (t = text) => readSkin(await parseText(t, BASE))

  it('keeps every control that agrees and lists the ports nobody binds', async () => {
    const result = checkSkin(await read(), { ids: ids() }, ports)
    expect(result.omitted).toEqual([])
    expect(result.keep.map(c => c.boundSymbol)).toEqual(['depth', 'mode', 'rate'])
    expect(result.unbound).toEqual(['bypass'])
  })

  it('leaves out a control whose element is not in the artwork, and names the id', async () => {
    const map = ids(); map.delete('rate-knob')
    const result = checkSkin(await read(), { ids: map }, ports)
    expect(result.omitted).toEqual([{ control: `${BASE}#rate`, reason: 'the artwork has no element for jig:element "rate-knob"' }])
    expect(result.unbound).toContain('rate')
  })

  it('names every missing id of one control, including its pivot and track', async () => {
    const result = checkSkin(await read(), { ids: new Map([['mode-steps', 3]]) }, ports)
    const rate = result.omitted.find(o => o.control.endsWith('#rate')).reason
    expect(rate).toContain('jig:element "rate-knob"')
    expect(rate).toContain('jig:pivotElement "rate-hub"')
    expect(result.omitted.find(o => o.control.endsWith('#depth')).reason).toContain('jig:trackElement "depth-slot"')
  })

  it('leaves out a binding to a port the plugin does not declare', async () => {
    const result = checkSkin(await read(), { ids: ids() }, ports.filter(p => p.symbol !== 'depth'))
    expect(result.omitted).toEqual([{ control: `${BASE}#depth`, reason: 'the plugin declares no port "depth"' }])
  })

  it('keeps the first of two controls on one port and leaves out the second', async () => {
    const twice = text.replace('jig:control <#depth>,', 'jig:control <#depth>, <#depth2>,')
      + '\n<#depth2> a jig:LinearControl ; jig:boundSymbol "depth" ; jig:element "depth-thumb" ; jig:trackElement "depth-slot" .'
    const result = checkSkin(await read(twice), { ids: ids() }, ports)
    expect(result.keep.filter(c => c.boundSymbol === 'depth').map(c => c.id.split('#')[1])).toEqual(['depth'])
    expect(result.omitted).toEqual([{ control: `${BASE}#depth2`, reason: 'port "depth" is already bound by an earlier control' }])
  })

  it('lets a readout sit beside the control that sets its port, and does not count it as reaching the port', async () => {
    const withReadout = text.replace('jig:control <#depth>,', 'jig:control <#depth>, <#depthText>, <#bypassText>,')
      + '\n<#depthText> a jig:ReadoutControl ; jig:boundSymbol "depth" ; jig:element "mode-steps" .'
      + '\n<#bypassText> a jig:ReadoutControl ; jig:boundSymbol "bypass" ; jig:element "mode-steps" .'
    const result = checkSkin(await read(withReadout), { ids: ids() }, ports)
    expect(result.omitted).toEqual([])
    expect(result.keep.filter(c => c.kind === 'readout')).toHaveLength(2)
    expect(result.unbound).toEqual(['bypass'])
  })

  it('leaves out a selector whose artwork has the wrong number of steps', async () => {
    const map = ids(); map.set('mode-steps', 2)
    const result = checkSkin(await read(), { ids: map }, ports)
    expect(result.omitted).toEqual([{ control: `${BASE}#mode`, reason: 'a selector for "mode" needs 3 child groups and "mode-steps" has 2' }])
  })

  it('counts the steps of an integer port with no scale points', async () => {
    const integerPorts = ports.map(p => p.symbol === 'mode' ? { ...p, scalePoints: [], minimum: 1, maximum: 4 } : p)
    const map = ids(); map.set('mode-steps', 4)
    expect(checkSkin(await read(), { ids: map }, integerPorts).omitted).toEqual([])
  })

  it('leaves out a selector on a port that is not whole steps', async () => {
    const result = checkSkin(await read(), { ids: ids() }, ports.map(p => p.symbol === 'mode' ? { ...p, scalePoints: [], maximum: 2.5 } : p))
    expect(result.omitted[0].reason).toContain('no whole number of steps')
  })

  it('checks a toggle for exactly two child groups', async () => {
    const t = text.replace('jig:SelectorControl', 'jig:ToggleControl').replace('"mode"', '"bypass"')
    const two = new Map(ids()); two.set('mode-steps', 2)
    expect(checkSkin(await read(t), { ids: two }, ports).omitted).toEqual([])
    const three = checkSkin(await read(t), { ids: ids() }, ports)
    expect(three.omitted).toEqual([{ control: `${BASE}#mode`, reason: 'a toggle needs 2 child groups and "mode-steps" has 3' }])
  })

  it('leaves out a control with no class and one with no element', async () => {
    const t = text + '\n<#bare> jig:boundSymbol "bypass" ; jig:element "x" .\n<#noelem> a jig:ToggleControl ; jig:boundSymbol "bypass" .'
      .replace('jig:control <#depth>', 'jig:control <#depth>')
    const withBoth = t.replace('jig:control <#depth>,', 'jig:control <#depth>, <#bare>, <#noelem>,')
    const reasons = Object.fromEntries(checkSkin(await read(withBoth), { ids: ids() }, ports).omitted.map(o => [o.control.split('#')[1], o.reason]))
    expect(reasons.bare).toBe('it has no control class')
    expect(reasons.noelem).toContain('jig:element (none given)')
  })
})
