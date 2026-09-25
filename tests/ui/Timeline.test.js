// tests/ui/Timeline.test.js
//
// The drag is driven the way a real one arrives: the press on the clip, and
// the move and the release on the document. A drag that only listened on the
// clip would stop at its edge in a browser and pass here otherwise.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTimeline, describeClip, barBeat, PIXELS_PER_BEAT } from '../../src/ui/Timeline.js'

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
    onAdd: record('add'), onAddAudio: record('addAudio'), onMove: record('move'), onResize: record('resize'), onOpen: record('open'), onRemove: record('remove'), onShowTrack: record('show')
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

  it('leads from a track\'s name to its plugins', () => {
    const { calls } = build()
    const name = document.getElementById('show-track-t2')
    expect(name.getAttribute('aria-label')).toBe('Loop: show its plugins')
    name.dispatchEvent(event('click'))
    expect(calls).toEqual([['show', 't2']])
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
