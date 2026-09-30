// tests/ui/TimeView.test.js
import { describe, it, expect, vi } from 'vitest'
import { TimeView, MIN_PIXELS_PER_BEAT, MAX_PIXELS_PER_BEAT } from '../../src/ui/TimeView.js'

describe('TimeView', () => {
  it('maps beats and pixels both ways', () => {
    const t = new TimeView()
    t.scrollTo(4)
    expect(t.beatToX(6)).toBe(2 * t.pixelsPerBeat)
    expect(t.xToBeat(t.beatToX(7.5))).toBeCloseTo(7.5)
  })

  it('keeps the beat under the pointer still when zooming', () => {
    const t = new TimeView()
    t.scrollTo(8)
    const beat = t.xToBeat(120)
    t.zoomBy(2, 120)
    expect(t.xToBeat(120)).toBeCloseTo(beat)
  })

  it('clamps zoom, and refuses a factor that is not positive', () => {
    const t = new TimeView()
    t.zoomBy(1e6)
    expect(t.pixelsPerBeat).toBe(MAX_PIXELS_PER_BEAT)
    t.zoomBy(1e-9)
    expect(t.pixelsPerBeat).toBe(MIN_PIXELS_PER_BEAT)
    expect(() => t.zoomBy(0)).toThrow(/above zero/)
    expect(() => t.zoomBy(NaN)).toThrow(/above zero/)
  })

  it('never scrolls before zero', () => {
    const t = new TimeView()
    t.scrollTo(-5)
    expect(t.scrollBeat).toBe(0)
    t.zoomBy(0.5, 0)
    expect(t.scrollBeat).toBe(0)
  })

  it('fits a length into a width from the start', () => {
    const t = new TimeView()
    t.scrollTo(3)
    t.fit(32, 640)
    expect(t.pixelsPerBeat).toBe(20)
    expect(t.scrollBeat).toBe(0)
    expect(() => t.fit(0, 640)).toThrow()
  })

  it('snaps to the grid, to the bar, and not at all when bypassed or off', () => {
    const t = new TimeView()
    expect(t.snap(2.6, 4)).toBe(3)
    t.setGrid('1/4')
    expect(t.snap(2.6, 4)).toBe(2.5)
    t.setGrid('bar')
    expect(t.snap(5.9, 4)).toBe(4)
    expect(t.snap(5.9, 3)).toBe(6)
    expect(t.snap(5.9, 4, { bypass: true })).toBe(5.9)
    t.setGrid('off')
    expect(t.snap(5.9, 4)).toBe(5.9)
    expect(t.snap(-1, 4)).toBe(0)
  })

  it('refuses a grid it does not know', () => {
    expect(() => new TimeView().setGrid('1/3')).toThrow(/no such grid/)
  })

  it('notifies on change only', () => {
    const t = new TimeView()
    const fn = vi.fn()
    t.subscribe(fn)
    t.setGrid('beat')
    expect(fn).not.toHaveBeenCalled()
    t.setGrid('bar')
    expect(fn).toHaveBeenCalledTimes(1)
  })
})
