// tests/ui/ClipButton.test.js
//
// ClipButton.js and ClipText.js were split out of Timeline.js. The behaviour is held by tests/ui/Timeline.test.js, which
// goes through the timeline; these check what the split itself promised: each module stands on its own, and
// Timeline.js is still the front door for what callers import from it.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createClipButton } from '../../src/ui/ClipButton.js'
import { barBeat, describeClip } from '../../src/ui/ClipText.js'
import * as timeline from '../../src/ui/Timeline.js'
import { TimeView } from '../../src/ui/TimeView.js'
import { Selection } from '../../src/model/Selection.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

describe('the split of Timeline.js', () => {
  it('still re-exports the clip text from Timeline.js, as the same functions', () => {
    expect(timeline.barBeat).toBe(barBeat)
    expect(timeline.describeClip).toBe(describeClip)
  })

  it('says in words that a MIDI clip loops, and how often, and says nothing of it otherwise', () => {
    const clip = { kind: 'midi', startBeat: 0, lengthBeats: 8, notes: [] }
    expect(describeClip({ ...clip, loopBeats: 2 }, { beatsPerBar: 4 })).toContain('0 notes, looping every 2 beats,')
    expect(describeClip({ ...clip, loopBeats: 1 }, { beatsPerBar: 4 })).toContain('looping every 1 beat,')
    expect(describeClip(clip, { beatsPerBar: 4 })).not.toContain('looping')
  })

  it('builds a clip button on its own, to scale, named and selectable', () => {
    const calls = []
    const record = name => (...args) => calls.push([name, ...args])
    const view = new TimeView()
    const selection = new Selection()
    const handlers = Object.fromEntries(['onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onMute', 'onCopy', 'onCut', 'onPaste', 'onLock', 'onTrim'].map(n => [n, record(n)]))
    const make = createClipButton(document, { ppb: () => view.pixelsPerBeat, view, selection, ...handlers })
    const clip = { id: 'c1', kind: 'midi', startBeat: 4, lengthBeats: 8, notes: [{}, {}] }
    const button = make(clip, { beatsPerBar: 4, playsIntoNothing: false, peaks: null })
    document.body.append(button)
    expect(button.id).toBe('clip-c1')
    expect(button.style.left).toBe(`${4 * view.pixelsPerBeat}px`)
    expect(button.getAttribute('aria-label')).toBe(describeClip(clip, { beatsPerBar: 4 }))
    button.click()
    expect(calls).toEqual([['onOpen', 'c1']])
    expect(selection.has('clip', 'c1')).toBe(true)
  })

  it('refuses nothing silently: a clip button needs the handlers it calls', () => {
    const make = createClipButton(document, { ppb: () => 10, view: new TimeView(), selection: new Selection() })
    const button = make({ id: 'c', kind: 'midi', startBeat: 0, lengthBeats: 1, notes: [] }, { beatsPerBar: 4 })
    document.body.append(button)
    expect(() => button.click()).toThrow()
  })
})

describe('Space on a clip', () => {
  function build () {
    const calls = []
    const view = new TimeView()
    const selection = new Selection()
    const handlers = Object.fromEntries(['onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onMute', 'onCopy', 'onCut', 'onPaste', 'onLock', 'onTrim'].map(n => [n, (...a) => calls.push([n, ...a])]))
    const make = createClipButton(document, { ppb: () => view.pixelsPerBeat, view, selection, ...handlers })
    const button = make({ id: 'c1', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [] }, { beatsPerBar: 4, playsIntoNothing: false, peaks: null })
    document.body.append(button)
    return { button, calls, selection }
  }
  const space = (button, init = {}) => {
    const e = Object.assign(new window.Event('keydown', { bubbles: true, cancelable: true }), { key: ' ', ...init })
    button.dispatchEvent(e)
    return e
  }

  it('adds the clip to the selection and takes it out again, and opens nothing', () => {
    const { button, calls, selection } = build()
    const first = space(button)
    expect(selection.has('clip', 'c1')).toBe(true)
    space(button)
    expect(selection.has('clip', 'c1')).toBe(false)
    expect(calls).toEqual([])
    // Prevented, so the browser's own press of the button (select and open) does not follow.
    expect(first.defaultPrevented).toBe(true)
  })

  it('keeps the other clips in the selection', () => {
    const { button, selection } = build()
    selection.set('clip', ['other'])
    space(button)
    expect(selection.ids.sort()).toEqual(['c1', 'other'])
  })

  it('is left to the page when Ctrl, Alt or Cmd is held', () => {
    const { button, selection } = build()
    space(button, { ctrlKey: true })
    space(button, { altKey: true })
    space(button, { metaKey: true })
    expect(selection.has('clip', 'c1')).toBe(false)
  })
})
