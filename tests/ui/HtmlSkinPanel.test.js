// tests/ui/HtmlSkinPanel.test.js
//
// An HTML skin operated (src/ui/HtmlSkinPanel.js): what the host supplies that the author's markup does not, and the
// rule that a control draws the value the host sent and never the one it asked for. Run against a linkedom document, which
// has no layout, so the cramped check is given the measurements a browser would; bin/check-skins.js runs it for real.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { buildHtmlSkin } from '../../src/ui/HtmlSkin.js'
import { createHtmlSkinPanel } from '../../src/ui/HtmlSkinPanel.js'

// Where the built nodes are: in the shadow root where the document has one, and in the host where it does not.
const inside = panel => panel.element.shadowRoot ?? panel.element

const PORTS = [
  { symbol: 'tone', name: 'Tone', widget: 'dial', minimum: 0, maximum: 1, unit: null, scalePoints: [], comment: 'How bright it is.' },
  { symbol: 'cutoff', name: 'Cutoff', widget: 'dial', minimum: 20, maximum: 20000, unit: 'http://lv2plug.in/ns/extensions/units#hz', scalePoints: [], comment: null },
  { symbol: 'mute', name: 'Mute', widget: 'switch', minimum: 0, maximum: 1, unit: null, scalePoints: [], comment: null },
  { symbol: 'model', name: 'Model', widget: 'selector', minimum: 0, maximum: 2, unit: null, scalePoints: [{ label: 'Keys', value: 0 }, { label: 'Reed', value: 1 }, { label: 'Pad', value: 2 }], comment: null }
]

const BODY = `<div>
  <label for="t">Tone</label><input id="t" type="range" data-param="tone">
  <label for="c" data-param-name="cutoff"></label><input id="c" type="range" data-param="cutoff"><output data-param-text="cutoff"></output>
  <input id="m" type="checkbox" data-param="mute">
  <select id="s" data-param="model"></select><output data-param-text="model"></output>
</div>`

function start (body = BODY) {
  const { document, window } = parseHTML(`<!doctype html><html><head><style>@layer skin { div { color: red } }</style></head><body>${body}</body></html>`)
  const built = buildHtmlSkin(document, { ports: PORTS }, { document, prefix: 'p-' })
  const changes = []
  const panel = createHtmlSkinPanel(document, built, PORTS, (symbol, value) => changes.push([symbol, value]), { scope: 'x' })
  const fire = (el, type, extra = {}) => { const e = new window.Event(type); Object.assign(e, extra); el.dispatchEvent(e) }
  const q = id => inside(panel).querySelector(`#p-${id}`)
  return { panel, changes, fire, q, built }
}

describe('what the host supplies', () => {
  it('names a control after its port, whatever the author labelled it', () => {
    const { q } = start()
    expect(q('t').getAttribute('aria-label')).toBe('Tone')
    expect(q('c').getAttribute('aria-label')).toBe('Cutoff')
  })

  it('says the value with its unit in words, once drawn', () => {
    const { panel, q } = start()
    panel.update('cutoff', 440)
    expect(q('c').getAttribute('aria-valuetext')).toBe('440 hertz')
  })

  it('takes range, step and a select\'s options from the port', () => {
    const { q } = start()
    expect(q('c').min).toBe('20')
    expect(q('c').max).toBe('20000')
    expect([...q('s').options].map(o => o.textContent)).toEqual(['Keys', 'Reed', 'Pad'])
  })

  it('writes a port\'s name into an element that asks for it, and its value into an output', () => {
    const { panel, q } = start()
    expect(inside(panel).querySelector('label[for="p-c"]').textContent).toBe('Cutoff')
    panel.update('cutoff', 440)
    expect(inside(panel).querySelectorAll('output')[0].textContent).toBe('440 Hz')
    panel.update('model', 1)
    expect(inside(panel).querySelectorAll('output')[1].textContent).toBe('Reed')
    expect(q('c')).not.toBeNull()
  })

  it('hides an output from assistive technology, since the control reports its value', () => {
    const { panel } = start()
    expect(inside(panel).querySelector('output').getAttribute('aria-hidden')).toBe('true')
  })

  it('writes its own rules after the author\'s, outside the author\'s cascade layer', () => {
    const { panel } = start()
    const sheet = inside(panel).querySelector('style').textContent
    expect(sheet.startsWith('@layer skin{')).toBe(true)
    expect(sheet).toContain('min-height:44px')
    expect(sheet).toContain('input:focus-visible,select:focus-visible{outline:2px solid')
    expect(sheet.indexOf('@layer skin{')).toBeLessThan(sheet.indexOf('min-height:44px'))
    // The host's rules are after the layer's closing brace, so they are not in it.
    const layer = sheet.slice(0, sheet.indexOf('}}') + 2)
    expect(layer).not.toContain('44px')
  })

  it('reports a visible label that is not part of the port\'s name', () => {
    const { panel } = start()
    expect(panel.warnings).toEqual([])
    const bad = start('<label for="t">Brightness</label><input id="t" type="range" data-param="tone">')
    expect(bad.panel.warnings).toEqual(['the label "Brightness" is not part of the port\'s name "Tone"'])
  })
})

