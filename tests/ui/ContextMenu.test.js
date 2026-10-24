// tests/ui/ContextMenu.test.js
//
// The page's one context menu, and the gestures that open it: right click and the Menu key (a `contextmenu` event with no pointer
// button) on a clip, a track's header, an empty lane and a plugin in a chain; double click on a name, an empty lane and a plugin.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createContextMenu, attachMenu } from '../../src/ui/ContextMenu.js'
import { createClipButton } from '../../src/ui/ClipButton.js'
import { createTrackHeader } from '../../src/ui/TrackHeader.js'
import { createChainStrip } from '../../src/ui/ChainStrip.js'
import { createTimeline } from '../../src/ui/Timeline.js'
import { TimeView } from '../../src/ui/TimeView.js'
import { Selection } from '../../src/model/Selection.js'

let document, window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><html><body></body></html>')) })

const event = (type, init = {}) => Object.assign(new window.Event(type, { cancelable: true, bubbles: true }), init)
const rightClick = target => { const e = event('contextmenu', { button: 2, clientX: 40, clientY: 50 }); target.dispatchEvent(e); return e }
const menuKey = target => { const e = event('contextmenu', { button: 0, clientX: 0, clientY: 0 }); target.dispatchEvent(e); return e }
const labels = menu => [...menu.element.querySelectorAll('[role^=menuitem] span')].map(s => s.textContent)
const item = (menu, label) => [...menu.element.querySelectorAll('button')].find(b => b.querySelector('span').textContent === label)

describe('the menu itself', () => {
  it('is hidden until opened, then lists its actions as menu items with the first focused', () => {
    const menu = createContextMenu(document)
    expect(menu.isOpen).toBe(false)
    const run = []
    menu.open([{ label: 'One', run: () => run.push(1) }, '-', { label: 'Two', checked: true, hint: 'T', run: () => run.push(2) }], { x: 5, y: 6 })
    expect(menu.isOpen).toBe(true)
    expect(menu.element.getAttribute('role')).toBe('menu')
    expect(labels(menu)).toEqual(['One', 'Two'])
    expect(item(menu, 'Two').getAttribute('role')).toBe('menuitemcheckbox')
    expect(item(menu, 'Two').getAttribute('aria-checked')).toBe('true')
    expect(item(menu, 'One').getAttribute('role')).toBe('menuitem')
    expect(menu.element.querySelector('[role=separator]')).not.toBeNull()
  })

  it('runs the chosen action once, after closing', () => {
    const menu = createContextMenu(document)
    const seen = []
    menu.open([{ label: 'Go', run: () => seen.push(menu.isOpen) }])
    item(menu, 'Go').dispatchEvent(event('click'))
    expect(seen).toEqual([false])
    expect(menu.isOpen).toBe(false)
  })

  it('gives the focus back to the item it came from on Escape', () => {
    const menu = createContextMenu(document)
    const from = document.createElement('button')
    let back = 0
    from.focus = () => { back += 1 }
    menu.open([{ label: 'Go', run () {} }], { from })
    menu.element.dispatchEvent(event('keydown', { key: 'Escape' }))
    expect(menu.isOpen).toBe(false)
    expect(back).toBe(1)
  })

  it('opens nothing for an empty list, or one of dividers only, and drops stray dividers', () => {
    const menu = createContextMenu(document)
    expect(menu.open([])).toBe(false)
    expect(menu.open(['-', '-'])).toBe(false)
    menu.open(['-', { label: 'A', run () {} }, '-', '-', { label: 'B', run () {} }, '-'])
    expect(menu.element.querySelectorAll('[role=separator]')).toHaveLength(1)
  })

  it('closes on a press outside it, without taking the focus back', () => {
    const menu = createContextMenu(document)
    const from = document.createElement('button')
    let back = 0
    from.focus = () => { back += 1 }
    menu.open([{ label: 'Go', run () {} }], { from })
    document.body.dispatchEvent(event('pointerdown'))
    expect(menu.isOpen).toBe(false)
    expect(back).toBe(0)
  })

  it('does not take over the browser\'s menu when there is nothing to offer', () => {
    const menu = createContextMenu(document)
    const target = document.createElement('div')
    document.body.append(target)
    attachMenu(target, menu, () => null)
    expect(rightClick(target).defaultPrevented).toBe(false)
    expect(menu.isOpen).toBe(false)
  })
})

