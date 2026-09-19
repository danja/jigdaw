// tests/ui/Dial.test.js
//
// The knob replaced the pixels of a slider and must not have replaced any of
// its behaviour. Two things are worth a test rather than a careful reading.
//
// The first is that the control is still a native range. A rotary control is
// exactly the widget that tempts a developer into a div with a drag handler,
// and every one of those loses the slider role, the arrow keys, Home and End,
// and the announced value, all at once and all silently: it still looks like
// a knob.
//
// The second is that the drawing follows what the host confirmed and never
// what the pointer asked for. messaging.md section 2.3, and a knob makes it
// easy to get wrong because the natural way to write a drag is to move the
// pointer with the finger.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'
import { createDial } from '../../src/ui/Dial.js'

const port = over => ({
  symbol: 'mix', name: 'Mix', defaultValue: 0.3, minimum: 0, maximum: 1,
  unit: null, toggled: false, enumeration: false, scalePoints: [],
  automationRate: 'k-rate', widget: 'dial', ...over
})

let document, window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const build = over => {
  const dial = createDial(document, port(over), 'mix')
  document.body.append(dial.element)
  return dial
}

/**
 * Where the drawn arc starts and ends, as fractions of the 270 degree sweep.
 *
 * The dash is its length and the offset moves its start round the ring, so
 * reading both is reading the arc.
 */
const arc = dial => {
  const circle = dial.element.querySelector('.dial-value')
  const [shown, whole] = circle.getAttribute('stroke-dasharray').split(' ').map(Number)
  const sweep = whole * 0.75
  const from = -Number(circle.getAttribute('stroke-dashoffset')) / sweep
  return { from, to: from + shown / sweep, length: shown / sweep }
}

/** How much of the ring is drawn, as a fraction of the full sweep. */
const drawn = dial => arc(dial).length

describe('the control under the knob', () => {
  it('is a native range, carrying the port declaration', () => {
    const { input } = build({ minimum: 200, maximum: 18000, defaultValue: 4200 })
    expect(input.tagName.toLowerCase()).toBe('input')
    expect(input.type).toBe('range')
    expect(input.min).toBe('200')
    expect(input.max).toBe('18000')
    expect(input.value).toBe('4200')
  })

  it('steps evenly whatever the range, so every knob turns the same', () => {
    expect(build({ minimum: 200, maximum: 18000 }).input.step).toBe('89')
    expect(build({ minimum: 0, maximum: 1 }).input.step).toBe('0.005')
  })

  it('is hidden by opacity, never by display or the hidden attribute', () => {
    // Both of those take it out of the tab order, and losing the keyboard is
    // the whole failure this widget invites. The stylesheet is checked too,
    // further down.
    const { input, element } = build()
    expect(input.hasAttribute('hidden')).toBe(false)
    expect(input.getAttribute('disabled')).toBeNull()
    expect(input.getAttribute('tabindex')).toBeNull()
    expect(element.contains(input)).toBe(true)
  })

  it('leaves the drawing out of the accessibility tree', () => {
    // The input already announces the name, the role and the value. A face
    // that announced itself would be the same control twice.
    const face = build().element.querySelector('.dial-face')
    expect(face.getAttribute('aria-hidden')).toBe('true')
    expect(face.getAttribute('focusable')).toBe('false')
  })
})

