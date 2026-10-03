// tests/ui/NamesPanel.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createNamesPanel } from '../../src/ui/NamesPanel.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const names = [{
  name: 'beats',
  label: 'Beats',
  parameters: [
    { symbol: 'genre', name: 'Genre', range: '0 to 13', line: 'beats.genre = 0', choices: [{ value: 0, label: 'Rock' }, { value: 1, label: 'Disco' }] },
    { symbol: 'density', name: 'Density', range: '0 to 1', line: 'beats.density = 0.58', choices: [] }
  ]
}]

describe('the names panel', () => {
  it('says so when no piece is open, rather than showing an empty list', () => {
    const panel = createNamesPanel(document, { onInsert () {} })
    document.body.append(panel.element)
    panel.draw([])
    expect(panel.element.textContent).toMatch(/No piece is open/)
    expect(document.querySelector('button')).toBeNull()
  })

  it('lists a plugin by its script name, with each parameter, its range and an Insert button named for it', () => {
    const panel = createNamesPanel(document, { onInsert () {} })
    document.body.append(panel.element)
    panel.draw(names)
    expect(document.querySelector('h3 code').textContent).toBe('beats')
    expect(document.querySelectorAll('.parameter').length).toBe(2)
    expect([...document.querySelectorAll('.insert')].map(b => b.getAttribute('aria-label')))
      .toEqual(['Insert a line setting beats genre', 'Insert a line setting beats density'])
  })

  it('shows named values only for a parameter that has them', () => {
    const panel = createNamesPanel(document, { onInsert () {} })
    document.body.append(panel.element)
    panel.draw(names)
    const details = document.querySelectorAll('details')
    expect(details.length).toBe(1)
    expect(details[0].textContent).toContain('1 Disco')
  })

  it('hands the line, and the button, to onInsert when Insert is pressed', () => {
    const got = []
    const panel = createNamesPanel(document, { onInsert: (line, button) => got.push([line, button.className]) })
    document.body.append(panel.element)
    panel.draw(names)
    document.querySelectorAll('.insert')[1].dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(got).toEqual([['beats.density = 0.58', 'insert']])
  })

  it('replaces the list when drawn again', () => {
    const panel = createNamesPanel(document, { onInsert () {} })
    document.body.append(panel.element)
    panel.draw(names)
    panel.draw([])
    expect(document.querySelectorAll('.parameter').length).toBe(0)
  })
})
