// tests/ui/Layout.test.js
//
// The Browser is a panel that starts closed. Checked as behaviour rather than
// pixels: what is hidden, what a screen reader is told, where the focus goes,
// and what survives a reload. Layout has no renderer here, so the stage taking
// the whole width is asserted nowhere; that half needs a look in a real browser.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createLayout } from '../../web/app/Layout.js'

let document
let window
let store
let focused

function storage (initial = {}) {
  const data = { ...initial }
  return {
    getItem: key => (key in data ? data[key] : null),
    setItem: (key, value) => { data[key] = String(value) },
    data
  }
}

/** The shape the page has: a toggle in the bar, main with the browser inside it, its Close button and search box. */
function build (initialStorage = {}, storageOverride = null) {
  ;({ document, window } = parseHTML('<!doctype html><body></body></html>'))
  store = storage(initialStorage)
  focused = null
  const toggle = document.createElement('button')
  toggle.id = 'toggle-browser'
  const main = document.createElement('main')
  const browser = document.createElement('section')
  browser.id = 'browser'
  const close = document.createElement('button')
  close.id = 'close-browser'
  const search = document.createElement('input')
  search.id = 'q'
  // linkedom's focus() does not move activeElement; what matters here is which
  // element was asked to take the focus.
  for (const el of [toggle, search]) el.focus = () => { focused = el.id }
  browser.append(close, search)
  main.append(browser)
  document.body.append(toggle, main)
  const ctx = { document, window: storageOverride ?? { localStorage: store }, $: id => document.getElementById(id) }
  return { main, browser, toggle, close, search, layout: createLayout(ctx) }
}

const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }))
const key = (el, k) => el.dispatchEvent(Object.defineProperty(new window.Event('keydown', { bubbles: true, cancelable: true }), 'key', { value: k }))

describe('the Browser panel', () => {
  let main
  let browser
  let toggle
  let close
  let layout

  beforeEach(() => { ({ main, browser, toggle, close, layout } = build()) })

  it('starts closed: hidden, out of the layout, and the button says so', () => {
    layout.mount()
    expect(browser.hidden).toBe(true)
    expect(main.classList.contains('no-browser')).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens from the button and moves the focus to the search box', () => {
    layout.mount()
    click(toggle)
    expect(browser.hidden).toBe(false)
    expect(main.classList.contains('no-browser')).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(focused).toBe('q')
  })

  it('closes from the button or from Close, and gives the focus back to the button', () => {
    layout.mount()
    click(toggle)
    click(close)
    expect(browser.hidden).toBe(true)
    expect(focused).toBe('toggle-browser')
    click(toggle)
    click(toggle)
    expect(browser.hidden).toBe(true)
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes on Escape from inside it, and ignores other keys', () => {
    layout.mount()
    click(toggle)
    key(browser, 'a')
    expect(browser.hidden).toBe(false)
    key(browser, 'Escape')
    expect(browser.hidden).toBe(true)
    expect(focused).toBe('toggle-browser')
  })

  it('can be opened from elsewhere on the page, as the empty arrangement does', () => {
    layout.mount()
    layout.showBrowser(true)
    expect(browser.hidden).toBe(false)
    expect(focused).toBe('q')
  })

  it('remembers the choice in this browser only, and restores an open panel on mount', () => {
    layout.mount()
    click(toggle)
    expect(store.data['jigdaw.browserOpen']).toBe('1')
    click(toggle)
    expect(store.data['jigdaw.browserOpen']).toBe('0')
    ;({ browser, toggle, layout } = build({ 'jigdaw.browserOpen': '1' }))
    layout.mount()
    expect(browser.hidden).toBe(false)
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
  })

  it('does not write the remembered state just for mounting', () => {
    layout.mount()
    expect(store.data['jigdaw.browserOpen']).toBeUndefined()
  })

  it('starts closed when storage is blocked or absent, and does not throw', () => {
    ;({ browser, layout } = build({}, {}))
    expect(() => layout.mount()).not.toThrow()
    expect(browser.hidden).toBe(true)
    const throwing = { localStorage: { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') } } }
    ;({ browser, toggle, layout } = build({}, throwing))
    expect(() => layout.mount()).not.toThrow()
    expect(() => click(toggle)).not.toThrow()
    expect(browser.hidden).toBe(false)
  })
})
