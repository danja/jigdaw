// tests/ui/LaneResize.test.js
//
// The grip along a lane's bottom edge. The drag is driven as a real one arrives: the press on the grip, and the move and the release on the document,
// since a drag that only listened on the grip would stop at its edge. linkedom has no layout, so the lane is given the height it would have.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createLaneResize, clampHeight } from '../../src/ui/LaneResize.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries({ button: 0, ...props })) Object.defineProperty(e, k, { value: v })
  return e
}

function build (height = 56) {
  const calls = []
  const lane = document.createElement('div')
  lane.getBoundingClientRect = () => ({ height: parseFloat(lane.style.minHeight) || height })
  document.body.append(lane)
  const grip = createLaneResize(document, { lane, onCommit: h => calls.push(['commit', h]), onReset: () => calls.push(['reset']) })
  lane.append(grip)
  return { lane, grip, calls }
}

describe('clampHeight', () => {
  it('rounds to whole pixels and holds to the least and most a lane may be', () => {
    expect(clampHeight(100.4)).toBe(100)
    expect(clampHeight(100.6)).toBe(101)
    expect(clampHeight(3)).toBe(24)
    expect(clampHeight(-50)).toBe(24)
    expect(clampHeight(5000)).toBe(800)
  })
})

describe('the grip', () => {
  it('is hidden from assistive technology and is not a stop in the tab order, since plus and minus do the same by size', () => {
    const { grip } = build()
    expect(grip.getAttribute('aria-hidden')).toBe('true')
    expect(grip.hasAttribute('tabindex')).toBe(false)
  })

  it('makes the lane as much taller as the pointer moves down, live, and commits that height once on release', () => {
    const { lane, grip, calls } = build(56)
    grip.dispatchEvent(event('pointerdown', { clientY: 100 }))
    document.dispatchEvent(event('pointermove', { clientY: 140 }))
    expect(lane.style.minHeight).toBe('96px')
    expect(calls).toEqual([])
    document.dispatchEvent(event('pointermove', { clientY: 180 }))
    document.dispatchEvent(event('pointerup', { clientY: 180 }))
    expect(lane.style.minHeight).toBe('136px')
    expect(calls).toEqual([['commit', 136]])
  })

  it('makes the lane shorter when the pointer moves up, and stops at the least a lane may be', () => {
    const { lane, grip, calls } = build(120)
    grip.dispatchEvent(event('pointerdown', { clientY: 300 }))
    document.dispatchEvent(event('pointermove', { clientY: 250 }))
    expect(lane.style.minHeight).toBe('70px')
    document.dispatchEvent(event('pointermove', { clientY: -400 }))
    document.dispatchEvent(event('pointerup', {}))
    expect(calls).toEqual([['commit', 24]])
  })

  it('keeps listening on the document, so a drag far past the lane still lands, and stops at the most a lane may be', () => {
    const { grip, calls } = build(56)
    grip.dispatchEvent(event('pointerdown', { clientY: 0 }))
    document.dispatchEvent(event('pointermove', { clientY: 9000 }))
    document.dispatchEvent(event('pointerup', {}))
    expect(calls).toEqual([['commit', 800]])
  })

  it('sends nothing for a press and release that moved nothing, and leaves the lane as it was', () => {
    const { lane, grip, calls } = build(56)
    lane.style.minHeight = '200px'
    grip.dispatchEvent(event('pointerdown', { clientY: 100 }))
    document.dispatchEvent(event('pointerup', { clientY: 100 }))
    expect(calls).toEqual([])
    expect(lane.style.minHeight).toBe('200px')
  })

  it('puts the lane back and sends nothing when Escape is pressed during the drag', () => {
    const { lane, grip, calls } = build(56)
    grip.dispatchEvent(event('pointerdown', { clientY: 100 }))
    document.dispatchEvent(event('pointermove', { clientY: 180 }))
    expect(lane.style.minHeight).toBe('136px')
    document.dispatchEvent(event('keydown', { key: 'Escape' }))
    document.dispatchEvent(event('pointerup', { clientY: 180 }))
    expect(lane.style.minHeight).toBe('')
    expect(calls).toEqual([])
  })

  it('does the same when the pointer is cancelled, as a touch that is taken over is', () => {
    const { lane, grip, calls } = build(56)
    grip.dispatchEvent(event('pointerdown', { clientY: 100 }))
    document.dispatchEvent(event('pointermove', { clientY: 180 }))
    document.dispatchEvent(event('pointercancel', {}))
    expect(lane.style.minHeight).toBe('')
    expect(calls).toEqual([])
  })

  it('stops listening once released, so a later move changes nothing', () => {
    const { lane, grip } = build(56)
    grip.dispatchEvent(event('pointerdown', { clientY: 100 }))
    document.dispatchEvent(event('pointermove', { clientY: 140 }))
    document.dispatchEvent(event('pointerup', {}))
    const after = lane.style.minHeight
    document.dispatchEvent(event('pointermove', { clientY: 400 }))
    expect(lane.style.minHeight).toBe(after)
  })

  it('ignores a press that is not the main button', () => {
    const { lane, grip, calls } = build(56)
    grip.dispatchEvent(event('pointerdown', { button: 2, clientY: 100 }))
    document.dispatchEvent(event('pointermove', { clientY: 200 }))
    document.dispatchEvent(event('pointerup', {}))
    expect(lane.style.minHeight).toBe('')
    expect(calls).toEqual([])
  })

  it('does not pass the press on to the lane behind it, which would select or add a clip', () => {
    const { lane, grip } = build(56)
    let reached = false
    lane.addEventListener('pointerdown', () => { reached = true })
    grip.dispatchEvent(event('pointerdown', { clientY: 100 }))
    document.dispatchEvent(event('pointerup', {}))
    expect(reached).toBe(false)
  })

  it('is reset by a double click, which does not add a clip to the lane behind it', () => {
    const { lane, grip, calls } = build(56)
    let reached = false
    lane.addEventListener('dblclick', () => { reached = true })
    grip.dispatchEvent(event('dblclick'))
    expect(calls).toEqual([['reset']])
    expect(reached).toBe(false)
  })
})
