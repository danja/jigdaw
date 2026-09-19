// src/ui/Dial.js
//
// A rotary control: the knob a hardware synthesiser has, in place of a slider.
//
// A slider needs the width of the panel to be usable and a knob needs about
// 50 pixels, which is the whole reason this exists: a plugin with 42 controls
// was two thousand pixels of scrolling, and the same controls as knobs fit on
// one screen.
//
// **The control is still an `<input type="range">`.** Everything a person
// reaches by keyboard, and everything a screen reader reads, comes from the
// native element: the slider role, the minimum, the maximum, the current
// value, the arrow keys, Home and End, Page Up and Page Down. None of it is
// reimplemented. AGENTS.md says the cheapest way to satisfy WCAG 2.1.1 is not
// to leave the platform, and a knob is exactly the control that tempts a
// developer to build a div with a drag handler and lose all of it.
//
// What is replaced is the pixels and the pointer. The input is laid over the
// knob and made invisible, the knob is drawn as SVG beside it, and a drag is
// handled here because a native range maps horizontal position across its own
// width to its whole range, which on a 50 pixel target is about twenty usable
// positions.

// The sweep, in degrees, measured clockwise from three o'clock. A knob that
// starts at seven thirty and ends at four thirty is the convention on every
// piece of hardware, and the gap at the bottom is what tells you which way is
// up at a glance.
const START_DEGREES = 135
const SWEEP_DEGREES = 270

const RADIUS = 38
const CENTRE = 50
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

// How far the pointer travels for the whole range, in CSS pixels. Longer than
// the knob is wide on purpose: the knob is the target, the travel is the
// gesture, and tying the two together is what makes a small knob unusable.
const TRAVEL = 160
// Held shift divides the movement, for setting a cutoff to the hertz.
const FINE = 6

const SVG_NS = 'http://www.w3.org/2000/svg'

const round = n => Math.round(n * 100) / 100

/** Where a fraction of the sweep lands, as a point on the dial face. */
function facePoint (fraction, radius) {
  const radians = (START_DEGREES + SWEEP_DEGREES * fraction) * Math.PI / 180
  return [round(CENTRE + radius * Math.cos(radians)), round(CENTRE + radius * Math.sin(radians))]
}

/**
 * Build a rotary control for one port.
 *
 * `onInput` is not called from here: the input is returned and the caller
 * listens to it, so a drag and an arrow key arrive by the same route and
 * there is one place that decides what an input means.
 */
export function createDial (document, port, id) {
  const element = document.createElement('div')
  element.className = 'dial'

  const input = document.createElement('input')
  input.type = 'range'
  input.id = id
  input.className = 'dial-input'
  input.min = String(port.minimum)
  input.max = String(port.maximum)
  // 200 steps across any range, so a dial feels the same whether it spans
  // 0 to 1 or 200 to 18000.
  input.step = String((port.maximum - port.minimum) / 200)
  input.value = String(port.defaultValue)

  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('viewBox', '0 0 100 100')
  svg.setAttribute('class', 'dial-face')
  // The input carries the name, the role and the value. The drawing is
  // decoration and a reader that announces it twice is a reader announcing
  // the same control twice.
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')

  // Track and value as one dashed circle each, rather than as arc paths: an
  // arc path has to be rebuilt on every change and a dash offset does not,
  // and the large-arc flag is a well known place to put a bug.
  const arc = className => {
    const circle = document.createElementNS(SVG_NS, 'circle')
    circle.setAttribute('class', className)
    circle.setAttribute('cx', String(CENTRE))
    circle.setAttribute('cy', String(CENTRE))
    circle.setAttribute('r', String(RADIUS))
    circle.setAttribute('fill', 'none')
    circle.setAttribute('transform', `rotate(${START_DEGREES} ${CENTRE} ${CENTRE})`)
    return circle
  }

  const track = arc('dial-track')
  setSweep(track, 0, 1)
  const value = arc('dial-value')

  // Where the arc grows from. A control that runs through zero, like a pan or
  // a transpose, is read from the middle: drawn from the left end instead, a
  // centred pan looks like half of something rather than like nothing, and
  // minus twelve semitones looks like a quarter turn of level. Anything that
  // does not cross zero grows from its minimum, which is every gain, time and
  // frequency there is.
  const origin = port.minimum < 0 && port.maximum > 0
    ? -port.minimum / (port.maximum - port.minimum)
    : 0

  // The line from the centre. A ring alone reads as a progress bar; the
  // pointer is what makes it a knob, and it is the part that stays legible
  // when the ring is too thin to see.
  const pointer = document.createElementNS(SVG_NS, 'line')
  pointer.setAttribute('class', 'dial-pointer')
  pointer.setAttribute('x1', String(CENTRE))
  pointer.setAttribute('y1', String(CENTRE))

  svg.append(track, value, pointer)
  element.append(svg, input)

  /** Draw the control at a value the host has confirmed. */
  function render (current) {
    const span = port.maximum - port.minimum
    const fraction = span === 0 ? 0 : Math.min(1, Math.max(0, (current - port.minimum) / span))
    setSweep(value, origin, fraction)
    const [x, y] = facePoint(fraction, RADIUS)
    pointer.setAttribute('x2', String(x))
    pointer.setAttribute('y2', String(y))
  }

  attachDrag(element, input, port)

  return { element, input, render }
}

