// tests/ui/Layout.test.js
//
// The browser column's collapse arrow: one control carrying what the Hide
// browser button did, in less space. Checked as behaviour rather than pixels:
// which classes are set, what a screen reader is told, and what survives a
// reload. Layout has no renderer here, so the rail's 48px width is asserted
// nowhere; that half needs the narrow-iframe check AGENTS.md describes.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createLayout } from '../../web/app/Layout.js'

let document
let store

function storage (initial = {}) {
  const data = { ...initial }
  return {
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value) },
    data
  }
}

/** The shape the test starts from: main, the browser section, the arrow. */
function build (initialStorage = {}) {
  ;({ document } = parseHTML('<!doctype html><body></body></html>'))
  store = storage(initialStorage)
  const main = document.createElement('main')
  const browser = document.createElement('section')
  browser.id = 'browser'
  const head = document.createElement('div')
  head.className = 'browser-head'
  const button = document.createElement('button')
  button.id = 'toggle-browser'
  const heading = document.createElement('h2')
  heading.textContent = 'Browser'
  head.append(button, heading)
  browser.append(head)
  main.append(browser)
  document.body.append(main)
  const ctx = {
    document,
    window: { localStorage: store },
    $: id => document.getElementById(id)
  }
  return { main, browser, button, layout: createLayout(ctx) }
}

const click = button => button.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }))

describe('the collapse arrow', () => {
  let main
  let browser
  let button
  let layout

  beforeEach(() => { ({ main, browser, button, layout } = build()) })

  it('starts expanded, pointing at the sidebar it collapses', () => {
    layout.mount()
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Hide browser panel')
    expect(button.textContent).toBe('‹')
    expect(browser.classList.contains('rail')).toBe(false)
    expect(main.classList.contains('no-browser')).toBe(false)
  })

  it('collapses to a rail on click, and the name follows the state', () => {
    layout.mount()
    click(button)
    expect(browser.classList.contains('rail')).toBe(true)
    expect(main.classList.contains('no-browser')).toBe(true)
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.getAttribute('aria-label')).toBe('Show browser panel')
    expect(button.textContent).toBe('›')
  })

  it('expands again from the rail, the arrow never leaving the page', () => {
    layout.mount()
    click(button)
    click(button)
    expect(browser.classList.contains('rail')).toBe(false)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(button.getAttribute('aria-label')).toBe('Hide browser panel')
  })

  it('remembers the choice in this browser only', () => {
    layout.mount()
    click(button)
    expect(store.data['jigdaw.browserHidden']).toBe('1')
    click(button)
    expect(store.data['jigdaw.browserHidden']).toBe('0')
  })

  it('restores a collapsed rail from storage on mount', () => {
    ;({ main, browser, button, layout } = build({ 'jigdaw.browserHidden': '1' }))
    layout.mount()
    expect(browser.classList.contains('rail')).toBe(true)
    expect(button.getAttribute('aria-label')).toBe('Show browser panel')
  })

  it('comes back expanded when storage is blocked or cleared', () => {
    ;({ main, browser, button, layout } = build())
    const ctx = { document, window: {}, $: id => document.getElementById(id) }
    const assertive = createLayout(ctx)
    // A window with no localStorage at all: the try/catch owns this case.
    expect(() => assertive.mount()).not.toThrow()
    expect(browser.classList.contains('rail')).toBe(false)
  })
})