describe('what the knob draws', () => {
  it('draws nothing at the minimum and the whole sweep at the maximum', () => {
    const dial = build()
    dial.render(0)
    expect(drawn(dial)).toBeCloseTo(0, 3)
    dial.render(1)
    expect(drawn(dial)).toBeCloseTo(1, 3)
    dial.render(0.5)
    expect(drawn(dial)).toBeCloseTo(0.5, 2)
  })

  it('grows from the centre on a control that runs through zero', () => {
    // A pan, a transpose, a detune. Drawn from the left end instead, a
    // centred pan looks like half of something rather than like nothing, and
    // minus twelve semitones looks like a quarter turn of level.
    const dial = build({ minimum: -24, maximum: 24, defaultValue: 0 })
    dial.render(0)
    expect(drawn(dial)).toBeCloseTo(0, 3)
    dial.render(-24)
    expect(arc(dial)).toMatchObject({ from: expect.closeTo(0, 2), to: expect.closeTo(0.5, 2) })
    dial.render(24)
    expect(arc(dial)).toMatchObject({ from: expect.closeTo(0.5, 2), to: expect.closeTo(1, 2) })
    dial.render(-12)
    expect(arc(dial)).toMatchObject({ from: expect.closeTo(0.25, 2), to: expect.closeTo(0.5, 2) })
  })

  it('grows from the minimum on a control that does not, whatever its range', () => {
    // Every gain, time and frequency. A cutoff of 100 to 18000 has no
    // meaningful centre and drawing from one would be inventing a default.
    const dial = build({ minimum: 100, maximum: 18000, defaultValue: 6000 })
    dial.render(100)
    expect(arc(dial)).toMatchObject({ from: expect.closeTo(0, 2), to: expect.closeTo(0, 2) })
    dial.render(9050)
    expect(arc(dial)).toMatchObject({ from: expect.closeTo(0, 2), to: expect.closeTo(0.5, 2) })
    dial.render(18000)
    expect(arc(dial)).toMatchObject({ from: expect.closeTo(0, 2), to: expect.closeTo(1, 2) })
  })

  it('leaves a range that only touches zero at its end growing from the minimum', () => {
    // 0 to 1 is unipolar and so is minus 60 to 0. Only a range with zero
    // strictly inside it has a centre.
    const up = build({ minimum: 0, maximum: 1, defaultValue: 0 })
    up.render(0.5)
    expect(arc(up).from).toBeCloseTo(0, 3)
    const down = build({ minimum: -60, maximum: 0, defaultValue: 0 })
    down.render(-30)
    expect(arc(down).from).toBeCloseTo(0, 3)
  })

  it('points where the value is, whether or not the arc starts there', () => {
    // The pointer is absolute and the arc is relative to the origin, so a
    // bipolar knob at its minimum points bottom left with an arc on the left
    // half rather than pointing at the centre.
    const dial = build({ minimum: -24, maximum: 24, defaultValue: 0 })
    const line = dial.element.querySelector('.dial-pointer')
    dial.render(-24)
    expect(Number(line.getAttribute('x2'))).toBeLessThan(50)
    dial.render(0)
    expect(Number(line.getAttribute('y2'))).toBeLessThan(50)   // straight up
    dial.render(24)
    expect(Number(line.getAttribute('x2'))).toBeGreaterThan(50)
  })

  it('puts the pointer at the bottom left at the minimum and bottom right at the maximum', () => {
    // The gap is at the bottom, which is what tells a person which way is up.
    const dial = build()
    const line = dial.element.querySelector('.dial-pointer')
    dial.render(0)
    const [lowX, lowY] = [Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))]
    dial.render(1)
    const [highX, highY] = [Number(line.getAttribute('x2')), Number(line.getAttribute('y2'))]
    expect(lowX).toBeLessThan(50)
    expect(highX).toBeGreaterThan(50)
    expect(lowY).toBeGreaterThan(50)
    expect(highY).toBeGreaterThan(50)
    dial.render(0.5)
    expect(Number(line.getAttribute('y2'))).toBeLessThan(50)   // straight up
  })

  it('clamps rather than drawing past the ends', () => {
    const dial = build()
    dial.render(5)
    expect(drawn(dial)).toBeCloseTo(1, 3)
    dial.render(-5)
    expect(drawn(dial)).toBeCloseTo(0, 3)
  })

  it('survives a port whose minimum and maximum are the same', () => {
    const dial = build({ minimum: 1, maximum: 1, defaultValue: 1 })
    expect(() => dial.render(1)).not.toThrow()
    expect(drawn(dial)).toBe(0)
  })
})

