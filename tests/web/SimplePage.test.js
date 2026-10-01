// tests/web/SimplePage.test.js
//
// Binds web/simple.html to the code that reads it. The page wires itself by id, and a test in a DOM cannot see a
// missing element until the line that needs it runs, so the ids are compared directly: every id the simple page
// and the shared modules it builds look up must be in the markup, and the Script tab's panels must be there.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = file => readFileSync(resolve(import.meta.dirname, '../..', file), 'utf8')
const html = read('web/simple.html')
const idsInMarkup = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))

// What the simple page and the modules it shares look up with $('id'), minus the ones that are the studio's alone.
const sources = ['web/simple.js', 'web/app/Script.js']

describe('the simple page markup', () => {
  for (const file of sources) {
    it(`has every id that ${file} looks up`, () => {
      const wanted = [...read(file).matchAll(/\$\('([^']+)'\)/g)].map(m => m[1])
      expect(wanted.length).toBeGreaterThan(0)
      expect(wanted.filter(id => !idsInMarkup.has(id))).toEqual([])
    })
  }

  it('has a panel for each tab, with the script panel hidden to begin with', () => {
    expect(idsInMarkup.has('music-panel')).toBe(true)
    expect(html).toMatch(/id="script-panel"[^>]*hidden/)
  })

  it('has the script panel inside the part of the page shown once a tune is open', () => {
    const now = html.slice(html.indexOf('id="now"'), html.indexOf('</main>'))
    expect(now).toContain('id="script-panel"')
  })
})
