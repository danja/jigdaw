// tests/ui/AmountField.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createAmountField } from '../../src/ui/AmountField.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  return e
}

function build () {
  const applied = []
  const field = createAmountField(document, { id: 'by', label: 'Level by', unit: 'dB', min: -60, max: 24, step: 0.5, onApply: n => applied.push(n) })
  document.body.append(field.element)
  const said = () => field.element.querySelector('[role=status]').textContent
  return { field, applied, said, apply: () => document.getElementById('by-apply').dispatchEvent(event('click')) }
}

describe('an amount field', () => {
  it('sends the number typed, as a number, on Apply and on Enter, and keeps it for another go', () => {
    const { field, applied, apply } = build()
    field.input.value = '-3.5'
    apply()
    field.input.dispatchEvent(event('keydown', { key: 'Enter' }))
    expect(applied).toEqual([-3.5, -3.5])
    expect(field.input.value).toBe('-3.5')
  })

  it('names its unit to the input, and its limits', () => {
    const { field } = build()
    expect(field.input.getAttribute('aria-describedby')).toBe('by-unit')
    expect(document.getElementById('by-unit').textContent).toBe('dB')
    expect([field.input.min, field.input.max, field.input.step]).toEqual(['-60', '24', '0.5'])
    expect(field.input.type).toBe('number')
  })

  it('refuses an empty entry, text and a number out of range, saying so and marking the input', () => {
    const { field, applied, said, apply } = build()
    for (const bad of ['', '  ', 'loud', '25', '-61']) {
      field.input.value = bad
      apply()
      expect(field.input.getAttribute('aria-invalid')).toBe('true')
      expect(said()).toBe('Level by needs a number from -60 to 24')
    }
    expect(applied).toEqual([])
  })

  it('takes the refusal back once a good number is applied, and accepts both limits', () => {
    const { field, applied, said, apply } = build()
    field.input.value = 'x'
    apply()
    field.input.value = '24'
    apply()
    field.input.value = '-60'
    apply()
    expect(field.input.getAttribute('aria-invalid')).toBeNull()
    expect(said()).toBe('')
    expect(applied).toEqual([24, -60])
  })
})
