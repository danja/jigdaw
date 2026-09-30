// tests/ui/Timeline.test.js
//
// The drag is driven the way a real one arrives: the press on the clip, and
// the move and the release on the document. A drag that only listened on the
// clip would stop at its edge in a browser and pass here otherwise.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTimeline, describeClip, barBeat, PIXELS_PER_BEAT } from '../../src/ui/Timeline.js'
import { TimeView } from '../../src/ui/TimeView.js'
import { Selection } from '../../src/model/Selection.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  return e
}

const tracks = [{ id: 't1', label: 'Keys', midiInput: 'n1' }, { id: 't2', label: 'Loop', midiInput: null }]
const clips = [
  { id: 'c1', track: 't1', kind: 'midi', startBeat: 4, lengthBeats: 8, notes: [{}, {}] },
  { id: 'c2', track: 't2', kind: 'midi', startBeat: 0, lengthBeats: 4, notes: [] },
  { id: 'c3', track: 't2', kind: 'audio', startBeat: 8, lengthBeats: 4, notes: [] }
]

function build () {
  const calls = []
  const record = name => (...args) => calls.push([name, ...args])
  const timeline = createTimeline(document, {
    onAdd: record('add'), onAddAudio: record('addAudio'), onMove: record('move'), onResize: record('resize'), onOpen: record('open'), onRemove: record('remove'), onSplit: record('split'), onDuplicate: record('duplicate'), onMute: record('mute'), onLock: record('lock'), onTrim: record('trim'), onCopy: record('copy'), onCut: record('cut'), onPaste: record('paste'), onChannel: record('channel'), onSetLoop: record('loop'), onMoveTrack: record('moveTrack'), onArm: record('arm')
  })
  document.body.append(timeline.element)
  timeline.draw({
    tracks, clips, beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: t => !t.midiInput,
    peaksFor: (clip, count) => new Float32Array(count).fill(0.5),
    unplayable: clip => (clip.id === 'c3' ? '404 for loop.wav' : null)
  })
  return { timeline, calls, clip: id => document.getElementById(`clip-${id}`) }
}

describe('what a clip says', () => {
  it('names itself by kind, position, length and contents', () => {
    expect(describeClip(clips[0], { beatsPerBar: 4 })).toBe('MIDI clip, 2 notes, bar 2 beat 1, 8 beats')
    expect(describeClip(clips[2], { beatsPerBar: 4 })).toBe('Audio clip, bar 3 beat 1, 4 beats')
  })

  it('reads a position as a musician does', () => {
    expect(barBeat(0, 4)).toBe('bar 1 beat 1')
    expect(barBeat(5.5, 4)).toBe('bar 2 beat 2.5')
    expect(barBeat(6, 3)).toBe('bar 3 beat 1')
  })

  it('says, in words and in its text, when it plays into nothing', () => {
    const { clip } = build()
    expect(clip('c2').getAttribute('aria-label')).toMatch(/plays into nothing/)
    expect(clip('c2').textContent).toContain('!')
    expect(clip('c1').getAttribute('aria-label')).not.toMatch(/nothing/)
    // An audio clip has no MIDI input to lack.
    expect(clip('c3').getAttribute('aria-label')).not.toMatch(/nothing/)
  })
})

