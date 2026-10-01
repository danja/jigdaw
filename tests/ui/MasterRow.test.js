// tests/ui/MasterRow.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createMasterRow } from '../../src/ui/MasterRow.js'
import { TimeView } from '../../src/ui/TimeView.js'

let document, window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><html><body></body></html>')) })

const lane = (id, label) => ({ id, label, min: 0, max: 2, start: 1, points: [{ atBeat: 0, value: 1, curve: 'linear' }], speak: v => `${v} units`, where: b => `beat ${b}` })

function build (state) {
  const asked = []
  const row = createMasterRow(document, { onChange () {}, onRemove () {}, onAutomate: kind => asked.push(kind), view: new TimeView() })
  document.body.append(row.element)
  row.update(state, { beatsPerBar: 4, width: 480 })
  return { row, asked }
}

describe('the master row', () => {
  it('offers the lanes it does not have yet, asks for the one chosen, and draws the ones it has', () => {
    const { asked } = build({ list: [lane('e1', 'Master level')], available: [{ kind: 'masterPan', label: 'Master pan' }] })
    expect([...document.querySelectorAll('#automate-master option')].map(o => o.textContent)).toEqual(['Master pan'])
    document.querySelector('.master-head').dispatchEvent(new window.Event('submit', { cancelable: true }))
    expect(asked).toEqual(['masterPan'])
    expect(document.querySelectorAll('.envelope-lane')).toHaveLength(1)
    expect(document.querySelector('.envelope-lane').getAttribute('aria-label')).toBe('Automation: Master level')
  })

  it('leaves the form out when both lanes exist, and says nothing when asked with nothing chosen', () => {
    const { asked } = build({ list: [lane('e1', 'Master level'), lane('e2', 'Master pan')], available: [] })
    expect(document.querySelector('#automate-master').closest('label').hidden).toBe(true)
    expect(document.querySelector('.master-head button').hidden).toBe(true)
    document.querySelector('.master-head').dispatchEvent(new window.Event('submit', { cancelable: true }))
    expect(asked).toEqual([])
  })

  it('is a group named Master, and needs onAutomate', () => {
    build({ list: [], available: [{ kind: 'masterGain', label: 'Master level' }] })
    expect(document.querySelector('.master-row').getAttribute('aria-label')).toBe('Master')
    expect(() => createMasterRow(document, { onChange () {}, onRemove () {}, view: new TimeView() })).toThrow(/onAutomate/)
  })
})
