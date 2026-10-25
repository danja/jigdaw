// tests/ui/TimelineAnnounce.test.js
//
// A track moved by Alt with Up or Down, or by dragging, is drawn somewhere else and used to be said nowhere. The timeline now
// keeps a status region and says where the track went, in words, and says so when the move could not happen: the focus has
// not moved either, so silence would read as success.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTimeline } from '../../src/ui/Timeline.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const noop = () => {}
const handlers = Object.fromEntries(['onAdd', 'onAddAudio', 'onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onBypass', 'onMoveInChain', 'onEnvelope', 'onRemoveEnvelope', 'onAutomateMaster', 'onMute', 'onTrim', 'onCopy', 'onCut', 'onPaste', 'onChannel', 'onSetLoop', 'onArm', 'onFolderCollapse'].map(n => [n, noop]))
const pointer = (type) => { const e = new window.Event(type, { bubbles: true, cancelable: true }); Object.defineProperty(e, 'button', { value: 0 }); return e }

function build ({ move = () => true, folders = {} } = {}) {
  const calls = []
  const timeline = createTimeline(document, { ...handlers, onMoveTrack: (id, delta) => { calls.push([id, delta]); return move(id, delta) } })
  document.body.append(timeline.element)
  timeline.draw({
    tracks: ['a', 'b', 'c', 'd'].map(id => ({ id, label: `Track ${id.toUpperCase()}`, midiInput: null })), clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false,
    layoutFor: t => ({ color: null, laneSize: 'small', folder: folders[t.id] ?? null, folderCollapsed: false })
  })
  const said = () => timeline.element.querySelector('[role=status][aria-live]').textContent
  return { calls, said }
}
const altArrow = (id, key) => {
  const e = new window.Event('keydown', { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries({ key, altKey: true })) Object.defineProperty(e, k, { value: v })
  document.getElementById(`show-track-${id}`).dispatchEvent(e)
}

describe('a track that moves says where it went', () => {
  it('has a polite status region for it, hidden from the eye', () => {
    const { said } = build()
    expect(said()).toBe('')
    const region = document.querySelector('.timeline > [role=status]')
    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(region.className).toBe('visually-hidden')
  })

  it('says the new place of a track moved with Alt and Down, counted from one', () => {
    const { calls, said } = build()
    altArrow('b', 'ArrowDown')
    expect(calls).toEqual([['b', 1]])
    expect(said()).toBe('Track B moved to place 3 of 4.')
  })

  it('says the new place after Alt and Up', () => {
    const { said } = build()
    altArrow('c', 'ArrowUp')
    expect(said()).toBe('Track C moved to place 2 of 4.')
  })

  it('says it cannot go further, rather than nothing, when the model refuses at an end', () => {
    const { said } = build({ move: () => false })
    altArrow('a', 'ArrowUp')
    expect(said()).toBe('Track A is already first.')
    altArrow('d', 'ArrowDown')
    expect(said()).toBe('Track D is already last.')
  })

  it('says the place a dragged track was dropped in', () => {
    const { calls, said } = build()
    document.getElementById('head-a-grip').dispatchEvent(pointer('pointerdown'))
    document.querySelector('.timeline-row[data-track="c"]').dispatchEvent(pointer('pointermove'))
    document.dispatchEvent(pointer('pointerup'))
    expect(calls).toEqual([['a', 2]])
    expect(said()).toBe('Track A moved to place 3 of 4.')
  })

  it('says a folder moved, with its name, from its buttons', () => {
    const { said } = build({ folders: { b: 'Drums', c: 'Drums' } })
    const down = document.querySelector('.folder-move-down')
    down.dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(said()).toBe('Folder Drums moved down.')
  })
})
