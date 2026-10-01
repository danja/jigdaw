// tests/ui/EnvelopeLane.test.js
//
// linkedom has no layout and no pointer capture: the lane's rectangle is given, pointer events are plain
// events carrying the fields the handlers read, and a drag is followed on the document.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createEnvelopeLane, envelopePath, CURVE_ORDER, LANE_HEIGHT } from '../../src/ui/EnvelopeLane.js'
import { TimeView } from '../../src/ui/TimeView.js'

let document, window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><html><body></body></html>')) })

const PPB = 24
const point = (atBeat, value, curve = 'linear') => ({ atBeat, value, curve })
const lane = (points, over = {}) => ({
  id: 'e1', label: 'Synth, cutoff', min: 0, max: 100, start: 50, points,
  speak: v => `${Math.round(v)} hertz`, where: b => `bar ${Math.floor(b / 4) + 1} beat ${(b % 4) + 1}`, ...over
})
const key = (k, extra = {}) => Object.assign(new window.Event('keydown', { cancelable: true }), { key: k, ...extra })
const pointer = (type, fields) => Object.assign(new window.Event(type, { cancelable: true, bubbles: true }), { button: 0, ...fields })

function build (points, over) {
  const changes = []
  const removed = []
  const view = new TimeView()
  view.setGrid('beat')
  const l = createEnvelopeLane(document, { onChange: (id, pts) => changes.push([id, pts]), onRemove: id => removed.push(id), view })
  document.body.append(l.element)
  l.update(lane(points, over), { beatsPerBar: 4, width: 480 })
  // Give the lane a rectangle at the page's origin.
  l.element.querySelector('.envelope-body').getBoundingClientRect = () => ({ left: 0, top: 0, width: 480, height: LANE_HEIGHT })
  const buttons = () => [...document.querySelectorAll('.envelope-point')]
  return { l, changes, removed, view, buttons }
}

describe('the path of an envelope', () => {
  const box = { ppb: 10, height: 100, min: 0, max: 100, width: 200 }
  it('runs flat to the first point, between points by each curve, and flat after the last', () => {
    expect(envelopePath([point(2, 50), point(6, 100)], box)).toBe('M 0 50 L 20 50 L 60 0 L 200 0')
    expect(envelopePath([point(2, 50, 'step'), point(6, 100)], box)).toBe('M 0 50 L 20 50 L 60 50 L 60 0 L 200 0')
  })
  it('draws a smooth leg as sixteen short lines ending on the next point, and nothing for no points', () => {
    const d = envelopePath([point(0, 0, 'smooth'), point(10, 100)], box)
    expect(d.match(/L/g)).toHaveLength(1 + 16 + 1)
    expect(d).toContain('L 100 0')
    expect(envelopePath([], box)).toBe('')
  })
})