describe('operating it', () => {
  it('sends a slider\'s move as a request and does not move the control itself', () => {
    const { panel, changes, fire, q } = start()
    panel.update('tone', 0.2)
    q('t').value = '0.9'
    fire(q('t'), 'input')
    expect(changes).toEqual([['tone', 0.9]])
    panel.update('tone', 0.5)
    expect(q('t').value).toBe('0.5')
  })

  it('follows a drag on the document and survives the input being taken out and put back, as a redraw does', () => {
    const { panel, changes, fire, q } = start()
    const input = q('t')
    input.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 44 })
    panel.update('tone', 0.5)
    fire(input, 'pointerdown', { button: 0, clientX: 200 })
    fire(input.ownerDocument, 'pointermove', { clientX: 240 })
    const parent = input.parentNode
    input.remove(); parent.append(input)
    fire(input.ownerDocument, 'pointermove', { clientX: 280 })
    fire(input.ownerDocument, 'pointerup', {})
    expect(changes.length).toBeGreaterThan(1)
    expect(changes.at(-1)[1]).toBeGreaterThan(changes[0][1])
  })

  it('gives the host an id that a redraw keeps, so the keyboard can be put back', () => {
    const { panel } = start()
    expect(panel.element.id).toBe('x_skin-host')
  })

  it('sends a switch as its range limits and a select as the chosen value', () => {
    const { changes, fire, q } = start()
    q('m').checked = true; fire(q('m'), 'change')
    q('m').checked = false; fire(q('m'), 'change')
    // linkedom's select has no settable value, so the chosen option is set directly.
    ;[...q('s').options][2].selected = true; fire(q('s'), 'change')
    expect(changes).toEqual([['mute', 1], ['mute', 0], ['model', 2]])
  })

  it('draws a switch and a select from the value the host sends', () => {
    const { panel, q } = start()
    panel.update('mute', 1)
    expect(q('m').checked).toBe(true)
    panel.update('model', 2)
    expect([...q('s').options].find(o => o.selected).value).toBe('2')
  })

  it('clamps a value a slider cannot show', () => {
    const { panel, q } = start()
    panel.update('tone', 7)
    expect(q('t').value).toBe('1')
  })

  it('says which ports it binds, so the panel draws the rest itself', () => {
    const { panel } = start('<input type="range" data-param="tone">')
    expect([...panel.bound]).toEqual(['tone'])
  })
})

describe('help', () => {
  it('describes a control by its port\'s comment, and a control with none has no description', () => {
    const { q } = start()
    expect(q('t').getAttribute('aria-describedby')).toBe('p-t-help')
    expect(q('t').nextElementSibling.textContent).toBe('How bright it is.')
    expect(q('c').hasAttribute('aria-describedby')).toBe(false)
  })

  it('draws the host\'s own help line after the skin when the author placed none, hidden from assistive technology', () => {
    const { panel, fire, q } = start()
    const line = inside(panel).querySelector('.control-help')
    expect(line.getAttribute('aria-hidden')).toBe('true')
    fire(q('t'), 'pointerenter')
    expect(line.textContent).toBe('Tone How bright it is.')
  })

  it('uses the element the author marked, and draws no second line', () => {
    const { panel, fire, q } = start('<p data-param-help id="h"></p><input id="t" type="range" data-param="tone">')
    expect(inside(panel).querySelectorAll('.control-help')).toHaveLength(0)
    fire(q('t'), 'focus')
    expect(inside(panel).querySelector('#p-h').textContent).toBe('Tone How bright it is.')
  })

  it('puts the line away on Escape and when the focus leaves', () => {
    const { panel, fire, q } = start()
    const line = inside(panel).querySelector('.control-help')
    fire(q('t'), 'focus')
    fire(q('t'), 'keydown', { key: 'Escape' })
    expect(line.textContent).toBe('')
    fire(q('t'), 'focus')
    fire(q('t'), 'blur')
    expect(line.textContent).toBe('')
  })
})

describe('fitting the room it is given', () => {
  // A DOM has no layout, so the measurements are supplied as a browser would give them.
  function measured (panel, { clientWidth, scrollWidth }) {
    Object.defineProperty(panel.element, 'clientWidth', { get: () => clientWidth, configurable: true })
    const root = inside(panel).querySelector('.html-skin')
    Object.defineProperty(root, 'scrollWidth', { get: () => scrollWidth, configurable: true })
    // Every control has a size unless a test says it has none.
    for (const el of inside(panel).querySelectorAll('input, select')) el.getBoundingClientRect = () => ({ width: 100, height: 44 })
  }

  it('says it is cramped when the content is wider than the room, and not when it fits', () => {
    const { panel } = start()
    const seen = []
    panel.onCramped(c => seen.push(c))
    measured(panel, { clientWidth: 300, scrollWidth: 400 })
    panel.fit()
    expect(panel.cramped).toBe(true)
    measured(panel, { clientWidth: 500, scrollWidth: 400 })
    panel.fit()
    expect(panel.cramped).toBe(false)
    expect(seen).toEqual([true, false])
  })

  it('says nothing when it has no layout to measure, rather than guessing', () => {
    const { panel } = start()
    const seen = []
    panel.onCramped(c => seen.push(c))
    panel.fit()
    expect(seen).toEqual([])
  })

  it('measures while shown and leaves it hidden afterwards, since a hidden element has no layout', () => {
    const { panel } = start()
    panel.element.hidden = true
    measured(panel, { clientWidth: 500, scrollWidth: 400 })
    panel.fit()
    expect(panel.element.hidden).toBe(true)
  })

  it('says it is cramped when a control has no size at all', () => {
    const { panel, q } = start()
    measured(panel, { clientWidth: 500, scrollWidth: 400 })
    q('t').getBoundingClientRect = () => ({ width: 0, height: 0 })
    panel.fit()
    expect(panel.cramped).toBe(true)
  })
})
