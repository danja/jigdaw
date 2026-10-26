// tests/validate/LaneHeightShape.test.js
//
// jig:laneHeight in an editor graph: a lane dragged to a height of its own is one whole number of pixels from 24 to 800. There is no counterexample
// file for the editor graph, so each way of getting it wrong is written here and each must be refused for the reason the shape gives.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve } from 'node:path'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { parseText } from '../../src/rdf/parse.js'

const shapes = resolve(import.meta.dirname, '../../vocabs/shapes.ttl')
let validator
beforeAll(async () => { validator = await shapeValidatorFromFile(shapes) })

const editor = values => `@base <http://example.org/session/> . @prefix jig: <http://purl.org/stuff/jigdaw/> .\n<#track-1> ${values} .`
const check = async values => validator.validate(await parseText(editor(values), 'http://example.org/session/editor'))

describe('jig:laneHeight', () => {
  it('is accepted as a whole number from 24 to 800, and beside a lane size', async () => {
    for (const ok of ['jig:laneHeight 24', 'jig:laneHeight 180', 'jig:laneHeight 800', 'jig:laneSize "large" ; jig:laneHeight 400']) {
      const report = await check(ok)
      expect(report.violations.map(v => v.message), ok).toEqual([])
      expect(report.conforms, ok).toBe(true)
    }
  })

  it('is refused when it is too small, too large, fractional, not a number, or given twice, with the reason', async () => {
    for (const bad of ['jig:laneHeight 23', 'jig:laneHeight 801', 'jig:laneHeight 100.5', 'jig:laneHeight "tall"', 'jig:laneHeight 100 , 200']) {
      const report = await check(bad)
      expect(report.conforms, bad).toBe(false)
      expect(report.violations.some(v => /one whole number of pixels, from 24 to 800/.test(v.message)), bad).toBe(true)
    }
  })
})
