// tests/ui/TimelineFolders.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTimeline } from '../../src/ui/Timeline.js'
import { createFolderBar } from '../../src/ui/FolderBar.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const click = el => el.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }))

const noop = () => {}
const handlers = Object.fromEntries(['onAdd', 'onAddAudio', 'onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onBypass', 'onMoveInChain', 'onEnvelope', 'onRemoveEnvelope', 'onAutomateMaster', 'onMute', 'onTrim', 'onCopy', 'onCut', 'onPaste', 'onChannel', 'onSetLoop', 'onMoveTrack', 'onArm'].map(n => [n, noop]))
const folders = { a: 'Drums', b: 'Drums', c: null, d: 'Drums' }

function build (extra = {}) {
  const timeline = createTimeline(document, { ...handlers, ...extra })
  document.body.append(timeline.element)
  timeline.draw({
    tracks: Object.keys(folders).map(id => ({ id, label: id, midiInput: null })), clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false,
    layoutFor: t => ({ color: null, laneSize: 'small', folder: folders[t.id] })
  })
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
