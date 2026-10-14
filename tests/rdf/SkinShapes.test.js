// tests/rdf/SkinShapes.test.js
//
// The skin shapes (docs/svg-skins.md) are new constraints, and a shape that is
// wrong passes everything, which looks the same as a shape that works. So each
// is broken once on purpose, and the report has to name that shape's message.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { parseText } from '../../src/rdf/parse.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const BASE = 'https://example.org/plugins/tremolo/skin.ttl'
const PIN = `sha384-${'A'.repeat(64)}`

const PREFIXES = `
@prefix jig: <http://purl.org/stuff/jigdaw/> .
@base <${BASE}> .
`

const art = `
<#art> a jig:Artwork ; jig:location <panel.svg> ; jig:mediaType "image/svg+xml" ; jig:integrity "${PIN}" .`

const skin = (body, artwork = art) => `${PREFIXES}
<> jig:artwork <#art> ; jig:control <#rate> .
${artwork}
${body}`

const rotary = `
<#rate> a jig:Rotary ; jig:portSymbol "rate" ; jig:element "rate-knob" ; jig:angleMin -135 ; jig:angleMax 135 .`

describe('skin shapes', () => {
  let validator
  beforeAll(async () => { validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl')) })

  const messages = async text => (await validator.validate(await parseText(text, BASE))).violations.map(v => v.message)

  it('accepts a skin with an artwork and a rotary', async () => {
    expect(await messages(skin(rotary))).toEqual([])
  })

  it('accepts a linear control with a track', async () => {
    const linear = `<#rate> a jig:Linear ; jig:portSymbol "depth" ; jig:element "thumb" ; jig:trackElement "slot" .`
    expect(await messages(skin(linear))).toEqual([])
  })

  it('refuses artwork that is not SVG', async () => {
    const png = art.replace('image/svg+xml', 'image/png')
    expect(await messages(skin(rotary, png))).toEqual([expect.stringContaining('must be image/svg+xml')])
  })

  it('refuses artwork with no digest, as any resource', async () => {
    const bare = art.replace(`; jig:integrity "${PIN}"`, '')
    expect((await messages(skin(rotary, bare))).join('\n')).toContain('Subresource Integrity')
  })

  it('refuses a control with no port symbol', async () => {
    const text = skin(rotary.replace('jig:portSymbol "rate" ;', ''))
    expect(await messages(text)).toEqual([expect.stringContaining('by its lv2:symbol')])
  })

  it('refuses a control with no element', async () => {
    const text = skin(rotary.replace('jig:element "rate-knob" ;', ''))
    expect(await messages(text)).toEqual([expect.stringContaining('artwork element it moves')])
  })

  it('refuses a rotary with no angles, one message each', async () => {
    const text = skin(`<#rate> a jig:Rotary ; jig:portSymbol "rate" ; jig:element "k" .`)
    const found = await messages(text)
    expect(found).toHaveLength(2)
    expect(found.join('\n')).toContain('jig:angleMin')
    expect(found.join('\n')).toContain('jig:angleMax')
  })

  it('refuses a linear control with no track', async () => {
    const text = skin(`<#rate> a jig:Linear ; jig:portSymbol "depth" ; jig:element "thumb" .`)
    expect(await messages(text)).toEqual([expect.stringContaining('jig:trackElement')])
  })

  it('refuses a skin with an artwork and no control', async () => {
    const text = `${PREFIXES}\n<> jig:artwork <#art> .${art}`
    expect(await messages(text)).toEqual([expect.stringContaining('binds at least one control')])
  })

  it('refuses a skin with two artworks', async () => {
    const two = `${art}\n<#art2> a jig:Artwork ; jig:location <b.svg> ; jig:mediaType "image/svg+xml" ; jig:integrity "${PIN}" .`
    const text = skin(rotary, two).replace('jig:artwork <#art> ;', 'jig:artwork <#art>, <#art2> ;')
    expect(await messages(text)).toEqual([expect.stringContaining('exactly one artwork')])
  })
})

describe('skin shapes, numeric literals', () => {
  it('takes an angle written as a bare integer, a decimal or a double', async () => {
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    for (const [min, max] of [['-135', '135'], ['-135.5', '135.5'], ['-1.35e2', '1.35e2']]) {
      const text = skin(rotary.replace('-135', min).replace('135 .', `${max} .`))
      const report = await validator.validate(await parseText(text, BASE))
      expect(report.violations.map(v => v.message), `${min} to ${max}`).toEqual([])
    }
  })

  it('refuses an angle that is a string', async () => {
    const validator = await shapeValidatorFromFile(resolve(root, 'vocabs/shapes.ttl'))
    const text = skin(rotary.replace('jig:angleMin -135', 'jig:angleMin "left"'))
    const report = await validator.validate(await parseText(text, BASE))
    expect(report.violations.map(v => v.message)).toEqual([expect.stringContaining('jig:angleMin')])
  })
})
