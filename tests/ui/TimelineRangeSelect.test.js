// tests/ui/TimelineRangeSelect.test.js
//
// Shift with Up or Down on a track's name extends the track selection by one, as a list does. Done with the keyboard alone, so
// choosing a run of tracks for the bulk panel needs no click on each, and skipping what is not shown: a track inside a
// collapsed folder has no row to stand on.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTimeline } from '../../src/ui/Timeline.js'
import { Selection } from '../../src/model/Selection.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const noop = () => {}
const handlers = Object.fromEntries(['onAdd', 'onAddAudio', 'onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onBypass', 'onMoveInChain', 'onEnvelope', 'onRemoveEnvelope', 'onAutomateMaster', 'onMute', 'onTrim', 'onCopy', 'onCut', 'onPaste', 'onChannel', 'onSetLoop', 'onMoveTrack', 'onArm', 'onFolderCollapse'].map(n => [n, noop]))
const press = (id, init) => {
  const el = document.getElementById(`show-track-${id}`)
  const e = new window.Event('keydown', { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(init)) Object.defineProperty(e, k, { value: v })
  el.dispatchEvent(e)
  return e
}
const click = (id, init = {}) => {
  const e = new window.Event('click', { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(init)) Object.defineProperty(e, k, { value: v })
  document.getElementById(`show-track-${id}`).dispatchEvent(e)
}

function build (map) {
  const selection = new Selection()
  const timeline = createTimeline(document, { ...handlers }, { selection })
  document.body.append(timeline.element)
  const ids = Object.keys(map)
  const focused = []
  timeline.draw({
    tracks: ids.map(id => ({ id, label: id, midiInput: null })), clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false,
    layoutFor: t => ({ color: null, laneSize: 'small', folder: map[t.id]?.folder ?? null, folderCollapsed: map[t.id]?.hidden ?? false })
  })
  // linkedom keeps no activeElement, so what can be seen is the call.
  for (const id of ids) { const el = document.getElementById(`show-track-${id}`); if (el) el.focus = () => focused.push(id) }
  return { selection, focused }
}
const plain = { a: {}, b: {}, c: {}, d: {}, e: {} }

describe('Shift with Up or Down on a track name', () => {
  it('selects the track below with the one pressed on, and moves the focus there', () => {
    const { selection, focused } = build(plain)
    const e = press('b', { key: 'ArrowDown', shiftKey: true })
    expect(e.defaultPrevented).toBe(true)
    expect(selection.ids).toEqual(['b', 'c'])
    expect(focused).toEqual(['c'])
  })

  it('keeps extending from where the run began, and shrinks when it comes back', () => {
    const { selection } = build(plain)
    press('b', { key: 'ArrowDown', shiftKey: true })
    press('c', { key: 'ArrowDown', shiftKey: true })
    expect(selection.ids).toEqual(['b', 'c', 'd'])
    press('d', { key: 'ArrowUp', shiftKey: true })
    expect(selection.ids).toEqual(['b', 'c'])
    press('c', { key: 'ArrowUp', shiftKey: true })
    expect(selection.ids).toEqual(['b'])
    press('b', { key: 'ArrowUp', shiftKey: true })
    expect(selection.ids).toEqual(['a', 'b'])
  })

  it('starts from the track last chosen by a click', () => {
    const { selection } = build(plain)
    click('d')
    expect(selection.ids).toEqual(['d'])
    press('d', { key: 'ArrowUp', shiftKey: true })
    press('c', { key: 'ArrowUp', shiftKey: true })
    expect(selection.ids).toEqual(['b', 'c', 'd'])
  })

  it('stops at the first and the last track', () => {
    const { selection } = build(plain)
    press('a', { key: 'ArrowUp', shiftKey: true })
    expect(selection.ids).toEqual(['a'])
    click('e')
    press('e', { key: 'ArrowDown', shiftKey: true })
    expect(selection.ids).toEqual(['e'])
  })

  it('skips the tracks of a collapsed folder, which are not drawn', () => {
    const { selection, focused } = build({ a: {}, b: { folder: 'F', hidden: true }, c: { folder: 'F', hidden: true }, d: {} })
    expect(document.getElementById('show-track-b')).toBeNull()
    press('a', { key: 'ArrowDown', shiftKey: true })
    expect(selection.ids).toEqual(['a', 'd'])
    expect(focused).toEqual(['d'])
  })

  it('does nothing with Alt, Ctrl or Cmd held, which move the track or belong to the browser, nor with no Shift', () => {
    const { selection } = build(plain)
    for (const mod of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      press('b', { key: 'ArrowDown', shiftKey: true, ...mod })
    }
    press('b', { key: 'ArrowDown' })
    expect(selection.ids).toEqual([])
  })
})