describe('the layout', () => {
  it('draws a lane per track and each clip at its beat, to scale', () => {
    const { clip } = build()
    expect(document.querySelectorAll('.timeline-row')).toHaveLength(2)
    expect(clip('c1').style.left).toBe(`${4 * PIXELS_PER_BEAT}px`)
    expect(clip('c1').style.width).toBe(`${8 * PIXELS_PER_BEAT}px`)
  })

  it('scrolls inside its own region, which the keyboard can reach', () => {
    build()
    const region = document.querySelector('.timeline-scroll')
    expect(region.getAttribute('tabindex')).toBe('0')
    expect(region.getAttribute('aria-label')).toMatch(/Arrangement/)
  })

  it('offers a new clip after the last one, rounded up to a bar', () => {
    const { calls } = build()
    document.getElementById('add-clip-t1').dispatchEvent(event('click'))
    document.getElementById('add-audio-t2').dispatchEvent(event('click'))
    expect(calls).toEqual([['add', 't1', 12], ['addAudio', 't2', 12]])
  })

  it('draws an audio clip\'s waveform, hidden from a reader, and says why one cannot play', () => {
    const { clip } = build()
    const wave = clip('c3').querySelector('svg')
    expect(wave.getAttribute('aria-hidden')).toBe('true')
    expect(clip('c3').getAttribute('aria-label')).toMatch(/cannot play: 404 for loop.wav/)
    expect(clip('c3').textContent).toContain('!')
    expect(clip('c1').querySelector('svg')).toBeNull()
  })
})

describe('the playhead', () => {
  it('stands at the transport\'s beat, to scale, and survives a redraw', () => {
    const { timeline } = build()
    timeline.playhead(2.5)
    const head = document.querySelector('.timeline .playhead')
    expect(head.hidden).toBe(false)
    expect(head.style.left).toBe(`calc(var(--head) + ${2.5 * PIXELS_PER_BEAT}px)`)
    timeline.draw({ tracks, clips, beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false })
    expect(document.querySelector('.timeline .playhead')).toBe(head)
    timeline.playhead(null)
    expect(head.hidden).toBe(true)
  })
})

describe('the keyboard', () => {
  it('moves a clip a beat at a time, and not before the start', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('keydown', { key: 'ArrowRight' }))
    clip('c1').dispatchEvent(event('keydown', { key: 'ArrowLeft' }))
    clip('c2').dispatchEvent(event('keydown', { key: 'ArrowLeft' }))
    expect(calls).toEqual([['move', 'c1', 5], ['move', 'c1', 3]])
  })

  it('resizes with Shift, never to nothing', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('keydown', { key: 'ArrowRight', shiftKey: true }))
    clip('c1').dispatchEvent(event('keydown', { key: 'ArrowLeft', shiftKey: true }))
    expect(calls).toEqual([['resize', 'c1', 9], ['resize', 'c1', 7]])
  })

  it('opens on Enter, which a button turns into a click, and removes on Delete', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('click'))
    clip('c1').dispatchEvent(event('keydown', { key: 'Delete' }))
    expect(calls).toEqual([['open', 'c1'], ['remove', 'c1']])
  })

  it('toggles lock on L, asking for the opposite of what the clip is now', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('keydown', { key: 'l' }))
    expect(calls).toEqual([['lock', 'c1', true]])
  })

  it('toggles mute on M, asking for the opposite of what the clip is now', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('keydown', { key: 'm' }))
    expect(calls).toEqual([['mute', 'c1', true]])
  })

  it('copies on Ctrl+C and pastes on Ctrl+V, and leaves the bare letters alone', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('keydown', { key: 'c', ctrlKey: true }))
    clip('c1').dispatchEvent(event('keydown', { key: 'x', ctrlKey: true }))
    clip('c1').dispatchEvent(event('keydown', { key: 'V', metaKey: true }))
    clip('c1').dispatchEvent(event('keydown', { key: 'c' }))
    clip('c1').dispatchEvent(event('keydown', { key: 'v' }))
    expect(calls).toEqual([['copy', 'c1'], ['cut', 'c1'], ['paste', 'c1']])
  })

  it('trims the start on [ and the end on ]', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('keydown', { key: '[' }))
    clip('c1').dispatchEvent(event('keydown', { key: ']' }))
    clip('c1').dispatchEvent(event('keydown', { key: ']', ctrlKey: true }))
    expect(calls).toEqual([['trim', 'c1', 'start'], ['trim', 'c1', 'end']])
  })

  it('splits on S and duplicates on D, and leaves Ctrl with those letters to the browser', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('keydown', { key: 's' }))
    clip('c1').dispatchEvent(event('keydown', { key: 'D' }))
    clip('c1').dispatchEvent(event('keydown', { key: 's', ctrlKey: true }))
    clip('c1').dispatchEvent(event('keydown', { key: 'd', metaKey: true }))
    expect(calls).toEqual([['split', 'c1'], ['duplicate', 'c1']])
  })
})

