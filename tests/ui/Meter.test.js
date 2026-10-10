// tests/ui/Meter.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createMeter } from '../../src/ui/Meter.js'

let document
beforeEach(() => { ({ document } = parseHTML('<!doctype html><body></body>')) })
const classes = meter => [...meter.element.querySelectorAll('.meter i')].map(i => i.className)

describe('the meter', () => {
  it('is named for what it measures, and hides the bars from assistive technology', () => {
    const meter = createMeter(document, { label: 'Sprout' })
    expect(meter.element.getAttribute('aria-label')).toBe('Level of Sprout')
    expect(meter.element.querySelector('.meter').getAttribute('aria-hidden')).toBe('true')
    expect(meter.element.querySelector('.meter-readout').textContent).toBe('-inf dB')
    expect(meter.element.querySelector('[aria-live]')).toBeNull()
  })

  it('refuses to be built without saying what it measures', () => {
    expect(() => createMeter(document, {})).toThrow(/label/)
  })

  it('lights bars for the level, the top two as hot, and shows the held peak as text', () => {
    const meter = createMeter(document, { label: 'Master', bars: 12 })
    meter.set(1, 0)
    expect(classes(meter)).toEqual([...Array(10).fill('on'), 'hot', 'hot'])
    expect(meter.element.querySelector('.meter-readout').textContent).toBe('0.0 dB')
    meter.set(0, 100)
    expect(classes(meter).every(c => c === '')).toBe(true)
    // The number is still the peak a moment ago.
    expect(meter.element.querySelector('.meter-readout').textContent).toBe('0.0 dB')
    meter.set(0, 5000)
    expect(meter.element.querySelector('.meter-readout').textContent).toBe('-inf dB')
  })

  it('touches the page only when what it shows has changed', () => {
    const meter = createMeter(document, { label: 'Master' })
    const cell = meter.element.querySelector('.meter i')
    meter.set(0.5, 0)
    // Marked by hand: a second frame at the same level must leave it alone, as a redraw would not.
    cell.className = 'marked'
    meter.set(0.5, 16)
    meter.set(0.5, 32)
    expect(cell.className).toBe('marked')
    meter.set(0, 48)
    expect(cell.className).toBe('')
  })
})
