// src/ui/EnvelopeLane.js
//
// One automation lane: a parameter's envelope drawn on the same beats as the lanes above it, with each
// point a button you can reach by Tab, and a line drawn between them for the eye.
//
// Keyboard first. On a point: Left and Right move it in time by a grid step (never past a neighbour),
// Up and Down change its value by a fiftieth of the range (Shift a two hundredth), C cycles how the
// value leaves it (step, linear, smooth) and Delete removes it. Add point, in the lane's header, puts
// a new one a bar after the last. A pointer does the same: drag a point, or click on empty lane to add one.
// Every gesture is one request with the whole new list of points, so one undo takes it back
// (`setEnvelope` replaces the list at once).
//
// A point says what it is in words: the parameter, its value with the unit spoken out, where it is and
// how it leaves. The line is drawn aria-hidden; it carries nothing the points do not say.
//
// Points are named by their place in the list, which is sorted by beat and never reordered by a move,
// so the focus can be put back on the same point after the redraw an edit causes (src/ui/Focus.js).
import { setIcon } from './Icons.js'

const SVG_NS = 'http://www.w3.org/2000/svg'
export const CURVE_ORDER = ['step', 'linear', 'smooth']
export const LANE_HEIGHT = 96
const DRAG_SLOP = 3

const smooth = u => u * u * (3 - 2 * u)

/** The SVG path of an envelope over `width` pixels: what the value does, for the eye. */
export function envelopePath (points, { ppb, height, min, max, width }) {
  if (points.length === 0) return ''
  const x = beat => beat * ppb
  const y = value => (1 - (value - min) / (max - min)) * height
  const parts = [`M 0 ${y(points[0].value)}`, `L ${x(points[0].atBeat)} ${y(points[0].value)}`]
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (a.curve === 'step') parts.push(`L ${x(b.atBeat)} ${y(a.value)}`, `L ${x(b.atBeat)} ${y(b.value)}`)
    else if (a.curve === 'smooth') {
      for (let k = 1; k <= 16; k++) {
        const u = k / 16
        parts.push(`L ${x(a.atBeat + (b.atBeat - a.atBeat) * u)} ${y(a.value + (b.value - a.value) * smooth(u))}`)
      }
    } else parts.push(`L ${x(b.atBeat)} ${y(b.value)}`)
  }
  const last = points[points.length - 1]
  parts.push(`L ${Math.max(width, x(last.atBeat))} ${y(last.value)}`)
  return parts.join(' ')
}

