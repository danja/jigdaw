// tests/ui/SkinPanel.test.js
//
// What a DOM can check: the semantics under each drawn control, that a change goes to the host and
// the drawing waits to be told, and where things are placed given a measurement. A DOM has no layout
// and no pointer to capture, so the drag and the 44px target are driven in Chrome (bin/check-skins.js).
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { buildArtwork, SVG_NS } from '../../src/ui/SkinArtwork.js'
import { createSkinPanel, overlapFraction } from '../../src/ui/SkinPanel.js'

const { document, Event } = parseHTML('<!doctype html><html><body></body></html>')
document.defaultView.Event = Event

const el = (name, attrs = {}, children = []) => {
  const e = document.createElementNS(SVG_NS, name)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v)
  for (const c of children) e.append(c)
  return e
}

const ports = [
  { symbol: 'rate', name: 'Rate', unit: 'http://lv2plug.in/ns/extensions/units#hz', minimum: 0.1, maximum: 20.1, defaultValue: 5, scalePoints: [] },
  { symbol: 'depth', name: 'Depth', minimum: 0, maximum: 1, defaultValue: 0.5, scalePoints: [] },
  { symbol: 'bypass', name: 'Bypass', toggled: true, minimum: 0, maximum: 1, defaultValue: 0, scalePoints: [] },
  { symbol: 'mode', name: 'Mode', minimum: 0, maximum: 2, defaultValue: 0, enumeration: true, scalePoints: [{ value: 0, label: 'Sine' }, { value: 1, label: 'Square' }, { value: 2, label: 'Saw' }] }
]

const artwork = () => el('svg', { viewBox: '0 0 200 100' }, [
  el('g', { id: 'knob' }, [el('circle', { id: 'hub', cx: '40', cy: '50', r: '20' })]),
  el('rect', { id: 'slot', x: '100', y: '45', width: '80', height: '10' }),
  el('g', { id: 'thumb' }, [el('circle', { r: '6' })]),
  el('text', { id: 'rate-text' }),
  el('g', { id: 'toggle' }, [el('g', { id: 'off' }), el('g', { id: 'on' })]),
  el('g', { id: 'steps' }, [el('g'), el('g'), el('g')])
])

const control = (kind, boundSymbol, extra) => ({ id: `#${boundSymbol}-${kind}`, kind, boundSymbol, hitElement: null, pivotElement: null, trackElement: null, ...extra })

const CONTROLS = [
  control('rotary', 'rate', { element: 'knob', pivotElement: 'hub', angleMin: -135, angleMax: 135 }),
  control('readout', 'rate', { element: 'rate-text' }),
  control('linear', 'depth', { element: 'thumb', trackElement: 'slot' }),
  control('toggle', 'bypass', { element: 'toggle' }),
  control('selector', 'mode', { element: 'steps' })
]

// Boxes by element id, as a layout would give them.
const BOXES = { hub: { x: 20, y: 30, width: 40, height: 40 }, knob: { x: 20, y: 30, width: 40, height: 40 }, slot: { x: 100, y: 45, width: 80, height: 10 }, thumb: { x: 94, y: 44, width: 12, height: 12 }, toggle: { x: 0, y: 0, width: 10, height: 10 }, steps: { x: 0, y: 0, width: 10, height: 10 } }

function make ({ controls = CONTROLS, boxes = BOXES, onChange = () => {} } = {}) {
  const built = buildArtwork({ documentElement: artwork() }, { document, prefix: 's-' })
  const measure = element => boxes[element.getAttribute('id').slice(2)]
  const panel = createSkinPanel(document, { svg: built.svg, elements: built.elements, controls, ports }, onChange, { scope: 'panel-n1', measure })
  document.body.append(panel.element)
  panel.fit()
  return { panel, built }
}

const input = (panel, symbol) => panel.element.querySelector(`input[id="panel-n1_skin-${symbol}"]`)
const transformOf = (built, id) => built.elements.get(id).getAttribute('transform')

