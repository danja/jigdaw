// tests/ui/RollLane.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createRollLane, LANE_HEIGHT } from '../../src/ui/RollLane.js'

let document
let window
beforeEach(() => {
  ({ document, window } = parseHTML('<!doctype html><body></body>'))
  document.activeElement = null
  // A real focus() moves the focus and fires `focus`; the lane learns where the keys are from that event.
  window.HTMLElement.prototype.focus = function () { document.activeElement = this; this.dispatchEvent(new window.Event('focus')) }
})

const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries({ button: 0, ...props })) Object.defineProperty(e, k, { value: v })
  return e
}
const item = (key, beat, value, extra = {}) => ({ key, beat, value, name: `Velocity ${key}`, text: `${value} for ${key}`, chosen: false, ...extra })

function build (options = {}, items = [item('a', 0, 100), item('b', 1, 64), item('c', 2, 1)]) {
  const sets = []
  const lane = createRollLane(document, { id: 'lane', label: 'Velocity', min: 1, max: 127, onSet: (it, v) => sets.push([it.key, v]), ...options })
  document.body.append(lane.element)
  const bars = lane.element.querySelector('.piano-roll-lane-bars')
  // A real layout has a rectangle; the DOM used here has none, so the lane is given the one it is drawn in.
  bars.getBoundingClientRect = () => ({ top: 0, left: 0, width: 200, height: LANE_HEIGHT })
  lane.draw(items)
  const bar = key => [...bars.children].find(b => b.dataset.key === key)
  return { lane, sets, bars, bar }
}
const key = (el, k, mods = {}) => el.dispatchEvent(event('keydown', { key: k, ...mods }))

describe('the bars', () => {
  it('are sliders with a name, a range, a value and the value in words', () => {
    const { bar } = build()
    const b = bar('a')
    expect(b.getAttribute('role')).toBe('slider')
    expect(b.getAttribute('aria-label')).toBe('Velocity a')
    expect([b.getAttribute('aria-valuemin'), b.getAttribute('aria-valuemax'), b.getAttribute('aria-valuenow')]).toEqual(['1', '127', '100'])
    expect(b.getAttribute('aria-valuetext')).toBe('100 for a')
    expect(b.getAttribute('aria-orientation')).toBe('vertical')
  })

  it('are as tall as their value, never invisible, and marked in the class when chosen', () => {
    const { bar } = build({}, [item('a', 0, 127), item('b', 1, 1, { chosen: true })])
    expect(bar('a').firstChild.style.height).toBe(`${LANE_HEIGHT}px`)
    expect(bar('b').firstChild.style.height).toBe('2px')
    expect(bar('b').classList.contains('chosen')).toBe(true)
  })

  it('give the keyboard one tab stop, on the first bar to start', () => {
    const { bars } = build()
    expect([...bars.children].map(b => b.getAttribute('tabindex'))).toEqual(['0', '-1', '-1'])
  })

  it('share a column between items that start together', () => {
    const { bar } = build({}, [item('a', 0, 100), item('b', 0, 90), item('c', 1, 80)])
    expect(bar('a').style.width).toBe('calc(var(--cell) / 2)')
    expect(bar('b').style.width).toBe('calc(var(--cell) / 2)')
    expect(bar('c').style.width).toBe('calc(var(--cell) / 1)')
    expect(bar('a').style.left).not.toBe(bar('b').style.left)
  })
})

