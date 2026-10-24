// tests/ui/LauncherGrid.test.js
//
// The launcher's grid: a cell per track and scene that says its state in words, an empty cell that adds a clip, a button that
// launches a row, and a redraw that takes nothing out of the document while its shape is the same.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createLauncherGrid } from '../../src/ui/LauncherGrid.js'
import { createContextMenu } from '../../src/ui/ContextMenu.js'

let document, window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><html><body></body></html>')) })
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true }))

function make (extra = {}) {
  const calls = []
  const rec = n => (...a) => calls.push([n, ...a])
  const grid = createLauncherGrid(document, {
    quantiseNames: ['none', 'beat', 'bar'], onLaunch: rec('launch'), onAdd: rec('add'), onScene: rec('scene'), onStopTrack: rec('stopTrack'),
    onStopAll: rec('stopAll'), onQuantise: rec('quantise'), ...extra
  })
  document.body.append(grid.element)
  const tracks = [{ id: 'bass', label: 'Bass' }, { id: 'lead', label: 'Lead' }]
  const draw = (cells = new Map([['bass|0', { clipId: 'c1', state: 'stopped' }]]), over = {}) => grid.draw({ tracks, scenes: 2, cells, quantise: 'bar', ...over })
  draw()
  return { grid, calls, draw, tracks }
}

describe('the cells', () => {
  it('say their state in words, and an empty one says it can add a clip', () => {
    make()
    expect(document.getElementById('cell-bass-0').getAttribute('aria-label')).toBe('Bass, scene 1, stopped')
    expect(document.getElementById('cell-lead-0').getAttribute('aria-label')).toBe('Lead, scene 1, empty, press to add a clip')
    expect(document.getElementById('cell-bass-0').textContent).toContain('stopped')
  })

  it('launch a clip on press, and add a clip where there is none', () => {
    const { calls } = make()
    click(document.getElementById('cell-bass-0'))
    click(document.getElementById('cell-lead-1'))
    expect(calls).toEqual([['launch', 'c1'], ['add', 'lead', 1]])
  })

  it('show every one of the states', () => {
    const { draw } = make()
    for (const state of ['queued', 'playing', 'stopping']) {
      draw(new Map([['bass|0', { clipId: 'c1', state }]]))
      expect(document.getElementById('cell-bass-0').dataset.state).toBe(state)
      expect(document.getElementById('cell-bass-0').getAttribute('aria-label')).toContain(state)
    }
  })

  it('are updated in place when only a state changed, so the focus stays', () => {
    const { draw } = make()
    const before = document.getElementById('cell-bass-0')
    draw(new Map([['bass|0', { clipId: 'c1', state: 'playing' }]]))
    expect(document.getElementById('cell-bass-0')).toBe(before)
    draw(new Map([['bass|0', { clipId: 'c1', state: 'playing' }], ['lead|1', { clipId: 'c2', state: 'stopped' }]]))
    expect(document.getElementById('cell-bass-0')).not.toBe(before)
  })
})

describe('rows, stops and the setting', () => {
  it('launches a scene, leaving the button out of a scene with no clip but keeping its place', () => {
    const { calls } = make()
    click(document.getElementById('scene-0'))
    expect(calls).toEqual([['scene', 0]])
    expect(document.getElementById('scene-1')).toBeNull()
    // The blank keeps every row the same width: a row is the scene column and then a cell for each track.
    expect([...document.querySelectorAll('.launcher-row')].map(r => r.children.length)).toEqual([3, 3, 3, 3])
  })

  it('stops one track or all of them', () => {
    const { calls } = make()
    click(document.getElementById('stop-lead'))
    click(document.getElementById('launcher-stop-all'))
    expect(calls).toEqual([['stopTrack', 'lead'], ['stopAll']])
  })

  it('offers the quantisations it was given, with the current one chosen', () => {
    const { calls } = make()
    const select = document.getElementById('launcher-quantise')
    expect([...select.options].map(o => o.value)).toEqual(['none', 'beat', 'bar'])
    expect([...select.options].find(o => o.selected).value).toBe('bar')
    expect(calls).toEqual([])
  })

  it('says what is missing when no track can play a clip, and draws no grid', () => {
    const { grid } = make()
    grid.draw({ tracks: [], scenes: 1, cells: new Map(), quantise: 'bar' })
    expect(grid.element.querySelector('.empty').textContent).toMatch(/MIDI input/)
    expect(grid.element.querySelector('.launcher-grid').hidden).toBe(true)
    expect(document.getElementById('launcher-stop-all').hidden).toBe(true)
  })
})

describe('the menu and the double click', () => {
  it('offers launch, stop, edit and delete on a clip, and only Add on an empty cell', () => {
    const menu = createContextMenu(document)
    const { calls } = make({ menu, onEdit: id => calls.push(['edit', id]), onRemove: id => calls.push(['remove', id]) })
    const labels = () => [...menu.element.querySelectorAll('span')].map(s => s.textContent)
    const right = el => el.dispatchEvent(Object.assign(new window.Event('contextmenu', { bubbles: true, cancelable: true }), { button: 2, clientX: 5, clientY: 5 }))
    right(document.getElementById('cell-bass-0'))
    expect(labels()).toEqual(['Launch', 'Stop this track', 'Edit the notes', 'Delete the clip'])
    menu.close()
    right(document.getElementById('cell-lead-0'))
    expect(labels()).toEqual(['Add an empty clip'])
    menu.close()
    document.getElementById('cell-bass-0').dispatchEvent(new window.Event('dblclick', { bubbles: true }))
    expect(calls).toContainEqual(['edit', 'c1'])
  })
})
