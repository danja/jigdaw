// tests/reel/Parser.test.js
import { describe, it, expect } from 'vitest'
import { parse } from '../../src/reel/Parser.js'

const one = text => {
  const r = parse(text)
  expect(r.errors, text).toEqual([])
  return r.statements[0]
}

describe('the parser, on what it accepts', () => {
  it('reads each statement form', () => {
    expect(one('load reverb = https://example.org/plugins/cascade/')).toMatchObject({ type: 'load', name: 'reverb', iri: 'https://example.org/plugins/cascade/' })
    expect(one('reverb.mix = 0.35')).toMatchObject({ type: 'set', target: { name: 'reverb', symbol: 'mix' } })
    expect(one('at 4:1 reverb.mix = 0.6')).toMatchObject({ type: 'at', pos: { bar: 4, beat: 1 }, body: { type: 'set' } })
    expect(one('at 4:2.5 reverb.mix = 0.6').pos).toEqual({ bar: 4, beat: 2.5 })
    expect(one('ramp f.cutoff 200Hz -> 8000Hz over 2 bars')).toMatchObject({ type: 'ramp', length: { n: 2, unit: 'bars' } })
    expect(one('every 1 bar: b.cutoff = pick(400Hz, 800Hz)')).toMatchObject({ type: 'every', length: { n: 1, unit: 'bars' } })
    expect(one('every 0.5 beats: b.mix = 1').length).toEqual({ n: 0.5, unit: 'beats' })
    expect(one('connect lead -> reverb')).toMatchObject({ type: 'connect', from: 'lead', to: 'reverb' })
    expect(one('let x = 3')).toMatchObject({ type: 'let', name: 'x' })
    expect(one('seed 7')).toMatchObject({ type: 'seed', value: 7 })
  })

  it('reads units as part of a number, and a minus as a sign or an operator', () => {
    expect(one('let a = 8kHz').expr).toMatchObject({ type: 'number', value: 8, unit: 'kHz' })
    expect(one('let a = -6dB').expr).toMatchObject({ type: 'negate' })
    expect(one('let a = 3 - -2').expr).toMatchObject({ type: 'binary', op: '-', right: { type: 'negate' } })
    expect(one('let a = 35%').expr).toMatchObject({ unit: '%' })
  })

  it('does not take the arrow of ramp or connect for a minus', () => {
    expect(one('ramp f.cutoff 1 -> 2 over 1 bar')).toMatchObject({ type: 'ramp' })
    expect(one('connect a -> b')).toMatchObject({ type: 'connect' })
  })

  it('respects precedence and parentheses', () => {
    expect(one('let a = 1 + 2 * 3').expr).toMatchObject({ op: '+', right: { op: '*' } })
    expect(one('let a = (1 + 2) * 3').expr).toMatchObject({ op: '*', left: { op: '+' } })
  })

  it('ignores comments and blank lines, but keeps a # inside an address', () => {
    const r = parse('# a comment\n\nload x = https://example.org/p/#frag   # trailing\nx.a = 1 # note\n')
    expect(r.errors).toEqual([])
    expect(r.statements.map(s => s.line)).toEqual([3, 4])
    expect(r.statements[0].iri).toBe('https://example.org/p/#frag')
  })

  it('numbers lines from one, counting blanks and comments', () => {
    expect(parse('\n\nx.a = 1').statements[0].line).toBe(3)
  })
})

describe('the parser, on what it refuses', () => {
  const bad = (text, pattern) => {
    const r = parse(text)
    expect(r.statements, text).toEqual([])
    expect(r.errors[0].message, text).toMatch(pattern)
    expect(r.errors[0].line).toBe(1)
    return r.errors[0]
  }

  it('says what it expected, with a column', () => {
    expect(bad('reverb.', /parameter symbol/).column).toBeGreaterThan(1)
    bad('reverb = 1', /"\."/)
    bad('at 4 x.a = 1', /position such as 4:1/)
    bad('at 0:1 x.a = 1', /count from 1/)
    bad('ramp f.c 1 -> 2 over 0 bars', /more than zero/)
    bad('ramp f.c 1 -> 2 over 2 weeks', /"bars" or "beats"/)
    bad('every 1 bar x.a = 1', /":"/)
    bad('let = 3', /expected a name/)
    bad('connect a', /"->"/)
    bad('x.a = ', /expected a number/)
    bad('x.a = (1 + 2', /"\)"/)
  })

  it('refuses an address that is not written out', () => {
    bad('load x = cascade', /http or https address/)
    bad('load x = ftp://example.org/p/', /http or https address/)
    bad('load x = ', /http or https address/)
  })

  it('refuses text left over after a complete statement', () => {
    bad('x.a = 1 2', /unexpected/)
  })

  it('reports every bad line, not only the first', () => {
    const r = parse('x.a = 1\nbad line\nat 0:1 x.a = 1\ny.b = 2')
    expect(r.errors.map(e => e.line)).toEqual([2, 3])
    expect(r.statements.map(s => s.line)).toEqual([1, 4])
  })

  it('refuses an expression nested past its depth, rather than overflowing the stack', () => {
    const r = parse(`let a = ${'('.repeat(100)}1${')'.repeat(100)}`)
    expect(r.errors[0].message).toMatch(/nested too deeply/)
  })
})
