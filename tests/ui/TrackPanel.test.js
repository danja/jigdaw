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
  const panel = createTrackPanel(document, { onRename: rec('rename'), onColor: rec('color'), onSize: rec('size'), onFolder: rec('folder'), onMove: rec('move'), onDelete: rec('delete'), onFreeze: rec('freeze') })
  document.body.append(panel.element)
  const state = { id: 't2', name: 'Bass', defaultName: 'Bass', layout: { order: null, color: null, laneSize: 'medium' }, index: 1, count: 3, plugins: 2, ...over }
  panel.show(state)
  return { panel, calls, state, $: id => document.getElementById(id) }
}

describe('the track panel', () => {
  it('offers Collapsed among the lane sizes, and commits it', () => {
    const { $, calls } = build()
    const options = [...$('track-size-input').options].map(o => o.value)
    expect(options).toEqual(['collapsed', 'small', 'medium', 'large'])
    $('track-size-input').options[0].selected = true
    $('track-size-input').dispatchEvent(event('change'))
    expect(calls).toContainEqual(['size', 't2', 'collapsed'])
  })

  it('commits a folder name trimmed, and an empty one as null, and offers the names in use', () => {
    const { $, calls, panel, state } = build()
    $('track-folder-input').value = '  Drums '
    $('track-folder-input').dispatchEvent(event('change'))
    $('track-folder-input').value = ''
    $('track-folder-input').dispatchEvent(event('change'))
    expect(calls).toEqual([['folder', 't2', 'Drums'], ['folder', 't2', null]])
    panel.show({ ...state, folders: ['Bass', 'Drums'] })
    expect([...document.querySelectorAll('#track-folder-names option')].map(o => o.value)).toEqual(['Bass', 'Drums'])
  })

  it('offers Export track as MIDI only for a track with MIDI, and asks for it by the track shown', () => {
    const calls = []
    const noop = () => {}
    const panel = createTrackPanel(document, { onRename: noop, onColor: noop, onSize: noop, onFolder: noop, onMove: noop, onDelete: noop, onFreeze: noop, onExportMidi: id => calls.push(id) })
    document.body.append(panel.element)
    const state = { id: 't2', name: 'Bass', defaultName: 'Bass', layout: { order: null, color: null, laneSize: 'medium', folder: null }, index: 1, count: 3, plugins: 0 }
    panel.show(state)
    expect(document.getElementById('track-export-midi').hidden).toBe(true)
    panel.show({ ...state, hasMidi: true })
    expect(document.getElementById('track-export-midi').hidden).toBe(false)
    document.getElementById('track-export-midi').dispatchEvent(event('click'))
    expect(calls).toEqual(['t2'])
  })

  it('leaves the export out when the host gives no way to export', () => {
    build({ hasMidi: true })
    expect(document.getElementById('track-export-midi')).toBeNull()
  })

  it('offers Freeze track and asks for it by the track it shows', () => {
    const { $, calls } = build()
    expect($('track-freeze').textContent).toBe('Freeze track')
    $('track-freeze').dispatchEvent(event('click'))
    expect(calls).toEqual([['freeze', 't2']])
  })

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

describe('the group level buttons', () => {
  function withGroup (members, give = true, pan = true) {
    const calls = []
    const noop = () => {}
    const panel = createTrackPanel(document, {
      onRename: noop, onColor: noop, onSize: noop, onFolder: noop, onMove: noop, onDelete: noop, onFreeze: noop,
      ...(give ? { onGroupLevel: (id, db) => calls.push([id, db]) } : {}),
      ...(give && pan ? { onGroupPan: (id, amount) => calls.push([id, 'pan', amount]) } : {})
    })
    document.body.append(panel.element)
    panel.show({ id: 'bus', name: 'Bus', defaultName: 'Bus', layout: { order: null, color: null, laneSize: 'medium', folder: null }, index: 0, count: 1, plugins: 0, members })
    return { calls, group: panel.element.querySelector('#track-group-level'), $: id => document.getElementById(id) }
  }

  it('step the members by a decibel, and name how many', () => {
    const { calls, $, group } = withGroup(3)
    expect(group.hidden).toBe(false)
    expect(group.getAttribute('aria-label')).toContain('3 tracks')
    $('track-group-down').dispatchEvent(event('click'))
    $('track-group-up').dispatchEvent(event('click'))
    expect(calls).toEqual([['bus', -1], ['bus', 1]])
  })

  it('shift the members left and right, and take a typed pan, for the track shown', () => {
    const { calls, $ } = withGroup(2)
    $('track-group-pan-left').dispatchEvent(event('click'))
    $('track-group-pan-right').dispatchEvent(event('click'))
    $('track-group-pan-by').value = '0.4'
    $('track-group-pan-by-apply').dispatchEvent(event('click'))
    $('track-group-pan-by').value = '2'
    $('track-group-pan-by-apply').dispatchEvent(event('click'))
    expect(calls).toEqual([['bus', 'pan', -0.1], ['bus', 'pan', 0.1], ['bus', 'pan', 0.4]])
  })

  it('leave the pan controls out when the host gives no way to pan', () => {
    withGroup(2, true, false)
    expect(document.getElementById('track-group-pan-left')).toBeNull()
    expect(document.getElementById('track-group-pan-by')).toBeNull()
    expect(document.getElementById('track-group-up')).not.toBeNull()
  })

  it('also take an exact figure, sent for the track shown', () => {
    const { calls, $ } = withGroup(2)
    $('track-group-by').value = '-4'
    $('track-group-by-apply').dispatchEvent(event('click'))
    expect(calls).toEqual([['bus', -4]])
  })

  it('are left out for a track with no members, or when the host gives no way to act', () => {
    expect(withGroup(0).group.hidden).toBe(true)
    document.body.textContent = ''
    expect(withGroup(2, false).group.hidden).toBe(true)
  })
})
