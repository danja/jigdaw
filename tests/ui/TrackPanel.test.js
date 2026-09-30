// tests/ui/TrackPanel.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTrackPanel, colorName, COLORS } from '../../src/ui/TrackPanel.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  return e
}

function build (over = {}) {
  const calls = []
  const rec = name => (...a) => calls.push([name, ...a])
  const panel = createTrackPanel(document, { onRename: rec('rename'), onColor: rec('color'), onSize: rec('size'), onMove: rec('move'), onDelete: rec('delete') })
  document.body.append(panel.element)
  const state = { id: 't2', name: 'Bass', defaultName: 'Bass', layout: { order: null, color: null, laneSize: 'medium' }, index: 1, count: 3, plugins: 2, ...over }
  panel.show(state)
  return { panel, calls, state, $: id => document.getElementById(id) }
}

describe('the track panel', () => {
  it('renames on change or Enter, and sends null for an emptied name so the default returns', () => {
    const { $, calls } = build()
    $('track-name-input').value = 'Sub bass'
    $('track-name-input').dispatchEvent(event('change'))
    $('track-name-input').value = '   '
    $('track-name-input').dispatchEvent(event('keydown', { key: 'Enter' }))
    expect(calls).toEqual([['rename', 't2', 'Sub bass'], ['rename', 't2', null]])
  })

  it('offers each colour by name, says which is chosen, and sends null for none', () => {
    const { calls } = build({ layout: { order: null, color: COLORS[5].value, laneSize: 'medium' } })
    const swatches = [...document.querySelectorAll('.swatch')]
    expect(swatches).toHaveLength(COLORS.length + 1)
    expect(swatches.find(s => s.getAttribute('aria-pressed') === 'true').getAttribute('aria-label')).toBe('Blue')
    expect(document.querySelector('.track-color-said').textContent).toBe(' Blue')
    swatches[0].dispatchEvent(event('click'))
    swatches[2].dispatchEvent(event('click'))
    expect(calls).toEqual([['color', 't2', null], ['color', 't2', COLORS[1].value]])
  })

  it('names a colour it does not know by its value, and none as None', () => {
    expect(colorName('#123456')).toBe('#123456')
    expect(colorName(null)).toBe('None')
  })

  it('changes the lane size', () => {
    const { $, calls } = build()
    Object.defineProperty($('track-size-input'), 'value', { value: 'large', configurable: true })
    $('track-size-input').dispatchEvent(event('change'))
    expect(calls).toEqual([['size', 't2', 'large']])
  })

  it('moves up and down, and leaves out the move that goes nowhere', () => {
    const { $, calls, panel, state } = build()
    $('track-move-up').dispatchEvent(event('click'))
    $('track-move-down').dispatchEvent(event('click'))
    expect(calls).toEqual([['move', 't2', -1], ['move', 't2', 1]])
    panel.show({ ...state, index: 0 })
    expect($('track-move-up').hidden).toBe(true)
    expect($('track-move-down').hidden).toBe(false)
    panel.show({ ...state, index: 2 })
    expect($('track-move-down').hidden).toBe(true)
    expect(document.querySelector('.track-position').textContent).toBe('Track 3 of 3.')
  })

  it('says what a delete takes with it, and that undo brings it back', () => {
    const { $, calls, panel, state } = build()
    expect($('track-delete').textContent).toBe('Delete track and 2 plugins')
    expect($('track-delete').getAttribute('aria-label')).toBe('Delete track and 2 plugins: Bass. Undo brings it back.')
    $('track-delete').dispatchEvent(event('click'))
    expect(calls).toEqual([['delete', 't2']])
    panel.show({ ...state, plugins: 0 })
    expect($('track-delete').textContent).toBe('Delete track')
    panel.show({ ...state, plugins: 1 })
    expect($('track-delete').textContent).toBe('Delete track and 1 plugin')
  })

  it('does not overwrite a name being typed', () => {
    const { $, panel, state } = build()
    Object.defineProperty(document, 'activeElement', { value: $('track-name-input'), configurable: true })
    $('track-name-input').value = 'half typ'
    panel.show({ ...state, name: 'Bass' })
    expect($('track-name-input').value).toBe('half typ')
  })

  it('will not be built without its handlers', () => {
    expect(() => createTrackPanel(document, { onRename () {} })).toThrow(/onColor/)
  })
})
