// tests/ui/HtmlSkinCss.test.js
//
// The stylesheet half of an HTML skin (src/ui/HtmlSkinCss.js, docs/html-skins.md "Style"). One hostile sheet per refusal,
// each asserting its own reason, since a refusal test that a different refusal also satisfies proves nothing.
import { describe, it, expect } from 'vitest'
import { checkCss, CSS_LIMITS } from '../../src/ui/HtmlSkinCss.js'

const inLayer = body => `@layer skin { ${body} }`
const problemsOf = (text, pattern) => {
  const { problems, css } = checkCss(text, 'p-')
  expect(css, 'a refused sheet writes nothing').toBe('')
  expect(problems.some(p => pattern.test(p)), problems.join('\n') || 'no problems found').toBe(true)
}

describe('what a stylesheet may contain', () => {
  it('is rewritten inside one cascade layer, from what was recognised, with ids prefixed', () => {
    const { css, problems } = checkCss(inLayer('#th { color: red } .row, .row:hover { display: grid; gap: 8px }'), 'p-')
    expect(problems).toEqual([])
    expect(css).toBe('@layer skin{#p-th{color:red}.row,.row:hover{display:grid;gap:8px}}')
  })

  it('accepts the properties a layout needs, math and layout functions, and container and media queries on size', () => {
    const { problems } = checkCss(inLayer('.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(17rem, 100%), 1fr)); gap: 12px; min-height: 44px; accent-color: #3d8bfd; position: relative; z-index: 3 } @container (max-width: 360px) { .row { display: block } } @media (min-width: 600px) and (max-height: 900px) { .row { gap: 2px } }'), 'p-')
    expect(problems).toEqual([])
  })

  it('writes nothing, and says so, for an empty sheet', () => {
    expect(checkCss('', 'p-')).toEqual({ css: '', problems: [] })
  })
})

describe('rules refused', () => {
  const refused = [
    ['an import', '@import "x.css";', /@import is refused/],
    ['a font face', inLayer('@font-face { font-family: x }'), /@font-face is refused/],
    ['keyframes', '@keyframes k { from { color: red } }', /@keyframes is refused/],
    ['@supports', inLayer('@supports (display: grid) { .a { color: red } }'), /@supports is refused/],
    ['a rule outside the skin layer', '.a { color: red }', /outside @layer skin/],
    ['a layer with another name', '@layer other { .a { color: red } }', /not the one skin layer/],
    ['a nested skin layer', inLayer('@layer skin { .a { color: red } }'), /not the one skin layer/],
    ['a media query on the colour scheme', inLayer('@media (prefers-color-scheme: dark) { .a { color: red } }'), /only width and height/],
    ['a media query outside the layer', '@media (max-width: 300px) { .a { color: red } }', /outside @layer skin/],
    ['an unclosed brace', '@layer skin { .a { color: red }', /unclosed brace/],
    ['an unmatched brace', '}', /unmatched closing brace/]
  ]
  for (const [name, text, pattern] of refused) it(`refuses ${name}`, () => problemsOf(text, pattern))
})

describe('properties and values refused', () => {
  const refused = [
    ['fixed positioning', 'position: fixed', /position fixed is not allowed/],
    ['sticky positioning', 'position: sticky', /position sticky is not allowed/],
    ['display none', 'display: none', /display none is not allowed/],
    ['opacity', 'opacity: 0', /property opacity is not allowed/],
    ['visibility', 'visibility: hidden', /property visibility is not allowed/],
    ['pointer-events', 'pointer-events: none', /property pointer-events is not allowed/],
    ['a transform', 'transform: scale(100)', /property transform is not allowed/],
    ['a filter', 'filter: blur(9px)', /property filter is not allowed/],
    ['content', 'content: x', /property content is not allowed/],
    ['an animation', 'animation: k 1s', /property animation is not allowed/],
    ['a transition', 'transition: all 1s', /property transition is not allowed/],
    ['a background shorthand, which can carry an image', 'background: red', /property background is not allowed/],
    ['a border image', 'border-image: x', /property border-image is not allowed/],
    ['a custom property', '--x: 1', /custom property --x is refused/],
    ['a url', 'background-color: url(x)', /refused function/],
    ['an image set', 'color: image-set(x)', /refused function/],
    ['a var', 'color: var(--x)', /refused function/],
    ['an attr', 'color: attr(x)', /refused function/],
    ['a z-index over 10', 'z-index: 99', /z-index 99 is not a whole number from 0 to 10/],
    ['a negative z-index', 'z-index: -1', /z-index -1/],
    ['a font that is not generic', 'font-family: Arial', /arial is not a generic family/],
    ['a large shadow', 'box-shadow: 0px 0px 40px red', /blur 40px is over 16px/],
    ['a container type other than inline-size', 'container-type: size', /container-type size is not allowed/],
    ['a quote, which could hold a url the word filter would miss', 'color: "u"', /character a value may not hold/],
    ['a backslash, which spells url( without writing it', 'color: ur\\6c(x)', /character a value may not hold/],
    ['!important, which beats the host in a lower layer', 'color: red !important', /character a value may not hold/]
  ]
  for (const [name, declaration, pattern] of refused) it(`refuses ${name}`, () => problemsOf(inLayer(`.a { ${declaration} }`), pattern))
})

describe('selectors refused', () => {
  const refused = [
    [':has', 'div:has(input)', /:has is not allowed/],
    [':not', 'div:not(.a)', /:not is not allowed/],
    [':visited', 'a:visited', /:visited is not allowed/],
    [':target', 'div:target', /:target is not allowed/],
    ['a pseudo-element', 'div::before', /pseudo-element/],
    ['the universal selector', '*', /character a selector may not hold/],
    ['a sibling combinator', 'div + div', /character a selector may not hold/],
    ['an attribute with a value, which could probe', '[data-param=tone]', /character a selector may not hold/],
    ['an attribute that is not the bound family', '[href]', /not an allowed selector/],
    ['an element that is not allowed', 'script', /not an allowed selector/],
    ['five compound parts', '.a .b .c .d .e', /more than four compound parts/]
  ]
  for (const [name, selector, pattern] of refused) it(`refuses ${name}`, () => problemsOf(inLayer(`${selector} { color: red }`), pattern))
})

describe('limits', () => {
  it('refuses a sheet over its size limit, and one with too many rules', () => {
    problemsOf('x'.repeat(CSS_LIMITS.bytes + 1), /over the \d+ limit/)
    problemsOf(inLayer('.a { color: red } '.repeat(CSS_LIMITS.rules + 1)), /rules, over the 500 limit/)
  })
})
