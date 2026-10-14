// tests/ui/SkinArtwork.test.js
//
// The allowlist is a security boundary (contract section 9.4), so each refusal
// is asserted by its reason and each copy by what it kept and what it dropped.
// The trees are built by hand with their real namespaces, because linkedom's
// DOMParser gives every element the XHTML namespace and so would let any
// artwork through as "not SVG" or be dropped whole, which tests nothing.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { buildArtwork, parseSvg, SkinError, SVG_NS, SKIN_LIMITS } from '../../src/ui/SkinArtwork.js'

const INKSCAPE = 'http://www.inkscape.org/namespaces/inkscape'
const { document } = parseHTML('<!doctype html><html><body></body></html>')

// el('g', { id: 'a' }, [children]); a string child is text.
function el (name, attrs = {}, children = [], ns = SVG_NS) {
  const e = document.createElementNS(ns, name)
  for (const [k, v] of Object.entries(attrs)) {
    if (k.startsWith('inkscape:') || k.startsWith('xlink:')) {
      e.setAttributeNS(k.startsWith('xlink:') ? 'http://www.w3.org/1999/xlink' : INKSCAPE, k, v)
    } else e.setAttribute(k, v)
  }
  for (const c of children) e.append(typeof c === 'string' ? document.createTextNode(c) : c)
  return e
}
const docOf = root => ({ documentElement: root })
const build = (root, extra = {}) => buildArtwork(docOf(root), { document, prefix: 'skin1-', ...extra })
const svg = (...children) => el('svg', { viewBox: '0 0 100 100' }, children)

describe('buildArtwork, what it keeps', () => {
  it('copies shapes and text and prefixes every id', () => {
    const { svg: out, ids } = build(svg(
      el('g', { id: 'rate-knob' }, [el('circle', { cx: '50', cy: '50', r: '20', fill: '#333' })]),
      el('text', { x: '1', y: '2' }, ['Rate'])
    ))
    expect(out.namespaceURI).toBe(SVG_NS)
    expect(out.querySelector('#skin1-rate-knob circle').getAttribute('r')).toBe('20')
    expect(out.querySelector('text').textContent).toBe('Rate')
    expect([...ids.keys()]).toEqual(['rate-knob'])
    expect(out.getAttribute('viewBox')).toBe('0 0 100 100')
  })

  it('rewrites same-file references to the prefixed ids', () => {
    const { svg: out } = build(svg(
      el('defs', {}, [el('linearGradient', { id: 'g1' }, [el('stop', { offset: '0', 'stop-color': '#000' })])]),
      el('rect', { id: 'r', fill: 'url(#g1)', style: 'stroke:url(#g1);stroke-width:2' }),
      el('use', { href: '#r' })
    ))
    expect(out.querySelector('rect').getAttribute('fill')).toBe('url(#skin1-g1)')
    expect(out.querySelector('rect').getAttribute('style')).toBe('stroke:url(#skin1-g1);stroke-width:2')
    expect(out.querySelector('use').getAttribute('href')).toBe('#skin1-r')
  })

  it('reports each id with the number of child elements its copy has', () => {
    const { ids } = build(svg(
      el('g', { id: 'toggle' }, [el('g'), el('g')]),
      el('g', { id: 'steps' }, [el('g'), el('g'), el('g')]),
      el('circle', { id: 'leaf', r: '1' })
    ))
    expect([...ids]).toEqual([['toggle', 2], ['steps', 3], ['leaf', 0]])
  })

  it('returns each id\'s copied element, so nothing needs to select by id', () => {
    const { svg: out, elements } = build(svg(el('g', { id: 'knob' }, [el('circle', { r: '1' })])))
    expect([...elements.keys()]).toEqual(['knob'])
    expect(elements.get('knob').getAttribute('id')).toBe('skin1-knob')
    expect(out.contains(elements.get('knob'))).toBe(true)
  })

  it('keeps known style properties and drops the rest', () => {
    const { svg: out } = build(svg(el('rect', { style: 'fill:#fff;-inkscape-font-specification:Sans;stroke-width:1;behavior:x' })))
    expect(out.querySelector('rect').getAttribute('style')).toBe('fill:#fff;stroke-width:1')
  })
})

