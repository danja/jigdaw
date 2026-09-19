// tests/ui/Tabs.test.js
//
// The WAI-ARIA tab pattern, checked against its own rules rather than against
// what looks right on screen: which element is reachable by Tab, what a
// screen reader is told is selected, and which panel is actually hidden.
//
// linkedom implements element.focus() as a no-op that never updates
// document.activeElement, the same limitation tests/ui/Focus.test.js already
// works around. So "moved the focus" is checked by replacing focus() with a
// counter before the interaction, not by reading activeElement afterward.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTabs } from '../../src/ui/Tabs.js'

let document

beforeEach(() => { ({ document } = parseHTML('<!doctype html><body></body></html>')) })

/** Two panels and the tabs pointing at them, the shape every test starts from. */
function build (onSelect) {
  const first = document.createElement('div')
  first.id = 'first-panel'
  first.textContent = 'first'
  const second = document.createElement('div')
  second.id = 'second-panel'
  second.textContent = 'second'
  document.body.append(first, second)

  const tabs = createTabs(document, [
    { id: 'first', label: 'First', panel: first },
    { id: 'second', label: 'Second', panel: second }
  ], onSelect ? { onSelect } : {})
  document.body.append(tabs.element)

  return { tabs, first, second, buttons: [...tabs.element.querySelectorAll('.tab')] }
}

/** Replace focus() with a counter, so a keyboard move can be proven without activeElement. */
function watchFocus (button) {
  const calls = { count: 0 }
  button.focus = () => { calls.count += 1 }
  return calls
}

/** A keydown for `key`. linkedom has no KeyboardEvent constructor, so a plain
 * Event carries the one property the listener actually reads, the same way
 * tests/ui/Dial.test.js builds a pointer event by hand. */
const keydown = key => {
  const event = new document.defaultView.Event('keydown', { bubbles: true, cancelable: true })
  event.key = key
  return event
}

/** linkedom's tabIndex getter always answers -1, whatever was assigned; the
 * tabindex attribute it wrote is correct, so that is what is read here. */
const tabIndex = element => Number(element.getAttribute('tabindex'))

describe('what a tab list is, to a screen reader', () => {
  it('is a tablist of tabs, each pointing at its panel', () => {
    const { tabs, buttons, first, second } = build()
    expect(tabs.element.getAttribute('role')).toBe('tablist')
    for (const button of buttons) expect(button.getAttribute('role')).toBe('tab')
    expect(buttons[0].getAttribute('aria-controls')).toBe(first.id)
    expect(buttons[1].getAttribute('aria-controls')).toBe(second.id)
  })

  it('labels each panel with the tab that owns it', () => {
    const { buttons, first, second } = build()
    expect(first.getAttribute('role')).toBe('tabpanel')
    expect(first.getAttribute('aria-labelledby')).toBe(buttons[0].id)
    expect(second.getAttribute('aria-labelledby')).toBe(buttons[1].id)
  })

  it('says which tab is selected, not only which panel is visible', () => {
    const { buttons } = build()
    expect(buttons[0].getAttribute('aria-selected')).toBe('true')
    expect(buttons[1].getAttribute('aria-selected')).toBe('false')
  })

  it('makes every panel reachable on its own, even an empty one', () => {
    const { first, second } = build()
    expect(tabIndex(first)).toBe(0)
    expect(tabIndex(second)).toBe(0)
  })
})

describe('what a tab list starts as', () => {
  it('shows the first panel and hides the rest', () => {
    const { first, second } = build()
    expect(first.hidden).toBe(false)
    expect(second.hidden).toBe(true)
  })

  it('puts only the selected tab in the page tab order', () => {
    // Roving tabindex: Tab itself must land on the tablist once, not once per
    // tab, or arrow-key navigation between tabs has nothing to add.
    const { buttons } = build()
    expect(tabIndex(buttons[0])).toBe(0)
    expect(tabIndex(buttons[1])).toBe(-1)
  })

  it('refuses to be built with no tabs', () => {
    expect(() => createTabs(document, [])).toThrow(/at least one tab/)
  })
})

describe('choosing a tab with a pointer', () => {
  it('shows that panel and hides the one before it', () => {
    const { buttons, first, second } = build()
    buttons[1].click()
    expect(second.hidden).toBe(false)
    expect(first.hidden).toBe(true)
  })

  it('moves aria-selected and the tab order to the clicked tab', () => {
    const { buttons } = build()
    buttons[1].click()
    expect(buttons[1].getAttribute('aria-selected')).toBe('true')
    expect(tabIndex(buttons[1])).toBe(0)
    expect(buttons[0].getAttribute('aria-selected')).toBe('false')
    expect(tabIndex(buttons[0])).toBe(-1)
  })

  it('tells the caller which tab was chosen', () => {
    const chosen = []
    const { buttons } = build(id => chosen.push(id))
    buttons[1].click()
    // The initial selection counts too: a caller wiring up its own panel
    // rendering from onSelect must not miss the very first one.
    expect(chosen).toEqual(['first', 'second'])
  })
})

describe('choosing a tab with the keyboard', () => {
  it('moves right and wraps from the last tab to the first', () => {
    const { buttons } = build()
    const watch = watchFocus(buttons[1])
    buttons[0].dispatchEvent(keydown('ArrowRight'))
    expect(buttons[1].getAttribute('aria-selected')).toBe('true')
    expect(watch.count, 'the keyboard did not follow the selection').toBe(1)

    const wrap = watchFocus(buttons[0])
    buttons[1].dispatchEvent(keydown('ArrowRight'))
    expect(buttons[0].getAttribute('aria-selected')).toBe('true')
    expect(wrap.count).toBe(1)
  })

  it('moves left and wraps from the first tab to the last', () => {
    const { buttons } = build()
    const watch = watchFocus(buttons[1])
    buttons[0].dispatchEvent(keydown('ArrowLeft'))
    expect(buttons[1].getAttribute('aria-selected')).toBe('true')
    expect(watch.count).toBe(1)
  })

  it('jumps to the first tab on Home and the last on End', () => {
    const { buttons } = build()
    buttons[1].dispatchEvent(keydown('End'))
    expect(buttons[1].getAttribute('aria-selected')).toBe('true')

    buttons[1].dispatchEvent(keydown('Home'))
    expect(buttons[0].getAttribute('aria-selected')).toBe('true')
  })

  it('leaves every other key alone', () => {
    const { buttons, first } = build()
    buttons[0].dispatchEvent(keydown('a'))
    expect(buttons[0].getAttribute('aria-selected')).toBe('true')
    expect(first.hidden).toBe(false)
  })
})

describe('choosing a tab from outside a keypress or a click', () => {
  it('selects by id', () => {
    const { tabs, second } = build()
    tabs.select('second')
    expect(second.hidden).toBe(false)
    expect(tabs.selected()).toBe('second')
  })

  it('refuses an id that names no tab', () => {
    const { tabs } = build()
    expect(() => tabs.select('third')).toThrow(/no such tab/)
  })

  it('reports the current tab without changing it', () => {
    const { tabs } = build()
    expect(tabs.selected()).toBe('first')
    tabs.select('second')
    expect(tabs.selected()).toBe('second')
  })
})
