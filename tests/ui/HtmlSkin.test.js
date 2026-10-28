// tests/ui/HtmlSkin.test.js
//
// The markup half of an HTML skin (src/ui/HtmlSkin.js, docs/html-skins.md "What the markup may contain"): the allowlist,
// the refusals, the bindings left out, and what a built skin looks like. Parsed with linkedom, which is more permissive than
// a browser's parser, so this holds the checker's own rules and the Chrome check (bin/check-skins.js) holds the parser's.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { checkHtmlSkin, buildHtmlSkin, HtmlSkinError, HTML_SKIN_LIMITS } from '../../src/ui/HtmlSkin.js'

const PORTS = [
  { symbol: 'tone', name: 'Tone', widget: 'dial', minimum: 0, maximum: 1 },
  { symbol: 'mute', name: 'Mute', widget: 'switch', minimum: 0, maximum: 1 },
  { symbol: 'model', name: 'Model', widget: 'selector', minimum: 0, maximum: 2 }
]
const page = (body, { head = '' } = {}) => parseHTML(`<!doctype html><html><head>${head}</head><body>${body}</body></html>`).document
const slider = '<input type="range" data-param="tone">'
const problems = (body, opts) => checkHtmlSkin(page(body, opts), PORTS).problems
const expectProblem = (body, pattern, opts) => {
  const found = problems(body, opts)
  expect(found.some(p => pattern.test(p)), found.join('\n') || 'no problems found').toBe(true)
}

describe('what a skin may contain', () => {
  it('accepts structure, labels, outputs and the three kinds of control', () => {
    const doc = page(`<section><h2>Voice</h2><div><label for="t" data-param-name="tone"></label>${slider.replace('<input', '<input id="t"')}<output data-param-text="tone"></output></div>
      <input type="checkbox" data-param="mute"><select data-param="model"></select><p data-param-help></p></section>`)
    expect(checkHtmlSkin(doc, PORTS)).toEqual({ problems: [], omitted: [], css: '' })
  })

  it('accepts a head holding only a title and the one stylesheet', () => {
    const doc = page(slider, { head: '<title>x</title><style>@layer skin { div { color: red } }</style>' })
    const checked = checkHtmlSkin(doc, PORTS)
    expect(checked.problems).toEqual([])
    expect(checked.css).toBe('@layer skin{div{color:red}}')
  })
})

describe('markup refused', () => {
  const elements = ['script', 'link', 'meta', 'base', 'iframe', 'object', 'embed', 'img', 'picture', 'video', 'audio', 'canvas', 'form', 'button', 'a', 'template', 'noscript', 'math', 'svg', 'table', 'textarea']
  for (const tag of elements) it(`refuses <${tag}>`, () => expectProblem(`<${tag}></${tag}>`, new RegExp(`<${tag}> is not an allowed element`)))

  it('refuses a custom element', () => expectProblem('<my-knob></my-knob>', /<my-knob> is not an allowed element/))

  const attributes = ['onclick', 'onerror', 'href', 'src', 'srcset', 'action', 'style', 'tabindex', 'contenteditable', 'draggable', 'autofocus', 'accesskey', 'is', 'slot', 'role', 'aria-label', 'aria-labelledby']
  for (const name of attributes) it(`refuses the ${name} attribute`, () => expectProblem(`<div ${name}="x"></div>`, new RegExp(`${name} is not an allowed attribute on <div>`)))

  it('refuses an input of another type, and one with no binding', () => {
    expectProblem('<input type="text" data-param="tone">', /<input type=text> is not allowed/)
    expectProblem('<input type="file" data-param="tone">', /<input type=file> is not allowed/)
    expectProblem('<input type="range">', /<input> without data-param is not allowed/)
    expectProblem('<select></select>', /<select> without data-param is not allowed/)
  })

  it('refuses options the author wrote, since the host makes them from the scale points', () => {
    expectProblem('<select data-param="model"><option>x</option></select>', /option children/)
  })

  it('refuses a label that names no element of the file', () => expectProblem('<label for="ghost">x</label>', /for="ghost" names no element/))

  it('refuses a head element other than a title and a stylesheet', () => {
    expectProblem(slider, /head > meta is not allowed/, { head: '<meta http-equiv="refresh" content="0;url=x">' })
    expectProblem(slider, /head > link is not allowed/, { head: '<link rel="stylesheet" href="x.css">' })
    expectProblem(slider, /head > script is not allowed/, { head: '<script>1</script>' })
    expectProblem(slider, /head > base is not allowed/, { head: '<base href="https://evil.example/">' })
  })

  it('refuses two stylesheets, wherever they are', () => {
    expectProblem(slider + '<style></style>', /2 style elements/, { head: '<style></style>' })
    expectProblem(slider + '<style></style><style></style>', /2 style elements/)
  })

  it('names the element and where it is', () => {
    expectProblem('<div></div><section><div><img src="x"></div></section>', /^section\[1\] > div\[1\] > img\[1\]: <img> is not an allowed element$/)
  })

  it('reports every reason, not only the first', () => {
    const found = problems('<script></script><img><a></a>')
    expect(found).toHaveLength(3)
  })

  it('carries the stylesheet\'s own refusals, prefixed with where they came from', () => {
    expectProblem(slider + '<style>@layer skin { div { position: fixed } }</style>', /^style: .*position fixed is not allowed/)
  })
})