describe('the pointer', () => {
  it('moves a clip by whole beats, following the pointer onto the document', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('pointerdown', { button: 0, clientX: 100 }))
    document.dispatchEvent(event('pointermove', { clientX: 100 + 2.6 * PIXELS_PER_BEAT }))
    expect(clip('c1').style.left).toBe(`${7 * PIXELS_PER_BEAT}px`)
    document.dispatchEvent(event('pointerup', { clientX: 100 + 2.6 * PIXELS_PER_BEAT }))
    expect(calls).toEqual([['move', 'c1', 7]])
    // A drag is not a click, so it does not also open the clip.
    clip('c1').dispatchEvent(event('click'))
    expect(calls).toEqual([['move', 'c1', 7]])
  })

  it('resizes from the right edge', () => {
    const { calls, clip } = build()
    const handle = clip('c1').querySelector('.clip-resize')
    handle.dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointerup', { clientX: -3 * PIXELS_PER_BEAT }))
    expect(calls).toEqual([['resize', 'c1', 5]])
  })

  it('stops listening once released', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointerup', { clientX: PIXELS_PER_BEAT }))
    document.dispatchEvent(event('pointerup', { clientX: 5 * PIXELS_PER_BEAT }))
    expect(calls).toEqual([['move', 'c1', 5]])
  })
})

