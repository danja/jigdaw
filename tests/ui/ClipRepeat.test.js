// tests/ui/ClipRepeat.test.js
//
// Repeating a MIDI clip to fill more time: the loop handle at its corner, the R key and the menu. Each is a second way to ask for the
// one thing, `onRepeat(clipId, lengthBeats)`, and a control that cannot act is not drawn. The drag is driven as a real one arrives:
// the press on the handle, and the move and the release on the document.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createClipButton } from '../../src/ui/ClipButton.js'
import { PIXELS_PER_BEAT } from '../../src/ui/Timeline.js'
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

const NOTE = { startBeat: 0, lengthBeats: 1, pitch: 60, velocity: 100 }

function build (clip = {}, { withRepeat = true, withStop = true, menu = null } = {}) {
  const calls = []
  const rec = name => (...a) => calls.push([name, ...a])
  const view = new TimeView()
  const names = ['onMove', 'onResize', 'onOpen', 'onRemove', 'onSplit', 'onDuplicate', 'onMute', 'onCopy', 'onCut', 'onPaste', 'onLock', 'onTrim']
  const make = createClipButton(document, {
    ppb: () => PIXELS_PER_BEAT, view, selection: new Selection(), menu,
    ...Object.fromEntries(names.map(n => [n, rec(n.replace(/^on/, '').toLowerCase())])),
    ...(withRepeat ? { onRepeat: rec('repeat') } : {}), ...(withStop ? { onStopRepeat: rec('stop') } : {})
  })
  const button = make({ id: 'c1', kind: 'midi', startBeat: 4, lengthBeats: 8, notes: [NOTE], ...clip }, { beatsPerBar: 4, playsIntoNothing: false, peaks: null })
  document.body.append(button)
  return { button, calls, loop: button.querySelector('.clip-loop') }
}

describe('the loop handle', () => {
  it('is on a MIDI clip that can be repeated', () => {
    expect(build().loop).not.toBeNull()
  })

  it('is left out of an audio clip, which has no pattern', () => {
    expect(build({ kind: 'audio', notes: undefined, source: 'a.wav' }).loop).toBeNull()
  })

  it('is left out of a locked clip, where it could only be refused', () => {
    expect(build({ locked: true }).loop).toBeNull()
  })

  it('is left out when the page gave no way to repeat', () => {
    expect(build({}, { withRepeat: false }).loop).toBeNull()
  })

  it('is hidden from a screen reader, since R and the menu do the same for a keyboard', () => {
    expect(build().loop.getAttribute('aria-hidden')).toBe('true')
  })

  it('repeats to the length dragged to, on the grid, and does not also resize or move the clip', () => {
    const { loop, calls } = build()
    loop.dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointerup', { clientX: 4 * PIXELS_PER_BEAT }))
    expect(calls).toEqual([['repeat', 'c1', 12]])
  })

  it('keeps listening on the document, so a drag past the clip still lands', () => {
    const { loop, calls } = build()
    loop.dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointermove', { clientX: 40 * PIXELS_PER_BEAT }))
    document.dispatchEvent(event('pointerup', { clientX: 40 * PIXELS_PER_BEAT }))
    expect(calls).toEqual([['repeat', 'c1', 48]])
  })

  it('asks for the shorter length when dragged back, and the caller decides that is an ordinary resize', () => {
    const { loop, calls } = build()
    loop.dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointerup', { clientX: -4 * PIXELS_PER_BEAT }))
    expect(calls).toEqual([['repeat', 'c1', 4]])
  })

  it('sends nothing for a press and release that moved nothing', () => {
    const { loop, calls } = build()
    loop.dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointerup', { clientX: 0 }))
    expect(calls).toEqual([])
  })

  it('puts the clip back and sends nothing when Escape is pressed during the drag', () => {
    const { loop, calls, button } = build()
    loop.dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointermove', { clientX: 4 * PIXELS_PER_BEAT }))
    expect(button.style.width).toBe(`${12 * PIXELS_PER_BEAT}px`)
    document.dispatchEvent(event('keydown', { key: 'Escape' }))
    document.dispatchEvent(event('pointerup', { clientX: 4 * PIXELS_PER_BEAT }))
    expect(calls).toEqual([])
    expect(button.style.width).toBe(`${8 * PIXELS_PER_BEAT}px`)
  })

  it('leaves the resize edge as it was: its drag still resizes', () => {
    const { button, calls } = build()
    button.querySelector('.clip-resize').dispatchEvent(event('pointerdown', { button: 0, clientX: 0 }))
    document.dispatchEvent(event('pointerup', { clientX: 4 * PIXELS_PER_BEAT }))
    expect(calls).toEqual([['resize', 'c1', 12]])
  })
})