describe('createSkinPanel, the semantics', () => {
  it('lays one native input under each control that sets a port, named by the port', () => {
    const { panel } = make()
    const inputs = [...panel.element.querySelectorAll('input')].sort((a, b) => a.id.localeCompare(b.id))
    expect(inputs.map(i => [i.id, i.type, i.getAttribute('aria-label')])).toEqual([
      ['panel-n1_skin-bypass', 'checkbox', 'Bypass'],
      ['panel-n1_skin-depth', 'range', 'Depth'],
      ['panel-n1_skin-mode', 'range', 'Mode'],
      ['panel-n1_skin-rate', 'range', 'Rate']
    ])
    expect(input(panel, 'bypass').getAttribute('role')).toBe('switch')
  })

  it('gives a readout no control of its own and hides it from assistive technology', () => {
    const { panel, built } = make()
    expect(panel.element.querySelectorAll('input')).toHaveLength(4)
    expect(built.elements.get('rate-text').getAttribute('aria-hidden')).toBe('true')
    expect(panel.bound).toEqual(new Set(['rate', 'depth', 'bypass', 'mode']))
  })

  it('does not count a readout alone as reaching its port', () => {
    const { panel } = make({ controls: [CONTROLS[1]] })
    expect(panel.bound.size).toBe(0)
    expect(panel.element.querySelectorAll('input')).toHaveLength(0)
  })

  it('reports a value as text with its unit, not a bare number', () => {
    const { panel } = make()
    panel.update('rate', 10.1)
    expect(input(panel, 'rate').getAttribute('aria-valuetext')).toBe('10.10 hertz')
  })
})

describe('createSkinPanel, asking and being told', () => {
  it('sends the value on input and leaves the drawing until the host answers', () => {
    const sent = []
    const { panel, built } = make({ onChange: (s, v) => sent.push([s, v]) })
    panel.update('depth', 0)
    const before = transformOf(built, 'thumb')
    const depth = input(panel, 'depth')
    depth.value = '0.75'
    depth.dispatchEvent(new Event('input', { bubbles: true }))
    expect(sent).toEqual([['depth', 0.75]])
    expect(transformOf(built, 'thumb')).toBe(before)
    panel.update('depth', 0.75)
    expect(transformOf(built, 'thumb')).toBe('translate(60 0)')
  })
})

describe('createSkinPanel, moving the artwork', () => {
  it('turns a rotary about the pivot centre between the two angles', () => {
    const { panel, built } = make()
    panel.update('rate', 0.1)
    expect(transformOf(built, 'knob')).toBe('rotate(-135 40 50)')
    panel.update('rate', 10.1)
    expect(transformOf(built, 'knob')).toBe('rotate(0 40 50)')
    panel.update('rate', 20.1)
    expect(transformOf(built, 'knob')).toBe('rotate(135 40 50)')
  })

  it('clamps a value outside the range rather than turning past the end stop', () => {
    const { panel, built } = make()
    panel.update('rate', 1000)
    expect(transformOf(built, 'knob')).toBe('rotate(135 40 50)')
  })

  it('keeps a transform the artwork already had', () => {
    const built = buildArtwork({ documentElement: el('svg', { viewBox: '0 0 10 10' }, [
      el('g', { id: 'knob', transform: 'translate(5 5)' }, [el('circle', { id: 'hub', r: '1' })]),
      el('g', { id: 'thumb', transform: 'scale(2)' }), el('rect', { id: 'slot' })
    ]) }, { document, prefix: 's-' })
    const panel = createSkinPanel(document, { svg: built.svg, elements: built.elements, ports,
      controls: [control('rotary', 'rate', { element: 'knob', pivotElement: 'hub', angleMin: 0, angleMax: 90 }), control('linear', 'depth', { element: 'thumb', trackElement: 'slot' })] },
    () => {}, { scope: 'p', measure: () => ({ x: 0, y: 0, width: 10, height: 4 }) })
    panel.fit()
    panel.update('rate', 20.1)
    expect(built.elements.get('knob').getAttribute('transform')).toBe('translate(5 5) rotate(90 5 2)')
    panel.update('depth', 1)
    expect(built.elements.get('thumb').getAttribute('transform')).toBe('translate(10 0) scale(2)')
  })

  it('slides a thumb up a track that is taller than it is wide', () => {
    const { panel, built } = make({ boxes: { ...BOXES, slot: { x: 0, y: 0, width: 8, height: 60 } } })
    panel.update('depth', 0.5)
    expect(transformOf(built, 'thumb')).toBe('translate(0 -30)')
    expect(input(panel, 'depth').getAttribute('aria-orientation')).toBe('vertical')
  })

  it('draws the first group off and the second on for a toggle', () => {
    const { panel, built } = make()
    panel.update('bypass', 0)
    expect([built.elements.get('off').getAttribute('display'), built.elements.get('on').getAttribute('display')]).toEqual(['inline', 'none'])
    panel.update('bypass', 1)
    expect([built.elements.get('off').getAttribute('display'), built.elements.get('on').getAttribute('display')]).toEqual(['none', 'inline'])
    expect(input(panel, 'bypass').checked).toBe(true)
  })

  it('draws only the group for the current step of a selector, and names the step', () => {
    const { panel, built } = make()
    panel.update('mode', 1)
    const groups = [...built.elements.get('steps').children]
    expect(groups.map(g => g.getAttribute('display'))).toEqual(['none', 'inline', 'none'])
    expect(input(panel, 'mode').getAttribute('aria-valuetext')).toBe('Square')
  })

  it('writes the value, with its unit, into a readout', () => {
    const { panel, built } = make()
    panel.update('rate', 5)
    expect(built.elements.get('rate-text').textContent).toBe('5.00 Hz')
  })
})