describe('zoom and snap, from a TimeView the page can share', () => {
  const buildWith = view => {
    const calls = []
    const record = name => (...args) => calls.push([name, ...args])
    const timeline = createTimeline(document, {
      onAdd: record('add'), onAddAudio: record('addAudio'), onMove: record('move'), onResize: record('resize'), onOpen: record('open'), onRemove: record('remove'), onSplit: record('split'), onDuplicate: record('duplicate'), onMute: record('mute'), onLock: record('lock'), onTrim: record('trim'), onCopy: record('copy'), onCut: record('cut'), onPaste: record('paste'), onChannel: record('channel'), onSetLoop: record('loop'), onMoveTrack: record('moveTrack'), onArm: record('arm')
    }, { view })
    document.body.append(timeline.element)
    timeline.draw({ tracks, clips, beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: t => !t.midiInput })
    return { timeline, calls, clip: id => document.getElementById(`clip-${id}`) }
  }
  const button = name => [...document.querySelectorAll('.timeline-tools button')].find(b => (b.getAttribute('aria-label') ?? b.textContent) === name)

  it('hands back the view it draws with, so the page snaps a cut to the same grid', () => {
    const view = new TimeView()
    const { timeline } = buildWith(view)
    expect(timeline.view).toBe(view)
    expect(timeline.view.snap(3.7, 4)).toBe(view.step(4) === null ? 3.7 : Math.round(3.7 / view.step(4)) * view.step(4))
  })

  it('redraws to the new scale when zoomed from its own buttons, and says so', () => {
    const view = new TimeView()
    const { clip } = buildWith(view)
    button('Zoom in').dispatchEvent(event('click'))
    expect(view.pixelsPerBeat).toBe(36)
    expect(clip('c1').style.left).toBe(`${4 * 36}px`)
    expect(document.querySelector('.timeline-zoom').textContent).toBe('Zoom 150%')
    button('Zoom out').dispatchEvent(event('click'))
    expect(clip('c1').style.left).toBe(`${4 * 24}px`)
  })

  it('redraws when something else zooms the shared view', () => {
    const view = new TimeView()
    const { clip } = buildWith(view)
    view.zoomBy(2)
    expect(clip('c1').style.width).toBe(`${8 * 48}px`)
  })

  it('thins the bar numbers when zoomed out, and draws beat ticks only when zoomed in', () => {
    const view = new TimeView()
    buildWith(view)
    const marks = () => document.querySelectorAll('.timeline-ruler span').length
    const ticks = () => document.querySelectorAll('.timeline-ruler i').length
    expect(ticks()).toBeGreaterThan(0)
    const full = marks()
    view.zoomBy(0.25)
    expect(marks()).toBeLessThan(full)
    expect(ticks()).toBe(0)
  })

  it('moves and sizes on the chosen grid, and Alt bypasses it', () => {
    const view = new TimeView()
    const { calls, clip } = buildWith(view)
    view.setGrid('1/2')
    clip('c1').dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointerup', { clientX: 1.4 * 24 }))
    expect(calls.at(-1)).toEqual(['move', 'c1', 5.5])
    clip('c1').dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointerup', { clientX: 1.3 * 24, altKey: true }))
    expect(calls.at(-1)[0]).toBe('move')
    expect(calls.at(-1)[2]).toBeCloseTo(5.3)
    view.setGrid('bar')
    clip('c1').querySelector('.clip-resize').dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointerup', { clientX: 3 * 24 }))
    expect(calls.at(-1)).toEqual(['resize', 'c1', 12])
  })

  it('changes the grid from its select, and shows it', () => {
    const view = new TimeView()
    buildWith(view)
    const select = document.querySelector('.timeline-tools select')
    // linkedom's select has no value, which a browser's does: what the person chose.
    Object.defineProperty(select, 'value', { value: '1/4', configurable: true })
    select.dispatchEvent(event('change'))
    expect(view.grid).toBe('1/4')
    // That a grid set elsewhere is what the select shows is not testable here:
    // linkedom does not implement option.selected. Checked in a browser instead.
  })

  it('steps the keyboard by the grid, and by a beat when snapping is off', () => {
    const view = new TimeView()
    const { calls, clip } = buildWith(view)
    view.setGrid('1/4')
    clip('c1').dispatchEvent(event('keydown', { key: 'ArrowRight' }))
    view.setGrid('off')
    clip('c1').dispatchEvent(event('keydown', { key: 'ArrowRight' }))
    view.setGrid('bar')
    clip('c1').dispatchEvent(event('keydown', { key: 'ArrowRight' }))
    expect(calls).toEqual([['move', 'c1', 4.25], ['move', 'c1', 5], ['move', 'c1', 8]])
  })

  it('does not take a small click for a drag', () => {
    const { calls, clip } = build()
    clip('c1').dispatchEvent(event('pointerdown', { button: 0, clientX: 10 }))
    document.dispatchEvent(event('pointermove', { clientX: 12 }))
    document.dispatchEvent(event('pointerup', { clientX: 12 }))
    clip('c1').dispatchEvent(event('click'))
    expect(calls).toEqual([['open', 'c1']])
  })

  it('zooms with plus and minus on the scroller, and leaves keys inside a clip alone', () => {
    const view = new TimeView()
    buildWith(view)
    const scroller = document.querySelector('.timeline-scroll')
    scroller.dispatchEvent(event('keydown', { key: '+' }))
    expect(view.pixelsPerBeat).toBe(36)
    scroller.dispatchEvent(event('keydown', { key: '-' }))
    expect(view.pixelsPerBeat).toBe(24)
    document.getElementById('clip-c1').dispatchEvent(event('keydown', { key: '+' }))
    expect(view.pixelsPerBeat).toBe(24)
  })
})

