// tests/model/TapTempo.test.js
import { describe, it, expect } from 'vitest'
import { createTapper } from '../../src/model/TapTempo.js'

function rig (options = {}) {
  let clock = 0
  const tapper = createTapper({ now: () => clock, ...options })
  return { tapper, tapAt: ms => { clock = ms; return tapper.tap() } }
}

describe('a tapper', () => {
  it('needs two taps before it says anything', () => {
    const { tapAt } = rig()
    expect(tapAt(0)).toBeNull()
    expect(tapAt(500)).toBe(120)
  })

  it('averages the gaps of the last few taps, so one uneven tap moves it a little', () => {
    const { tapAt } = rig()
    tapAt(0); tapAt(500); tapAt(1000)
    // The next tap is 100 ms late: the mean gap is 1600 / 3 ms, a little under 120 and not a jump to 100.
    expect(tapAt(1600)).toBe(112.5)
    // Five taps now, from 0 to 2100: the mean gap is 525 ms.
    expect(tapAt(2100)).toBe(114.3)
  })

  it('uses only the last five taps, so an early wobble is forgotten', () => {
    const { tapAt } = rig()
    tapAt(0); tapAt(300)
    for (let i = 1; i <= 5; i++) tapAt(300 + i * 500)
    expect(tapAt(300 + 6 * 500)).toBe(120)
  })

  it('starts a new count after a pause, rather than reading the pause as a slow beat', () => {
    const { tapAt, tapper } = rig()
    tapAt(0); tapAt(500)
    expect(tapAt(10000)).toBeNull()
    expect(tapper.count).toBe(1)
    expect(tapAt(10500)).toBe(120)
  })

  it('keeps the tempo inside the range, and to one decimal place', () => {
    const { tapAt } = rig()
    tapAt(0)
    expect(tapAt(100)).toBe(300)
    const slow = rig({ maxGapMs: 10000 })
    slow.tapAt(0)
    expect(slow.tapAt(6000)).toBe(20)
    const odd = rig()
    odd.tapAt(0)
    expect(odd.tapAt(510)).toBe(117.6)
  })

  it('says nothing for two taps at the same instant, and can be reset', () => {
    const { tapAt, tapper } = rig()
    tapAt(1000)
    expect(tapAt(1000)).toBeNull()
    tapper.reset()
    expect(tapper.count).toBe(0)
  })

  it('refuses to be built without a clock', () => {
    expect(() => createTapper()).toThrow(/clock/)
  })
})
