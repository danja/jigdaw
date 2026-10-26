// tests/web/Help.test.js
//
// The tip drawn for a control that has the keyboard focus. linkedom has no :focus-visible, so each element says whether it matches it, which is the one
// thing a test has to decide that a browser decides: keyboard focus or not.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createHelp } from '../../web/app/Help.js'

let document
let window
let help
beforeEach(() => {
  ({ document, window } = parseHTML('<!doctype html><body><div class="transport"><button id="play" title="Play from the playhead">Play</button><button id="plain">Plain</button><input id="tempo" title="Tempo in beats per minute"><label for="bars">Bars</label><input id="bars" title="Bars"><button id="named" aria-label="Save" title="Save">S</button><span id="inner"><button id="deep" title="Deep"><i id="icon">x</i></button></span></div></body>'))
  window.innerWidth = 1000
  help = createHelp({ document, window })
  help.mount()
})

const focus = (id, { keyboard = true } = {}) => {
  const element = document.getElementById(id)
  element.matches = selector => (selector === ':focus-visible' ? keyboard : false)
  element.getBoundingClientRect = () => ({ left: 40, bottom: 60 })
  const event = new window.Event('focusin', { bubbles: true })
  element.dispatchEvent(event)
  return element
}
const tip = () => document.querySelector('.help-tip')

describe('the help tip', () => {
  it('is drawn with a control\'s title when the control has the focus by keyboard, under it', () => {
    focus('play')
    expect(tip().textContent).toBe('Play from the playhead')
    expect(tip().hidden).toBe(false)
    expect(tip().style.top).toBe('66px')
    expect(tip().style.left).toBe('40px')
  })

  it('is hidden from assistive technology, since the title is already the control\'s description', () => {
    focus('play')
    expect(tip().getAttribute('aria-hidden')).toBe('true')
  })

  it('is not drawn for a focus that came from a click, which already has the native tooltip', () => {
    focus('play', { keyboard: false })
    expect(tip()).toBeNull()
  })

  it('is not drawn for a control with no title', () => {
    focus('plain')
    expect(tip()).toBeNull()
  })

  it('is not drawn when the title only repeats the name of the control, from its label or its aria-label', () => {
    const bars = document.getElementById('bars')
    bars.labels = [document.querySelector('label[for="bars"]')]
    focus('bars')
    expect(tip()).toBeNull()
    focus('named')
    expect(tip()).toBeNull()
  })

  it('finds the title on the control when the focus is on something inside it', () => {
    focus('icon')
    expect(tip().textContent).toBe('Deep')
  })

  it('goes when the focus leaves, and when Escape is pressed, without taking the key', () => {
    focus('play')
    document.getElementById('play').dispatchEvent(new window.Event('focusout', { bubbles: true }))
    expect(tip().hidden).toBe(true)
    focus('tempo')
    expect(tip().hidden).toBe(false)
    const escape = new window.Event('keydown', { bubbles: true, cancelable: true })
    Object.defineProperty(escape, 'key', { value: 'Escape' })
    document.dispatchEvent(escape)
    expect(tip().hidden).toBe(true)
    expect(escape.defaultPrevented).toBe(false)
  })

  it('goes when the page scrolls or is resized, which would leave it under the wrong control', () => {
    focus('play')
    window.dispatchEvent(new window.Event('scroll'))
    expect(tip().hidden).toBe(true)
    focus('play')
    window.dispatchEvent(new window.Event('resize'))
    expect(tip().hidden).toBe(true)
  })

  it('replaces the text when the focus moves from one control to the next, and keeps one tip', () => {
    focus('play')
    focus('tempo')
    expect(document.querySelectorAll('.help-tip')).toHaveLength(1)
    expect(tip().textContent).toBe('Tempo in beats per minute')
  })

  it('stays inside the window at the right edge', () => {
    const element = document.getElementById('play')
    element.matches = () => true
    element.getBoundingClientRect = () => ({ left: 980, bottom: 60 })
    help.mount()
    const original = document.createElement.bind(document)
    document.createElement = tag => { const el = original(tag); Object.defineProperty(el, 'offsetWidth', { value: 200 }); return el }
    element.dispatchEvent(new window.Event('focusin', { bubbles: true }))
    expect(Number.parseInt(tip().style.left, 10)).toBeLessThanOrEqual(1000 - 200 - 8)
  })
})
