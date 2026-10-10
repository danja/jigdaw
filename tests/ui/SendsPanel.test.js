// tests/ui/SendsPanel.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createSendsPanel } from '../../src/ui/SendsPanel.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const event = type => new window.Event(type, { bubbles: true, cancelable: true })
const chosen = (el, value) => Object.defineProperty(el, 'value', { value, configurable: true })

function build (over = {}) {
  const calls = []
  const rec = name => (...a) => calls.push([name, ...a])
  const panel = createSendsPanel(document, { onOutput: rec('output'), onAdd: rec('add'), onLevel: rec('level'), onTap: rec('tap'), onRemove: rec('remove') })
  document.body.append(panel.element)
  const state = {
    label: 'Lead', output: null, outputOptions: [{ id: 'bus', label: 'Bus' }],
    sends: [{ id: 's1', toLabel: 'Reverb', level: 0.5, tap: 'post' }], addOptions: [{ id: 'rv', label: 'Reverb' }, { id: 'bus', label: 'Bus' }], ...over
  }
  panel.show(state)
  return { panel, calls, state }
}

describe('the sends panel', () => {
  it('offers the master and each track as an output, and reports a change', () => {
    const { calls } = build()
    expect([...document.querySelectorAll('#track-output option')].map(o => o.textContent)).toEqual(['Master', 'Bus'])
    chosen(document.getElementById('track-output'), 'bus')
    document.getElementById('track-output').dispatchEvent(event('change'))
    chosen(document.getElementById('track-output'), '')
    document.getElementById('track-output').dispatchEvent(event('change'))
    expect(calls).toEqual([['output', 'bus'], ['output', null]])
  })

  it('lists each send with its destination, level in text, and tap', () => {
    build()
    expect(document.querySelector('.send-name').textContent).toBe('To Reverb')
    expect(document.getElementById('send-s1-level').getAttribute('aria-valuetext')).toBe('-6.0 decibels')
    expect(document.getElementById('send-s1-level').getAttribute('aria-label')).toBe('Level of the send from Lead to Reverb')
  })

  it('reports a level, a tap and a removal for the right send', () => {
    const { calls } = build()
    const level = document.getElementById('send-s1-level')
    level.value = '1'
    level.dispatchEvent(event('input'))
    chosen(document.getElementById('send-s1-tap'), 'pre')
    document.getElementById('send-s1-tap').dispatchEvent(event('change'))
    document.querySelector('.send-row button').dispatchEvent(event('click'))
    expect(calls).toEqual([['level', 's1', 1], ['tap', 's1', 'pre'], ['remove', 's1']])
  })

  it('adds a send to the first destination without choosing, or the one chosen', () => {
    const { calls } = build()
    document.querySelector('.send-add').dispatchEvent(event('submit'))
    chosen(document.getElementById('send-to'), 'bus')
    document.getElementById('send-to').dispatchEvent(event('change'))
    document.querySelector('.send-add').dispatchEvent(event('submit'))
    expect(calls).toEqual([['add', 'rv', 'audio'], ['add', 'bus', 'audio']])
  })

  it('leaves out Add when there is nowhere to send, and the list when there are no sends', () => {
    build({ sends: [], addOptions: [] })
    expect(document.querySelector('.send-add').hidden).toBe(true)
    expect(document.querySelector('.send-list').hidden).toBe(true)
  })

  it('keeps a send row across a redraw, so a level being dragged is not taken out of the page', () => {
    const { panel, state } = build()
    const before = document.getElementById('send-s1-level')
    panel.show({ ...state, sends: [{ id: 's1', toLabel: 'Reverb', level: 0.75, tap: 'post' }] })
    expect(document.getElementById('send-s1-level')).toBe(before)
    expect(before.isConnected).toBe(true)
    expect(before.value).toBe('0.75')
  })

  it('removes the row of a send that has gone, and does not move a slider being held', () => {
    const { panel, state } = build()
    const input = document.getElementById('send-s1-level')
    Object.defineProperty(document, 'activeElement', { value: input, configurable: true })
    input.value = '1.2'
    panel.show({ ...state, sends: [{ id: 's1', toLabel: 'Reverb', level: 0.3, tap: 'post' }] })
    expect(input.value).toBe('1.2')
    Object.defineProperty(document, 'activeElement', { value: null, configurable: true })
    panel.show({ ...state, sends: [] })
    expect(document.getElementById('send-s1-level')).toBeNull()
  })

  it('will not be built without its handlers', () => {
    expect(() => createSendsPanel(document, { onOutput () {} })).toThrow(/onAdd/)
  })
})

describe('the sends panel with MIDI sends', () => {
  const midiState = { midiAddOptions: [{ id: 'drums', label: 'Drums' }] }

  it('offers the kind only when MIDI could go somewhere, and sends the choice to the track chosen', () => {
    const { calls } = build()
    expect(document.getElementById('send-kind').closest('label').hidden).toBe(true)
    document.body.replaceChildren()
    const withMidi = build(midiState)
    expect(document.getElementById('send-kind').closest('label').hidden).toBe(false)
    // MIDI, then its own list of destinations.
    for (const option of document.getElementById('send-kind').options) option.selected = option.value === 'midi'
    document.getElementById('send-kind').dispatchEvent(event('change'))
    expect([...document.querySelectorAll('#send-to option')].map(o => o.textContent)).toEqual(['Drums'])
    document.querySelector('.send-add').dispatchEvent(event('submit'))
    expect(withMidi.calls).toEqual([['add', 'drums', 'midi']])
    void calls
  })

  it('draws a MIDI send without a level or a tap, which it has none of, and says what it is in words', () => {
    build({ sends: [{ id: 'm1', toLabel: 'Drums', kind: 'midi' }] })
    expect(document.querySelector('.send-name').textContent).toBe('MIDI to Drums')
    expect(document.querySelector('.send-level').hidden).toBe(true)
    expect(document.getElementById('send-m1-tap').hidden).toBe(true)
    expect(document.querySelector('.send-row button').getAttribute('aria-label')).toBe('Remove the MIDI send from Lead to Drums')
  })

  it('leaves out the form when neither kind has anywhere to go', () => {
    build({ addOptions: [], midiAddOptions: [] })
    expect(document.querySelector('.send-add').hidden).toBe(true)
  })
})
