// tests/ui/SliderDrag.test.js
//
// A drag on a native range input that survives the input being taken out of the page and put back (src/ui/SliderDrag.js).
// A DOM has no layout and no native drag to cancel, so this is given the measurements a browser would, and the rule it holds
// is the one the browser broke: the move and the release are heard on the document, and the value comes from where the
// pointer is, so a redraw in the middle changes nothing.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { attachSliderDrag } from '../../src/ui/SliderDrag.js'

const PORT = { minimum: 0, maximum: 1 }

// An input 200 wide at x 100: the thumb is 16 wide, so its centre runs from 108 to 292.
function start (value = 0.5) {
  const { document, window } = parseHTML('<!doctype html><html><body></body></html>')
  const input = document.createElement('input')
  input.type = 'range'
  input.min = '0'; input.max = '1'; input.step = '0.005'; input.value = String(value)
  input.getBoundingClientRect = () => ({ left: 100, width: 200, top: 0, height: 44 })
  document.body.append(input)
  attachSliderDrag(input, PORT)
  const inputs = []
  input.addEventListener('input', () => inputs.push(Number(input.value)))
  const fire = (target, type, init = {}) => { const e = new window.Event(type, { bubbles: true }); Object.assign(e, init); target.dispatchEvent(e) }
  return { document, input, inputs, fire, window }
}

describe('dragging a slider', () => {
  it('follows the pointer to the document, not only over the input', () => {
    const { document, input, inputs, fire } = start(0.5)
    fire(input, 'pointerdown', { button: 0, clientX: 200 })
    fire(document, 'pointermove', { clientX: 250 })
    fire(document, 'pointermove', { clientX: 900 })
    expect(inputs.at(-1)).toBe(1)
    fire(document, 'pointermove', { clientX: -400 })
    expect(inputs.at(-1)).toBe(0)
  })

  it('keeps going across a removal and a re-attachment of the input, which ends a native drag', () => {
    const { document, input, inputs, fire } = start(0.5)
    fire(input, 'pointerdown', { button: 0, clientX: 200 })
    fire(document, 'pointermove', { clientX: 240 })
    // The rack is redrawn by the first change: the same element comes out and goes back in.
    input.remove()
    document.body.append(input)
    fire(document, 'pointermove', { clientX: 280 })
    expect(inputs.length).toBeGreaterThan(1)
    expect(inputs.at(-1)).toBeGreaterThan(inputs[0])
  })

  it('keeps the thumb under the pointer when it is grabbed, instead of moving its centre to the press', () => {
    const { input, inputs, fire } = start(0.5)
    // The thumb centre is at 100 + 8 + 0.5 * 184 = 200. Press 6 px to the right of it.
    fire(input, 'pointerdown', { button: 0, clientX: 206 })
    expect(inputs).toEqual([])
    expect(Number(input.value)).toBe(0.5)
  })

  it('moves the thumb to a press on the track away from it, as the native control does', () => {
    const { input, inputs, fire } = start(0.5)
    fire(input, 'pointerdown', { button: 0, clientX: 292 })
    expect(inputs).toEqual([1])
  })

  it('stops following on release, and again on cancel', () => {
    const { document, input, inputs, fire } = start(0.5)
    fire(input, 'pointerdown', { button: 0, clientX: 200 })
    fire(document, 'pointerup', {})
    fire(document, 'pointermove', { clientX: 290 })
    expect(inputs).toEqual([])
    fire(input, 'pointerdown', { button: 0, clientX: 200 })
    fire(document, 'pointercancel', {})
    fire(document, 'pointermove', { clientX: 290 })
    expect(inputs).toEqual([])
  })

  it('ignores a button that is not the primary one, and a move with no drag begun', () => {
    const { document, input, inputs, fire } = start(0.5)
    fire(input, 'pointerdown', { button: 2, clientX: 292 })
    fire(document, 'pointermove', { clientX: 292 })
    expect(inputs).toEqual([])
  })

  it('snaps to the step, and never reports the value it already has', () => {
    const { document, input, inputs, fire } = start(0.5)
    fire(input, 'pointerdown', { button: 0, clientX: 200 })
    fire(document, 'pointermove', { clientX: 200.2 })
    fire(document, 'pointermove', { clientX: 200.2 })
    expect(inputs.every(v => Math.abs(v / 0.005 - Math.round(v / 0.005)) < 1e-6)).toBe(true)
    expect(new Set(inputs).size).toBe(inputs.length)
  })

  it('does nothing, rather than guessing, when the input has no width to measure', () => {
    const { document, input, inputs, fire } = start(0.5)
    input.getBoundingClientRect = () => ({ left: 0, width: 0, top: 0, height: 0 })
    fire(input, 'pointerdown', { button: 0, clientX: 50 })
    fire(document, 'pointermove', { clientX: 60 })
    expect(inputs).toEqual([])
  })
})
