// tests/ui/TimelineFolders.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTimeline } from '../../src/ui/Timeline.js'
import { createFolderBar } from '../../src/ui/FolderBar.js'
import { Project } from '../../src/model/Project.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }))

const noop = () => {}
const handlers = Object.fromEntries(['onAdd', 'onAddAudio', 'onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onBypass', 'onMoveInChain', 'onEnvelope', 'onRemoveEnvelope', 'onAutomateMaster', 'onMute', 'onTrim', 'onCopy', 'onCut', 'onPaste', 'onChannel', 'onSetLoop', 'onMoveTrack', 'onArm'].map(n => [n, noop]))
const folders = { a: 'Drums', b: 'Drums', c: null, d: 'Drums' }

function build (extra = {}) {
  // Stands in for the layout: the hidden folders are kept here, as the editor state keeps them, and a toggle redraws.
  const hidden = new Set()
  const asked = []
  const args = {
    tracks: Object.keys(folders).map(id => ({ id, label: id, midiInput: null })), clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false,
    layoutFor: t => ({ color: null, laneSize: 'small', folder: folders[t.id], folderCollapsed: hidden.has(folders[t.id]) })
  }
  const timeline = createTimeline(document, {
    ...handlers,
    onFolderCollapse: (name, collapsed) => { asked.push([name, collapsed]); collapsed ? hidden.add(name) : hidden.delete(name); timeline.draw(args) },
    ...extra
  })
  document.body.append(timeline.element)
  timeline.draw(args)
  timeline.asked = asked
  return timeline
}
const order = () => [...document.querySelector('.timeline-scroll').children].filter(c => c.classList.contains('timeline-folder') || c.classList.contains('timeline-row'))
  .map(c => (c.classList.contains('timeline-folder') ? `folder:${c.getAttribute('aria-label')}` : c.getAttribute('aria-label')))

describe('folders in the timeline', () => {
  it('puts a bar before each run of tracks sharing a name, and none before a track without one', () => {
    build()
    expect(order()).toEqual(['folder:Folder Drums', 'Track a', 'Track b', 'Track c', 'folder:Folder Drums', 'Track d'])
  })

  it('hides every run of a folder when one bar is collapsed, says so, and shows them again', () => {
    build()
    const [first] = document.querySelectorAll('.folder-toggle')
    expect(first.getAttribute('aria-expanded')).toBe('true')
    // linkedom keeps no activeElement, so the call is what can be seen; Chrome confirmed the focus itself.
    const focused = []
    first.focus = () => focused.push('focus')
    click(first)
    expect(focused).toEqual(['focus'])
    expect(order()).toEqual(['folder:Folder Drums', 'Track c', 'folder:Folder Drums'])
    const [again] = document.querySelectorAll('.folder-toggle')
    expect(again.getAttribute('aria-expanded')).toBe('false')
    expect(again.textContent).toContain('hidden')
    click(again)
    expect(order()).toHaveLength(6)
  })
})

describe('a folder bar', () => {
  it('reports the toggle by folder name and counts one track in the singular', () => {
    const seen = []
    const bar = createFolderBar(document, { onToggle: name => seen.push(name) })
    bar.update({ name: 'Bass', count: 1, collapsed: false })
    click(bar.element.querySelector('button'))
    expect(seen).toEqual(['Bass'])
    expect(bar.element.querySelector('button').getAttribute('aria-label')).toBe('Hide the 1 track in folder Bass')
  })
})

describe('moving a folder', () => {
  it('hops the neighbour over the whole run, and leaves out the move that goes nowhere', () => {
    const moves = []
    build({ onMoveTrack: (id, delta) => moves.push([id, delta]) })
    const bars = [...document.querySelectorAll('.timeline-folder')]
    const visible = bar => [...bar.querySelectorAll('.folder-move')].filter(b => !b.hidden).map(b => b.textContent)
    // a, b (Drums) are first, so they can only go down; d (Drums) is last, so it can only go up.
    expect(visible(bars[0])).toEqual(['Move down'])
    expect(visible(bars[1])).toEqual(['Move up'])
    click(bars[0].querySelector('.folder-move-down'))
    click(bars[1].querySelector('.folder-move-up'))
    // The track past the run moves up over both of a and b; c moves down over the one-track run.
    expect(moves).toEqual([['c', -2], ['c', 1]])
  })

  it('names the folder on each button, and offers none when the caller cannot move', () => {
    build()
    expect(document.querySelector('.folder-move-down').getAttribute('aria-label')).toBe('Move folder Drums down')
    const bar = createFolderBar(document, { onToggle () {} })
    expect(bar.element.querySelectorAll('.folder-move')).toHaveLength(0)
  })
})

describe('a folder that is hidden', () => {
  it('asks the caller to hide and show it, by name, and does not hold the state itself', () => {
    const timeline = build()
    click(document.querySelector('.folder-toggle'))
    click(document.querySelector('.folder-toggle'))
    expect(timeline.asked).toEqual([['Drums', true], ['Drums', false]])
  })

  it('is drawn hidden when the layout says so, as after a session is opened', () => {
    const timeline = createTimeline(document, { ...handlers, onFolderCollapse: noop })
    document.body.append(timeline.element)
    timeline.draw({
      tracks: Object.keys(folders).map(id => ({ id, label: id, midiInput: null })), clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false,
      layoutFor: t => ({ color: null, laneSize: 'small', folder: folders[t.id], folderCollapsed: t.id === 'b' })
    })
    // One track of the folder says so, so every run of Drums is hidden down to its bar.
    expect(order()).toEqual(['folder:Folder Drums', 'Track c', 'folder:Folder Drums'])
    expect(document.querySelector('.folder-toggle').getAttribute('aria-expanded')).toBe('false')
  })
})