describe('createSkinPanel, pressing', () => {
  it('moves the focus to the control a press was on, for a toggle and a selector', () => {
    const { panel } = make()
    for (const symbol of ['bypass', 'mode']) {
      const focused = []
      const i = input(panel, symbol)
      i.focus = () => focused.push(symbol)
      i.parentNode.dispatchEvent(new Event('click', { bubbles: true }))
      expect(focused).toEqual([symbol])
    }
  })

  it('sends the maximum then the minimum as a toggle is pressed', () => {
    const sent = []
    const { panel } = make({ onChange: (s, v) => sent.push([s, v]) })
    const box = input(panel, 'bypass').parentNode
    box.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sent).toEqual([['bypass', 1]])
    panel.update('bypass', 1)
    box.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sent).toEqual([['bypass', 1], ['bypass', 0]])
  })

  it('steps a selector to the next position, wrapping, and sends the scale point value', () => {
    const sent = []
    const { panel } = make({ onChange: (s, v) => sent.push([s, v]) })
    const box = input(panel, 'mode').parentNode
    for (let i = 0; i < 4; i++) box.dispatchEvent(new Event('click', { bubbles: true }))
    expect(sent.map(([, v]) => v)).toEqual([1, 2, 0, 1])
  })
})

const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height })

describe('overlapFraction', () => {
  it('is the part of the smaller rectangle that the other covers', () => {
    expect(overlapFraction(rect(0, 0, 44, 44), rect(0, 22, 44, 44))).toBe(0.5)
    expect(overlapFraction(rect(0, 0, 100, 100), rect(10, 10, 20, 20))).toBe(1)
  })

  it('is 0 for rectangles that only touch or do not meet', () => {
    expect(overlapFraction(rect(0, 0, 44, 44), rect(44, 0, 44, 44))).toBe(0)
    expect(overlapFraction(rect(0, 0, 44, 44), rect(100, 100, 44, 44))).toBe(0)
  })
})

describe('createSkinPanel, too cramped to use', () => {
  // Sizes are in the drawing's units (200 by 100 here) and the width it is given. rate is a 40 unit knob, depth a 12 unit
  // thumb, and bypass and mode are 10 unit groups; each is padded to 44 CSS pixels.
  const apart = { ...BOXES, toggle: { x: 150, y: 90, width: 10, height: 10 }, steps: { x: 10, y: 90, width: 10, height: 10 } }
  const make2 = (boxes, width = 200) => {
    const built = buildArtwork({ documentElement: artwork() }, { document, prefix: 's-' })
    const measure = element => boxes[element.getAttribute('id').slice(2)]
    const panel = createSkinPanel(document, { svg: built.svg, elements: built.elements, controls: CONTROLS, ports }, () => {}, { scope: 'panel-n1', measure, availableWidth: () => width })
    document.body.append(panel.element)
    const answers = []
    panel.onCramped(c => answers.push(c))
    panel.fit()
    return { panel, answers }
  }

  it('says no when the padded areas keep apart', () => {
    const { panel, answers } = make2(apart)
    expect(panel.cramped).toBe(false)
    expect(answers).toEqual([false])
  })

  it('says yes when two overlap by more than a quarter of the smaller', () => {
    // depth's thumb moved onto the knob
    const { panel, answers } = make2({ ...apart, thumb: { x: 40, y: 60, width: 12, height: 12 } })
    expect(panel.cramped).toBe(true)
    expect(answers).toEqual([true])
  })

  it('lets two neighbours meet at their padding, a small overlap, without calling it cramped', () => {
    // centres 40 units apart, each padded to 44: they share 4
    const { panel } = make2({ ...apart, thumb: { x: 74, y: 44, width: 12, height: 12 } })
    expect(panel.cramped).toBe(false)
  })

  it('depends on the width: the same drawing is fine at its natural size and cramped when it shrinks', () => {
    // knob centre 40, thumb centre 100: 60 apart at scale 1, and 30 apart at half
    expect(make2(apart, 200).panel.cramped).toBe(false)
    expect(make2(apart, 100).panel.cramped).toBe(true)
  })

  it('never draws larger than the natural size when judging, so a wide panel is not read as roomier than it is', () => {
    // two small groups 20 units apart: both padded to 44 they overlap at natural size, and would not if scaled up twenty times
    const close = { ...apart, toggle: { x: 150, y: 90, width: 10, height: 10 }, steps: { x: 170, y: 90, width: 10, height: 10 } }
    expect(make2(close, 200).panel.cramped).toBe(true)
    expect(make2(close, 4000).panel.cramped).toBe(true)
  })

  it('says nothing when there is no width, as for a DOM with no layout', () => {
    const { panel, answers } = make2(apart, 0)
    expect(panel.cramped).toBe(false)
    expect(answers).toEqual([])
  })

  it('keeps the last sizes it had when the drawing is put away and measures as nothing, so it can answer again', () => {
    const boxes = { ...apart }
    const built = buildArtwork({ documentElement: artwork() }, { document, prefix: 's-' })
    let width = 200
    const panel = createSkinPanel(document, { svg: built.svg, elements: built.elements, controls: CONTROLS, ports }, () => {},
      { scope: 'panel-n1', measure: element => boxes[element.getAttribute('id').slice(2)], availableWidth: () => width })
    document.body.append(panel.element)
    const answers = []
    panel.onCramped(c => answers.push(c))
    panel.fit()
    // put away: every element now measures as nothing
    for (const k of Object.keys(boxes)) boxes[k] = { x: 0, y: 0, width: 0, height: 0 }
    width = 100
    panel.fit()
    width = 200
    panel.fit()
    expect(answers).toEqual([false, true, false])
  })
})