describe('the R key', () => {
  const press = (button, init) => button.dispatchEvent(Object.assign(new window.Event('keydown', { bubbles: true, cancelable: true }), init))

  it('repeats a clip that does not loop by its own length again', () => {
    const { button, calls } = build()
    press(button, { key: 'r' })
    expect(calls).toEqual([['repeat', 'c1', 16]])
  })

  it('adds one pattern to a clip that already loops', () => {
    const { button, calls } = build({ lengthBeats: 7, loopBeats: 2 })
    press(button, { key: 'R' })
    expect(calls).toEqual([['repeat', 'c1', 9]])
  })

  it('does nothing on an audio clip, with a modifier, or when the page gave no way to repeat', () => {
    const audio = build({ kind: 'audio', notes: undefined })
    press(audio.button, { key: 'r' })
    const modified = build()
    press(modified.button, { key: 'r', ctrlKey: true })
    const none = build({}, { withRepeat: false })
    press(none.button, { key: 'r' })
    expect([...audio.calls, ...modified.calls, ...none.calls]).toEqual([])
  })
})

describe('the menu', () => {
  const open = options => {
    let items = null
    const menu = { open: list => { items = list } }
    const built = build(options.clip, { ...options, menu })
    built.button.dispatchEvent(event('contextmenu', { clientX: 5, clientY: 5, button: 2 }))
    return { ...built, items }
  }
  const labels = items => items.filter(i => typeof i !== 'string').map(i => i.label)

  it('offers Repeat once more on a MIDI clip, and Stop repeating only while it repeats', () => {
    expect(labels(open({ clip: {} }).items)).toContain('Repeat once more')
    expect(labels(open({ clip: {} }).items)).not.toContain('Stop repeating')
    expect(labels(open({ clip: { loopBeats: 2 } }).items)).toContain('Stop repeating')
  })

  it('runs the same request the key and the handle make', () => {
    const { items, calls } = open({ clip: { loopBeats: 2 } })
    items.find(i => i.label === 'Repeat once more').run()
    items.find(i => i.label === 'Stop repeating').run()
    expect(calls).toEqual([['repeat', 'c1', 10], ['stop', 'c1']])
  })

  it('leaves both out of an audio clip, a locked clip, and a page that gave no way to repeat', () => {
    expect(labels(open({ clip: { kind: 'audio', notes: undefined } }).items)).not.toContain('Repeat once more')
    expect(labels(open({ clip: { locked: true } }).items)).not.toContain('Repeat once more')
    expect(labels(open({ clip: {}, withRepeat: false }).items)).not.toContain('Repeat once more')
  })
})

describe('how a repeated clip is drawn', () => {
  it('draws the notes coming round again, and not only the first pattern', () => {
    const plain = build({ lengthBeats: 8 }).button.querySelector('.clip-notes path').getAttribute('d')
    const looped = build({ lengthBeats: 8, loopBeats: 2 }).button.querySelector('.clip-notes path').getAttribute('d')
    expect(plain.match(/M/g)).toHaveLength(1)
    expect(looped.match(/M/g)).toHaveLength(4)
  })

  it('marks where the pattern repeats, with a line at each repeat, and not on a clip that does not repeat', () => {
    expect(build({ lengthBeats: 8, loopBeats: 2 }).button.style.backgroundImage).toContain('repeating-linear-gradient')
    expect(build({ lengthBeats: 8, loopBeats: 2 }).button.classList.contains('clip-looped')).toBe(true)
    expect(build().button.style.backgroundImage ?? '').toBe('')
  })

  it('draws no marks when the pattern is as long as the clip, since nothing repeats', () => {
    expect(build({ lengthBeats: 8, loopBeats: 8 }).button.classList.contains('clip-looped')).toBe(false)
  })
})
