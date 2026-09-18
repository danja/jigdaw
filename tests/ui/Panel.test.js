// tests/ui/Panel.test.js
//
// AGENTS.md requires WCAG 2.2 AA, and says a rule worth stating is worth a
// test. Almost every control in JigDAW comes out of createPanel, so these
// assertions are the difference between every generated plugin being usable
// with a keyboard and a screen reader, and none of them being.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'
import { createPanel } from '../../src/ui/Panel.js'

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

describe('the page on a phone', () => {
  // AGENTS.md says a rule worth stating is worth a test. These are the parts of
  // "works on a phone" that can be checked without a browser; the rest needs
  // someone to open it, which is HUMANS.md item 1.
  const page = () => readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8')

  it('declares a viewport, without which a phone renders at 980px and zooms out', () => {
    expect(page()).toMatch(/<meta\s+name="viewport"\s+content="width=device-width/)
  })

  it('collapses to one column on a narrow screen', () => {
    const css = page()
    expect(css).toMatch(/@media\s*\(max-width:\s*\d+px\)/)
    expect(css).toMatch(/grid-template-columns:\s*1fr\s*;/)
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
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const app = readFileSync(resolve(import.meta.dirname, '../../web/app.js'), 'utf8')
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
    const { readProfile } = await import('../../src/rdf/ProfileReader.js')

    const found = []
    for (const entry of readdirSync(join(root, 'plugins'), { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const file = join(root, 'plugins', entry.name, 'profile.ttl')
      if (!existsSync(file)) continue
      found.push({
        name: entry.name,
        profile: readProfile(await parseText(readFileSync(file, 'utf8'), 'urn:jigdaw:test'))
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
      const options = [...element.querySelectorAll('select')]
        .map(select => [...select.children].map(o => o.textContent))
      const declared = profile.ports
        .filter(p => p.widget === 'selector')
        .map(p => p.scalePoints.map(s => s.label))
      expect(options, name).toEqual(declared)
    }
    // The assertion above is vacuously true for a plugin with no enumerated
    // port, so the population is checked as well as the rule.
    expect(selectorsSeen, 'no plugin declares an enumerated port').toBeGreaterThan(0)
  })
})