describe('rows are kept across a redraw', () => {
  const draw = timeline => timeline.draw({
    tracks: tracks.map(t => ({ ...t, channel: { gain: 1, pan: 0, muted: false, soloed: false } })),
    clips, beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false
  })

  it('reuses a track header, so a slider being dragged is not taken out of the document', () => {
    const { timeline } = build()
    draw(timeline)
    const before = document.getElementById('head-t1-gain')
    draw(timeline)
    expect(document.getElementById('head-t1-gain')).toBe(before)
    expect(before.isConnected).toBe(true)
  })

  it('forwards a channel change with the track it is for', () => {
    const { timeline, calls } = build()
    draw(timeline)
    document.getElementById('head-t2-soloed').dispatchEvent(event('click'))
    expect(calls.at(-1)).toEqual(['channel', 't2', { soloed: true }])
  })

  it('draws a track that was added, and forgets one that went', () => {
    const { timeline } = build()
    timeline.draw({ tracks: [tracks[0]], clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false })
    expect(document.querySelectorAll('.timeline-row')).toHaveLength(1)
    timeline.draw({ tracks, clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false })
    expect(document.querySelectorAll('.timeline-row')).toHaveLength(2)
    timeline.draw({ tracks: [], clips: [], beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false })
    expect(document.querySelectorAll('.timeline-row')).toHaveLength(0)
    expect(document.querySelector('.empty')).not.toBeNull()
  })
})

describe('selection', () => {
  const buildSel = selection => {
    const calls = []
    const record = name => (...args) => calls.push([name, ...args])
    const timeline = createTimeline(document, {
      onAdd: record('add'), onAddAudio: record('addAudio'), onMove: record('move'), onResize: record('resize'),
      onOpen: record('open'), onRemove: record('remove'), onSplit: record('split'), onDuplicate: record('duplicate'), onMute: record('mute'), onLock: record('lock'), onTrim: record('trim'), onCopy: record('copy'), onCut: record('cut'), onPaste: record('paste'), onChannel: record('channel'), onSetLoop: record('loop'), onMoveTrack: record('moveTrack'), onArm: record('arm')
    }, { selection })
    document.body.append(timeline.element)
    timeline.draw({ tracks, clips, beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false })
    return { calls, clip: id => document.getElementById(`clip-${id}`) }
  }

  it('a plain click selects the clip and opens it', () => {
    const selection = new Selection()
    const { calls, clip } = buildSel(selection)
    clip('c1').dispatchEvent(event('click'))
    expect(selection.has('clip', 'c1')).toBe(true)
    expect(calls).toEqual([['open', 'c1']])
  })

  it('a click with Shift adds to the selection and opens nothing', () => {
    const selection = new Selection()
    const { calls, clip } = buildSel(selection)
    clip('c1').dispatchEvent(event('click'))
    clip('c2').dispatchEvent(event('click', { shiftKey: true }))
    expect(selection.ids).toEqual(['c1', 'c2'])
    expect(calls).toEqual([['open', 'c1']])
  })

  it('marks selected clips in words and style, without rebuilding them', () => {
    const selection = new Selection()
    const { clip } = buildSel(selection)
    const before = clip('c1')
    expect(before.getAttribute('aria-current')).toBe('false')
    selection.set('clip', ['c1'])
    expect(clip('c1')).toBe(before)
    expect(before.getAttribute('aria-current')).toBe('true')
    expect(before.classList.contains('selected')).toBe(true)
    selection.set('track', ['t1'])
    expect(before.getAttribute('aria-current')).toBe('false')
  })

  it('a track name selects the track, and the header says so', () => {
    const selection = new Selection()
    buildSel(selection)
    const name = document.getElementById('show-track-t2')
    name.dispatchEvent(event('click'))
    expect(selection.has('track', 't2')).toBe(true)
    expect(name.getAttribute('aria-pressed')).toBe('true')
    expect(document.getElementById('show-track-t1').getAttribute('aria-pressed')).toBe('false')
  })
})