export function createEnvelopeLane (document, { onChange, onRemove, view }) {
  for (const [name, fn] of Object.entries({ onChange, onRemove })) {
    if (typeof fn !== 'function') throw new Error(`createEnvelopeLane needs ${name}`)
  }
  if (!view) throw new Error('createEnvelopeLane needs view, the shared TimeView')

  const element = document.createElement('div')
  element.className = 'envelope-lane'
  element.setAttribute('role', 'group')
  const head = document.createElement('div')
  head.className = 'envelope-head'
  const title = document.createElement('span')
  title.className = 'envelope-title'
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'envelope-add'
  add.textContent = 'Add point'
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.className = 'envelope-remove'
  head.append(title, add, remove)
  const body = document.createElement('div')
  body.className = 'envelope-body'
  const svg = document.createElementNS(SVG_NS, 'svg')
  svg.setAttribute('class', 'envelope-line')
  svg.setAttribute('aria-hidden', 'true')
  svg.setAttribute('focusable', 'false')
  const path = document.createElementNS(SVG_NS, 'path')
  svg.append(path)
  body.append(svg)
  element.append(head, body)

  let current = null
  let shown = { beatsPerBar: 4, width: 0 }
  const ppb = () => view.pixelsPerBeat
  const step = () => view.step(shown.beatsPerBar) ?? 0.25

  const clampValue = v => Math.min(current.max, Math.max(current.min, v))
  const valueAtY = y => clampValue(current.max - (Math.min(LANE_HEIGHT, Math.max(0, y)) / LANE_HEIGHT) * (current.max - current.min))
  const yOfValue = v => (1 - (v - current.min) / (current.max - current.min)) * LANE_HEIGHT
  const commit = points => onChange(current.id, points.map(p => ({ atBeat: p.atBeat, value: p.value, curve: p.curve })))

  /** Where point `index` may be in time: strictly between its neighbours, never before the start. */
  const limits = index => ({
    low: index === 0 ? 0 : current.points[index - 1].atBeat + 1e-6,
    high: index === current.points.length - 1 ? Infinity : current.points[index + 1].atBeat - 1e-6
  })

  const describe = (point) =>
    `${current.label}, ${current.speak(point.value)} at ${current.where(point.atBeat)}, ${point.curve}`

  function pointButton (point, index) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'envelope-point'
    button.id = `env-${current.id}-p${index}`
    const dot = document.createElement('span')
    dot.className = 'envelope-dot'
    dot.setAttribute('aria-hidden', 'true')
    button.append(dot)
    const label = describe(point)
    button.setAttribute('aria-label', label)
    button.title = label
    button.style.left = `${point.atBeat * ppb() - 22}px`
    button.style.top = `${yOfValue(point.value) - 22}px`

    button.addEventListener('keydown', event => {
      const all = current.points
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault()
        const { low, high } = limits(index)
        const next = point.atBeat + (event.key === 'ArrowRight' ? step() : -step())
        if (next < low || next > high) return
        commit(all.map((p, i) => (i === index ? { ...p, atBeat: next } : p)))
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        const delta = ((current.max - current.min) / (event.shiftKey ? 200 : 50)) * (event.key === 'ArrowUp' ? 1 : -1)
        const value = clampValue(point.value + delta)
        if (value !== point.value) commit(all.map((p, i) => (i === index ? { ...p, value } : p)))
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        commit(all.filter((_, i) => i !== index))
      } else if (event.key.toLowerCase() === 'c' && !event.ctrlKey && !event.metaKey && !event.altKey) {
        event.preventDefault()
        const curve = CURVE_ORDER[(CURVE_ORDER.indexOf(point.curve) + 1) % CURVE_ORDER.length]
        commit(all.map((p, i) => (i === index ? { ...p, curve } : p)))
      }
    })

    // A drag is followed on the document once the pointer is down, not on the point: it must not stop at
    // the point's own edge (CLAUDE.md, interface rules). Nothing is written until the release.
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      const origin = { x: event.clientX, y: event.clientY }
      const rect = body.getBoundingClientRect()
      let moved = false
      let landed = { atBeat: point.atBeat, value: point.value }
      const place = e => {
        const { low, high } = limits(index)
        const beat = view.snap((e.clientX - rect.left) / ppb(), shown.beatsPerBar, { bypass: e.altKey })
        landed = { atBeat: Math.min(high, Math.max(low, beat)), value: valueAtY(e.clientY - rect.top) }
        button.style.left = `${landed.atBeat * ppb() - 22}px`
        button.style.top = `${yOfValue(landed.value) - 22}px`
      }
      const move = e => {
        if (!moved && Math.hypot(e.clientX - origin.x, e.clientY - origin.y) < DRAG_SLOP) return
        moved = true
        place(e)
      }
      const up = () => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        if (moved) commit(current.points.map((p, i) => (i === index ? { ...p, ...landed } : p)))
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    })
    return button
  }

  // A click on empty lane adds a point there.
  body.addEventListener('pointerdown', event => {
    if (event.button !== 0 || (event.target !== body && event.target !== svg && event.target !== path)) return
    const rect = body.getBoundingClientRect()
    const atBeat = view.snap((event.clientX - rect.left) / ppb(), shown.beatsPerBar, { bypass: event.altKey })
    if (current.points.some(p => Math.abs(p.atBeat - atBeat) < 1e-6)) return
    const value = valueAtY(event.clientY - rect.top)
    commit([...current.points, { atBeat, value, curve: 'linear' }].sort((a, b) => a.atBeat - b.atBeat))
  })

  // Add point: a bar after the last, at the last value; or at the start, at `start`, when there are none.
  add.addEventListener('click', () => {
    const last = current.points.at(-1)
    const next = last
      ? { atBeat: last.atBeat + shown.beatsPerBar, value: last.value, curve: 'linear' }
      : { atBeat: 0, value: clampValue(current.start), curve: 'linear' }
    commit([...current.points, next])
  })
  remove.addEventListener('click', () => onRemove(current.id))
  setIcon(document, remove, 'delete', 'Remove lane')

  return {
    element,
    /**
     * `lane` is `{ id, label, min, max, start, points, speak(value), where(beat) }`: `start` the value a first
     * point takes, `speak` a value in words, `where` a beat as "bar 2 beat 1".
     */
    update (lane, { beatsPerBar, width }) {
      current = lane
      shown = { beatsPerBar, width }
      element.setAttribute('aria-label', `Automation: ${lane.label}`)
      title.textContent = `Automation: ${lane.label}`
      remove.setAttribute('aria-label', `Remove the automation lane for ${lane.label}`)
      add.setAttribute('aria-label', `Add a point to ${lane.label}`)
      body.style.width = `${width}px`
      body.style.height = `${LANE_HEIGHT}px`
      svg.setAttribute('width', String(width))
      svg.setAttribute('height', String(LANE_HEIGHT))
      path.setAttribute('d', envelopePath(lane.points, { ppb: ppb(), height: LANE_HEIGHT, min: lane.min, max: lane.max, width }))
      body.replaceChildren(svg, ...lane.points.map(pointButton))
    }
  }
}
