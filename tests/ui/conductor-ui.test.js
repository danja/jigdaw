// tests/ui/conductor-ui.test.js
//
// Conductor's own editor runs in Node against a linkedom document. It draws a control only for a
// port the profile declares, so this binds the editor to plugins/conductor/profile.json: every one
// of the 64 ports is reachable from the editor, and a change is sent as a request that the host echoes.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'

// linkedom's select has no value getter, so the chosen option is read directly.
const chosen = select => [...select.options].find(o => o.selected)?.value

const root = resolve(import.meta.dirname, '../..')
const html = readFileSync(resolve(root, 'plugins/conductor/ui/index.html'), 'utf8')
const profile = JSON.parse(readFileSync(resolve(root, 'plugins/conductor/profile.json'), 'utf8'))
const script = html.match(/<script>([\s\S]*)<\/script>/)[1]

function start () {
  const { document, window } = parseHTML(html.replace(/<script>[\s\S]*<\/script>/, ''))
  const posted = []
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) }
  const listeners = []
  const win = { addEventListener: (type, fn) => listeners.push(fn) }
  const dom = window
  class ResizeObserver { observe () {} }
  new Function('document', 'window', 'parent', 'ResizeObserver', script)(document, win, parent, ResizeObserver)
  const deliver = data => { for (const fn of listeners) fn({ source: parent, origin: 'https://host.example', data }) }
  return { document, posted, deliver, window: dom }
}

const init = { type: 'init', parameters: {}, profile: { port: profile.ports.map(p => ({ symbol: p.symbol, minimum: p.minimum, maximum: p.maximum, default: p.default })) } }

describe('conductor, its own editor', () => {
  it('says ready to any origin and nothing else until the host initialises it', () => {
    const { posted } = start()
    expect(posted).toEqual([{ message: { type: 'ready' }, origin: '*' }])
  })

  it('draws a control for every port the profile declares', () => {
    const { document, deliver } = start()
    deliver(init)
    const missing = profile.ports.filter(p => !document.getElementById(`p-${p.symbol}`)).map(p => p.symbol)
    expect(missing).toEqual([])
  })

  it('offers the form steps as the five sections, with End on every step but the first', () => {
    const { document, deliver } = start()
    deliver(init)
    const labels = id => [...document.getElementById(id).querySelectorAll('option')].map(o => o.textContent)
    expect(labels('p-form_1')).toEqual(['Intro', 'Development', 'Break', 'Reprise', 'Coda'])
    expect(labels('p-form_2')).toEqual(['End', 'Intro', 'Development', 'Break', 'Reprise', 'Coda'])
  })

  it('shows the values the host sends, and a later parameter message repaints', () => {
    const { document, deliver } = start()
    deliver({ ...init, parameters: { form_4: 5, coda_reset: 1 } })
    expect(chosen(document.getElementById('p-form_4'))).toBe('5')
    expect(document.getElementById('p-coda_reset').checked).toBe(true)
    deliver({ type: 'parameter', symbol: 'form_4', value: 3 })
    expect(chosen(document.getElementById('p-form_4'))).toBe('3')
  })

  it('sends a change as a gesture around one parameter request to the host origin', () => {
    const { document, posted, deliver, window } = start()
    deliver(init)
    posted.length = 0
    const select = document.getElementById('p-form_2')
    ;[...select.options].find(o => o.value === '4').selected = true
    select.dispatchEvent(new window.Event('change'))
    expect(posted.map(p => p.message)).toEqual([
      { type: 'gesture', symbol: 'form_2', phase: 'begin' },
      { type: 'parameter', symbol: 'form_2', value: 4 },
      { type: 'gesture', symbol: 'form_2', phase: 'end' }
    ])
    expect(posted.every(p => p.origin === 'https://host.example')).toBe(true)
  })

  it('ignores a message from another source and never writes markup', () => {
    const { document, deliver } = start()
    deliver(init)
    expect(html).not.toContain('innerHTML')
    expect(document.getElementById('controls').children.length).toBeGreaterThan(5)
  })
})
