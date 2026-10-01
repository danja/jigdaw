// tests/reel/Values.test.js
import { describe, it, expect } from 'vitest'
import { parse } from '../../src/reel/Parser.js'
import { evaluate, bounds, makeRng, portDimension, ReelError } from '../../src/reel/Values.js'

const expr = text => parse(`let v = ${text}`).statements[0].expr
const val = (text, env = new Map(), seed = 1) => evaluate(expr(text), env, makeRng(seed))

describe('values carry a dimension', () => {
  it('converts a literal to its base unit', () => {
    expect(val('8kHz')).toEqual({ v: 8000, dim: 'hz' })
    expect(val('2s')).toEqual({ v: 2000, dim: 'time' })
    expect(val('250ms')).toEqual({ v: 250, dim: 'time' })
    expect(val('-6dB')).toEqual({ v: -6, dim: 'db' })
    expect(val('7st')).toEqual({ v: 7, dim: 'st' })
    expect(val('35%')).toEqual({ v: 35, dim: 'pc' })
    expect(val('12')).toEqual({ v: 12, dim: null })
  })

  it('adds like with like, and refuses to mix dimensions', () => {
    expect(val('1kHz + 500Hz')).toEqual({ v: 1500, dim: 'hz' })
    expect(() => val('1kHz + 6dB')).toThrow(ReelError)
    expect(() => val('1kHz + 5')).toThrow(/cannot add/)
  })

  it('scales a quantity by a plain number, and refuses two quantities multiplied', () => {
    expect(val('2 * 400Hz')).toEqual({ v: 800, dim: 'hz' })
    expect(val('400Hz / 4')).toEqual({ v: 100, dim: 'hz' })
    expect(() => val('400Hz * 2Hz')).toThrow(/both carry a unit/)
    expect(() => val('4 / 2Hz')).toThrow(/divide by a quantity/)
    expect(() => val('4 / 0')).toThrow(/division by zero/)
  })

  it('reads let variables, and says when one is missing', () => {
    expect(val('x * 2', new Map([['x', { v: 3, dim: null }]]))).toEqual({ v: 6, dim: null })
    expect(() => val('x')).toThrow(/"x" is not defined/)
  })

  it('knows its functions and their arity', () => {
    expect(() => val('nope(1)')).toThrow(/unknown function/)
    expect(() => val('rand(1)')).toThrow(/takes 2/)
    expect(() => val('pick()')).toThrow(/takes 1 to 64/)
    expect(val('round(2.6)')).toEqual({ v: 3, dim: null })
  })
})

describe('randomness is seeded', () => {
  it('gives the same sequence for the same seed, and a different one for another', () => {
    const run = seed => {
      const rng = makeRng(seed)
      return Array.from({ length: 8 }, () => evaluate(expr('pick(1, 2, 3, 4, 5, 6)'), new Map(), rng).v)
    }
    expect(run(7)).toEqual(run(7))
    expect(run(7)).not.toEqual(run(8))
  })

  it('draws from one generator across calls, so a sequence moves on', () => {
    const rng = makeRng(5)
    const e = expr('rand(0, 1)')
    const draws = Array.from({ length: 6 }, () => evaluate(e, new Map(), rng).v)
    expect(new Set(draws).size).toBe(6)
    for (const d of draws) { expect(d).toBeGreaterThanOrEqual(0); expect(d).toBeLessThan(1) }
  })

  it('keeps rand in its range and pick among its choices', () => {
    const rng = makeRng(2)
    for (let i = 0; i < 200; i++) {
      const r = evaluate(expr('rand(10Hz, 20Hz)'), new Map(), rng).v
      expect(r).toBeGreaterThanOrEqual(10); expect(r).toBeLessThanOrEqual(20)
      expect([1, 5, 9]).toContain(evaluate(expr('pick(1, 5, 9)'), new Map(), rng).v)
    }
  })

  it('refuses a rand across two units', () => {
    expect(() => val('rand(1Hz, 2dB)')).toThrow(/same unit/)
  })
})

describe('bounds, the interval a value can fall in without running anything', () => {
  const b = (text, env = new Map()) => bounds(expr(text), env)

  it('is exact for a constant and spans a rand', () => {
    expect(b('8kHz')).toEqual({ lo: 8000, hi: 8000, dim: 'hz' })
    expect(b('rand(200Hz, 800Hz)')).toEqual({ lo: 200, hi: 800, dim: 'hz' })
  })

  it('spans every choice of a pick', () => {
    expect(b('pick(400Hz, 1600Hz, 800Hz)')).toEqual({ lo: 400, hi: 1600, dim: 'hz' })
  })

  it('carries arithmetic through, including a negative scale', () => {
    expect(b('rand(1, 3) * 2')).toEqual({ lo: 2, hi: 6, dim: null })
    expect(b('rand(1, 3) * -2')).toEqual({ lo: -6, hi: -2, dim: null })
    expect(b('rand(100Hz, 200Hz) + 50Hz')).toEqual({ lo: 150, hi: 250, dim: 'hz' })
    expect(b('-rand(1, 2)')).toEqual({ lo: -2, hi: -1, dim: null })
  })

  it('refuses a division by something that could be zero', () => {
    expect(() => b('4 / rand(-1, 1)')).toThrow(/could be zero/)
    expect(b('4 / rand(1, 2)')).toEqual({ lo: 2, hi: 4, dim: null })
  })

  it('uses what a let was bounded to', () => {
    const env = new Map([['x', { lo: 1, hi: 2, dim: null }]])
    expect(b('x * 10', env)).toEqual({ lo: 10, hi: 20, dim: null })
  })

  it('agrees with evaluation: no draw ever leaves its bounds', () => {
    const text = 'pick(1, 4) * rand(2, 3) - 1'
    const bb = b(text)
    const rng = makeRng(11)
    for (let i = 0; i < 500; i++) {
      const v = evaluate(expr(text), new Map(), rng).v
      expect(v).toBeGreaterThanOrEqual(bb.lo - 1e-9); expect(v).toBeLessThanOrEqual(bb.hi + 1e-9)
    }
  })
})

describe('a port\'s unit', () => {
  it('maps the units profiles use, and is undefined for the rest', () => {
    expect(portDimension('http://lv2plug.in/ns/extensions/units#hz')).toMatchObject({ dim: 'hz', factor: 1 })
    expect(portDimension('khz')).toMatchObject({ dim: 'hz', factor: 1 / 1000 })
    expect(portDimension('s')).toMatchObject({ dim: 'time', factor: 1 / 1000 })
    expect(portDimension('semitone12TET')).toMatchObject({ dim: 'st' })
    expect(portDimension('bpm').dim).toBeUndefined()
    expect(portDimension(null)).toBeNull()
  })
})

describe('evaluation has a budget', () => {
  it('stops an expression too large to run inside a tick', () => {
    const big = expr(Array.from({ length: 300 }, () => '1').join(' + '))
    expect(() => evaluate(big, new Map(), makeRng(1), { left: 200 })).toThrow(/too large/)
  })
})
