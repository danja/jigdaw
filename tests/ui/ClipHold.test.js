// tests/ui/ClipHold.test.js
import { describe, it, expect } from 'vitest'
import { createClipHold, CLIP_LEVEL } from '../../src/ui/ClipHold.js'

describe('the clip hold', () => {
  it('starts clear and stays clear below the top of the range', () => {
    const hold = createClipHold()
    expect(hold.clipped).toBe(false)
    for (const peak of [0, 0.3, 0.9, CLIP_LEVEL - 0.001]) expect(hold.update(peak)).toBe(false)
  })

  it('latches on a clip and holds it through quiet frames until cleared', () => {
    const hold = createClipHold()
    expect(hold.update(1)).toBe(true)
    expect(hold.update(0)).toBe(true)
    expect(hold.clipped).toBe(true)
    hold.clear()
    expect(hold.clipped).toBe(false)
    expect(hold.update(0.5)).toBe(false)
  })

  it('counts a sample past full scale, which a clipped mix before the limiter has', () => {
    expect(createClipHold().update(2.7)).toBe(true)
  })

  it('refuses a level that is not a level, rather than never clipping', () => {
    for (const level of [0, -1, 1.5, NaN, 'high']) expect(() => createClipHold({ level })).toThrow(/clip level/)
  })
})
