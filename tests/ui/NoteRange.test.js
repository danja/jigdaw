// tests/ui/NoteRange.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createNoteRange, noteName } from '../../src/ui/NoteRange.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const change = el => el.dispatchEvent(new window.Event('change', { bubbles: true }))

describe('note names', () => {
  it('names notes by pitch class and octave, with middle C as C4', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(0)).toBe('C-1')
    expect(noteName(127)).toBe('G9')
    expect(noteName(69)).toBe('A4')
    expect(noteName(61)).toBe('C#4')
  })
  it('refuses what is not a MIDI note', () => {
    for (const bad of [-1, 128, 60.5, '60', NaN]) expect(() => noteName(bad)).toThrow(/MIDI note/)
  })
})

describe('the note range fields', () => {
  const build = (over = {}) => {
    const calls = []
    const range = createNoteRange(document, { idBase: 'r1', what: 'to Bass', onChange: c => calls.push(c), ...over })
    document.body.append(range.element)
    return { range, calls }
  }

  it('has two labelled number fields from 0 to 127 in a named group, and needs no more to be understood', () => {
    build()
    const group = document.querySelector('.note-range')
    expect(group.getAttribute('role')).toBe('group')
    expect(group.getAttribute('aria-label')).toBe('Notes let through to Bass')
    const inputs = [...group.querySelectorAll('input')]
    expect(inputs.map(i => i.id)).toEqual(['r1-lowNote', 'r1-highNote'])
    for (const input of inputs) expect([input.type, input.min, input.max, input.step]).toEqual(['number', '0', '127', '1'])
    expect([...group.querySelectorAll('label')].map(l => l.querySelector('span').textContent)).toEqual(['Lowest note', 'Highest note'])
  })

  it('shows a range with the note names beside it, and an end that is not set as empty', () => {
    const { range } = build()
    range.show({ lowNote: 60, highNote: undefined })
    expect(document.getElementById('r1-lowNote').value).toBe('60')
    expect(document.getElementById('r1-highNote').value).toBe('')
    expect([...document.querySelectorAll('.note-name')].map(n => n.textContent)).toEqual(['C4', ''])
  })

  it('reports both ends when one is committed, with null for an empty one, which is how an end is taken away', () => {
    const { range, calls } = build()
    range.show({ lowNote: 36, highNote: undefined })
    const high = document.getElementById('r1-highNote')
    high.value = '59'
    change(high)
    expect(calls).toEqual([{ lowNote: 36, highNote: 59 }])
    const low = document.getElementById('r1-lowNote')
    low.value = ''
    change(low)
    expect(calls[1]).toEqual({ lowNote: null, highNote: 59 })
  })

  it('leaves a field alone while it has the focus, so a redraw does not change what is being typed', () => {
    const { range } = build()
    const low = document.getElementById('r1-lowNote')
    low.value = '4'
    range.show({ lowNote: 60, highNote: undefined }, low)
    expect(low.value).toBe('4')
  })

  it('refuses to be built without an id base or a callback', () => {
    expect(() => createNoteRange(document, { what: 'x', onChange () {} })).toThrow(/idBase/)
    expect(() => createNoteRange(document, { idBase: 'a', what: 'x' })).toThrow(/onChange/)
  })
})