describe('a binding the profile cannot honour is left out, not refused', () => {
  it('leaves out a binding to a port the plugin does not declare', () => {
    const { problems: p, omitted } = checkHtmlSkin(page('<input type="range" data-param="nope">'), PORTS)
    expect(p).toEqual([])
    expect(omitted).toEqual([{ element: 'input[1]', reason: 'data-param="nope" names no port of this plugin' }])
  })

  it('leaves out a control of the wrong kind for its port', () => {
    const { omitted } = checkHtmlSkin(page('<input type="range" data-param="mute"><input type="checkbox" data-param="tone"><input type="range" data-param="model">'), PORTS)
    expect(omitted.map(o => o.reason)).toEqual([
      'a range cannot set mute, which is a switch',
      'a checkbox cannot set tone, which is a dial',
      'a range cannot set model, which is a selector'
    ])
  })
})

describe('limits', () => {
  it('refuses a skin with too many elements, and one that is too large', () => {
    expectProblem('<span></span>'.repeat(HTML_SKIN_LIMITS.elements + 1), /elements, over the 2000 limit/)
    const doc = page(slider)
    expect(() => buildHtmlSkin(doc, { ports: PORTS }, { document: doc, prefix: 'p-', size: HTML_SKIN_LIMITS.bytes + 1 })).toThrow(/over the 262144 limit/)
  })
})

describe('building', () => {
  const build = (body, head) => {
    const doc = page(body, { head })
    return buildHtmlSkin(doc, { ports: PORTS }, { document: doc, prefix: 'p-' })
  }

  it('prefixes ids and the labels that point at them, and the ids in the stylesheet', () => {
    const built = build('<label for="t">Tone</label><input id="t" type="range" data-param="tone">', '<style>@layer skin { #t { color: red } }</style>')
    expect(built.root.querySelector('label').getAttribute('for')).toBe('p-t')
    expect(built.root.querySelector('input').getAttribute('id')).toBe('p-t')
    expect(built.css).toBe('@layer skin{#p-t{color:red}}')
  })

  it('lists the controls with their ports, and the bound text, names and help elements', () => {
    const built = build('<span data-param-name="tone"></span><input type="range" data-param="tone"><output data-param-text="tone"></output><p data-param-help></p>')
    expect(built.controls.map(c => [c.port.symbol, c.kind])).toEqual([['tone', 'range']])
    expect(built.texts.map(t => t.symbol)).toEqual(['tone'])
    expect(built.names.map(t => t.symbol)).toEqual(['tone'])
    expect(built.help).toHaveLength(1)
  })

  it('builds new nodes and never the author\'s: nothing in the result is a node of the parsed document', () => {
    const doc = page(slider)
    const original = doc.body.querySelector('input')
    const built = buildHtmlSkin(doc, { ports: PORTS }, { document: doc, prefix: 'p-' })
    expect(built.root.querySelector('input')).not.toBe(original)
  })

  it('copies text as text', () => {
    const built = build('<p>&lt;img src=x onerror=alert(1)&gt;</p>')
    expect(built.root.querySelector('p').textContent).toBe('<img src=x onerror=alert(1)>')
    expect(built.root.querySelector('img')).toBeNull()
  })

  it('leaves a refused binding out of the result and keeps its label', () => {
    const built = build('<label>x</label><input type="range" data-param="nope">')
    expect(built.controls).toEqual([])
    expect(built.root.querySelector('input')).toBeNull()
    expect(built.root.querySelector('label')).not.toBeNull()
    expect(built.omitted).toHaveLength(1)
  })

  it('throws HtmlSkinError naming every reason when the skin breaks a rule', () => {
    const doc = page('<script></script><img>')
    try {
      buildHtmlSkin(doc, { ports: PORTS }, { document: doc, prefix: 'p-' })
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(HtmlSkinError)
      expect(error.problems).toHaveLength(2)
      expect(error.message).toMatch(/and 1 more/)
    }
  })
})
