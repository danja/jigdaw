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

// The transport block: the readouts first, the controls on a band of their own below them, Play green and Record red.
describe('the transport block of the simple page', () => {
  const player = html.slice(html.indexOf('<div class="player">'), html.indexOf('id="tabs-mount"'))
  const at = needle => player.indexOf(needle)

  it('puts the speed and level line before the line of controls, so Tab follows what is seen', () => {
    // The DOM is swapped rather than reordered in CSS: a visual order that differs from the keyboard order is a WCAG 2.4.3 failure.
    expect(at('class="player-status"')).toBeGreaterThan(-1)
    expect(at('class="player-status"')).toBeLessThan(at('class="player-controls"'))
    for (const id of ['tempo', 'meter']) expect(at(`id="${id}"`)).toBeLessThan(at('class="player-controls"'))
    for (const id of ['play', 'stop', 'voice']) expect(at(`id="${id}"`)).toBeGreaterThan(at('class="player-controls"'))
  })

  it('keeps Play, Stop and Record inside the controls band, in that order', () => {
    const band = player.slice(at('class="player-controls"'))
    expect([...band.matchAll(/id="(play|stop|voice)"/g)].map(m => m[1])).toEqual(['play', 'stop', 'voice'])
  })

  const variable = name => html.match(new RegExp(`--${name}:(#[0-9a-f]{6})`))[1]
  const channel = c => { const v = c / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }
  const luminance = hex => [1, 3, 5].map(i => channel(parseInt(hex.slice(i, i + 2), 16)))
    .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0)
  const contrastWithWhite = hex => 1.05 / (luminance(hex) + 0.05)

  it('makes Play green and Record red, with white text that passes 4.5:1 at rest, hovered and pressed', () => {
    const hue = hex => {
      const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16))
      return { r, g, b }
    }
    for (const name of ['play', 'play-hover']) {
      const { r, g, b } = hue(variable(name))
      expect(g, `--${name} is not green`).toBeGreaterThan(Math.max(r, b) * 1.4)
      expect(contrastWithWhite(variable(name))).toBeGreaterThanOrEqual(4.5)
    }
    for (const name of ['rec', 'rec-hover']) {
      const { r, g, b } = hue(variable(name))
      expect(r, `--${name} is not red`).toBeGreaterThan(Math.max(g, b) * 2)
      expect(contrastWithWhite(variable(name))).toBeGreaterThanOrEqual(4.5)
    }
    expect(html).toMatch(/#play \{[^}]*var\(--play\)/)
    expect(html).toMatch(/#voice \{[^}]*var\(--rec\)/)
  })

  it('gives the controls band a background unlike the block around it, and marks a pressed one by more than colour', () => {
    expect(variable('controls')).not.toBe(variable('panel'))
    expect(html).toMatch(/\.player-controls \{[^}]*background:var\(--controls\)/)
    expect(html).toMatch(/#play\[aria-pressed="true"\], #voice\[aria-pressed="true"\] \{ box-shadow:inset 0 0 0 3px #fff/)
  })
})
