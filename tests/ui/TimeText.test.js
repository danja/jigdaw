// tests/ui/TimeText.test.js
import { describe, it, expect } from 'vitest'
import { formatClock } from '../../src/ui/TimeText.js'

describe('formatClock', () => {
  it('says minutes, seconds and tenths', () => {
    expect(formatClock(0)).toBe('0:00.0')
    expect(formatClock(1.5)).toBe('0:01.5')
    expect(formatClock(59.99)).toBe('0:59.9')
    expect(formatClock(60)).toBe('1:00.0')
    expect(formatClock(754.26)).toBe('12:34.2')
  })

  it('does not round a tenth up into the next second', () => {
    expect(formatClock(0.99)).toBe('0:00.9')
    expect(formatClock(119.999)).toBe('1:59.9')
  })

  it('reads a time that is not a time as zero', () => {
    for (const bad of [-3, NaN, Infinity, undefined, null, '5']) expect(formatClock(bad), String(bad)).toBe('0:00.0')
  })
})