describe('dragging the knob', () => {
  const drag = (dial, from, to, over = {}) => {
    const down = new window.Event('pointerdown', { bubbles: true })
    Object.assign(down, { clientY: from, pointerId: 1, button: 0 })
    dial.element.dispatchEvent(down)
    const move = new window.Event('pointermove', { bubbles: true })
    Object.assign(move, { clientY: to, pointerId: 1, shiftKey: false, ...over })
    dial.element.dispatchEvent(move)
    const up = new window.Event('pointerup', { bubbles: true })
    Object.assign(up, { pointerId: 1 })
    dial.element.dispatchEvent(up)
  }

  it('asks through the same input event an arrow key produces', () => {
    // One route, so nothing downstream has to know which happened, and the
    // panel needs one listener rather than two.
    const dial = build({ defaultValue: 0.5 })
    const asked = []
    dial.input.addEventListener('input', () => asked.push(Number(dial.input.value)))
    drag(dial, 200, 120)
    expect(asked).toHaveLength(1)
    expect(asked[0]).toBeGreaterThan(0.5)
  })

  it('goes up when the pointer goes up', () => {
    const up = build({ defaultValue: 0.5 })
    drag(up, 200, 120)
    const down = build({ defaultValue: 0.5 })
    drag(down, 200, 280)
    expect(Number(up.input.value)).toBeGreaterThan(0.5)
    expect(Number(down.input.value)).toBeLessThan(0.5)
  })

  it('moves less with shift held, so a wide range can be set precisely', () => {
    const coarse = build({ minimum: 200, maximum: 18000, defaultValue: 9000 })
    drag(coarse, 200, 180)
    const fine = build({ minimum: 200, maximum: 18000, defaultValue: 9000 })
    drag(fine, 200, 180, { shiftKey: true })
    expect(Number(fine.input.value) - 9000).toBeGreaterThan(0)
    expect(Number(fine.input.value) - 9000).toBeLessThan((Number(coarse.input.value) - 9000) / 2)
  })

  it('stops at the ends rather than running past them', () => {
    const dial = build({ defaultValue: 0.9 })
    drag(dial, 200, -2000)
    expect(Number(dial.input.value)).toBe(1)
    const low = build({ defaultValue: 0.1 })
    drag(low, 200, 2000)
    expect(Number(low.input.value)).toBe(0)
  })

  it('does not draw what it was only asked for', () => {
    // messaging.md 2.3. The drawing is the applied value, and a knob that
    // moved under the finger would disagree with the host the first time a
    // value was clamped or overridden by automation.
    const dial = build({ defaultValue: 0.5 })
    dial.render(0.5)
    const before = drawn(dial)
    drag(dial, 200, 100)
    expect(drawn(dial)).toBe(before)
    dial.render(Number(dial.input.value))
    expect(drawn(dial)).toBeGreaterThan(before)
  })

  it('keeps tracking after the pointer has left the knob', () => {
    // The knob is 52px across and a useful drag is three times that, so
    // almost every real drag ends somewhere else on the page. This dispatches
    // the move and the release on the document and never on the knob, which
    // is what actually happens once the pointer is outside it.
    //
    // It is a regression test with a date. setPointerCapture is the API for
    // this and it threw in Chrome on the pointerId it was handed, which took
    // the rest of the pointerdown handler with it; the drag then tracked only
    // to the edge of the knob and the value moved by a fifth of what the hand
    // asked for. Every unit test here passed, because a DOM with no layout
    // has no pointer capture to fail.
    const dial = build({ defaultValue: 0.5 })
    const down = new window.Event('pointerdown', { bubbles: true })
    Object.assign(down, { clientY: 400, pointerId: 1, button: 0 })
    dial.element.dispatchEvent(down)

    const move = new window.Event('pointermove', { bubbles: true })
    Object.assign(move, { clientY: 240, pointerId: 1 })
    document.dispatchEvent(move)
    // 160px is the whole travel, so half way up from the middle is the top.
    expect(Number(dial.input.value)).toBe(1)

    const up = new window.Event('pointerup', { bubbles: true })
    Object.assign(up, { pointerId: 1 })
    document.dispatchEvent(up)
    // And it stopped listening: a stray move afterwards moves nothing.
    const stray = new window.Event('pointermove', { bubbles: true })
    Object.assign(stray, { clientY: 900, pointerId: 1 })
    document.dispatchEvent(stray)
    expect(Number(dial.input.value)).toBe(1)
  })

  it('does not reach for pointer capture, which is what broke it', () => {
    // Stated as well as tested above, because the above passes either way in
    // a DOM that has no setPointerCapture to call.
    // Comments stripped: the file explains at length why it does not use it,
    // and a guard that its own explanation trips is a guard nobody keeps.
    const code = readFileSync(resolve(import.meta.dirname, '../../src/ui/Dial.js'), 'utf8')
      .split('\n')
      .filter(line => !/^\s*(\/\/|\/?\*)/.test(line))
      .join('\n')
    expect(code).not.toMatch(/PointerCapture/)
  })

  it('ignores a move with no press before it', () => {
    const dial = build({ defaultValue: 0.5 })
    const move = new window.Event('pointermove', { bubbles: true })
    Object.assign(move, { clientY: 10, pointerId: 1 })
    dial.element.dispatchEvent(move)
    expect(dial.input.value).toBe('0.5')
  })
})

