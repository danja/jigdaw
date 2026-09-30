// tests/ui/Dock.test.js
//
// The splitter is driven the way a real drag arrives: the press on the handle,
// the move and the release on the document.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createDock, DOCK_MIN, DOCK_MAX, DOCK_DEFAULT, DOCK_STEP } from '../../src/ui/Dock.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  return e
}
const memory = (initial = {}) => {
  const data = { ...initial }
  return { getItem: k => data[k] ?? null, setItem: (k, v) => { data[k] = v }, data }
}

describe('the dock', () => {
  it('shows one slot at a time, titled for what is in it', () => {
    const dock = createDock(document, { slots: ['a', 'b'] })
    dock.show('b', 'Editor: B')
    expect(dock.shown).toBe('b')
    expect(dock.slot('a').hidden).toBe(true)
    expect(document.createElement('div') && dock.element.querySelector('h2').textContent).toBe('Editor: B')
    expect(() => dock.show('c', 'x')).toThrow(/no slot/)
    expect(() => createDock(document, { slots: [] })).toThrow()
  })

  it('leaves the splitter out while the first slot rests, since there is nothing to resize', () => {
    const dock = createDock(document, { slots: ['idle', 'b'] })
    const splitter = dock.element.querySelector('[role="separator"]')
    dock.show('idle', 'Editor')
    expect(splitter.hidden).toBe(true)
    expect(dock.element.querySelector('.dock-body').classList.contains('idle')).toBe(true)
    dock.show('b', 'Editor: B')
    expect(splitter.hidden).toBe(false)
    expect(dock.element.querySelector('.dock-body').classList.contains('idle')).toBe(false)
  })

  it('is a labelled region with a splitter that reports its value as text', () => {
    const dock = createDock(document, { slots: ['a'] })
    const splitter = dock.element.querySelector('[role="separator"]')
    expect(dock.element.getAttribute('aria-labelledby')).toBe('dock-title')
    expect(splitter.getAttribute('tabindex')).toBe('0')
    expect(splitter.getAttribute('aria-valuenow')).toBe(String(DOCK_DEFAULT))
    expect(splitter.getAttribute('aria-valuetext')).toBe(`${DOCK_DEFAULT} pixels tall`)
  })

  it('resizes by keys, within limits', () => {
    const dock = createDock(document, { slots: ['a'] })
    const splitter = dock.element.querySelector('[role="separator"]')
    splitter.dispatchEvent(event('keydown', { key: 'ArrowUp' }))
    expect(dock.height).toBe(DOCK_DEFAULT + DOCK_STEP)
    splitter.dispatchEvent(event('keydown', { key: 'End' }))
    expect(dock.height).toBe(DOCK_MAX)
    splitter.dispatchEvent(event('keydown', { key: 'ArrowUp' }))
    expect(dock.height).toBe(DOCK_MAX)
    splitter.dispatchEvent(event('keydown', { key: 'Home' }))
    expect(dock.height).toBe(DOCK_MIN)
    splitter.dispatchEvent(event('keydown', { key: 'ArrowDown' }))
    expect(dock.height).toBe(DOCK_MIN)
    expect(dock.element.querySelector('.dock-body').style.height).toBe(`${DOCK_MIN}px`)
  })

  it('follows a drag onto the document, and remembers only where it ended', () => {
    const storage = memory()
    const dock = createDock(document, { slots: ['a'], storage })
    const splitter = dock.element.querySelector('[role="separator"]')
    splitter.dispatchEvent(event('pointerdown', { button: 0, clientY: 500 }))
    document.dispatchEvent(event('pointermove', { clientY: 450 }))
    expect(dock.height).toBe(DOCK_DEFAULT + 50)
    expect(storage.data['jigdaw.dockHeight']).toBeUndefined()
    document.dispatchEvent(event('pointerup', { clientY: 420 }))
    expect(dock.height).toBe(DOCK_DEFAULT + 80)
    expect(storage.data['jigdaw.dockHeight']).toBe(String(DOCK_DEFAULT + 80))
    // Released: further movement does nothing.
    document.dispatchEvent(event('pointermove', { clientY: 0 }))
    expect(dock.height).toBe(DOCK_DEFAULT + 80)
  })

  it('starts from a remembered height, clamped, and copes with storage that throws', () => {
    expect(createDock(document, { slots: ['a'], storage: memory({ 'jigdaw.dockHeight': '9999' }) }).height).toBe(DOCK_MAX)
    expect(createDock(document, { slots: ['a'], storage: memory({ 'jigdaw.dockHeight': 'junk' }) }).height).toBe(DOCK_DEFAULT)
    const throwing = { getItem () { throw new Error('blocked') }, setItem () { throw new Error('blocked') } }
    const dock = createDock(document, { slots: ['a'], storage: throwing })
    dock.element.querySelector('[role="separator"]').dispatchEvent(event('keydown', { key: 'ArrowUp' }))
    expect(dock.height).toBe(DOCK_DEFAULT + DOCK_STEP)
  })
})
