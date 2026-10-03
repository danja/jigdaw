// tests/reel/Examples.test.js
//
// Every example the Reel page offers, planned against the real piece it was written for and the real plugin
// profiles: a name that is not in the piece, a parameter that does not exist or a value outside its range is a
// failure here and not a surprise on stage. Also binds the examples to the page's pieces and to the language.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { EXAMPLES } from '../../src/reel/Examples.js'
import { parse } from '../../src/reel/Parser.js'
import { plan } from '../../src/reel/Planner.js'
import { STATEMENTS } from '../../src/reel/Reference.js'
import { pieceNames, resolvePlugin, root } from './catalogue.js'

const index = JSON.parse(readFileSync(resolve(root, 'web/presets/index.json'), 'utf8')).presets

describe('the example scripts', () => {
  it('has examples, with distinct ids and every field', () => {
    expect(EXAMPLES.length).toBeGreaterThan(5)
    expect(new Set(EXAMPLES.map(e => e.id)).size).toBe(EXAMPLES.length)
    for (const e of EXAMPLES) {
      for (const field of ['id', 'title', 'piece', 'about', 'source']) expect(typeof e[field], `${e.id}.${field}`).toBe('string')
      expect(e.about.length).toBeGreaterThan(10)
    }
  })

  for (const example of EXAMPLES) {
    describe(example.id, () => {
      it('is written for a piece the page lists', () => {
        expect(index.map(p => p.file)).toContain(example.piece)
      })

      it('parses and plans against its piece with no problems', async () => {
        const parsed = parse(example.source)
        expect(parsed.errors).toEqual([])
        expect(parsed.statements.length).toBeGreaterThan(0)
        const { existing } = await pieceNames(example.piece)
        const planned = await plan(parsed.statements, { beatsPerBar: 4, existing, resolvePlugin })
        expect(planned.errors ?? []).toEqual([])
        expect(planned.ok).toBe(true)
      })
    })
  }

  it('refuses a name that is not in the piece, so the check above can fail', async () => {
    const { existing } = await pieceNames('acid.ttl')
    const planned = await plan(parse('nothere.cutoff = 100Hz').statements, { beatsPerBar: 4, existing, resolvePlugin })
    expect(planned.ok).toBe(false)
    expect(planned.errors[0].message).toMatch(/no plugin called "nothere"/)
  })

  it('between them use every kind of statement the language has', () => {
    const used = new Set()
    for (const e of EXAMPLES) for (const s of parse(e.source).statements) used.add(s.type)
    // `connect` has no example yet: wiring a loaded plugin into a piece has not been heard in a browser, and an
    // example is a promise about what a person will hear. Remove the exemption when one has.
    const exempt = new Set(['connect'])
    const missing = STATEMENTS.map(s => s.type).filter(type => !used.has(type) && !exempt.has(type))
    expect(missing).toEqual([])
  })
})