describe('the keys', () => {
  it('change the value by one, by ten with Shift or Page keys, and go to the ends with Home and End', () => {
    const { bar, sets } = build()
    const b = bar('b')
    key(b, 'ArrowUp'); key(b, 'ArrowDown'); key(b, 'ArrowUp', { shiftKey: true }); key(b, 'PageDown'); key(b, 'PageUp'); key(b, 'Home'); key(b, 'End')
    expect(sets).toEqual([['b', 65], ['b', 63], ['b', 74], ['b', 54], ['b', 74], ['b', 1], ['b', 127]])
  })

  it('send nothing when the value would not change, at either end', () => {
    const { bar, sets } = build()
    key(bar('c'), 'ArrowDown'); key(bar('c'), 'Home')
    const top = build({}, [item('z', 0, 127)])
    key(top.bar('z'), 'ArrowUp'); key(top.bar('z'), 'End')
    expect(sets).toEqual([])
    expect(top.sets).toEqual([])
  })

  it('clamp a ten-step to the range', () => {
    const { bar, sets } = build()
    key(bar('c'), 'PageUp'); key(bar('a'), 'PageUp')
    expect(sets).toEqual([['c', 11], ['a', 110]])
  })

  it('move to the neighbouring bar with Left and Right, keeping the focus there', () => {
    const { bar, bars } = build()
    key(bar('a'), 'ArrowRight')
    expect(document.activeElement.dataset.key).toBe('b')
    expect([...bars.children].map(b => b.getAttribute('tabindex'))).toEqual(['-1', '0', '-1'])
    key(document.activeElement, 'ArrowLeft')
    key(document.activeElement, 'ArrowLeft')
    expect(document.activeElement.dataset.key).toBe('a')
  })

  it('keep the focus on the bar through the redraw an edit causes', () => {
    const { lane, bar } = build()
    bar('b').focus()
    lane.draw([item('a', 0, 100), item('b', 1, 70), item('c', 2, 1)])
    expect(document.activeElement.dataset.key).toBe('b')
    expect(document.activeElement.getAttribute('aria-valuenow')).toBe('70')
  })

  it('remove with Delete only where the caller can remove', () => {
    const removed = []
    const a = build({ onRemove: it => removed.push(it.key) })
    key(a.bar('b'), 'Delete'); key(a.bar('c'), 'Backspace')
    expect(removed).toEqual(['b', 'c'])
    const b = build()
    key(b.bar('b'), 'Delete')
    expect(b.sets).toEqual([])
  })
})

describe('a drag', () => {
  const down = (el, y) => el.dispatchEvent(event('pointerdown', { clientY: y, clientX: 0 }))
  const move = y => document.dispatchEvent(event('pointermove', { clientY: y }))
  const up = () => document.dispatchEvent(event('pointerup'))

  it('follows the pointer on the bar, and sends one edit on release', () => {
    const { bar, sets } = build()
    const b = bar('b')
    down(b, LANE_HEIGHT / 2)
    expect(b.getAttribute('aria-valuenow')).toBe('64')
    move(0)
    expect(b.getAttribute('aria-valuenow')).toBe('127')
    move(LANE_HEIGHT)
    expect(b.getAttribute('aria-valuenow')).toBe('1')
    move(LANE_HEIGHT / 4)
    expect(sets).toEqual([])
    up()
    expect(sets).toHaveLength(1)
    expect(sets[0][0]).toBe('b')
    expect(sets[0][1]).toBeGreaterThan(90)
    move(0); up()
    expect(sets).toHaveLength(1)
  })

  it('clamps a pointer above or below the lane to the ends of the range', () => {
    const { bar, sets } = build()
    down(bar('b'), -50); up()
    down(bar('b'), LANE_HEIGHT + 50); up()
    expect(sets).toEqual([['b', 127], ['b', 1]])
  })

  it('sends nothing when it is cancelled, and puts the bar back', () => {
    const { bar, sets } = build()
    const b = bar('b')
    down(b, 0)
    document.dispatchEvent(event('pointercancel'))
    expect(sets).toEqual([])
    expect(b.getAttribute('aria-valuenow')).toBe('64')
    expect(b.firstChild.style.height).toBe(`${(63 / 126) * LANE_HEIGHT}px`)
    up()
    expect(sets).toEqual([])
  })

  it('is dropped, not committed, when the lane is drawn again under it', () => {
    const { lane, bar, sets } = build()
    down(bar('b'), 0)
    lane.draw([item('a', 0, 100)])
    up()
    expect(sets).toEqual([])
  })
})

describe('adding to a lane that allows it', () => {
  it('adds at the fraction along the lane and the value pressed on empty lane, and not on a bar', () => {
    const added = []
    const { bars, bar } = build({ onAdd: (x, value) => added.push([x, value]) })
    bars.dispatchEvent(event('pointerdown', { clientX: 50, clientY: 0 }))
    bars.dispatchEvent(event('pointerdown', { clientX: 999, clientY: LANE_HEIGHT }))
    expect(added).toEqual([[0.25, 127], [1, 1]])
    bar('a').dispatchEvent(event('pointerdown', { clientX: 5, clientY: 0 }))
    expect(added).toHaveLength(2)
  })

  it('has no add without the caller asking', () => {
    const { bars, sets } = build()
    bars.dispatchEvent(event('pointerdown', { clientX: 60, clientY: 0 }))
    expect(sets).toEqual([])
  })
})
