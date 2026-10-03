// tests/reel/Names.test.js
//
// The line the Insert button writes must be one the planner accepts, for every parameter of every plugin in the
// catalogue: the button is a promise that what it adds will run.
import { describe, it, expect } from 'vitest'
import { describeNames, setLine, rangeText, unitSuffix } from '../../src/reel/Names.js'
import { parse, UNITS } from '../../src/reel/Parser.js'
import { plan } from '../../src/reel/Planner.js'
import { pluginNames, portsOfPlugin, pieceNames } from './catalogue.js'

describe('the line written for a parameter', () => {
  for (const name of pluginNames()) {
    it(`is accepted by the planner for every parameter of ${name}`, async () => {
      const ports = portsOfPlugin(name)
      const existing = new Map([['p', { ports }]])
      for (const port of ports) {
        const line = setLine('p', port)
        const parsed = parse(line)
        expect(parsed.errors, line).toEqual([])
        const planned = await plan(parsed.statements, { beatsPerBar: 4, existing, resolvePlugin: async () => ({ ok: false }) })
        expect(planned.errors ?? [], line).toEqual([])
      }
    })
  }
})

describe('units', () => {
  it('maps each port unit to a suffix the parser reads', () => {
    for (const unit of ['hz', 'khz', 'ms', 's', 'db', 'semitone12TET', 'pc', 'cent']) expect(UNITS).toContain(unitSuffix(unit))
  })
  it('writes a plain number for no unit and for one Reel cannot write', () => {
    expect(unitSuffix(null)).toBe('')
    expect(unitSuffix('http://example.org/units#furlong')).toBe('')
  })
  it('states a range with its unit', () => {
    expect(rangeText({ unit: 'hz', minimum: 40, maximum: 12000 })).toBe('40Hz to 12000Hz')
    expect(rangeText({ unit: null, minimum: 0, maximum: 1 })).toBe('0 to 1')
  })
})

describe('the names in a piece', () => {
  it('lists each plugin by its slug with its parameters, in name order, with the named values a port has', async () => {
    const { existing, ids } = await pieceNames('acid.ttl')
    const names = describeNames(existing, name => ids.get(name))
    expect(names.map(n => n.name)).toEqual([...names.map(n => n.name)].sort())
    const beats = names.find(n => n.name === 'beats')
    expect(beats.parameters.find(p => p.symbol === 'genre').choices[0]).toEqual({ value: 0, label: 'Rock' })
    expect(beats.parameters.find(p => p.symbol === 'density').line).toBe('beats.density = 0.58')
  })
})
