// tests/ui/Panel.test.js
//
// AGENTS.md requires WCAG 2.2 AA, and says a rule worth stating is worth a
// test. Almost every control in Jiggy comes out of createPanel, so these
// assertions are the difference between every generated plugin being usable
// with a keyboard and a screen reader, and none of them being.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'
import { createPanel, UNIT_LABELS, SPOKEN_UNITS } from '../../src/ui/Panel.js'
import { appFile } from './appSource.js'

const port = over => ({
  symbol: 'mix', name: 'Mix', defaultValue: 0.3, minimum: 0, maximum: 1,
  unit: null, toggled: false, enumeration: false, scalePoints: [],
  automationRate: 'k-rate', widget: 'dial', ...over
})

const profile = ports => ({
  iri: 'https://strandz.it/jigdaw/plugins/cascade/',
  label: 'Cascade',
  comment: 'A reverb.',
  ports
})

let document
beforeEach(() => { ({ document } = parseHTML('<!doctype html><body></body>')) })

const build = (ports, onChange = () => {}) => createPanel(document, profile(ports), onChange)

describe('createPanel accessibility', () => {
  it('names the panel with its own heading', () => {
    const { element } = build([port()])
    const heading = element.querySelector('h3')
    expect(element.getAttribute('role')).toBe('group')
    expect(element.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(heading.id).toBeTruthy()
    expect(heading.textContent).toBe('Cascade')
  })

  it('gives every control a label that points at it', () => {
    // WCAG 4.1.2: a control needs a programmatic name, not a nearby caption.
    const { element } = build([port(), port({ symbol: 'size', name: 'Size', widget: 'dial' })])
    const controls = [...element.querySelectorAll('input, select')]
    expect(controls).toHaveLength(2)
    for (const control of controls) {
      const label = element.querySelector(`label[for="${control.id}"]`)
      expect(label, `no label for ${control.id}`).not.toBeNull()
      expect(label.textContent.length).toBeGreaterThan(0)
    }
  })

  it('names the bound controller on the control it drives', () => {
    // The binding is per port in the profile, so a person matching a hardware
    // knob to the panel finds it by reading rather than by trying each one.
    const { element } = build([
      port({ symbol: 'mix', name: 'Mix', controller: 79 }),
      port({ symbol: 'size', name: 'Size' })
    ])
    const labels = [...element.querySelectorAll('label')].map(l => l.textContent)
    expect(labels).toEqual(['Mix (CC 79)', 'Size'])
  })

  it('groups controls under named sections, ungrouped first', () => {
    // DrumKit's 75 controls flat are haphazard; grouped by voice each section
    // reads alone. A fieldset names its controls to assistive technology,
    // which a visible heading alone would not.
    const { element } = build([
      port({ symbol: 'bit_crush', name: 'Bit Crush' }),
      port({ symbol: 'kick_pitch', name: 'Kick Pitch', group: 'Kick' }),
      port({ symbol: 'kick_level', name: 'Kick Level', group: 'Kick' }),
      port({ symbol: 'snare_tone', name: 'Snare Tone', group: 'Snare' })
    ])
    const legends = [...element.querySelectorAll('fieldset.control-group > legend')]
      .map(l => l.textContent)
    expect(legends).toEqual(['Kick', 'Snare'])
    const topGrids = [...element.children].filter(c => c.className === 'controls')
    expect(topGrids).toHaveLength(1)
    expect([...topGrids[0].querySelectorAll('label')].map(l => l.textContent)).toEqual(['Bit Crush'])
    const kick = [...element.querySelectorAll('fieldset.control-group')]
      .find(f => f.querySelector('legend').textContent === 'Kick')
    expect([...kick.querySelectorAll('label')].map(l => l.textContent))
      .toEqual(['Kick Pitch', 'Kick Level'])
  })

  it('renders no sections for a plugin with no groups, exactly as before', () => {
    const { element } = build([port(), port({ symbol: 'size', name: 'Size' })])
    expect(element.querySelector('fieldset')).toBeNull()
    expect(element.querySelectorAll('.controls')).toHaveLength(1)
  })

  it('gives every control ids that are unique and valid', () => {
    // The IRI is sanitised into the id, so a colliding or malformed id here
    // would silently break every label association on the panel.
    const { element } = build([port(), port({ symbol: 'size', name: 'Size' })])
    const ids = [...element.querySelectorAll('input, select')].map(c => c.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[A-Za-z][\w-]*$/)
  })

  it('reports a slider value with its unit, not as a bare number', () => {
    const { element } = build([port({ symbol: 'damping', name: 'Damping', unit: 'http://lv2plug.in/ns/extensions/units#hz', defaultValue: 4200, minimum: 200, maximum: 18000 })])
    const slider = element.querySelector('input[type=range]')
    // "4200" and "4200 hertz" are different information.
    expect(slider.getAttribute('aria-valuetext')).toBe('4200 hertz')
  })

  it('describes each control by its readout', () => {
    const { element } = build([port()])
    const slider = element.querySelector('input[type=range]')
    const describedBy = slider.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(element.querySelector(`#${describedBy}`).textContent).toBe('0.30')
  })

  it('signals switch state in text as well as by the checkbox', () => {
    // WCAG 1.4.1: state must not be carried by appearance alone.
    const { element } = build([port({ symbol: 'freeze', name: 'Freeze', widget: 'switch', defaultValue: 0, minimum: 0, maximum: 1 })])
    const readout = element.querySelector('.value')
    expect(readout.textContent).toBe('off')
  })

  it('names a two-point enumeration drawn as a switch by its points, not on and off', () => {
    // The readout is the checkbox's accessible description, so this is also
    // what a screen reader says.
    const panel = build([port({
      symbol: 'estimator', name: 'Envelope estimator', widget: 'switch', enumeration: true,
      defaultValue: 0, minimum: 0, maximum: 1,
      scalePoints: [{ label: 'Cepstral', value: 0 }, { label: 'True envelope', value: 1 }]
    })])
    const input = panel.element.querySelector('input')
    const readout = panel.element.querySelector(`#${input.getAttribute('aria-describedby')}`)
    expect(readout.textContent).toBe('Cepstral')
    panel.update('estimator', 1)
    expect(readout.textContent).toBe('True envelope')
  })

  it('uses native controls, so keyboard support is not reimplemented', () => {
    // The cheapest way to satisfy 2.1.1 is not to leave the platform. A div
    // with a click handler is how a control stops being reachable by tab.
    const { element } = build([
      port(),
      port({ symbol: 'freeze', name: 'Freeze', widget: 'switch' }),
      port({ symbol: 'mode', name: 'Mode', widget: 'selector', enumeration: true, minimum: 0, maximum: 2, defaultValue: 0, scalePoints: [{ label: 'Plate', value: 0 }, { label: 'Hall', value: 1 }, { label: 'Bloom', value: 2 }] })
    ])
    const tags = [...element.querySelectorAll('input, select')].map(c => c.tagName.toLowerCase())
    expect(tags.sort()).toEqual(['input', 'input', 'select'])
    expect(element.querySelectorAll('[onclick]')).toHaveLength(0)
  })

  it('names every option in a selector', () => {
    const { element } = build([port({ symbol: 'mode', name: 'Mode', widget: 'selector', enumeration: true, minimum: 0, maximum: 2, defaultValue: 0, scalePoints: [{ label: 'Plate', value: 0 }, { label: 'Hall', value: 1 }, { label: 'Bloom', value: 2 }] })])
    const options = [...element.querySelectorAll('option')].map(o => o.textContent)
    expect(options).toEqual(['Plate', 'Hall', 'Bloom'])
  })
})

describe('two instances of one plugin', () => {
  it('share no id when each panel is given its own scope', () => {
    const ports = [port(), port({ symbol: 'size', name: 'Size' })]
    const a = createPanel(document, profile(ports), () => {}, undefined, { scope: 'panel-node-1' })
    const b = createPanel(document, profile(ports), () => {}, undefined, { scope: 'panel-node-2' })
    document.body.append(a.element, b.element)
    const ids = [...document.querySelectorAll('[id]')].map(e => e.id)
    expect(ids.length).toBeGreaterThan(4)
    expect(new Set(ids).size).toBe(ids.length)
    // And every label still points at its own control, in its own panel.
    for (const panel of [a, b]) {
      for (const label of panel.element.querySelectorAll('label[for]')) {
        expect(panel.element.querySelector(`#${label.getAttribute('for')}`)).not.toBeNull()
      }
    }
  })
})

describe('createPanel behaviour', () => {
  it('renders the declared default through the same path as a host update', () => {
    const { element } = build([port({ defaultValue: 0.75 })])
    expect(element.querySelector('input[type=range]').value).toBe('0.75')
    expect(element.querySelector('.value').textContent).toBe('0.75')
  })

  it('asks rather than applies, and renders what it is told', () => {
    // messaging.md 2.3: a UI that renders optimistically from its own input
    // disagrees with the host the first time a value is clamped or overridden.
    const asked = []
    const panel = build([port()], (symbol, value) => asked.push([symbol, value]))
    const slider = panel.element.querySelector('input[type=range]')

    slider.value = '0.9'
    slider.dispatchEvent(new (panel.element.ownerDocument.defaultView.Event)('input'))
    expect(asked).toEqual([['mix', 0.9]])
    // Nothing moved on its own: the readout still shows the last applied value.
    expect(panel.element.querySelector('.value').textContent).toBe('0.30')

    panel.update('mix', 0.5)
    expect(panel.element.querySelector('.value').textContent).toBe('0.50')
  })

  it('steps a dial evenly whatever its range', () => {
    const wide = build([port({ symbol: 'damping', minimum: 200, maximum: 18000, defaultValue: 4200 })])
    expect(wide.element.querySelector('input[type=range]').step).toBe('89')
  })
})

describe('the application keeps a panel current', () => {
  // A panel that never hears about a change made anywhere but itself: Cascade's
  // Mix read its declared 0.30 after being set to 0.83 through WebMCP, on a
  // panel that was already on screen. drawRack is in the browser bundle, where
  // there is no AudioContext to build a real Engine against, so the wiring is
  // checked in the source, the same way tests/ui/Focus.test.js checks that
  // drawRack calls preserveFocus. The panel is built in drawSlot, one plugin's
  // part of the rack, and the slice ends at that function's closing brace.
  const app = appFile('web/app/Rack.js') + appFile('web/app/RackSlot.js')
  const drawStart = app.indexOf('function drawSlot')
  const draw = app.slice(drawStart, app.indexOf('\n  }\n', drawStart))

  it('finds the function it checks', () => {
    expect(drawStart).toBeGreaterThan(-1)
    expect(draw).toMatch(/createPanel\(/)
  })

  it('shows the default for a port with no setting, such as one whose first change was undone', () => {
    const settings = draw.indexOf('for (const [symbol, value] of node.settings)')
    const defaults = draw.indexOf('panel.update(port.symbol, port.defaultValue)')
    expect(defaults, 'an unset port is never put back to its default').toBeGreaterThan(-1)
    expect(defaults).toBeGreaterThan(settings)
    expect(defaults).toBeLessThan(draw.indexOf('element.append(panel.element)'))
  })

  it('scopes each panel to its node, so two instances of a plugin share no id', () => {
    expect(draw).toMatch(/scope: `panel-\$\{node\.id\}`/)
  })

  it('pushes node.settings into the panel on every redraw', () => {
    const push = draw.indexOf('for (const [symbol, value] of node.settings)')
    const appended = draw.indexOf('element.append(panel.element)')
    expect(push, 'drawRack does not push node.settings into the panel').toBeGreaterThan(-1)
    expect(push, 'the panel must exist, cached or fresh, before its settings can be pushed')
      .toBeGreaterThan(draw.indexOf('panels.set(node.id, panel)'))
    expect(push, 'settings are pushed before the panel is shown, not after')
      .toBeLessThan(appended)
  })

  it('is not gated behind creating a fresh panel', () => {
    // The bug: a value applied from outside only ever reached the panel
    // through the panel's own onChange, so a panel fetched from the cache
    // never learned that anything had changed. The push must sit outside the
    // `if (!panel)` branch that guards construction.
    const ifNoPanel = draw.indexOf('if (!panel)')
    const closeOfThatBlock = draw.indexOf('}', draw.indexOf('panels.set(node.id, panel)'))
    const push = draw.indexOf('for (const [symbol, value] of node.settings)')
    expect(ifNoPanel).toBeGreaterThan(-1)
    expect(push, 'the settings push must run after the creation branch closes, on every redraw')
      .toBeGreaterThan(closeOfThatBlock)
  })
})

describe('the page on a phone', () => {
  // AGENTS.md says a rule worth stating is worth a test. These are the parts of
  // "works on a phone" that can be checked without a browser; the rest needs
  // someone to open it on one.
  const page = () => readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8')

  it('declares a viewport, without which a phone renders at 980px and zooms out', () => {
    expect(page()).toMatch(/<meta\s+name="viewport"\s+content="width=device-width/)
  })

  it('collapses to one column on a narrow screen', () => {
    const css = page()
    expect(css).toMatch(/@media\s*\(max-width:\s*\d+px\)/)
    // minmax(0, 1fr) rather than 1fr: a 1fr column grows to its widest
    // content, and the timeline and the piano roll are as wide as the music,
    // which made a 390px phone 654px wide. They scroll in their own boxes.
    expect(css).toMatch(/grid-template-columns:\s*minmax\(0,\s*1fr\)\s*;/)
    expect(css).not.toMatch(/grid-template-columns:\s*[^;]*\b300px 1fr\b/)
  })

  it('does not zoom the page in when a text input takes focus on iOS', () => {
    // Safari zooms when a focused input has a font size below 16px, and does
    // not zoom back out afterwards.
    //
    // Every rule that both mentions an input and sets a font size is checked,
    // rather than one named selector. The first version of this looked for
    // `input[type=text]` specifically and went quiet the moment the stylesheet
    // was rewritten to use a class: the rule was right, the population was
    // wrong, which is the recurring shape in MISTAKES.md.
    const rules = [...page().matchAll(/([^{}]+)\{([^}]*)\}/g)]
    let checked = 0
    for (const [, selector, body] of rules) {
      if (!/\binput\b|\bselect\b|\btextarea\b/.test(selector)) continue
      const size = /font-size:\s*(\d+(?:\.\d+)?)px/.exec(body)
      if (!size) continue
      checked += 1
      expect(Number(size[1]), `${selector.trim()} sets ${size[1]}px, which makes iOS zoom`)
        .toBeGreaterThanOrEqual(16)
    }
    expect(checked, 'no input rule set a font size, so this checked nothing').toBeGreaterThan(0)
  })

  it('gives buttons a touch-sized target', () => {
    // WCAG 2.5.8 asks for 24px; 44px is the comfortable figure.
    const rule = /\bbutton\s*\{[^}]*min-height:\s*(\d+)px/.exec(page())
    expect(rule, 'no min-height on button').not.toBeNull()
    expect(Number(rule[1])).toBeGreaterThanOrEqual(24)
  })

  it('shows a visible focus indicator, since a keyboard user has nothing else', () => {
    expect(page()).toMatch(/:focus-visible\s*\{[^}]*outline:/)
  })
})

describe('the Load by IRI field', () => {
  it('is rewritten to an absolute IRI on load', async () => {
    // A plugin is identified by an absolute IRI, and the box should show the
    // thing that would be published or pasted into another host. It cannot be
    // written into the HTML because it depends on where this host is served.
    const app = appFile('web/app.js')
    expect(app).toMatch(/\$\('iri'\)\.value\s*=\s*new URL\(\$\('iri'\)\.value,\s*document\.baseURI\)\.href/)
  })
})

describe('the panel each committed plugin actually generates', () => {
  // Every other test in this file builds a port object by hand, which proves
  // the generator and says nothing about whether a real profile still reaches
  // it. That gap is how a change to bin/write-profile.js could empty every
  // selector in the application while this suite stayed green.
  //
  // It is not hypothetical. Skolemising lv2:scalePoint, so that a profile could
  // be canonicalised and signed, moved three triples per option out of a blank
  // node and into a named one. Nothing in tests/ read a committed profile
  // through the panel, so nothing would have reported it if that had gone
  // wrong. This walks plugins/ rather than naming a plugin, so a new one comes
  // into scope by existing.
  const walk = async () => {
    const { readdirSync, readFileSync, existsSync } = await import('node:fs')
    const { resolve, join } = await import('node:path')
    const root = resolve(import.meta.dirname, '../..')
    const { parseText } = await import('../../src/rdf/parse.js')
    const { readPlugin } = await import('../../src/rdf/PluginReader.js')

    const found = []
    for (const entry of readdirSync(join(root, 'plugins'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = join(root, 'plugins', entry.name, 'profile.ttl')
      if (!existsSync(file)) continue
      found.push({
        name: entry.name,
        profile: readPlugin(await parseText(readFileSync(file, 'utf8'), 'urn:jigdaw:test'))
      })
    }
    return found
  }

  it('offers every scale point the profile declares, in order', async () => {
    const plugins = await walk()
    expect(plugins.length, 'no plugins found, so this checked nothing').toBeGreaterThan(0)

    let selectorsSeen = 0
    for (const { name, profile } of plugins) {
      const { document } = parseHTML('<!doctype html><html><body></body></html>')
      const { element } = createPanel(document, profile, () => {})

      for (const port of profile.ports.filter(p => p.widget === 'selector')) {
        selectorsSeen++
        const row = element.querySelector(`.control-selector select`)
        expect(row, `${name}/${port.symbol} generated no selector`).not.toBeNull()
      }
      // By label rather than document order: a grouped panel orders controls
      // by section, so the nth select is not the nth declared port. The CC
      // suffix a bound control carries is stripped for the match.
      const shown = new Map()
      for (const row of element.querySelectorAll('.control-selector')) {
        const label = row.querySelector('label').textContent.replace(/ \(CC \d+\)$/, '')
        shown.set(label, [...row.querySelectorAll('option')].map(o => o.textContent))
      }
      const declared = profile.ports.filter(p => p.widget === 'selector')
      for (const port of declared) {
        expect(shown.get(port.name), `${name}/${port.symbol} options`).toEqual(port.scalePoints.map(s => s.label))
      }
      expect(shown.size, `${name} draws a selector nothing declares`).toBe(declared.length)
    }
    // The assertion above is vacuously true for a plugin with no enumerated
    // port, so the population is checked as well as the rule.
    expect(selectorsSeen, 'no plugin declares an enumerated port').toBeGreaterThan(0)
  }, 30000)

  // A port declares units:unit and the panel looks it up in a table. A unit
  // missing from that table is not an error anywhere: the control renders the
  // number with nothing after it, and a screen reader reads a bare figure. So
  // the two lists are bound here rather than reviewed. The 8b8 arrived with
  // units:pc and units:semitone12TET, neither of which the panel knew.
  it('knows every unit any committed plugin declares', async () => {
    const plugins = await walk()
    const unknown = []
    let unitsSeen = 0
    for (const { name, profile } of plugins) {
      for (const port of profile.ports) {
        if (!port.unit) continue
        unitsSeen++
        if (!(port.unit in UNIT_LABELS)) unknown.push(`${name}/${port.symbol} shows ${port.unit}`)
        if (!(port.unit in SPOKEN_UNITS)) unknown.push(`${name}/${port.symbol} speaks ${port.unit}`)
      }
    }
    expect(unknown, `units the panel would drop:\n  ${unknown.join('\n  ')}`).toEqual([])
    expect(unitsSeen, 'no committed plugin declares a unit, so this checked nothing').toBeGreaterThan(0)
  })

  // A unit a sighted user sees and a screen reader does not is the same bug
  // in one table rather than in both, and the loop above would not catch a
  // unit that no plugin happens to use yet.
  it('shows and speaks the same set of units', () => {
    expect(Object.keys(UNIT_LABELS).sort()).toEqual(Object.keys(SPOKEN_UNITS).sort())
  })
})

describe('a foreign plugin is marked', () => {
  // Contract section 12.5. A foreign plugin runs in this document with this
  // document's privileges. Someone who consented a week ago has no other way to
  // tell the difference, and the difference is the whole of section 12.
  const foreign = ports => ({ ...profile(ports), kind: 'foreign' })

  it('says so in words, not only in styling', () => {
    // The rule that matters: an outline a stylesheet draws is invisible to a
    // screen reader and to anyone who cannot see the outline, and section 12.5
    // forbids carrying the mark by colour alone.
    const { element } = createPanel(document, foreign([port()]), () => {})
    expect(element.textContent).toMatch(/foreign/i)
  })

  it('puts the mark inside the heading that names the panel', () => {
    // The panel is a group labelled by its heading, so a mark inside the
    // heading is read out with the plugin's name rather than sitting somewhere
    // a reader reaches separately, or never.
    const { element } = createPanel(document, foreign([port()]), () => {})
    const heading = element.querySelector('h3')
    expect(heading.textContent).toMatch(/foreign/i)
    expect(element.getAttribute('aria-labelledby')).toBe(heading.id)
  })

  it('says what being foreign means, for anyone who does not know', () => {
    const { element } = createPanel(document, foreign([port()]), () => {})
    expect(element.querySelector('.foreign').title).toMatch(/not sandboxed|privileges/i)
  })

  it('leaves a native plugin unmarked', () => {
    const { element } = build([port()])
    expect(element.textContent).not.toMatch(/foreign/i)
    expect(element.querySelector('.foreign')).toBeNull()
  })
})

// A skin (docs/svg-skins.md) is drawn above the generated controls for the ports it leaves out, and at a width where its
// padded hit areas overlap it is put away and every port is drawn as a generated control.
describe('createPanel with a skin', () => {
  const SVG_NS = 'http://www.w3.org/2000/svg'
  const el = (name, attrs = {}) => { const e = document.createElementNS(SVG_NS, name); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e }
  const ports = [port({ symbol: 'mix', name: 'Mix' }), port({ symbol: 'size', name: 'Size', defaultValue: 0.5 })]

  async function withSkin () {
    const { buildArtwork } = await import('../../src/ui/SkinArtwork.js')
    const svg = el('svg', { viewBox: '0 0 100 100' })
    svg.append(el('g', { id: 'knob' }), el('circle', { id: 'hub', r: '5' }))
    const built = buildArtwork({ documentElement: svg }, { document, prefix: 's-' })
    const controls = [{ id: 'c1', kind: 'rotary', boundSymbol: 'mix', element: 'knob', pivotElement: 'hub', hitElement: null, trackElement: null, angleMin: -135, angleMax: 135 }]
    const sent = []
    const panel = createPanel(document, profile(ports), (s, v) => sent.push([s, v]), null, {
      scope: 'p', skin: { svg: built.svg, elements: built.elements, controls },
      skinLayout: { measure: () => ({ x: 0, y: 0, width: 10, height: 10 }), availableWidth: () => 100 }
    })
    document.body.append(panel.element)
    return { panel, sent }
  }

  it('draws the skin, then generated controls for the ports it leaves out, under their own heading', async () => {
    const { panel } = await withSkin()
    expect(panel.skinned).toBe(true)
    expect(panel.element.querySelector('.skin')).not.toBeNull()
    const others = panel.element.querySelector('.skin-others')
    expect(others.querySelector('legend').textContent).toBe('Other controls')
    expect([...others.querySelectorAll('input')].map(i => i.id)).toEqual(['p_size'])
  })

  it('keeps every id in the document unique, though a port may be drawn by both the skin and a generated control', async () => {
    const { panel } = await withSkin()
    const ids = [...panel.element.querySelectorAll('[id]')].map(e => e.id)
    expect(ids.length).toBeGreaterThan(5)
    expect(ids.filter((id, i) => ids.indexOf(id) !== i)).toEqual([])
  })

  it('has the fallback hidden until the skin is too cramped, then swaps them', async () => {
    const { panel } = await withSkin()
    const [skin, others, everything] = ['.skin', '.skin-others', '.skin-fallback'].map(s => panel.element.querySelector(s))
    panel.skinView.fit()
    expect([skin.hidden, others.hidden, everything.hidden]).toEqual([false, false, true])
    expect(panel.element.classList.contains('skin-cramped')).toBe(false)
  })

  it('draws every port as a generated control, and not the skin, when the skin is cramped', async () => {
    // two controls measured at the same place, so their padded areas lie on top of each other
    const { buildArtwork } = await import('../../src/ui/SkinArtwork.js')
    const svg = el('svg', { viewBox: '0 0 100 100' })
    svg.append(el('g', { id: 'a' }), el('g', { id: 'b' }), el('circle', { id: 'ah', r: '1' }), el('circle', { id: 'bh', r: '1' }))
    const built = buildArtwork({ documentElement: svg }, { document, prefix: 's-' })
    const rot = (id, symbol, element, pivot) => ({ id, kind: 'rotary', boundSymbol: symbol, element, pivotElement: pivot, hitElement: null, trackElement: null, angleMin: 0, angleMax: 90 })
    const panel = createPanel(document, profile(ports), () => {}, null, {
      scope: 'p', skin: { svg: built.svg, elements: built.elements, controls: [rot('c1', 'mix', 'a', 'ah'), rot('c2', 'size', 'b', 'bh')] },
      skinLayout: { measure: () => ({ x: 0, y: 0, width: 10, height: 10 }), availableWidth: () => 100 }
    })
    document.body.append(panel.element)
    panel.skinView.fit()
    expect(panel.element.classList.contains('skin-cramped')).toBe(true)
    expect(panel.element.querySelector('.skin').hidden).toBe(true)
    expect(panel.element.querySelector('.skin-others').hidden).toBe(true)
    const everything = panel.element.querySelector('.skin-fallback')
    expect(everything.hidden).toBe(false)
    expect([...everything.querySelectorAll('input')].map(i => i.id)).toEqual(['p_all-mix', 'p_all-size'])
  })

  it('moves every drawing of a port when the host updates it', async () => {
    const { panel } = await withSkin()
    panel.update('size', 0.8)
    const generated = panel.element.querySelector('input[id="p_size"]')
    expect(Number(generated.value)).toBeCloseTo(0.8)
    const all = panel.element.querySelector('input[id="p_all-size"]')
    expect(Number(all.value)).toBeCloseTo(0.8)
  })
})


describe('which controls come first', () => {
  const ranked = (symbol, displayPriority) => port({ symbol, name: symbol.toUpperCase(), displayPriority })
  const plain = symbol => port({ symbol, name: symbol.toUpperCase(), displayPriority: null })
  const names = element => [...element.querySelectorAll('label')].map(l => l.textContent)

  it('draws the ports with a priority first, highest first, and puts the rest under a disclosure that says how many', () => {
    const { element } = build([plain('a'), ranked('b', 10), plain('c'), ranked('d', 90)])
    const more = element.querySelector('details.more-controls')
    expect(more).not.toBeNull()
    expect(more.querySelector('summary').textContent).toBe('More controls (2)')
    const outside = [...element.querySelectorAll('label')].filter(l => !more.contains(l)).map(l => l.textContent)
    expect(outside).toEqual(['D', 'B'])
    expect([...more.querySelectorAll('label')].map(l => l.textContent)).toEqual(['A', 'C'])
  })

  it('still draws every port once, so nothing a person or an agent could set is lost', () => {
    const { element } = build([plain('a'), ranked('b', 10), plain('c'), ranked('d', 90)])
    expect(names(element).sort()).toEqual(['A', 'B', 'C', 'D'])
    expect(element.querySelectorAll('input, select')).toHaveLength(4)
  })

  it('draws no disclosure when no port has a priority, as a profile that says nothing was always drawn', () => {
    expect(build([plain('a'), plain('b')]).element.querySelector('details')).toBeNull()
  })

  it('draws no disclosure when every port has one, since there is nothing to put away', () => {
    const { element } = build([ranked('a', 1), ranked('b', 2)])
    expect(element.querySelector('details')).toBeNull()
    // Nothing is put away, so the author's own order stands and not the priority order.
    expect(names(element)).toEqual(['A', 'B'])
  })

  it('draws the first view as one flat grid with no group headings, and keeps the groups inside the disclosure', () => {
    const { element } = build([
      port({ symbol: 'l', name: 'L', displayPriority: 5, group: 'Kick' }), port({ symbol: 's', name: 'S', displayPriority: 4, group: 'Snare' }),
      port({ symbol: 'p', name: 'P', displayPriority: null, group: 'Kick' }), port({ symbol: 'm', name: 'M', displayPriority: null, group: 'Snare' })
    ])
    const more = element.querySelector('details.more-controls')
    expect([...more.querySelectorAll('legend')].map(l => l.textContent)).toEqual(['Kick', 'Snare'])
    expect([...element.querySelectorAll('legend')].filter(l => !more.contains(l))).toEqual([])
    expect([...element.querySelectorAll('label')].filter(l => !more.contains(l)).map(l => l.textContent)).toEqual(['L', 'S'])
  })

  it('keeps the groups when there is no split, since then nothing was put away', () => {
    const { element } = build([port({ symbol: 'a', name: 'A', displayPriority: null, group: 'Kick' }), port({ symbol: 'b', name: 'B', displayPriority: null, group: 'Snare' })])
    expect([...element.querySelectorAll('legend')].map(l => l.textContent)).toEqual(['Kick', 'Snare'])
  })

  it('names the disclosure with a summary a keyboard reaches and opens, which is what a details element is', () => {
    const { element } = build([plain('a'), ranked('b', 1)])
    const more = element.querySelector('details.more-controls')
    expect(more.hasAttribute('open')).toBe(false)
    expect(more.querySelector('summary')).not.toBeNull()
    // The controls inside keep their labels whether or not the disclosure is open.
    expect(more.querySelector('label[for]')).not.toBeNull()
  })
})


describe('a pad on the panel', () => {
  const ports = () => [
    port({ symbol: 'density', name: 'Density', defaultValue: 0.5 }),
    port({ symbol: 'variation', name: 'Variation', defaultValue: 0.25 }),
    port({ symbol: 'seed', name: 'Seed', minimum: 1, maximum: 100, defaultValue: 1 })
  ]
  const withPad = (extra = {}) => {
    const changes = []
    const panel = createPanel(document, { iri: 'https://example.test/p/', label: 'P', ports: ports(), pads: [{ label: 'Feel', x: 'density', y: 'variation' }], ...extra }, (symbol, value) => changes.push([symbol, value]))
    document.body.append(panel.element)
    const surface = panel.element.querySelector('.pad-surface')
    if (surface) surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 })
    return { panel, changes, surface, element: panel.element }
  }
  const press = (surface, clientX, clientY) => {
    const e = new document.defaultView.Event('pointerdown', { bubbles: true, cancelable: true })
    for (const [k, v] of Object.entries({ button: 0, clientX, clientY })) Object.defineProperty(e, k, { value: v })
    surface.dispatchEvent(e)
    document.dispatchEvent(new document.defaultView.Event('pointerup'))
  }

  it('is drawn above the controls, and the two ports it sets are still controls of their own', () => {
    const { element } = withPad()
    const pads = element.querySelector('.pads')
    expect(pads).not.toBeNull()
    expect(pads.compareDocumentPosition(element.querySelector('.controls')) & 4).toBeTruthy()
    expect([...element.querySelectorAll('.control label')].map(l => l.textContent)).toEqual(['Density', 'Variation', 'Seed'])
  })

  it('draws none for a profile that has none, as every profile did before pads', () => {
    const panel = createPanel(document, profile(ports()), () => {})
    expect(panel.element.querySelector('.pads')).toBeNull()
    const absent = createPanel(document, { ...profile(ports()), pads: [] }, () => {})
    expect(absent.element.querySelector('.pads')).toBeNull()
  })

  it('tells the host both values, as a drag of each knob would', () => {
    const { surface, changes } = withPad()
    press(surface, 80, 20)
    expect(changes).toEqual([['density', 0.8], ['variation', 0.8]])
  })

  it('moves the two controls it sets, so the readouts and the controls agree with the pad', () => {
    const { surface, element } = withPad()
    press(surface, 80, 20)
    expect(element.querySelector('input[id$="density"]').value).toBe('0.8')
    expect(element.querySelector('input[id$="variation"]').value).toBe('0.8')
    expect(element.querySelector('input[id$="seed"]').value).toBe('1')
  })

  it('starts the puck where the two ports\' defaults are, and follows a host update', () => {
    const { panel, element } = withPad()
    const puck = element.querySelector('.pad-puck')
    expect(puck.style.left).toBe('50%')
    expect(puck.style.top).toBe('75%')
    panel.update('density', 1)
    expect(puck.style.left).toBe('100%')
    panel.update('seed', 50)
    expect(puck.style.left).toBe('100%')
  })

  it('is not read to a screen reader as a control: the controls beside it carry the meaning', () => {
    const { element } = withPad()
    expect(element.querySelector('.pad-surface').getAttribute('aria-hidden')).toBe('true')
    expect(element.querySelector('.pad').getAttribute('role')).toBe('group')
  })

  it('is refused when it names a port the plugin does not have', () => {
    expect(() => withPad({ pads: [{ label: 'Feel', x: 'density', y: 'nope' }] })).toThrow(/must both be ports of the plugin/)
  })
})