describe('dragging a folder by its grip', () => {
  const pointer = (type, props = {}) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true })
    for (const [k, v] of Object.entries({ button: 0, ...props })) Object.defineProperty(e, k, { value: v })
    return e
  }
  function layout (map) {
    const moves = []
    const timeline = createTimeline(document, { ...handlers, onMoveTrack: (id, delta) => moves.push([id, delta]), onFolderCollapse: noop })
    document.body.append(timeline.element)
    timeline.draw({
      tracks: Object.keys(map).map(id => ({ id, label: id, midiInput: null })), clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false,
      layoutFor: t => ({ color: null, laneSize: 'small', folder: map[t.id], folderCollapsed: false })
    })
    const row = id => document.querySelector(`.timeline-row[data-track="${id}"]`)
    const grip = document.querySelector('.folder-grip')
    return { moves, row, grip }
  }

  it('moves the tracks it is dragged past over the run, one by one, when dragged down', () => {
    const { moves, row, grip } = layout({ a: 'F', b: 'F', c: null, d: null, e: null })
    grip.dispatchEvent(pointer('pointerdown'))
    expect(row('a').classList.contains('dragging') && row('b').classList.contains('dragging')).toBe(true)
    row('d').dispatchEvent(pointer('pointermove'))
    expect(row('d').classList.contains('drop-target')).toBe(true)
    document.dispatchEvent(pointer('pointerup'))
    // c, then d hop up over the two tracks of the run, which then sits after d.
    expect(moves).toEqual([['c', -2], ['d', -2]])
    expect(document.querySelectorAll('.dragging, .drop-target')).toHaveLength(0)
  })

  it('moves them below the run, last first, when dragged up', () => {
    const { moves, row, grip } = layout({ a: null, b: null, c: 'F', d: 'F' })
    grip.dispatchEvent(pointer('pointerdown'))
    row('a').dispatchEvent(pointer('pointermove'))
    document.dispatchEvent(pointer('pointerup'))
    expect(moves).toEqual([['b', 2], ['a', 2]])
  })

  it('does nothing when released on its own tracks or nowhere, or cancelled', () => {
    const { moves, row, grip } = layout({ a: 'F', b: 'F', c: null })
    grip.dispatchEvent(pointer('pointerdown'))
    row('b').dispatchEvent(pointer('pointermove'))
    document.dispatchEvent(pointer('pointerup'))
    grip.dispatchEvent(pointer('pointerdown'))
    row('c').dispatchEvent(pointer('pointermove'))
    document.dispatchEvent(pointer('pointercancel'))
    document.dispatchEvent(pointer('pointerup'))
    expect(moves).toEqual([])
    expect(document.querySelectorAll('.dragging, .drop-target')).toHaveLength(0)
  })

  it('leaves the real tracks in the order the drop describes, the run whole and the others as they were', () => {
    // The calls the timeline makes are replayed on a real project, each against what the one before left.
    const replay = (names, run, to) => {
      const project = new Project()
      project.apply(names.map(id => ({ op: 'addTrack', id })))
      const timeline = createTimeline(document, { ...handlers, onMoveTrack: (id, delta) => project.moveTrack(id, delta), onFolderCollapse: noop })
      document.body.append(timeline.element)
      timeline.draw({
        tracks: names.map(id => ({ id, label: id, midiInput: null })), clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false,
        layoutFor: t => ({ color: null, laneSize: 'small', folder: run.includes(t.id) ? 'F' : null, folderCollapsed: false })
      })
      document.querySelector('.folder-grip').dispatchEvent(pointer('pointerdown'))
      document.querySelector(`.timeline-row[data-track="${to}"]`).dispatchEvent(pointer('pointermove'))
      document.dispatchEvent(pointer('pointerup'))
      return project.orderedTracks.map(t => t.id)
    }
    expect(replay(['a', 'b', 'c', 'd', 'e'], ['a', 'b'], 'd')).toEqual(['c', 'd', 'a', 'b', 'e'])
    document.body.replaceChildren()
    expect(replay(['a', 'b', 'c', 'd', 'e'], ['c', 'd'], 'a')).toEqual(['c', 'd', 'a', 'b', 'e'])
    document.body.replaceChildren()
    expect(replay(['a', 'b', 'c', 'd', 'e'], ['b', 'c'], 'e')).toEqual(['a', 'd', 'e', 'b', 'c'])
  })

  it('answers only the main button, and names its keyboard equivalent', () => {
    const { moves, grip } = layout({ a: 'F', b: null })
    grip.dispatchEvent(pointer('pointerdown', { button: 2 }))
    document.dispatchEvent(pointer('pointerup'))
    expect(moves).toEqual([])
    expect(grip.getAttribute('aria-label')).toBe('Drag to move folder F, or use its Move up and Move down buttons')
  })

  it('has no grip in a bar built for a page that cannot follow a drag', () => {
    const bar = createFolderBar(document, { onToggle: noop })
    expect(bar.element.querySelector('.folder-grip')).toBeNull()
  })
})
