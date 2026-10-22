// tests/model/Scale.test.js
import { describe, it, expect } from 'vitest'
import { SCALES, SCALE_NAMES, inScale, snapPitch } from '../../src/model/Scale.js'

describe('inScale', () => {
  it('knows C major from its white keys, in any octave, and a transposed root', () => {
    const white = [0, 2, 4, 5, 7, 9, 11]
    for (let pc = 0; pc < 12; pc++) expect(inScale(60 + pc, 0, 'major')).toBe(white.includes(pc))
    expect(inScale(0, 0, 'major')).toBe(true)
    expect(inScale(127, 0, 'major')).toBe(true) // G
    // D major has F# and C#, not F or C.
    expect(inScale(66, 2, 'major')).toBe(true)
    expect(inScale(65, 2, 'major')).toBe(false)
  })

  it('refuses a root out of range and a scale it does not have', () => {
    expect(() => inScale(60, 12, 'major')).toThrow(/root/)
    expect(() => inScale(60, 1.5, 'major')).toThrow(/root/)
    expect(() => inScale(60, 0, 'lydian')).toThrow(/no such scale: lydian/)
  })

  it('has every scale start on its root and stay inside one octave, ascending', () => {
    for (const name of SCALE_NAMES) {
      const steps = SCALES[name]
      expect(steps[0]).toBe(0)
      expect([...steps].sort((a, b) => a - b)).toEqual(steps)
      expect(steps.at(-1)).toBeLessThan(12)
    }
  })
})

describe('snapPitch', () => {
  it('leaves a pitch in the scale alone, and moves a black key to a neighbour', () => {
    expect(snapPitch(60, 0, 'major')).toBe(60)
    expect(snapPitch(61, 0, 'major')).toBe(60)
    expect(snapPitch(66, 0, 'major')).toBe(65)
  })

  it('sends a pitch halfway between two to the lower, whatever the direction', () => {
    // 61 is a semitone from both 60 and 62 in C major pentatonic (0 2 4 7 9): 60 and 62, so lower.
    expect(snapPitch(61, 0, 'majorPentatonic')).toBe(60)
    // 66 has 64 and 67 near: 67 is one away, 64 is two.
    expect(snapPitch(66, 0, 'majorPentatonic')).toBe(67)
  })

  it('stays within 0 to 127 at the ends', () => {
    expect(snapPitch(127, 1, 'major')).toBeLessThanOrEqual(127)
    expect(snapPitch(0, 1, 'major')).toBeGreaterThanOrEqual(0)
    expect(inScale(snapPitch(127, 1, 'major'), 1, 'major')).toBe(true)
  })
})
