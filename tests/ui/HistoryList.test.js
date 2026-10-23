// tests/ui/HistoryList.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createHistoryList } from '../../src/ui/HistoryList.js'

let document
let window
beforeEach(() => {
  ({ document, window } = parseHTML('<!doctype html><body></body>'))
  document.activeElement = null
  window.HTMLElement.prototype.focus = function () { document.activeElement = this }
})
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }))

function build (history = { done: [], undone: [] }) {
  const jumps = []
  const list = createHistoryList(document, { jump: n => jumps.push(n) })
  document.body.append(list.element)
  list.draw(history)
  const buttons = () => [...document.querySelectorAll('.history-step')]
  return { list, jumps, buttons, said: () => document.querySelector('[role=status]').textContent }
}

describe('the history list', () => {
  it('has only the start, and says nothing has been done, when there is no history', () => {
    const { buttons, said } = build()
    expect(buttons().map(b => b.textContent)).toEqual(['The start'])
    expect(buttons()[0].getAttribute('aria-current')).toBe('step')
    expect(said()).toBe('Nothing has been done yet.')
  })

  it('lists the start, each edit done and each undone, in order, and marks where it is now', () => {
    const { buttons, said } = build({ done: ['Add a track', 'Edit notes'], undone: ['Add a clip'] })
    expect(buttons().map(b => b.textContent)).toEqual(['The start', '1. Add a track', '2. Edit notes', '3. Add a clip'])
    expect(buttons().map(b => b.getAttribute('aria-current'))).toEqual([null, null, 'step', null])
    expect(buttons().map(b => b.getAttribute('aria-label'))).toEqual([
      'The start, before now', '1. Add a track, before now', '2. Edit notes, now', '3. Add a clip, undone'
    ])
    expect(buttons()[3].classList.contains('undone')).toBe(true)
    expect(said()).toBe('2 edits done, 1 undone.')
  })

  it('says a single edit in the singular', () => {
    expect(build({ done: ['Add a track'], undone: [] }).said()).toBe('1 edit done, 0 undone.')
  })

  it('asks to go back by the number of edits between here and the one chosen, and forward likewise', () => {
    const { buttons, jumps } = build({ done: ['a', 'b', 'c'], undone: ['d', 'e'] })
    click(buttons()[0])
    click(buttons()[1])
    click(buttons()[4])
    click(buttons()[5])
    expect(jumps).toEqual([-3, -2, 1, 2])
  })

  it('asks for nothing when the current step is chosen', () => {
    const { buttons, jumps } = build({ done: ['a', 'b'], undone: [] })
    click(buttons()[2])
    expect(jumps).toEqual([])
  })

  it('keeps the focus on the same place in the list through the redraw a jump causes', () => {
    const { list, buttons } = build({ done: ['a', 'b'], undone: [] })
    buttons()[1].focus()
    list.draw({ done: ['a'], undone: ['b'] })
    expect(document.activeElement).toBe(buttons()[1])
    expect(document.activeElement.getAttribute('aria-current')).toBe('step')
  })

  it('does not take the focus when it was not in the list', () => {
    const { list, buttons } = build({ done: ['a'], undone: [] })
    list.draw({ done: [], undone: ['a'] })
    expect(buttons().includes(document.activeElement)).toBe(false)
  })
})