describe('the stylesheet and the generator agree', () => {
  // Dial.js writes the class names and web/index.html draws them. Nothing
  // connects the two, and a rename in either leaves a knob that is present,
  // focusable, announced correctly and completely invisible. AGENTS.md names
  // this as the recurring failure here, so the lists are bound.
  const page = readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8')
  const source = readFileSync(resolve(import.meta.dirname, '../../src/ui/Dial.js'), 'utf8')

  const CLASSES = ['dial', 'dial-face', 'dial-track', 'dial-value', 'dial-pointer', 'dial-input']

  it('emits every class the stylesheet draws, and no others', () => {
    const emitted = new Set([...source.matchAll(/'(dial(?:-[a-z]+)?)'/g)].map(m => m[1]))
    expect([...emitted].sort()).toEqual([...CLASSES].sort())
  })

  it('draws every class the generator emits', () => {
    const missing = CLASSES.filter(name => !new RegExp(`\\.${name}[\\s,:{]`).test(page))
    expect(missing, `styled nowhere: ${missing.join(', ')}`).toEqual([])
  })

  it('hides the input without taking it out of the tab order', () => {
    const rule = page.match(/\.dial-input\s*\{([^}]*)\}/)
    expect(rule, 'no .dial-input rule').not.toBeNull()
    expect(rule[1]).toMatch(/opacity\s*:\s*0/)
    expect(rule[1]).not.toMatch(/display\s*:\s*none/)
    expect(rule[1]).not.toMatch(/visibility\s*:\s*hidden/)
  })

  it('shows the focus ring on the wrapper, since the input it belongs to is invisible', () => {
    expect(page).toMatch(/\.dial:focus-within\s*\{[^}]*outline/)
  })

  it('gives the knob a touch target of at least 44px and stops the page scrolling under a drag', () => {
    const rule = page.match(/\.dial\s*\{([^}]*)\}/)
    const width = Number(rule[1].match(/width\s*:\s*(\d+)px/)?.[1])
    const height = Number(rule[1].match(/height\s*:\s*(\d+)px/)?.[1])
    expect(width).toBeGreaterThanOrEqual(44)
    expect(height).toBeGreaterThanOrEqual(44)
    expect(rule[1]).toMatch(/touch-action\s*:\s*none/)
  })
})
