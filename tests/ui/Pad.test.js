// tests/ui/Pad.test.js
//
// The pad maps a pointer position to two port values, and shows where the two ports are. The drag is driven as a real one arrives: the
// press on the pad, and the move and the release on the document, since a drag that only listened on the pad would stop at its edge.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createPad, fractionOf, valueAt } from '../../src/ui/Pad.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const density = { symbol: 'density', name: 'Density', minimum: 0, maximum: 1 }
const variation = { symbol: 'variation', name: 'Variation', minimum: 0, maximum: 1 }
const velocity = { symbol: 'velocity', name: 'Velocity', minimum: 1, maximum: 127 }

function build (pad = { label: 'Feel', x: 'density', y: 'variation' }, ports = [density, variation, velocity]) {
  const sets = []
  const made = createPad(document, { pad, ports, onSet: (symbol, value) => sets.push([symbol, value]), id: 'p' })
  document.body.append(made.element)
  const surface = made.element.querySelector('.pad-surface')
  // linkedom has no layout: the pad is 200 by 100 pixels at the origin.
  surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 200, height: 100 })
  return { ...made, surface, sets, puck: made.element.querySelector('.pad-puck') }
}
const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries({ button: 0, ...props })) Object.defineProperty(e, k, { value: v })
  return e
}

describe('the mapping', () => {
  it('is linear across a port\'s own range, at both ends and between', () => {
    expect(valueAt(0, velocity)).toBe(1)
    expect(valueAt(1, velocity)).toBe(127)
    expect(valueAt(0.5, velocity)).toBe(64)
    expect(fractionOf(64, velocity)).toBeCloseTo(0.5)
    expect(fractionOf(1, velocity)).toBe(0)
  })

  it('stays inside the range for a fraction or a value outside it', () => {
    expect(valueAt(-1, density)).toBe(0)
    expect(valueAt(7, density)).toBe(1)
    expect(fractionOf(-3, density)).toBe(0)
    expect(fractionOf(9, density)).toBe(1)
  })

  it('puts a port with no range in the middle rather than dividing by zero', () => {
    expect(fractionOf(5, { minimum: 3, maximum: 3 })).toBe(0.5)
  })
})

describe('the pad', () => {
  it('sets the across port from left to right and the up port from bottom to top', () => {
    const { surface, sets } = build()
    surface.dispatchEvent(event('pointerdown', { clientX: 150, clientY: 25 }))
    expect(sets).toEqual([['density', 0.75], ['variation', 0.75]])
    document.dispatchEvent(event('pointerup', { clientX: 150, clientY: 25 }))
  })

  it('has the top edge the maximum and the bottom edge the minimum of the up port', () => {
    const { surface, sets } = build()
    surface.dispatchEvent(event('pointerdown', { clientX: 0, clientY: 0 }))
    surface.dispatchEvent(event('pointerdown', { clientX: 200, clientY: 100 }))
    document.dispatchEvent(event('pointerup', {}))
    expect(sets).toEqual([['density', 0], ['variation', 1], ['density', 1], ['variation', 0]])
  })

  it('follows the pointer on the document, and a drag past the pad stops at its edge', () => {
    const { surface, sets } = build()
    surface.dispatchEvent(event('pointerdown', { clientX: 100, clientY: 50 }))
    document.dispatchEvent(event('pointermove', { clientX: 900, clientY: -400 }))
    expect(sets.slice(-2)).toEqual([['density', 1], ['variation', 1]])
    document.dispatchEvent(event('pointerup', {}))
  })

  it('stops listening once released, or cancelled', () => {
    const { surface, sets } = build()
    surface.dispatchEvent(event('pointerdown', { clientX: 100, clientY: 50 }))
    document.dispatchEvent(event('pointerup', {}))
    const count = sets.length
    document.dispatchEvent(event('pointermove', { clientX: 10, clientY: 10 }))
    expect(sets).toHaveLength(count)
    surface.dispatchEvent(event('pointerdown', { clientX: 100, clientY: 50 }))
    document.dispatchEvent(event('pointercancel', {}))
    const after = sets.length
    document.dispatchEvent(event('pointermove', { clientX: 10, clientY: 10 }))
    expect(sets).toHaveLength(after)
  })

  it('ignores a press that is not the main button', () => {
    const { surface, sets } = build()
    surface.dispatchEvent(event('pointerdown', { button: 2, clientX: 100, clientY: 50 }))
    expect(sets).toEqual([])
  })

  it('sends nothing for a pad with no size, as when it is not on the screen', () => {
    const { surface, sets } = build()
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 0, height: 0 })
    surface.dispatchEvent(event('pointerdown', { clientX: 5, clientY: 5 }))
    expect(sets).toEqual([])
  })

  it('sends the value the pointer chose for the second axis even when sending the first makes the host push old values back', () => {
    // What the rack does: setting one port redraws every panel, which calls update() for every port with the model's last value.
    const sets = []
    let made
    made = createPad(document, {
      pad: { label: 'Feel', x: 'density', y: 'variation' },
      ports: [density, variation],
      id: 'q',
      onSet: (symbol, value) => {
        sets.push([symbol, value])
        made.update('density', 0.58)
        made.update('variation', 0.35)
      }
    })
    document.body.append(made.element)
    const surface = made.element.querySelector('.pad-surface')
    surface.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100 })
    surface.dispatchEvent(event('pointerdown', { clientX: 90, clientY: 10 }))
    document.dispatchEvent(event('pointerup', {}))
    expect(sets).toEqual([['density', 0.9], ['variation', 0.9]])
  })

  it('maps through each port\'s own range', () => {
    const { surface, sets } = build({ label: 'Hit', x: 'velocity', y: 'density' })
    surface.dispatchEvent(event('pointerdown', { clientX: 100, clientY: 100 }))
    document.dispatchEvent(event('pointerup', {}))
    expect(sets).toEqual([['velocity', 64], ['density', 0]])
  })

  it('moves the puck when a port changes some other way, and ignores a port that is not one of its two', () => {
    const { update, puck } = build()
    update('density', 0.25)
    update('variation', 1)
    expect(puck.style.left).toBe('25%')
    expect(puck.style.top).toBe('0%')
    update('velocity', 127)
    expect(puck.style.left).toBe('25%')
  })

  it('is refused for a port the plugin does not have, rather than drawn and left moving nothing', () => {
    expect(() => build({ label: 'Feel', x: 'density', y: 'missing' })).toThrow('pad Feel: density and missing must both be ports of the plugin')
  })

  it('is a named group that a screen reader skips the drawing of, with the controls named in words under it', () => {
    const { element, surface } = build()
    expect(element.getAttribute('role')).toBe('group')
    expect(document.getElementById(element.getAttribute('aria-labelledby')).textContent).toBe('Feel Across is Density, up is Variation.')
    expect(surface.getAttribute('aria-hidden')).toBe('true')
    expect(element.querySelector('[tabindex]')).toBeNull()
  })
})