describe('the loop', () => {
  const buildLoop = (loop, view = new TimeView()) => {
    const calls = []
    const record = name => (...args) => calls.push([name, ...args])
    const timeline = createTimeline(document, {
      onAdd: record('add'), onAddAudio: record('addAudio'), onMove: record('move'), onResize: record('resize'),
      onOpen: record('open'), onRemove: record('remove'), onSplit: record('split'), onDuplicate: record('duplicate'), onMute: record('mute'), onLock: record('lock'), onTrim: record('trim'), onCopy: record('copy'), onCut: record('cut'), onPaste: record('paste'), onChannel: record('channel'), onSetLoop: record('loop'), onMoveTrack: record('moveTrack'), onArm: record('arm')
    }, { view })
    document.body.append(timeline.element)
    timeline.draw({ tracks, clips, beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false, loop })
    return { calls, timeline, view, $: id => document.getElementById(id) }
  }

  it('says whether the loop is set and on, in text and in the group name', () => {
    const { $ } = buildLoop({ start: 4, end: 12, enabled: true })
    expect(document.querySelector('.timeline-loop').getAttribute('aria-label')).toBe('Loop, on')
    expect(document.querySelector('.loop-brace span').textContent).toBe('Loop on')
    expect($('loop-start').getAttribute('aria-label')).toMatch(/^Loop start, bar 2 beat 1/)
    expect($('loop-end').getAttribute('aria-label')).toMatch(/^Loop end, bar 4 beat 1/)
    expect(document.querySelector('.loop-brace').style.left).toBe(`${4 * 24}px`)
    expect(document.querySelector('.loop-brace').style.width).toBe(`${8 * 24}px`)
  })

  it('leaves out the brace and handles when no loop is set, rather than drawing dead ones', () => {
    const { $ } = buildLoop({ start: 0, end: 0, enabled: false })
    expect(document.querySelector('.timeline-loop').getAttribute('aria-label')).toBe('Loop, not set')
    expect($('loop-start').hidden).toBe(true)
    expect(document.querySelector('.loop-brace').hidden).toBe(true)
  })

  it('says a loop that is set but off is off', () => {
    buildLoop({ start: 4, end: 8, enabled: false })
    expect(document.querySelector('.loop-brace span').textContent).toBe('Loop off')
  })

  it('moves an end by the grid from the keyboard, a bar with Shift, and refuses to cross', () => {
    const { calls, $ } = buildLoop({ start: 4, end: 12, enabled: true })
    $('loop-end').dispatchEvent(event('keydown', { key: 'ArrowRight' }))
    $('loop-end').dispatchEvent(event('keydown', { key: 'ArrowLeft', shiftKey: true }))
    $('loop-start').dispatchEvent(event('keydown', { key: 'ArrowLeft' }))
    expect(calls).toEqual([['loop', { start: 4, end: 13 }], ['loop', { start: 4, end: 8 }], ['loop', { start: 3, end: 12 }]])
    calls.length = 0
    // Pulling the end back past the start would make it the start: it is kept ordered.
    $('loop-end').dispatchEvent(event('keydown', { key: 'ArrowLeft', shiftKey: true }))
    $('loop-end').dispatchEvent(event('keydown', { key: 'ArrowLeft', shiftKey: true }))
    expect(calls.every(([, r]) => r.end > r.start)).toBe(true)
  })

  it('moves an edge with the pointer, following the drag onto the document, on the grid', () => {
    const { calls, $ } = buildLoop({ start: 4, end: 12, enabled: true })
    $('loop-end').dispatchEvent(event('pointerdown', { button: 0, clientX: 300 }))
    document.dispatchEvent(event('pointermove', { clientX: 300 + 2.4 * 24 }))
    document.dispatchEvent(event('pointerup', { clientX: 300 + 2.4 * 24 }))
    expect(calls).toEqual([['loop', { start: 4, end: 14 }]])
    document.dispatchEvent(event('pointerup', { clientX: 900 }))
    expect(calls).toHaveLength(1)
  })

  it('draws a new loop by dragging on the empty row', () => {
    const { calls } = buildLoop({ start: 0, end: 0, enabled: false })
    const row = document.querySelector('.timeline-loop')
    row.dispatchEvent(event('pointerdown', { button: 0, clientX: 2 * 24 }))
    document.dispatchEvent(event('pointermove', { clientX: 6 * 24 }))
    document.dispatchEvent(event('pointerup', { clientX: 6 * 24 }))
    expect(calls).toEqual([['loop', { start: 2, end: 6 }]])
  })

  it('draws it the right way round when dragged backwards, and ignores a click', () => {
    const { calls } = buildLoop({ start: 0, end: 0, enabled: false })
    const row = document.querySelector('.timeline-loop')
    row.dispatchEvent(event('pointerdown', { button: 0, clientX: 8 * 24 }))
    document.dispatchEvent(event('pointerup', { clientX: 3 * 24 }))
    row.dispatchEvent(event('pointerdown', { button: 0, clientX: 5 * 24 }))
    document.dispatchEvent(event('pointerup', { clientX: 5 * 24 }))
    expect(calls).toEqual([['loop', { start: 3, end: 8 }]])
  })
})

