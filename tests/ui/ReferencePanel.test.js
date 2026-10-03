// tests/ui/ReferencePanel.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createReferencePanel } from '../../src/ui/ReferencePanel.js'
import { STATEMENTS, FUNCTIONS_REFERENCE, NOTES } from '../../src/reel/Reference.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

describe('the reference panel', () => {
  it('shows every note, statement and function, each section under a heading that names it', () => {
    document.body.append(createReferencePanel(document, { onInsert () {} }).element)
    const headings = [...document.querySelectorAll('section h3')].map(h => h.textContent)
    for (const note of NOTES) expect(headings).toContain(note.heading)
    expect(headings).toEqual(expect.arrayContaining(['Statements', 'Units', 'Functions']))
    expect(document.querySelectorAll('.ref-entry').length).toBe(STATEMENTS.length + Object.keys(FUNCTIONS_REFERENCE).length)
    for (const section of document.querySelectorAll('section')) {
      expect(document.getElementById(section.getAttribute('aria-labelledby'))).not.toBeNull()
    }
  })

  it('names each Insert button for the form it inserts, and passes the example text', () => {
    const got = []
    document.body.append(createReferencePanel(document, { onInsert: text => got.push(text) }).element)
    const first = document.querySelector('.ref-entry .insert')
    expect(first.getAttribute('aria-label')).toBe(`Insert the example for ${STATEMENTS[0].form}`)
    first.dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(got).toEqual([STATEMENTS[0].example])
  })
})
