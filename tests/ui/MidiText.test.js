// tests/ui/MidiText.test.js
import { describe, it, expect } from 'vitest'
import { describeMidi, noteName } from '../../src/ui/MidiText.js'

describe('MIDI in words', () => {
  it('names notes with middle C as C4', () => {
    expect([60, 61, 69, 0, 127].map(noteName)).toEqual(['C4', 'C#4', 'A4', 'C-1', 'G9'])
  })

  it('reads note on, note off and a note on at velocity 0, with the channel counted from one', () => {
    expect(describeMidi([0x90, 60, 99])).toBe('Note on C4, velocity 99, channel 1')
    expect(describeMidi([0x80, 60, 0])).toBe('Note off C4, channel 1')
    expect(describeMidi([0x93, 61, 0])).toBe('Note off C#4, channel 4')
  })

  it('reads controllers, bend, program and pressure', () => {
    expect(describeMidi([0xb0, 7, 90])).toBe('Control 7 = 90, channel 1')
    expect(describeMidi([0xe0, 0, 64])).toBe('Pitch bend 0, channel 1')
    expect(describeMidi([0xe2, 0, 0])).toBe('Pitch bend -8192, channel 3')
    expect(describeMidi([0xc1, 5])).toBe('Program 5, channel 2')
    expect(describeMidi([0xd0, 40])).toBe('Channel pressure 40, channel 1')
    expect(describeMidi([0xa0, 60, 30])).toBe('Key pressure C4 = 30, channel 1')
  })

  it('gives what it does not know as hex rather than dropping it', () => {
    expect(describeMidi([0xf8])).toBe('Clock')
    expect(describeMidi([0xf0, 0x7e, 0xf7])).toBe('System message f0 7e f7')
  })
})