describe('follow', () => {
  const scrolling = () => {
    const { timeline } = build()
    const scroller = document.querySelector('.timeline-scroll')
    Object.defineProperty(scroller, 'clientWidth', { value: 500, configurable: true })
    scroller.scrollLeft = 0
    const follow = [...document.querySelectorAll('.timeline-tools button')].find(b => b.textContent === 'Follow')
    return { timeline, scroller, follow }
  }

  it('is on by default, and says so', () => {
    expect(scrolling().follow.getAttribute('aria-pressed')).toBe('true')
  })

  it('brings the playhead back into view, a little in from the left, and stays put while it is visible', () => {
    const { timeline, scroller } = scrolling()
    timeline.playhead(10)
    expect(scroller.scrollLeft).toBe(0)
    timeline.playhead(40)
    expect(scroller.scrollLeft).toBe(40 * 24 - 500 * 0.15)
  })

  it('does nothing when Follow is off', () => {
    const { timeline, scroller, follow } = scrolling()
    follow.dispatchEvent(event('click'))
    expect(follow.getAttribute('aria-pressed')).toBe('false')
    timeline.playhead(40)
    expect(scroller.scrollLeft).toBe(0)
  })

  it('turns itself off when the person scrolls, and not for its own scrolling', () => {
    const { timeline, scroller, follow } = scrolling()
    timeline.playhead(40)
    scroller.dispatchEvent(event('scroll'))
    expect(follow.getAttribute('aria-pressed')).toBe('true')
    scroller.scrollLeft += 200
    scroller.dispatchEvent(event('scroll'))
    expect(follow.getAttribute('aria-pressed')).toBe('false')
  })

  it('a scroll while the transport is stopped is not the person leaving it', () => {
    const { timeline, scroller, follow } = scrolling()
    timeline.playhead(null)
    scroller.scrollLeft = 300
    scroller.dispatchEvent(event('scroll'))
    expect(follow.getAttribute('aria-pressed')).toBe('true')
  })
})

