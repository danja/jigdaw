// tests/plugin-ui/JigUiHelp.test.js
//
// What a bound control does, said two ways: to a screen reader as its description, and on a help line that follows
// the pointer and the focus. The same rules as the generated panel's (src/ui/Panel.js, WCAG 1.4.13: dismissible,
// hoverable, persistent). Run against Canticle's profile, since Dynamix declares no port comments.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { readFileSync } from 'node:fs'
import { parseHTML } from 'linkedom'
import { createBridge } from '../../src/plugin-ui/JigUi.js'
import { profileAsJsonLd } from '../../src/rdf/ProfileJsonLd.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
let ld
let comments

beforeAll(async () => {
  const dir = resolve(root, 'plugins/canticle')
  const iri = JSON.parse(readFileSync(resolve(dir, 'profile.json'), 'utf8')).iri
  const profile = await readProfile(await parseTurtleFile(resolve(dir, 'profile.ttl')), iri)
  ld = profileAsJsonLd(profile)
  comments = Object.fromEntries(profile.ports.filter(p => p.comment).map(p => [p.symbol, p.comment]))
})

const MARKUP = `<body>
  <input id="attack" type="range" data-param="attack">
  <input id="tone" type="range" data-param="tone">
  <p id="help" data-param-help></p>
</body>`

function start (profile = ld) {
  const { document, window } = parseHTML(MARKUP)
  const parent = { postMessage () {} }
  const listeners = []
  createBridge({ window: { addEventListener: (t, fn) => listeners.push(fn), console }, document, parent })
  for (const fn of listeners) fn({ source: parent, origin: 'https://host.example', data: { type: 'init', profile, parameters: {} } })
  const fire = (el, type, extra = {}) => { const e = new window.Event(type); Object.assign(e, extra); el.dispatchEvent(e) }
  return { document, fire, help: document.getElementById('help') }
}

describe('a control\'s description', () => {
  it('is the port\'s comment, in a hidden element the control is described by', () => {
    const { document } = start()
    const attack = document.getElementById('attack')
    const words = document.getElementById(attack.getAttribute('aria-describedby'))
    expect(words.textContent).toBe(comments.attack)
  })

  it('is absent for a port that has no comment', () => {
    const { document } = start()
    expect(document.getElementById('tone').hasAttribute('aria-describedby')).toBe(false)
  })
})

describe('the help line', () => {
  it('is hidden from assistive technology, since the controls carry the words already', () => {
    expect(start().help.getAttribute('aria-hidden')).toBe('true')
  })

  it('says the port\'s name and comment while the pointer is over a control', () => {
    const { document, fire, help } = start()
    fire(document.getElementById('attack'), 'pointerenter')
    expect(help.textContent).toBe(`Attack ${comments.attack}`)
  })

  it('says nothing for a control that has no comment', () => {
    const { document, fire, help } = start()
    fire(document.getElementById('attack'), 'pointerenter')
    // A pointer leaves one control before it enters the next.
    fire(document.getElementById('attack'), 'pointerleave')
    fire(document.getElementById('tone'), 'pointerenter')
    expect(help.textContent).toBe('')
  })

  it('goes back to the focused control when the pointer leaves another', () => {
    const { document, fire, help } = start()
    fire(document.getElementById('attack'), 'focus')
    fire(document.getElementById('tone'), 'pointerenter')
    fire(document.getElementById('tone'), 'pointerleave')
    expect(help.textContent).toBe(`Attack ${comments.attack}`)
  })

  it('clears when the focus leaves', () => {
    const { document, fire, help } = start()
    fire(document.getElementById('attack'), 'focus')
    fire(document.getElementById('attack'), 'blur')
    expect(help.textContent).toBe('')
  })

  it('is put away by Escape', () => {
    const { document, fire, help } = start()
    fire(document.getElementById('attack'), 'focus')
    expect(help.textContent).not.toBe('')
    fire(document.getElementById('attack'), 'keydown', { key: 'Escape' })
    expect(help.textContent).toBe('')
  })

  it('shows the comment as text, never as markup', () => {
    const hostile = { ...ld, port: ld.port.map(p => p.symbol === 'attack' ? { ...p, comment: '<img src=x onerror=alert(1)><b>bold</b>' } : p) }
    const { document, fire, help } = start(hostile)
    fire(document.getElementById('attack'), 'pointerenter')
    expect(help.querySelectorAll('*')).toHaveLength(1)
    expect(help.querySelector('b').textContent).toBe('Attack')
    expect(help.textContent).toContain('<img src=x onerror=alert(1)>')
  })
})
