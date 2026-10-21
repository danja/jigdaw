// tests/ui/LoopRow.test.js
//
// The row on its own, without a timeline around it. The drag is driven the way a
// real one arrives: the press on the row, the move and release on the document.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createLoopRow } from '../../src/ui/LoopRow.js'
import { TimeView } from '../../src/ui/TimeView.js'

let document, window
const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  return e
}

const build = () => {
  ;({ document, window } = parseHTML('<html><body></body></html>'))
  const view = new TimeView()
  const calls = []
  const row = createLoopRow(document, { view, bpb: () => 4, onSetLoop: r => calls.push(r), snapBeat: (b, e) => view.snap(b, 4, { bypass: e?.altKey }) })
  document.body.append(row.element)
  return { row, calls, view }
}

describe('LoopRow', () => {
  beforeEach(() => { document = null })

  it('says in text whether a set loop is on or off, and hides the brace when none is set', () => {
    const { row } = build()
    row.draw({ start: 4, end: 8, enabled: true }, 400)
    expect(row.element.getAttribute('aria-label')).toBe('Loop, on')
    expect(document.querySelector('.loop-brace span').textContent).toBe('Loop on')
    row.draw({ start: 4, end: 8, enabled: false }, 400)
    expect(document.querySelector('.loop-brace span').textContent).toBe('Loop off')
    row.draw(null, 400)
    expect(row.element.getAttribute('aria-label')).toBe('Loop, not set')
    expect(document.querySelector('.loop-brace').hidden).toBe(true)
    expect(document.getElementById('loop-start').hidden).toBe(true)
  })

  it('sends a range from the keyboard and refuses one that would end at its start', () => {
    const { row, calls } = build()
    row.draw({ start: 4, end: 12, enabled: true }, 400)
    document.getElementById('loop-end').dispatchEvent(event('keydown', { key: 'ArrowRight' }))
    expect(calls).toEqual([{ start: 4, end: 13 }])
    calls.length = 0
    row.draw({ start: 4, end: 4.25, enabled: true }, 400)
    document.getElementById('loop-end').dispatchEvent(event('keydown', { key: 'ArrowLeft' }))
    expect(calls).toEqual([])
  })

  it('draws a loop by a drag on the row, the release arriving on the document', () => {
    const { row, calls, view } = build()
    row.draw(null, 400)
    row.element.dispatchEvent(event('pointerdown', { button: 0, clientX: 2 * view.pixelsPerBeat }))
    document.dispatchEvent(event('pointerup', { clientX: 6 * view.pixelsPerBeat }))
    expect(calls).toEqual([{ start: 2, end: 6 }])
  })
})