describe('an empty arrangement', () => {
  it('says what to do and offers it as buttons that run the given requests', () => {
    const ran = []
    const timeline = createTimeline(document, {
      onAdd () {}, onAddAudio () {}, onMove () {}, onResize () {}, onOpen () {}, onRemove () {}, onSplit () {}, onDuplicate () {}, onMute () {}, onLock () {}, onTrim () {}, onCopy () {}, onCut () {}, onPaste () {}, onChannel () {}, onSetLoop () {}, onMoveTrack () {}, onArm () {}
    })
    document.body.append(timeline.element)
    timeline.draw({
      tracks: [], clips: [], beatsPerBar: 4, labelFor: () => '', playsIntoNothing: () => false,
      empty: { text: 'Start here.', actions: [{ label: 'One', run: () => ran.push('one') }, { label: 'Two', run: () => ran.push('two') }] }
    })
    expect(document.querySelector('.empty p').textContent).toBe('Start here.')
    const buttons = [...document.querySelectorAll('.empty button')]
    expect(buttons.map(b => b.textContent)).toEqual(['One', 'Two'])
    buttons[1].dispatchEvent(event('click'))
    expect(ran).toEqual(['two'])
  })

  it('still says something with no actions given', () => {
    const timeline = createTimeline(document, {
      onAdd () {}, onAddAudio () {}, onMove () {}, onResize () {}, onOpen () {}, onRemove () {}, onSplit () {}, onDuplicate () {}, onMute () {}, onLock () {}, onTrim () {}, onCopy () {}, onCut () {}, onPaste () {}, onChannel () {}, onSetLoop () {}, onMoveTrack () {}, onArm () {}
    })
    document.body.append(timeline.element)
    timeline.draw({ tracks: [], clips: [], beatsPerBar: 4, labelFor: () => '', playsIntoNothing: () => false })
    expect(document.querySelector('.empty p').textContent).toMatch(/No tracks yet/)
    expect(document.querySelectorAll('.empty button')).toHaveLength(0)
  })
})

describe('the chain under each lane', () => {
  const chainFor = track => ({
    trackId: track.id,
    nodes: track.id === 't1'
      ? [{ id: 'n1', label: 'Synth', loaded: true, failed: null, takes: ['MIDI'], gives: ['audio'], takesMidiFromTrack: true, takesAudioFromTrack: false, sends: [], receives: [] }]
      : []
  })
  const buildChain = selection => {
    const timeline = createTimeline(document, {
      onAdd () {}, onAddAudio () {}, onMove () {}, onResize () {}, onOpen () {}, onRemove () {}, onSplit () {}, onDuplicate () {}, onMute () {}, onLock () {}, onTrim () {}, onCopy () {}, onCut () {}, onPaste () {}, onChannel () {}, onSetLoop () {}, onMoveTrack () {}, onArm () {}
    }, { selection })
    document.body.append(timeline.element)
    timeline.draw({ tracks, clips, beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false, chainFor })
    return timeline
  }

  it('draws a strip for a track with plugins and leaves out one with none', () => {
    buildChain(new Selection())
    const strips = [...document.querySelectorAll('.timeline-chain')]
    expect(strips.map(s => s.hidden)).toEqual([false, true])
    expect(document.getElementById('chain-n1').textContent).toBe('Synth')
  })

  it('selects a plugin from its button, marks it, and keeps the button across a redraw', () => {
    const selection = new Selection()
    const timeline = buildChain(selection)
    const chip = document.getElementById('chain-n1')
    chip.dispatchEvent(event('click'))
    expect(selection.has('node', 'n1')).toBe(true)
    expect(chip.getAttribute('aria-pressed')).toBe('true')
    selection.set('clip', ['c1'])
    expect(chip.getAttribute('aria-pressed')).toBe('false')
    timeline.draw({ tracks, clips, beatsPerBar: 4, labelFor: t => t.label, playsIntoNothing: () => false, chainFor })
    expect(document.querySelectorAll('.chain-node')).toHaveLength(1)
  })

  it('has a Routing button that says whether the chains are shown', () => {
    buildChain(new Selection())
    const button = [...document.querySelectorAll('.timeline-tools button')].find(b => b.textContent === 'Routing')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    button.dispatchEvent(event('click'))
    expect(button.getAttribute('aria-pressed')).toBe('false')
    expect(document.querySelector('.timeline').dataset.routing).toBe('off')
  })

  it('keeps the header and lane side by side above the chain', () => {
    buildChain(new Selection())
    const row = document.querySelector('.timeline-row')
    expect([...row.children].map(c => c.className)).toEqual(['timeline-body', 'timeline-chain'])
    expect([...row.querySelector('.timeline-body').children].map(c => c.className.split(' ')[0])).toEqual(['timeline-head', 'timeline-lane'])
  })
})