describe('the lane', () => {
  it('draws one button per point, each saying what it is in words, placed by beat and value', () => {
    const { buttons } = build([point(0, 0), point(4, 50, 'smooth')])
    expect(buttons().map(b => b.getAttribute('aria-label'))).toEqual([
      'Synth, cutoff, 0 hertz at bar 1 beat 1, linear',
      'Synth, cutoff, 50 hertz at bar 2 beat 1, smooth'
    ])
    expect(buttons().map(b => b.id)).toEqual(['env-e1-p0', 'env-e1-p1'])
    expect(buttons()[1].style.left).toBe(`${4 * PPB - 22}px`)
    expect(buttons()[1].style.top).toBe(`${LANE_HEIGHT / 2 - 22}px`)
    expect(document.querySelector('.envelope-lane').getAttribute('aria-label')).toBe('Automation: Synth, cutoff')
  })

  it('moves a point in time by a grid step with Left and Right, and never past a neighbour', () => {
    const { buttons, changes } = build([point(2, 10), point(3, 20)])
    buttons()[0].dispatchEvent(key('ArrowRight'))
    expect(changes).toEqual([])
    buttons()[0].dispatchEvent(key('ArrowLeft'))
    expect(changes[0][1].map(p => p.atBeat)).toEqual([1, 3])
    buttons()[1].dispatchEvent(key('ArrowRight'))
    expect(changes[1][1].map(p => p.atBeat)).toEqual([2, 4])
    buttons()[1].dispatchEvent(key('ArrowLeft'))
    expect(changes).toHaveLength(2)
  })

  it('does not move the first point before the start', () => {
    const { buttons, changes } = build([point(0, 10)])
    buttons()[0].dispatchEvent(key('ArrowLeft'))
    expect(changes).toEqual([])
  })

  it('changes the value by a fiftieth of the range with Up and Down, a two hundredth with Shift, within the range', () => {
    const { buttons, changes } = build([point(0, 50), point(4, 100)])
    buttons()[0].dispatchEvent(key('ArrowUp'))
    buttons()[0].dispatchEvent(key('ArrowDown', { shiftKey: true }))
    buttons()[1].dispatchEvent(key('ArrowUp'))
    expect(changes.map(c => c[1].map(p => p.value))).toEqual([[52, 100], [49.5, 100]])
  })

  it('cycles the curve with C and removes a point with Delete, each as one request with the whole list', () => {
    const { buttons, changes } = build([point(0, 10, 'step'), point(4, 20)])
    buttons()[0].dispatchEvent(key('c'))
    expect(changes[0][1].map(p => p.curve)).toEqual(['linear', 'linear'])
    buttons()[1].dispatchEvent(key('c'))
    expect(changes[1][1].map(p => p.curve)).toEqual(['step', 'smooth'])
    buttons()[0].dispatchEvent(key('Delete'))
    expect(changes[2][1]).toEqual([point(4, 20)])
    expect(CURVE_ORDER).toEqual(['step', 'linear', 'smooth'])
  })

  it('adds a point a bar after the last at its value, or at the start when there are none', () => {
    const { changes, l } = build([point(0, 10), point(4, 70)])
    document.querySelector('.envelope-add').dispatchEvent(new window.Event('click'))
    expect(changes[0][1].at(-1)).toEqual(point(8, 70))
    l.update(lane([]), { beatsPerBar: 4, width: 480 })
    document.querySelector('.envelope-add').dispatchEvent(new window.Event('click'))
    expect(changes[1][1]).toEqual([point(0, 50)])
  })

  it('removes the lane', () => {
    const { removed } = build([point(0, 10)])
    document.querySelector('.envelope-remove').dispatchEvent(new window.Event('click'))
    expect(removed).toEqual(['e1'])
  })

  it('adds a point where the empty lane is clicked, snapped in time, and not on top of one that is there', () => {
    const { changes } = build([point(0, 0), point(8, 100)])
    const body = document.querySelector('.envelope-body')
    body.dispatchEvent(pointer('pointerdown', { clientX: 4.4 * PPB, clientY: LANE_HEIGHT / 4, target: body }))
    expect(changes[0][1].map(p => [p.atBeat, Math.round(p.value)])).toEqual([[0, 0], [4, 75], [8, 100]])
    body.dispatchEvent(pointer('pointerdown', { clientX: 8 * PPB, clientY: 10 }))
    expect(changes).toHaveLength(1)
  })

  it('drags a point on the document, writes nothing until the release, then one request', () => {
    const { buttons, changes } = build([point(0, 0), point(4, 50), point(8, 100)])
    const p = buttons()[1]
    p.dispatchEvent(pointer('pointerdown', { clientX: 4 * PPB, clientY: LANE_HEIGHT / 2 }))
    document.dispatchEvent(pointer('pointermove', { clientX: 5.2 * PPB, clientY: LANE_HEIGHT / 4 }))
    expect(changes).toEqual([])
    expect(p.style.left).toBe(`${5 * PPB - 22}px`)
    document.dispatchEvent(pointer('pointerup', {}))
    expect(changes).toHaveLength(1)
    expect(changes[0][1].map(x => [x.atBeat, Math.round(x.value)])).toEqual([[0, 0], [5, 75], [8, 100]])
    // A release after the pointer has left the point's own box still commits once, and a later move does nothing.
    document.dispatchEvent(pointer('pointermove', { clientX: 0, clientY: 0 }))
    expect(changes).toHaveLength(1)
  })

  it('keeps a dragged point between its neighbours, inside the value range', () => {
    const { buttons, changes } = build([point(2, 0), point(4, 50), point(6, 100)])
    buttons()[1].dispatchEvent(pointer('pointerdown', { clientX: 4 * PPB, clientY: 48 }))
    document.dispatchEvent(pointer('pointermove', { clientX: 12 * PPB, clientY: -500 }))
    document.dispatchEvent(pointer('pointerup', {}))
    const moved = changes[0][1][1]
    expect(moved.atBeat).toBeLessThan(6)
    expect(moved.atBeat).toBeGreaterThan(2)
    expect(moved.value).toBe(100)
  })

  it('treats a press that barely moves as a click, and changes nothing', () => {
    const { buttons, changes } = build([point(0, 0), point(4, 50)])
    buttons()[1].dispatchEvent(pointer('pointerdown', { clientX: 100, clientY: 40 }))
    document.dispatchEvent(pointer('pointermove', { clientX: 101, clientY: 41 }))
    document.dispatchEvent(pointer('pointerup', {}))
    expect(changes).toEqual([])
  })

  it('needs its handlers and the shared view', () => {
    const view = new TimeView()
    expect(() => createEnvelopeLane(document, { onRemove () {}, view })).toThrow(/onChange/)
    expect(() => createEnvelopeLane(document, { onChange () {}, view })).toThrow(/onRemove/)
    expect(() => createEnvelopeLane(document, { onChange () {}, onRemove () {} })).toThrow(/view/)
  })
})
