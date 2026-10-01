// tests/engine/Automation.test.js
import { describe, it, expect } from 'vitest'
import { automationBetween, valueAtSeconds } from '../../src/engine/Automation.js'
import { segments } from '../../src/engine/Scheduler.js'

// Two beats a second, so beat b is at b / 2 seconds.
const plain = { secondsAtBeat: b => b / 2, loop: { enabled: false } }
const looped = (start, end) => ({ secondsAtBeat: b => b / 2, loop: { enabled: true, start, end } })
const run = (transport, points, start, end) => automationBetween(transport, points, [...segments(transport, start, end)], start, end)
const pt = (atBeat, value, curve = 'linear') => ({ atBeat, value, curve })

describe('the value of an envelope at a time', () => {
  const timed = [{ t: 0, value: 0, curve: 'linear' }, { t: 2, value: 10, curve: 'step' }, { t: 4, value: 20, curve: 'smooth' }, { t: 6, value: 0, curve: 'linear' }]
  it('holds the first value before the first point and the last after the last', () => {
    expect(valueAtSeconds(timed, -1)).toBe(0)
    expect(valueAtSeconds(timed, 99)).toBe(0)
    expect(valueAtSeconds([], 1)).toBeNull()
  })
  it('follows each segment by the curve of the point it leaves', () => {
    expect(valueAtSeconds(timed, 1)).toBe(5)
    expect(valueAtSeconds(timed, 3)).toBe(10)
    // From 20 at 4 s towards 0 at 6 s, smoothstep: halfway is half, a quarter of the way is 0.15625 of it.
    expect(valueAtSeconds(timed, 5)).toBe(10)
    expect(valueAtSeconds(timed, 4.5)).toBeCloseTo(20 - 20 * 0.15625, 10)
  })
})

describe('what an envelope asks of a parameter', () => {
  it('sets the first value at the start, then each point at its own time, with a ramp to the next', () => {
    const out = run(plain, [pt(0, 0), pt(4, 8)], 0, 10)
    expect(out.map(i => [i.kind, i.at, i.value ?? null])).toEqual([['set', 0, 0], ['ramp', 0, 0], ['set', 2, 8]])
    expect(out[1]).toMatchObject({ end: 2, endValue: 8 })
  })

  it('a step holds and asks for no ramp', () => {
    const out = run(plain, [pt(0, 1, 'step'), pt(2, 5, 'step')], 0, 10)
    expect(out.map(i => i.kind)).toEqual(['set', 'set'])
  })

  it('a smooth segment is a curve that starts and ends on its points', () => {
    const out = run(plain, [pt(0, 0, 'smooth'), pt(4, 10)], 0, 10)
    const curve = out.find(i => i.kind === 'curve')
    expect(curve.at).toBe(0)
    expect(curve.duration).toBe(2)
    expect(curve.values[0]).toBe(0)
    expect(curve.values.at(-1)).toBeCloseTo(10, 5)
    expect([...curve.values].every((v, k, a) => k === 0 || v >= a[k - 1])).toBe(true)
  })

  it('only gives what falls inside the window, so each point is asked for once across windows', () => {
    const points = [pt(0, 0), pt(2, 4), pt(4, 8), pt(6, 2)]
    const all = run(plain, points, 0, 10)
    const split = [...run(plain, points, 0, 1.5), ...run(plain, points, 1.5, 10)]
    expect(split.map(i => [i.kind, i.at])).toEqual(all.map(i => [i.kind, i.at]))
  })

  it('holds the last value after the last point and asks for nothing more', () => {
    const out = run(plain, [pt(0, 0), pt(2, 6)], 5, 9)
    expect(out).toEqual([])
  })

  it('asks for nothing when there are no points', () => {
    expect(run(plain, [], 0, 10)).toEqual([])
  })

  it('at the start of each loop pass sets the value the envelope has at the loop start, and what remains of the segment', () => {
    // Loop beats 2 to 6 (seconds 1 to 3); the envelope rises from 0 at beat 0 to 8 at beat 8.
    const out = run(looped(2, 6), [pt(0, 0), pt(8, 8)], 0, 10)
    const setsAtPasses = out.filter(i => i.kind === 'set').map(i => [i.at, i.value])
    // First pass runs from 0 (value 0). The second pass starts when the first ends, at elapsed 3, at the value for song time 1 (beat 2).
    expect(setsAtPasses).toContainEqual([0, 0])
    expect(setsAtPasses).toContainEqual([3, 2])
    const ramp = out.find(i => i.kind === 'ramp' && i.at === 3)
    expect(ramp).toMatchObject({ value: 2, end: 5, endValue: 6 })
  })

  it('a point on the loop start is not given twice', () => {
    const out = run(looped(2, 6), [pt(0, 0), pt(2, 4), pt(8, 8)], 0, 10)
    const atThree = out.filter(i => i.kind === 'set' && i.at === 3)
    expect(atThree).toHaveLength(1)
    expect(atThree[0].value).toBe(4)
  })
})
