// tests/web/TransportLayout.test.js
//
// The shape of the transport bar: two rows in a fixed order, the piece above and the controls that move through it below, Rewind first among them,
// and Play and Record coloured by a token and not by a colour written into a rule. The rows are real elements and not wrapping, so the order
// holds at every width instead of depending on how much fits on a line.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ICONS } from '../../src/ui/Icons.js'

const root = resolve(import.meta.dirname, '../..')
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8')
const app = readFileSync(resolve(root, 'web/app.js'), 'utf8')
const { document } = parseHTML(html)
const rows = [...document.querySelectorAll('.transport > .transport-row')]

describe('the transport bar', () => {
  it('is two rows, the piece first and the controls that move through it second', () => {
    expect(rows.map(r => r.id)).toEqual(['transport-top', 'transport-bottom'])
    const labels = row => [...row.querySelectorAll('[role="group"]')].map(g => g.getAttribute('aria-label'))
    expect(labels(rows[0])).toEqual(['Tempo and time', 'Input', 'Edit', 'File', 'More', 'Output'])
    expect(labels(rows[1])).toEqual(['Sounds and help', 'Play'])
  })

  it('has the name of the studio and the Show control at the left of the bottom row, which is the old first row moved down whole', () => {
    expect(rows[1].querySelector('.brand')).not.toBeNull()
    expect(rows[1].querySelector('#show-step')).not.toBeNull()
    expect(rows[1].firstElementChild.classList.contains('brand')).toBe(true)
    expect(rows[0].querySelector('.brand')).toBeNull()
  })

  it('has nothing in the bar outside the two rows, so no control can slip between them', () => {
    const outside = [...document.querySelectorAll('.transport > *')].filter(el => !el.classList.contains('transport-row'))
    expect(outside).toEqual([])
  })

  it('has Rewind first in the play group, before Play, with a name, a title and an icon that exists', () => {
    const group = document.getElementById('group-play')
    const buttons = [...group.querySelectorAll('button')].map(b => b.id)
    expect(buttons.slice(0, 4)).toEqual(['rewind', 'play', 'stop', 'record'])
    const rewind = document.getElementById('rewind')
    expect(rewind.getAttribute('data-icon')).toBe('rewind')
    expect(rewind.textContent.trim()).toBe('Rewind')
    expect(rewind.getAttribute('title')).toBe('Go back to the start')
    expect(ICONS.rewind.length).toBeGreaterThan(10)
  })

  it('sends Rewind to the start of the piece through the transport\'s own seek, and reports a failure rather than swallowing it', () => {
    expect(app).toMatch(/\$\('rewind'\)\.addEventListener\('click', \(\) => \{ try \{ transport\.seek\(0\) \} catch \(error\) \{ log\(error\.message, 'error'\) \} \}\)/)
  })

  it('colours the Play and Record icons from tokens, and fills the button when it is on so the icon is white on the fill and never green on blue', () => {
    expect(html).toMatch(/\.transport #play \.icon \{ color:var\(--play-ink\); \}/)
    expect(html).toMatch(/\.transport #record \.icon \{ color:var\(--rec-ink\); \}/)
    expect(html).toMatch(/\.transport #play\[aria-pressed=true\] \{ background:var\(--play-fill\)/)
    expect(html).toMatch(/\.transport #record\[aria-pressed=true\] \{ background:var\(--rec-fill\)/)
    expect(html).toMatch(/#play\[aria-pressed=true\] \.icon, \.transport #record\[aria-pressed=true\] \.icon \{ color:#fff; \}/)
  })
})
