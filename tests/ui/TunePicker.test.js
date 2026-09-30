// tests/ui/TunePicker.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTunePicker } from '../../src/ui/TunePicker.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

describe('the tune picker', () => {
  const tunes = [{ label: 'Chiptune', url: 'u/chip' }, { label: 'Acid', url: 'u/acid' }]

  it('draws a button per tune in the order given, and says which is open in state and not only look', () => {
    const picker = createTunePicker(document, { onPick () {} })
    document.body.append(picker.element)
    picker.draw(tunes, { current: 'u/acid' })
    const buttons = [...document.querySelectorAll('.tune')]
    expect(buttons.map(b => b.textContent)).toEqual(['Chiptune', 'Acid'])
    expect(buttons.map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  })

  it('opens a tune only when it is pressed', () => {
    const picked = []
    const picker = createTunePicker(document, { onPick: t => picked.push(t.url) })
    document.body.append(picker.element)
    picker.draw(tunes)
    expect(picked).toEqual([])
    document.querySelector('.tune').dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(picked).toEqual(['u/chip'])
  })

  it('has none open when none is given', () => {
    const picker = createTunePicker(document, { onPick () {} })
    picker.draw(tunes)
    expect(picker.element.querySelectorAll('[aria-pressed="true"]')).toHaveLength(0)
  })

  it('will not be built without its handler', () => {
    expect(() => createTunePicker(document, {})).toThrow(/onPick/)
  })
})
