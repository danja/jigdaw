// tests/ui/MeterModel.test.js
import { describe, it, expect } from 'vitest'
import { peakDb, litBars, readout, createPeakHold, FLOOR_DB } from '../../src/ui/MeterModel.js'

describe('the meter scale', () => {
  it('is decibels: full scale is 0, half is about -6, and silence is minus infinity', () => {
    expect(peakDb(1)).toBe(0)
    expect(peakDb(0.5)).toBeCloseTo(-6.02, 2)
    expect(peakDb(0)).toBe(-Infinity)
    expect(peakDb(2)).toBeCloseTo(6.02, 2)
  })

  it('lights nothing at and below the floor, everything at full scale, and no more above it', () => {
    expect(litBars(0, 12)).toBe(0)
    expect(litBars(10 ** (FLOOR_DB / 20), 12)).toBe(0)
    expect(litBars(1, 12)).toBe(12)
    expect(litBars(4, 12)).toBe(12)
  })

  it('lights one bar for anything above the floor, so a quiet track is not shown as silent', () => {
    expect(litBars(10 ** ((FLOOR_DB + 0.5) / 20), 12)).toBe(1)
  })

  it('rises with the level, a bar for each fraction of the range, evenly in decibels', () => {
    const at = db => litBars(10 ** (db / 20), 12)
    expect(at(-36)).toBe(3)
    expect(at(-24)).toBe(6)
    expect(at(-12)).toBe(9)
    const levels = [-45, -40, -30, -20, -10, -3, 0].map(at)
    expect([...levels].sort((a, b) => a - b)).toEqual(levels)
  })

  it('refuses a meter with no bars or a floor that is not below zero, rather than drawing nonsense', () => {
    expect(() => litBars(0.5, 0)).toThrow(/at least one bar/)
    expect(() => litBars(0.5, 12, { floorDb: 0 })).toThrow(/floor/)
    expect(() => litBars(0.5, 12, { floorDb: Number.NaN })).toThrow(/floor/)
  })
})

describe('the readout', () => {
  it('says decibels with a sign where it is above zero, and minus infinity for silence', () => {
    expect(readout(1)).toBe('0.0 dB')
    expect(readout(0.25)).toBe('-12.0 dB')
    expect(readout(1.2)).toBe('+1.6 dB')
    expect(readout(0)).toBe('-inf dB')
  })
})

describe('the peak hold', () => {
  it('holds the highest peak for the hold time, then lets go to what is there', () => {
    const hold = createPeakHold({ holdMs: 1000 })
    expect(hold.update(0.2, 0)).toBe(0.2)
    expect(hold.update(0.8, 100)).toBe(0.8)
    expect(hold.update(0.1, 600)).toBe(0.8)
    expect(hold.update(0.1, 1100)).toBe(0.8)
    expect(hold.update(0.1, 1101)).toBe(0.1)
  })

  it('starts a new hold when a peak is as high as the held one, so a steady level does not flicker', () => {
    const hold = createPeakHold({ holdMs: 1000 })
    hold.update(0.5, 0)
    expect(hold.update(0.5, 900)).toBe(0.5)
    expect(hold.update(0.2, 1800)).toBe(0.5)
  })

  it('refuses a hold time that is not a time', () => {
    expect(() => createPeakHold({ holdMs: -1 })).toThrow(/hold time/)
    expect(() => createPeakHold({ holdMs: Number.NaN })).toThrow(/hold time/)
  })
})
