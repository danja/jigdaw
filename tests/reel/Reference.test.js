// tests/reel/Reference.test.js
//
// The reference is a claim about the language, so it is bound to the code: every statement the parser can
// produce, every unit it reads and every function the evaluator has must be described, and every example in it
// must parse.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { STATEMENTS, UNITS_REFERENCE, FUNCTIONS_REFERENCE, NOTES } from '../../src/reel/Reference.js'
import { parse, UNITS } from '../../src/reel/Parser.js'
import { FUNCTION_NAMES } from '../../src/reel/Values.js'

const parserSource = readFileSync(resolve(import.meta.dirname, '../../src/reel/Parser.js'), 'utf8')

describe('the language reference', () => {
  it('describes every statement type the parser produces', () => {
    const produced = new Set([...parserSource.matchAll(/type: '([a-z]+)'/g)].map(m => m[1]))
    // These are expressions and parts of statements, not statements.
    for (const part of ['number', 'binary', 'negate', 'call', 'variable']) produced.delete(part)
    expect([...produced].sort()).toEqual(STATEMENTS.map(s => s.type).sort())
  })

  it('describes every unit and every function, and no others', () => {
    expect(Object.keys(UNITS_REFERENCE).sort()).toEqual([...UNITS].sort())
    expect(Object.keys(FUNCTIONS_REFERENCE).sort()).toEqual([...FUNCTION_NAMES].sort())
  })

  it('has examples that parse as the statement they illustrate', () => {
    for (const s of STATEMENTS) {
      const parsed = parse(s.example)
      expect(parsed.errors, s.example).toEqual([])
      expect(parsed.statements[0].type, s.example).toBe(s.type)
    }
    for (const unit of Object.values(UNITS_REFERENCE)) expect(parse(`a.b = ${unit.example}`).errors, unit.example).toEqual([])
    for (const f of Object.values(FUNCTIONS_REFERENCE)) expect(parse(`a.b = ${f.example}`).errors, f.example).toEqual([])
  })

  it('states its limits from the code and not from memory', () => {
    const limits = NOTES.find(n => n.heading === 'Limits').items.join(' ')
    expect(limits).toMatch(/500 statements/)
    expect(limits).toMatch(/32 deep/)
    expect(limits).toMatch(/200 steps/)
  })
})
