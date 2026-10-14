// src/ui/SkinPanel.js
//
// Draws a skin (docs/svg-skins.md) and operates it. The artwork is already a set
// of nodes this page built from an allowlist (src/ui/SkinArtwork.js); this moves
// them and gives each control the semantics a person or a tool relies on.
//
// **The platform's own control is under every drawn one**, as src/ui/Dial.js does
// it: an invisible but focusable `<input>` laid over the control's hit area keeps
// the role, the value, every key and the focus order, and the artwork supplies
// pixels only. The hit area is padded to 44 CSS pixels by the stylesheet, so a
// small thumb in a large drawing is still a target.
//
// Like the generated panel it renders what the host says and not what it was
// asked for (messaging.md section 2.3): the input's own value moves with the
// pointer, the drawing moves in update().
import { attachDrag } from './Dial.js'
import { formatValue, spokenValue } from './PortText.js'

const clamp = (n, low, high) => Math.min(high, Math.max(low, n))
const fractionOf = (port, value) => {
  const span = port.maximum - port.minimum
  return span === 0 ? 0 : clamp((value - port.minimum) / span, 0, 1)
}

// An element may carry a transform of its own. The turn is appended, so it happens in the element's own
// coordinates, which is where the pivot's box is measured; the slide is prepended, so it happens in the
// parent's, along the track's axis.
const withTurn = (base, turn) => [base, turn].filter(Boolean).join(' ')
const withSlide = (base, slide) => [slide, base].filter(Boolean).join(' ')

/**
 * @param {Document} document
 * @param {{ svg: Element, elements: Map<string, Element>, controls: object[], ports: object[] }} skin
 *   controls are the kept ones from checkSkin; ports are the profile's
 * @param {(symbol: string, value: number) => void} onChange
 * @param {{ scope: string, measure?: (element: Element) => { x, y, width, height } }} options
 *   measure defaults to getBBox, which needs a layout; a test supplies its own
 * @returns {{ element: Element, update: (symbol: string, value: number) => void, fit: () => void, bound: Set<string> }}
 *   fit() places the hit areas and the pivots, and is called once the element is in the document and again on resize
 */
