// tests/ui/Keyboard.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createKeyboard, noteName, noteOn, noteOff } from '../../src/ui/Keyboard.js'

let document
beforeEach(() => { ({ document } = parseHTML('<!doctype html><body></body>')) })

const build = (over = {}) => {
  const sent = []
  const keyboard = createKeyboard(document, { onNote: bytes => sent.push([...bytes]), ...over })
  return { keyboard, sent }
}

const pointer = (element, type) => {
  const Event = element.ownerDocument.defaultView.Event
  element.dispatchEvent(new Event(type))
}

describe('noteName', () => {
  it('names middle C and the A above it as a musician would', () => {
    expect(noteName(60)).toBe('C4')
    expect(noteName(69)).toBe('A4')
    expect(noteName(61)).toBe('C#4')
  })
})

describe('the MIDI it sends', () => {
  it('is the three bytes any MIDI source sends', () => {
    expect([...noteOn(69, 100)]).toEqual([0x90, 69, 100])
    expect([...noteOff(69)]).toEqual([0x80, 69, 0])
  })
})

describe('layout', () => {
  it('draws seven white keys and five black ones per octave', () => {
    const { keyboard } = build({ octaves: 2 })
    expect(keyboard.element.querySelectorAll('.key-white')).toHaveLength(14)
    expect(keyboard.element.querySelectorAll('.key-black')).toHaveLength(10)
  })

  it('starts where it is told', () => {
    const { keyboard } = build({ first: 60, octaves: 1 })
    const notes = [...keyboard.element.querySelectorAll('.key')].map(k => Number(k.dataset.note))
    expect(Math.min(...notes)).toBe(60)
    expect(Math.max(...notes)).toBe(71)
  })

  it('names every key for a screen reader, which cannot see a piano', () => {
    const { keyboard } = build({ first: 60, octaves: 1 })
    for (const key of keyboard.element.querySelectorAll('.key')) {
      expect(key.getAttribute('aria-label')).toMatch(/^[A-G]#?-?\d$/)
    }
  })

  it('uses buttons, so every key is reachable by tab', () => {
    const { keyboard } = build()
    const tags = new Set([...keyboard.element.querySelectorAll('.key')].map(k => k.tagName.toLowerCase()))
    expect([...tags]).toEqual(['button'])
  })
})

describe('playing', () => {
  it('sends note on when pressed and note off when released', () => {
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    const c = keyboard.element.querySelector('[data-note="60"]')
    pointer(c, 'pointerdown')
    expect(sent).toEqual([[0x90, 60, 100]])
    pointer(c, 'pointerup')
    expect(sent[1]).toEqual([0x80, 60, 0])
  })

  it('does not retrigger a key that is already down', () => {
    // A pointer that moves within a key fires more than once, and a synth that
    // retriggers on each one sounds like a stutter.
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    const c = keyboard.element.querySelector('[data-note="60"]')
    pointer(c, 'pointerdown')
    pointer(c, 'pointerdown')
    expect(sent).toHaveLength(1)
  })

  it('sends nothing on releasing a key that was not held', () => {
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    pointer(keyboard.element.querySelector('[data-note="60"]'), 'pointerup')
    expect(sent).toEqual([])
  })

  it('releases a note when the pointer leaves the key', () => {
    // Otherwise dragging off a key leaves it sounding for ever.
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    const c = keyboard.element.querySelector('[data-note="60"]')
    pointer(c, 'pointerdown')
    pointer(c, 'pointerleave')
    expect(sent[1]).toEqual([0x80, 60, 0])
    expect(keyboard.held).toEqual([])
  })

  it('tracks what is held', () => {
    const { keyboard } = build({ first: 60, octaves: 1 })
    pointer(keyboard.element.querySelector('[data-note="60"]'), 'pointerdown')
    pointer(keyboard.element.querySelector('[data-note="64"]'), 'pointerdown')
    expect(keyboard.held.sort((a, b) => a - b)).toEqual([60, 64])
  })

  it('releases everything on request, so a removed instrument is not left sounding', () => {
    const { keyboard, sent } = build({ first: 60, octaves: 1 })
    pointer(keyboard.element.querySelector('[data-note="60"]'), 'pointerdown')
    pointer(keyboard.element.querySelector('[data-note="64"]'), 'pointerdown')
    keyboard.allNotesOff()
    expect(keyboard.held).toEqual([])
    expect(sent.filter(m => m[0] === 0x80)).toHaveLength(2)
  })
})
