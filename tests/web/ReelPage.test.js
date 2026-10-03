// tests/web/ReelPage.test.js
//
// Binds web/reel.html to the code that reads it, as SimplePage.test.js does for the simple page: the page wires
// itself by id, and a DOM test cannot see a missing element until the line that needs it runs.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const read = file => readFileSync(resolve(import.meta.dirname, '../..', file), 'utf8')
const html = read('web/reel.html')
const idsInMarkup = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]))
const sources = ['web/reel.js', 'web/app/Script.js', 'web/app/Transport.js', 'web/app/Pwa.js']
// Looked up by the shared modules and absent here on purpose: each is guarded in the module, or belongs to a part
// of the studio this page does not have.
const optional = new Set(['tempo-group', 'tempo-note', 'signature', 'loop', 'metronome', 'state', 'save', 'open', 'openfile', 'presetbar', 'preset', 'presets'])

describe('the Reel page markup', () => {
  for (const file of sources) {
    it(`has every id that ${file} looks up`, () => {
      const wanted = [...read(file).matchAll(/\$\('([^']+)'\)/g)].map(m => m[1]).filter(id => !optional.has(id))
      expect(wanted.length).toBeGreaterThan(0)
      expect(wanted.filter(id => !idsInMarkup.has(id))).toEqual([])
    })
  }

  it('has a panel for each tab, with all but the script hidden to begin with', () => {
    for (const id of ['script-panel', 'examples-panel', 'names-panel', 'reference-panel']) expect(idsInMarkup.has(id)).toBe(true)
    for (const id of ['examples-panel', 'names-panel', 'reference-panel']) expect(html).toMatch(new RegExp(`id="${id}"[^>]*hidden`))
  })

  it('does not load view.js, which sends a narrow screen to the simple page and so would bounce this one', () => {
    expect(html).not.toContain('view.js')
  })

  it('is a page for a phone: a viewport, and a menu that is opened by a button', () => {
    expect(html).toContain('name="viewport" content="width=device-width, initial-scale=1"')
    expect(html).toMatch(/<form id="piece-form">[\s\S]*type="submit"/)
  })

  it('is in the build and in the offline list, so it is built and kept', () => {
    expect(read('bin/build-web.js')).toContain('web/reel.js')
    const precache = read('bin/build-precache.js')
    expect(precache).toContain("web('reel.html')")
    expect(precache).toContain("web('reel.bundle.js')")
    expect(precache).toContain("web('script.css')")
  })

  it('links the stylesheet that the simple page also links, so the Script tab looks the same on both', () => {
    expect(html).toContain('href="script.css"')
    expect(read('web/simple.html')).toContain('href="script.css"')
  })
})