export function createSkinPanel (document, skin, onChange, { scope, measure = el => el.getBBox() }) {
  const wrap = document.createElement('div')
  wrap.className = 'skin'
  wrap.append(skin.svg)
  // The viewBox width is the artwork's natural size in CSS pixels: it shrinks to fit a narrow panel and does not grow
  // past what the author drew, so a 320 unit panel is not blown up to the width of a desktop and a 720 unit one is not
  // squeezed to a size where its text is small. Without a viewBox, fit() refuses the artwork.
  const natural = Number((skin.svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/)[2])
  if (Number.isFinite(natural) && natural > 0) wrap.style.maxWidth = `${natural}px`

  const ports = new Map(skin.ports.map(p => [p.symbol, p]))
  const renderers = new Map()   // symbol -> [function (value)]
  const fitters = []
  const hits = []     // { box, centre: { x, y }, height }, as last measured
  const bound = new Set()

  const render = (symbol, fn) => {
    if (!renderers.has(symbol)) renderers.set(symbol, [])
    renderers.get(symbol).push(fn)
  }

  // The invisible control and the box it sits in, placed over `target` by fit().
  function hitArea (control, port, input) {
    const box = document.createElement('div')
    box.className = 'skin-hit'
    const id = `${scope}#${port.symbol}`.replace(/[^\w-]/g, '_')
    input.id = id
    input.className = 'skin-input'
    // The drawing holds a visible label, but nothing ties it to the control, so the name is stated here.
    input.setAttribute('aria-label', port.name ?? port.symbol)
    box.append(input)
    wrap.append(box)
    const target = skin.elements.get(control.hitElement ?? control.element)
    const hit = { box, x: 0, y: 0, height: 0 }
    hits.push(hit)
    fitters.push(() => {
      const [vx, vy, vw, vh] = (skin.svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/).map(Number)
      if (![vx, vy, vw, vh].every(Number.isFinite) || vw <= 0 || vh <= 0) throw new Error('a skin artwork needs a viewBox, which is what the hit areas are placed by')
      const vb = { x: vx, y: vy, width: vw, height: vh }
      const b = measure(target)
      Object.assign(hit, { x: b.x + b.width / 2, y: b.y + b.height / 2, height: b.height })
      box.style.left = `${((b.x + b.width / 2 - vb.x) / vb.width) * 100}%`
      box.style.top = `${((b.y + b.height / 2 - vb.y) / vb.height) * 100}%`
      box.style.width = `${(b.width / vb.width) * 100}%`
      box.style.height = `${(b.height / vb.height) * 100}%`
    })
    return box
  }

  const rangeInput = (port, steps) => {
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(port.minimum)
    input.max = String(port.maximum)
    input.step = String(steps ?? (port.maximum - port.minimum) / 200)
    input.value = String(port.defaultValue)
    input.addEventListener('input', () => onChange(port.symbol, Number(input.value)))
    return input
  }

  for (const control of skin.controls) {
    const port = ports.get(control.boundSymbol)
    const element = skin.elements.get(control.element)

    if (control.kind === 'readout') {
      // Text for the eye. The control beside it reports its own value, so this is not read out a second time.
      element.setAttribute('aria-hidden', 'true')
      render(port.symbol, v => { element.textContent = formatValue(port, v) })
      continue
    }
    bound.add(port.symbol)

    if (control.kind === 'rotary') {
      const input = rangeInput(port)
      const box = hitArea(control, port, input)
      attachDrag(box, input, port)
      const base = element.getAttribute('transform') ?? ''
      const pivot = skin.elements.get(control.pivotElement ?? control.element)
      let centre = { x: 0, y: 0 }
      fitters.push(() => {
        const b = measure(pivot)
        centre = { x: b.x + b.width / 2, y: b.y + b.height / 2 }
      })
      render(port.symbol, v => {
        input.value = String(v)
        input.setAttribute('aria-valuetext', spokenValue(port, v))
        const angle = control.angleMin + (control.angleMax - control.angleMin) * fractionOf(port, v)
        element.setAttribute('transform', withTurn(base, `rotate(${angle} ${centre.x} ${centre.y})`))
      })
      // The centre is only known after fit(); draw again when it is.
      fitters.push(() => { const v = Number(input.value); renderers.get(port.symbol).forEach(f => f(v)) })
    } else if (control.kind === 'linear') {
      const input = rangeInput(port)
      const box = hitArea(control, port, input)
      const track = skin.elements.get(control.trackElement)
      const base = element.getAttribute('transform') ?? ''
      let travel = { dx: 0, dy: 0, horizontal: true }
      fitters.push(() => {
        const b = measure(track)
        const horizontal = b.width >= b.height
        travel = { dx: horizontal ? b.width : 0, dy: horizontal ? 0 : -b.height, horizontal }
      })
      attachTrackDrag(box, input, port, track, () => travel.horizontal)
      render(port.symbol, v => {
        input.value = String(v)
        input.setAttribute('aria-valuetext', spokenValue(port, v))
        if (!travel.horizontal) input.setAttribute('aria-orientation', 'vertical')
        const f = fractionOf(port, v)
        element.setAttribute('transform', withSlide(base, `translate(${travel.dx * f} ${travel.dy * f})`))
      })
      fitters.push(() => { const v = Number(input.value); renderers.get(port.symbol).forEach(f => f(v)) })
    } else if (control.kind === 'toggle') {
      const input = document.createElement('input')
      input.type = 'checkbox'
      input.setAttribute('role', 'switch')
      const box = hitArea(control, port, input)
      input.addEventListener('change', () => onChange(port.symbol, input.checked ? port.maximum : port.minimum))
      // The input takes no pointer, as the knob's does not, so the press is the box's.
      // Set and announced here rather than by input.click(), whose default action not every DOM performs.
      box.addEventListener('click', event => {
        if (event.target === input) return
        // The input takes no pointer, so the press cannot focus it; focus it here, so the keyboard continues where the hand was.
        input.focus?.()
        input.checked = !input.checked
        input.dispatchEvent(new (document.defaultView.Event)('change', { bubbles: true }))
      })
      const [off, on] = [...element.children]
      render(port.symbol, v => {
        const isOn = v >= 0.5
        input.checked = isOn
        input.setAttribute('aria-checked', String(isOn))
        off.setAttribute('display', isOn ? 'none' : 'inline')
        on.setAttribute('display', isOn ? 'inline' : 'none')
      })
    } else if (control.kind === 'selector') {
      const steps = port.scalePoints.length > 0 ? port.scalePoints.map(p => p.value) : null
      const count = steps ? steps.length : port.maximum - port.minimum + 1
      const input = document.createElement('input')
      input.type = 'range'
      input.min = '0'
      input.max = String(count - 1)
      input.step = '1'
      input.value = '0'
      const valueOf = index => (steps ? steps[index] : port.minimum + index)
      input.addEventListener('input', () => onChange(port.symbol, valueOf(Number(input.value))))
      const box = hitArea(control, port, input)
      // A press steps to the next position, wrapping: a selector has no drag, and cycling reaches every one.
      box.addEventListener('click', event => {
        if (event.target === input) return
        input.focus?.()
        input.value = String((Number(input.value) + 1) % count)
        input.dispatchEvent(new (document.defaultView.Event)('input', { bubbles: true }))
      })
      const groups = [...element.children]
      render(port.symbol, v => {
        const index = Math.max(0, steps ? steps.indexOf(v) : Math.round(v - port.minimum))
        input.value = String(index)
        groups.forEach((g, i) => g.setAttribute('display', i === index ? 'inline' : 'none'))
        input.setAttribute('aria-valuetext', port.scalePoints?.[index]?.label ?? String(valueOf(index)))
      })
    }
  }

  return {
    element: wrap,
    bound,
    update (symbol, value) { for (const fn of renderers.get(symbol) ?? []) fn(value) },
    fit () {
      for (const fn of fitters) fn()
      followThePicture(wrap, hits)
    }
  }
}

