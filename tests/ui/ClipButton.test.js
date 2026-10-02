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