describe('a clip', () => {
  function clip (over = {}, handlers = {}) {
    const menu = createContextMenu(document)
    const view = new TimeView()
    const rec = []
    const names = ['onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onMute', 'onCopy', 'onCut', 'onPaste', 'onLock', 'onTrim']
    const selection = new Selection()
    const make = createClipButton(document, {
      ppb: () => view.pixelsPerBeat, view, selection, menu,
      ...Object.fromEntries(names.map(n => [n, (...a) => rec.push([n, ...a])])), ...handlers
    })
    const button = make({ id: 'c1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [], ...over }, { beatsPerBar: 4, playsIntoNothing: false, peaks: null })
    document.body.append(button)
    return { button, menu, rec, selection }
  }

  it('offers the actions its keys make, on right click', () => {
    const { button, menu } = clip()
    const e = rightClick(button)
    expect(e.defaultPrevented).toBe(true)
    expect(labels(menu)).toEqual(['Open in the piano roll', 'Split at the playhead', 'Duplicate', 'Copy', 'Cut', 'Paste at the playhead', 'Mute', 'Lock',
      'Trim the start to the playhead', 'Trim the end to the playhead', 'Delete'])
  })

  it('opens from the keyboard\'s Menu key too', () => {
    const { button, menu } = clip()
    menuKey(button)
    expect(menu.isOpen).toBe(true)
  })

  it('selects the clip it was opened on, as the actions act on the selection', () => {
    const { button, selection } = clip()
    rightClick(button)
    expect(selection.has('clip', 'c1')).toBe(true)
  })

  it('runs the same handler the key does, with the clip\'s id', () => {
    const { button, menu, rec } = clip()
    rightClick(button)
    item(menu, 'Split at the playhead').dispatchEvent(event('click'))
    rightClick(button)
    item(menu, 'Mute').dispatchEvent(event('click'))
    rightClick(button)
    item(menu, 'Trim the end to the playhead').dispatchEvent(event('click'))
    expect(rec).toEqual([['onSplit', 'c1'], ['onMute', 'c1', true], ['onTrim', 'c1', 'end']])
  })

  it('says a muted and a locked clip are on, and leaves out what a lock forbids', () => {
    const { button, menu } = clip({ muted: true, locked: true })
    rightClick(button)
    expect(item(menu, 'Mute').getAttribute('aria-checked')).toBe('true')
    expect(item(menu, 'Lock').getAttribute('aria-checked')).toBe('true')
    expect(labels(menu)).toEqual(['Open in the piano roll', 'Duplicate', 'Copy', 'Paste at the playhead', 'Mute', 'Lock'])
  })

  it('has no menu where the page gave none, and leaves the browser\'s alone', () => {
    const view = new TimeView()
    const noop = () => {}
    const make = createClipButton(document, { ppb: () => 10, view, selection: new Selection(), onMove: noop, onResize: noop, onOpen: noop, onRemove: noop, onSplit: noop, onDuplicate: noop, onMute: noop, onCopy: noop, onCut: noop, onPaste: noop, onLock: noop, onTrim: noop })
    const button = make({ id: 'c1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [] }, { beatsPerBar: 4, playsIntoNothing: false, peaks: null })
    document.body.append(button)
    expect(rightClick(button).defaultPrevented).toBe(false)
  })

  it('puts the clip back and sends nothing when Escape is pressed during a drag', () => {
    const { button, rec } = clip()
    button.dispatchEvent(event('pointerdown', { button: 0, clientX: 0, target: button }))
    document.dispatchEvent(event('pointermove', { clientX: 200 }))
    document.dispatchEvent(event('keydown', { key: 'Escape' }))
    document.dispatchEvent(event('pointerup', { clientX: 200 }))
    expect(rec.filter(([name]) => name === 'onMove')).toEqual([])
    expect(button.style.left).toBe('0px')
  })

  it('still sends the move when the drag is released without Escape', () => {
    const { button, rec } = clip()
    button.dispatchEvent(event('pointerdown', { button: 0, clientX: 0, target: button }))
    document.dispatchEvent(event('pointermove', { clientX: 200 }))
    document.dispatchEvent(event('pointerup', { clientX: 200 }))
    expect(rec.filter(([name]) => name === 'onMove')).toHaveLength(1)
  })
})

describe('a track header', () => {
  function header (over = {}) {
    const menu = createContextMenu(document)
    const rec = []
    const r = n => (...a) => rec.push([n, ...a])
    const h = createTrackHeader(document, {
      id: 't1', onSelect: r('select'), onAdd: r('add'), onAddAudio: r('audio'), onChannel: r('channel'), onMove: r('move'), onArm: r('arm'),
      onDuplicateTrack: r('duplicate'), onSizeStep: r('size'), onEdit: r('edit'), onDeleteTrack: r('delete'), menu, ...over
    })
    document.body.append(h.element)
    h.update({ label: 'Bass', channel: { gain: 1, pan: 0, muted: false, soloed: false }, mixable: true, silent: false, at: 8, where: 'bar 3 beat 1', size: 'small', ...(over.update ?? {}) })
    return { h, menu, rec }
  }

  it('offers the track\'s actions on right click, leaving out a move that cannot happen', () => {
    const { h, menu } = header({ update: { first: true } })
    rightClick(h.element.querySelector('.show-track'))
    expect(labels(menu)).toEqual(['Rename', 'Add a MIDI clip here', 'Add an audio file here', 'Mute', 'Solo', 'Move down', 'Taller lane', 'Shorter lane', 'Duplicate track', 'Delete track'])
  })

  it('leaves out Arm unless the track can be armed, and the size change at either end', () => {
    const { h, menu } = header({ update: { canArm: true, armed: true, size: 'large', last: true } })
    rightClick(h.element.querySelector('.show-track'))
    expect(labels(menu)).toContain('Arm for MIDI input')
    expect(item(menu, 'Arm for MIDI input').getAttribute('aria-checked')).toBe('true')
    expect(labels(menu)).not.toContain('Taller lane')
    expect(labels(menu)).not.toContain('Move down')
    expect(labels(menu)).toContain('Shorter lane')
  })

  it('does what its buttons do', () => {
    const { h, menu, rec } = header()
    const name = h.element.querySelector('.show-track')
    rightClick(name)
    item(menu, 'Add a MIDI clip here').dispatchEvent(event('click'))
    rightClick(name)
    item(menu, 'Solo').dispatchEvent(event('click'))
    rightClick(name)
    item(menu, 'Delete track').dispatchEvent(event('click'))
    expect(rec).toEqual([['add', 't1', 8], ['channel', 't1', { soloed: true }], ['delete', 't1']])
  })

  it('keeps the browser\'s menu on a slider', () => {
    const { h } = header()
    expect(rightClick(h.element.querySelector('input[type=range]')).defaultPrevented).toBe(false)
  })

  it('edits the track on a double click of its name', () => {
    const { h, rec } = header()
    h.element.querySelector('.show-track').dispatchEvent(event('dblclick'))
    expect(rec).toEqual([['edit', 't1']])
  })
})

describe('a plugin in a chain', () => {
  function chain (nodeOver = {}, handlers = {}) {
    const menu = createContextMenu(document)
    const rec = []
    const r = n => (...a) => rec.push([n, ...a])
    const strip = createChainStrip(document, { onSelect: r('select'), onBypass: r('bypass'), onMove: r('move'), onReplace: r('replace'), onRemove: r('remove'), onShow: r('show'), menu, ...handlers })
    document.body.append(strip.element)
    const fx = (id, label, over = {}) => ({ id, label, loaded: true, failed: null, takes: ['audio'], gives: ['audio'], passesAudio: true, sends: [], receives: [], ...over })
    strip.update({ nodes: [fx('a', 'EQ'), fx('b', 'Comp', nodeOver), fx('c', 'Verb')] }, { label: 'Lead', selected: null })
    return { strip, menu, rec, items: [...strip.element.querySelectorAll('.chain-item')] }
  }

  it('offers what the buttons beside it do', () => {
    const { menu, items } = chain()
    rightClick(items[1])
    expect(labels(menu)).toEqual(['Select', 'Show controls', 'Bypass', 'Replace with another plugin', 'Move earlier', 'Move later', 'Remove'])
  })

  it('leaves out a move at the end of the chain, and bypass and replace on a plugin that failed to load', () => {
    const first = chain()
    rightClick(first.items[0])
    expect(labels(first.menu)).not.toContain('Move earlier')
    const failed = chain({ failed: 'no module' })
    rightClick(failed.items[1])
    expect(labels(failed.menu)).not.toContain('Bypass')
    expect(labels(failed.menu)).not.toContain('Replace with another plugin')
    expect(labels(failed.menu)).toContain('Remove')
  })

  it('removes the plugin asked for, and shows its controls on a double click', () => {
    const { menu, items, rec } = chain()
    rightClick(items[1])
    item(menu, 'Remove').dispatchEvent(event('click'))
    items[1].querySelector('.chain-node').dispatchEvent(event('dblclick'))
    expect(rec).toEqual([['remove', 'b'], ['show', 'b']])
  })

  it('opens from the Menu key on the plugin\'s button', () => {
    const { menu, items } = chain()
    menuKey(items[2].querySelector('.chain-node'))
    expect(menu.isOpen).toBe(true)
  })
})

describe('an empty lane', () => {
  function build (clips) {
    const menu = createContextMenu(document)
    const rec = []
    const r = n => (...a) => rec.push([n, ...a])
    const names = ['onAdd', 'onAddAudio', 'onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onBypass', 'onMoveInChain', 'onEnvelope', 'onRemoveEnvelope', 'onAutomateMaster', 'onMute', 'onTrim', 'onCopy', 'onCut', 'onPaste', 'onLock', 'onChannel', 'onSetLoop', 'onMoveTrack', 'onFolderCollapse', 'onArm']
    const timeline = createTimeline(document, Object.fromEntries(names.map(n => [n, r(n)])), { view: new TimeView(), selection: new Selection(), menu })
    document.body.append(timeline.element)
    timeline.draw({
      tracks: [{ id: 't1', channel: {} }], clips: clips ?? [], beatsPerBar: 4, labelFor: () => 'Bass', playsIntoNothing: () => false
    })
    return { lane: document.querySelector('.timeline-lane'), menu, rec }
  }

  it('adds a MIDI clip on a double click, at the beat under the pointer', () => {
    const { lane, rec } = build()
    lane.getBoundingClientRect = () => ({ left: 0 })
    lane.dispatchEvent(event('dblclick', { clientX: 0, target: lane }))
    expect(rec.filter(([n]) => n === 'onAdd')).toHaveLength(1)
    expect(rec.find(([n]) => n === 'onAdd').slice(0, 2)).toEqual(['onAdd', 't1'])
  })

  it('shows a clip\'s own menu on a clip, not the lane\'s underneath it', () => {
    const { menu } = build([{ id: 'c1', track: 't1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [] }])
    rightClick(document.querySelector('.clip'))
    expect(labels(menu)[0]).toBe('Open in the piano roll')
    expect(labels(menu)).not.toContain('Add a MIDI clip here')
  })

  it('adds nothing when the double click lands on a clip', () => {
    const { rec } = build([{ id: 'c1', track: 't1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [] }])
    document.querySelector('.timeline-lane').getBoundingClientRect = () => ({ left: 0 })
    document.querySelector('.clip').dispatchEvent(event('dblclick', { clientX: 5 }))
    expect(rec.filter(([n]) => n === 'onAdd')).toEqual([])
  })

  it('offers a MIDI clip or an audio file here on right click', () => {
    const { lane, menu } = build()
    lane.getBoundingClientRect = () => ({ left: 0 })
    rightClick(lane)
    expect(labels(menu)).toEqual(['Add a MIDI clip here', 'Add an audio file here'])
  })

  function lane2 () { return lane() }
})

describe('Escape during a track drag', () => {
  function drag ({ escape }) {
    const moves = []
    const names = ['onAdd', 'onAddAudio', 'onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onBypass', 'onMoveInChain', 'onEnvelope', 'onRemoveEnvelope', 'onAutomateMaster', 'onMute', 'onTrim', 'onCopy', 'onCut', 'onPaste', 'onLock', 'onChannel', 'onSetLoop', 'onFolderCollapse', 'onArm']
    const handlers = Object.fromEntries(names.map(n => [n, () => {}]))
    const timeline = createTimeline(document, { ...handlers, onMoveTrack: (id, delta) => moves.push([id, delta]) }, { view: new TimeView(), selection: new Selection() })
    document.body.append(timeline.element)
    timeline.draw({ tracks: [{ id: 'a', channel: {} }, { id: 'b', channel: {} }], clips: [], beatsPerBar: 4, labelFor: t => t.id, playsIntoNothing: () => false })
    const grip = document.getElementById('head-a-grip')
    grip.dispatchEvent(Object.assign(event('pointerdown'), { button: 0 }))
    const rowB = document.querySelector('.timeline-row[data-track=b]')
    rowB.dispatchEvent(event('pointermove'))
    if (escape) document.dispatchEvent(event('keydown', { key: 'Escape' }))
    document.dispatchEvent(event('pointerup'))
    return { moves, dragging: document.querySelectorAll('.dragging').length }
  }

  it('moves the track one place when released over the next row', () => {
    expect(drag({ escape: false }).moves).toEqual([['a', 1]])
  })

  it('moves nothing, and clears the marks, when Escape comes before the release', () => {
    expect(drag({ escape: true })).toEqual({ moves: [], dragging: 0 })
  })
})