/**
 * Put the hit areas in reading order, so Tab goes through the controls the way the picture reads: rows from the
 * top, and left to right along a row. The skin document is a set of triples and has no order of its own, so the
 * order of the DOM would otherwise be the order the controls happened to be read in (WCAG 2.4.3). A box is only
 * moved when the order is wrong, because moving a focused element in the DOM drops its focus.
 */
function followThePicture (wrap, hits) {
  const byY = [...hits].sort((a, b) => a.y - b.y)
  const rows = []
  for (const hit of byY) {
    const row = rows.find(r => Math.abs(r.y - hit.y) < Math.max(r.height, hit.height) / 2)
    if (row) row.hits.push(hit)
    else rows.push({ y: hit.y, height: hit.height, hits: [hit] })
  }
  const wanted = rows.flatMap(r => r.hits.sort((a, b) => a.x - b.x)).map(h => h.box)
  const current = [...wrap.children].filter(child => wanted.includes(child))
  if (wanted.every((box, i) => box === current[i])) return
  for (const box of wanted) wrap.append(box)
}

/**
 * A press on a linear control sets the value where the pointer is along the track, and a drag follows
 * it. Absolute, unlike the knob: the thumb is drawn on the track, so the value belongs under the finger.
 * Listened for on the document and not by pointer capture, for the reason src/ui/Dial.js gives.
 */
function attachTrackDrag (box, input, port, track, isHorizontal) {
  const owner = box.ownerDocument
  const Event = owner.defaultView?.Event
  if (!Event) return

  let dragging = false
  const at = event => {
    const r = track.getBoundingClientRect()
    const t = isHorizontal() ? (event.clientX - r.left) / r.width : (r.bottom - event.clientY) / r.height
    const next = port.minimum + clamp(t, 0, 1) * (port.maximum - port.minimum)
    if (Number(input.value) === next) return
    input.value = String(next)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  }
  const move = event => { if (dragging) at(event) }
  const end = () => {
    if (!dragging) return
    dragging = false
    owner.removeEventListener('pointermove', move)
    owner.removeEventListener('pointerup', end)
    owner.removeEventListener('pointercancel', end)
  }
  box.addEventListener('pointerdown', event => {
    if (event.button !== undefined && event.button !== 0) return
    dragging = true
    input.focus?.()
    event.preventDefault?.()
    at(event)
    owner.addEventListener('pointermove', move)
    owner.addEventListener('pointerup', end)
    owner.addEventListener('pointercancel', end)
  })
}