describe('createSkinPanel, size', () => {
  it('is no wider than the viewBox says, so the artwork has a natural size and still shrinks to fit', () => {
    const { panel } = make()
    expect(panel.element.style.maxWidth).toBe('200px')
  })

  it('sets no width for artwork with no viewBox, which fit() then refuses', () => {
    const built = buildArtwork({ documentElement: el('svg', {}, [el('g', { id: 'thumb' }), el('rect', { id: 'slot' })]) }, { document, prefix: 's-' })
    const panel = createSkinPanel(document, { svg: built.svg, elements: built.elements, ports, controls: [] }, () => {}, { scope: 'p', measure: () => BOXES.slot })
    expect(panel.element.style.maxWidth).toBe('')
  })
})

describe('createSkinPanel, tab order', () => {
  const order = panel => [...panel.element.querySelectorAll('input')].map(i => i.id.replace('panel-n1_skin-', ''))

  it('follows the picture, rows from the top and left to right along a row, not the order of the skin', () => {
    // rate and depth share a row at y 50 (rate left of depth); bypass and mode are a row below, mode left of bypass
    const boxes = { ...BOXES, toggle: { x: 150, y: 90, width: 10, height: 10 }, steps: { x: 10, y: 90, width: 10, height: 10 } }
    const { panel } = make({ boxes })
    expect(order(panel)).toEqual(['rate', 'depth', 'mode', 'bypass'])
  })

  it('does not move a box that is already in order, which would drop its focus', () => {
    const boxes = { ...BOXES, toggle: { x: 150, y: 90, width: 10, height: 10 }, steps: { x: 10, y: 90, width: 10, height: 10 } }
    const { panel } = make({ boxes })
    const moved = []
    for (const box of panel.element.querySelectorAll('.skin-hit')) {
      const append = box.parentNode.append.bind(box.parentNode)
      box.parentNode.append = (...nodes) => { moved.push(...nodes); return append(...nodes) }
    }
    panel.fit()
    expect(moved).toEqual([])
  })
})

describe('createSkinPanel, placing the hit areas', () => {
  it('puts each box over its element as a percentage of the viewBox', () => {
    const { panel } = make()
    const box = input(panel, 'depth').parentNode
    // thumb: x 94..106 and y 44..56 in a 200 by 100 box
    expect([box.style.left, box.style.top, box.style.width, box.style.height]).toEqual(['50%', '50%', '6%', '12%'])
  })

  it('uses the hit element where the control names one', () => {
    const controls = CONTROLS.map(c => c.kind === 'linear' ? { ...c, hitElement: 'slot' } : c)
    const { panel } = make({ controls })
    const box = input(panel, 'depth').parentNode
    expect([box.style.left, box.style.width]).toEqual(['70%', '40%'])
  })

  it('refuses artwork with no viewBox, since nothing could be placed', () => {
    const built = buildArtwork({ documentElement: el('svg', {}, [el('g', { id: 'thumb' }), el('rect', { id: 'slot' })]) }, { document, prefix: 's-' })
    const panel = createSkinPanel(document, { svg: built.svg, elements: built.elements, ports, controls: [control('linear', 'depth', { element: 'thumb', trackElement: 'slot' })] }, () => {}, { scope: 'p', measure: () => BOXES.slot })
    expect(() => panel.fit()).toThrow(/needs a viewBox/)
  })
})