/**
 * Draw the part of the ring between two fractions of the sweep.
 *
 * A dash the length of the span, and a negative dash offset to move its start
 * round to where the span begins. Offsetting rather than rebuilding a path
 * means the arc has no large-arc flag to get wrong and nothing to recompute
 * but two numbers.
 */
function setSweep (circle, from, to) {
  const sweep = CIRCUMFERENCE * (SWEEP_DEGREES / 360)
  const low = Math.min(from, to)
  const high = Math.max(from, to)
  circle.setAttribute('stroke-dasharray', `${round((high - low) * sweep)} ${round(CIRCUMFERENCE)}`)
  circle.setAttribute('stroke-dashoffset', String(round(-low * sweep)))
}

/**
 * Turn a vertical drag into input events on the range.
 *
 * Vertical rather than horizontal, because the panel scrolls vertically and a
 * horizontal drag on a knob is what every hardware emulation has used for
 * thirty years. `touch-action: none` in the stylesheet is what stops the drag
 * scrolling the page instead.
 *
 * The event is dispatched on the input rather than calling back, so a drag
 * and an arrow key are indistinguishable downstream. The input's own value
 * moves with the pointer, which is what a native range does under a thumb;
 * the readout and the drawing do not, because messaging.md section 2.3 says a
 * panel renders what it is told and not what it was asked for.
 *
 * **The move and the release are listened for on the document, not on the
 * knob, and not through setPointerCapture.** A knob is 52 pixels across and a
 * useful drag is three times that, so almost every drag leaves the element it
 * started on. Capture is the API for exactly this and it is the thing that
 * fails quietly: it throws on a pointerId the implementation does not
 * recognise, which takes the rest of the pointerdown handler with it, and the
 * drag then tracks only as far as the edge of the knob. Found in Chrome after
 * the unit tests passed, because a DOM with no layout has no pointer capture
 * to fail. The document always has the events.
 */
function attachDrag (element, input, port) {
  const span = port.maximum - port.minimum
  const owner = element.ownerDocument
  const Event = owner.defaultView?.Event
  if (!Event) return    // no event constructor, so no pointer: keyboard alone

  let dragging = null

  const move = event => {
    if (!dragging) return
    const sensitivity = event.shiftKey ? TRAVEL * FINE : TRAVEL
    // Up is more, which is the direction every fader and every knob agrees on.
    const moved = (dragging.y - event.clientY) / sensitivity
    const next = Math.min(port.maximum, Math.max(port.minimum, dragging.from + moved * span))
    if (Number(input.value) === next) return
    input.value = String(next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }

  const end = () => {
    if (!dragging) return
    dragging = null
    owner.removeEventListener('pointermove', move)
    owner.removeEventListener('pointerup', end)
    owner.removeEventListener('pointercancel', end)
  }

  element.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return
    dragging = { y: event.clientY, from: Number(input.value) }
    // pointer-events are off on the input so the drag can reach this element,
    // which means the press cannot focus it. Focusing here keeps the keyboard
    // where the hand left it.
    input.focus?.()
    event.preventDefault?.()
    owner.addEventListener('pointermove', move)
    owner.addEventListener('pointerup', end)
    owner.addEventListener('pointercancel', end)
  })
}