describe('buildArtwork, what it drops without complaint', () => {
  it('drops elements and attributes in other namespaces, and the subtree of an element', () => {
    const { svg: out } = build(svg(
      el('metadata', {}, [], 'http://example.org/other'),
      el('g', { id: 'a', 'inkscape:label': 'knob' }, [
        el('namedview', {}, [el('circle', { r: '1' })], INKSCAPE),
        el('circle', { r: '2' })
      ])
    ))
    expect(out.querySelectorAll('circle')).toHaveLength(1)
    expect(out.querySelector('g').getAttributeNames()).toEqual(['id'])
    expect(out.innerHTML).not.toMatch(/inkscape|other|namedview/)
  })

  it('does not carry xlink:href across, so it is not a way round the href rule', () => {
    const { svg: out } = build(svg(el('use', { 'xlink:href': 'https://evil.example/x.svg#a' })))
    expect(out.querySelector('use').getAttributeNames()).toEqual([])
  })

  it('drops an attribute that is not on the list, such as class and data-*', () => {
    const { svg: out } = build(svg(el('rect', { class: 'x', 'data-a': '1', width: '3' })))
    expect(out.querySelector('rect').getAttributeNames()).toEqual(['width'])
  })

  it('keeps text only inside text elements, so a stray string is not a way in', () => {
    const { svg: out } = build(svg('loose', el('g', {}, ['also loose'])))
    expect(out.textContent).toBe('')
  })
})

describe('buildArtwork, what it refuses', () => {
  for (const name of ['script', 'foreignObject', 'image', 'style', 'filter', 'a', 'animate', 'set', 'animateTransform', 'mask', 'pattern', 'marker', 'symbol']) {
    it(`refuses <${name}> and says where`, () => {
      const root = svg(el('g', {}, [el('g'), el(name)]))
      expect(() => build(root)).toThrow(SkinError)
      try { build(root) } catch (e) {
        expect(e.message).toContain(`<${name}> is not an allowed element`)
        expect(e.element).toBe(`svg > g[1] > ${name}[1]`)
      }
    })
  }

  it('refuses an event attribute', () => {
    expect(() => build(svg(el('circle', { r: '1', onclick: 'alert(1)' })))).toThrow(/event attribute onclick/)
    expect(() => build(svg(el('circle', { r: '1', onLoad: 'x' })))).toThrow(/event attribute onLoad/)
  })

  it('refuses an href that leaves the file', () => {
    for (const href of ['https://evil.example/x.svg#a', 'data:image/svg+xml,<svg/>', 'javascript:alert(1)', 'other.svg#a', '#']) {
      expect(() => build(svg(el('use', { href }))), href).toThrow(/leaves the file/)
    }
  })

  it('refuses a url() that leaves the file, in an attribute or a style', () => {
    expect(() => build(svg(el('rect', { fill: 'url(https://evil.example/a)' })))).toThrow(/leaves the file/)
    expect(() => build(svg(el('rect', { style: 'fill:url(http://evil.example/a)' })))).toThrow(/leaves the file/)
    expect(() => build(svg(el('rect', { style: "fill:url('//evil.example/a')" })))).toThrow(/leaves the file/)
  })

  it('refuses code and imports in a value, and a CSS escape in a style', () => {
    expect(() => build(svg(el('rect', { fill: 'javascript:1' })))).toThrow(/runs or imports code/)
    expect(() => build(svg(el('rect', { style: '@import "x"' })))).toThrow(/runs or imports code/)
    expect(() => build(svg(el('rect', { style: 'fill:u\\72l(http://evil.example)' })))).toThrow(/CSS escape/)
  })

  it('refuses an id used twice', () => {
    expect(() => build(svg(el('g', { id: 'a' }), el('g', { id: 'a' })))).toThrow(/used twice/)
  })

  it('refuses a root that is not svg in the SVG namespace, which is what a parser that ignores namespaces gives', () => {
    expect(() => build(el('svg', {}, [], 'http://www.w3.org/1999/xhtml'))).toThrow(/not an svg element in the SVG namespace/)
    expect(() => build(el('html', {}, [], SVG_NS))).toThrow(/not an svg element/)
  })

  it('refuses a file or a tree over its limit', () => {
    expect(() => build(svg(), { size: SKIN_LIMITS.bytes + 1 })).toThrow(/limit is/)
    const many = svg(...Array.from({ length: 6 }, () => el('g')))
    expect(() => build(many, { limits: { bytes: 1000, elements: 5 } })).toThrow(/more than 5 elements/)
    expect(() => build(many, { limits: { bytes: 1000, elements: 7 } })).not.toThrow()
  })

  it('needs an id prefix', () => {
    expect(() => buildArtwork(docOf(svg()), { document, prefix: '' })).toThrow(TypeError)
  })
})

describe('parseSvg', () => {
  const Parser = (parsed) => class { parseFromString (text, type) { this.type = type; return parsed } }

  it('asks for image/svg+xml and returns the document', () => {
    let asked
    class P { parseFromString (text, type) { asked = type; return { getElementsByTagName: () => [] } } }
    expect(parseSvg('<svg/>', P)).toBeTruthy()
    expect(asked).toBe('image/svg+xml')
  })

  it('turns a parsererror document into a SkinError', () => {
    const failed = { getElementsByTagName: () => [{ textContent: 'Opening and ending tag mismatch\nline 1' }] }
    expect(() => parseSvg('<svg><g></svg>', Parser(failed))).toThrow(/not well formed XML: Opening and ending tag mismatch/)
  })
})
