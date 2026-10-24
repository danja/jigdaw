// tests/web/OptionalLauncher.test.js
//
// The clip launcher belongs to the full page (web/app.js sets ctx.launcher). The simple page and
// Reel share web/app/ with it and never set it, so anything there that reads through ctx.launcher
// has to ask first. One line did not (Transport.js, in the scheduler's setup), and Play on the
// simple page threw "Cannot read properties of undefined (reading 'state')" for every tune. No
// unit test saw it because none builds a transport the way those pages do.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const dir = resolve(import.meta.dirname, '../../web/app')
const files = readdirSync(dir).filter(f => f.endsWith('.js'))

describe('code shared with pages that have no clip launcher', () => {
  it('walks the files it means to, so the rest of this is not vacuous', () => {
    expect(files).toContain('Transport.js')
    expect(files).toContain('Runtime.js')
  })

  for (const file of files) {
    it(`${file} never reads through ctx.launcher without checking it exists`, () => {
      const unguarded = readFileSync(resolve(dir, file), 'utf8').split('\n')
        .map((text, i) => ({ text, line: i + 1 }))
        .filter(({ text }) => /ctx\.launcher\.\w/.test(text))
        .filter(({ text }) => !/ctx\.launcher\s*(\?|&&)/.test(text))
      expect(unguarded).toEqual([])
    })
  }
})
