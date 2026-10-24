// tests/ui/sam-ui.test.js
//
// Sam's own editor runs in Node against a linkedom document: a box for the words, and the messages
// it sends and accepts (docs/messaging.md section 2). It draws what the processor says as text, so
// the checks here are about what crosses the boundary, in both directions.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'

const root = resolve(import.meta.dirname, '../..')
const html = readFileSync(resolve(root, 'plugins/sam/ui/index.html'), 'utf8')
const script = html.match(/<script>([\s\S]*)<\/script>/)[1]
const HOST = 'https://host.example'

function start () {
  const { document, window } = parseHTML(html.replace(/<script>[\s\S]*<\/script>/, ''))
  const posted = []
  const parent = { postMessage: (message, origin) => posted.push({ message, origin }) }
  const listeners = []
  const win = { addEventListener: (type, fn) => listeners.push(fn) }
  class ResizeObserver { observe () {} }
  new Function('document', 'window', 'parent', 'ResizeObserver', script)(document, win, parent, ResizeObserver)
  const deliver = (data, { source = parent, origin = HOST } = {}) => { for (const fn of listeners) fn({ source, origin, data }) }
  return { document, posted, deliver, window, parent }
}

/** Initialised, with the messages sent so far cleared. */
function open () {
  const page = start()
  page.deliver({ type: 'init', profile: {}, parameters: {} })
  page.posted.length = 0
  return page
}

const text = payload => ({ type: 'plugin', payload: { type: 'text', ...payload } })
const click = (page, element) => element.dispatchEvent(new page.window.Event('click'))
const type = (page, box, value) => { box.value = value; box.dispatchEvent(new page.window.Event('input')) }

describe('sam, its own editor', () => {
  it('says ready to any origin and nothing else until the host initialises it', () => {
    const { posted } = start()
    expect(posted).toEqual([{ message: { type: 'ready' }, origin: '*' }])
  })

  it('draws no box before init, so there is nothing to type into that goes nowhere', () => {
    const { document } = start()
    expect(document.getElementById('text')).toBeNull()
  })

  it('ignores a message from anything but its parent, and any other type before init', () => {
    const page = start()
    page.deliver({ type: 'init' }, { source: {} })
    page.deliver({ type: 'plugin', payload: { type: 'text', text: 'x' } })
    expect(page.document.getElementById('text')).toBeNull()
  })

  it('after init, learns the host origin, asks for the text and reports its height', () => {
    const page = start()
    page.posted.length = 0
    page.deliver({ type: 'init', profile: {}, parameters: {} })
    expect(page.document.getElementById('text')).not.toBeNull()
    const sent = page.posted.map(p => [p.message.type, p.message.payload?.type ?? null, p.origin])
    expect(sent).toContainEqual(['plugin', 'getText', HOST])
    expect(sent.some(([type, , origin]) => type === 'resize' && origin === HOST)).toBe(true)
    // Nothing after init goes to a wildcard.
    expect(page.posted.every(p => p.origin === HOST)).toBe(true)
  })

  it('has a labelled box that the hint and the count describe', () => {
    const { document } = open()
    const box = document.getElementById('text')
    expect(document.querySelector('label[for="text"]').textContent).toBe('Text to speak')
    expect(box.getAttribute('aria-describedby').split(' ').every(id => document.getElementById(id))).toBe(true)
    expect(box.getAttribute('maxlength')).toBe('2000')
    expect(document.getElementById('status').getAttribute('role')).toBe('status')
  })

  it('shows the text the processor says is loaded, with its word count, as text', () => {
    const page = open()
    page.deliver(text({ text: 'Hello <b>world</b>', words: 2 }))
    const box = page.document.getElementById('text')
    expect(box.value).toBe('Hello <b>world</b>')
    expect(page.document.getElementById('status').textContent).toBe('Applied: 2 words.')
    // The payload is data: nothing in it became an element.
    expect(page.document.querySelector('b')).toBeNull()
    expect(page.document.getElementById('count').textContent).toBe('18 of 2000 characters')
  })

  it('says "1 word", not "1 words"', () => {
    const page = open()
    page.deliver(text({ text: 'hi', words: 1 }))
    expect(page.document.getElementById('status').textContent).toBe('Applied: 1 word.')
  })

  it('sends the text as one setText request when Apply is pressed', () => {
    const page = open()
    const box = page.document.getElementById('text')
    type(page, box, 'one two three')
    expect(page.posted).toEqual([])   // typing sends nothing: the person decides when
    click(page, page.document.querySelector('button'))
    expect(page.posted).toEqual([{ message: { type: 'plugin', payload: { type: 'setText', text: 'one two three' } }, origin: HOST }])
  })

  it('sends it on Ctrl+Enter and on Cmd+Enter, and not on a plain Enter that makes a new line', () => {
    const page = open()
    const box = page.document.getElementById('text')
    const key = (init) => { const e = new page.window.Event('keydown'); Object.assign(e, { preventDefault () {} }, init); box.dispatchEvent(e) }
    type(page, box, 'abc')
    key({ key: 'Enter' })
    expect(page.posted).toEqual([])
    key({ key: 'Enter', ctrlKey: true })
    key({ key: 'Enter', metaKey: true })
    expect(page.posted.map(p => p.message.payload.type)).toEqual(['setText', 'setText'])
  })

  it('does not draw over unsent typing when the text changes elsewhere, and says so', () => {
    const page = open()
    const box = page.document.getElementById('text')
    type(page, box, 'my own edit')
    page.deliver(text({ text: 'a replaced file', words: 3 }))
    expect(box.value).toBe('my own edit')
    expect(page.document.getElementById('status').textContent).toMatch(/changed elsewhere/)
  })

  it('takes the processor\'s echo of its own Apply, and is then free to follow later changes', () => {
    const page = open()
    const box = page.document.getElementById('text')
    type(page, box, 'sent words')
    click(page, page.document.querySelector('button'))
    page.deliver(text({ text: 'sent words', words: 2 }))
    expect(page.document.getElementById('status').textContent).toBe('Applied: 2 words.')
    page.deliver(text({ text: 'from a file', words: 3 }))
    expect(box.value).toBe('from a file')
  })

  it('ignores a malformed payload, a wrong type and a message from another origin', () => {
    const page = open()
    const box = page.document.getElementById('text')
    page.deliver(text({ text: 42, words: 1 }))
    page.deliver({ type: 'plugin', payload: { type: 'other', text: 'no' } })
    page.deliver({ type: 'plugin' })
    page.deliver(text({ text: 'from elsewhere', words: 2 }), { origin: 'https://evil.example' })
    expect(box.value).toBe('')
  })

  it('never inserts anything as markup', () => {
    expect(script).not.toContain('innerHTML')
    expect(script).not.toContain('insertAdjacentHTML')
    expect(script).not.toContain('document.write')
  })

  it('keeps to the module\'s limit', () => {
    const limit = readFileSync(resolve(root, 'plugins/sam/sam.cpp'), 'utf8').match(/MAX_TEXT_BYTES = (\d+)/)[1]
    expect(script).toContain(`const MAX_CHARS = ${limit}`)
  })
})
