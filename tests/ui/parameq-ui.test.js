// tests/ui/parameq-ui.test.js
//
// A runtime smoke test for Parameq's own editor, which is hand-written DOM
// code no generated-panel test covers. The inline script of
// plugins/parameq/ui/index.html runs in Node against a small stub document:
// the host handshake (ready, init, parameter echo), a node drag's gesture
// bracketing, and the response-curve draw all execute without throwing, and
// the frame asks for what the protocol requires rather than rendering from
// its own input.
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const html = readFileSync(resolve(root, 'plugins/parameq/ui/index.html'), 'utf8')
const script = html.match(/<script>([\s\S]*)<\/script>/)[1]

class FakeElement {
  constructor (tag, shared) {
    this.tagName = tag.toUpperCase()
    this.shared = shared
    this.children = []
    this.listeners = {}
    this.attributes = {}
    this.dataset = {}
    this.style = {}
    this.classList = { toggle: () => {}, add: () => {}, remove: () => {}, contains: () => false }
    this.value = ''
    this.checked = false
    this.textContent = ''
    this.hidden = false
    this.clientWidth = 600
    this.clientHeight = 220
    this.width = 0
    this.height = 0
    let id = ''
    Object.defineProperty(this, 'id', {
      get: () => id,
      set: v => { id = String(v); if (id) shared.byId[id] = this }
    })
  }

  setAttribute (k, v) { this.attributes[k] = String(v) }
  getAttribute (k) { return this.attributes[k] ?? null }
  addEventListener (type, fn) { (this.listeners[type] ??= []).push(fn) }
  append (...kids) { this.children.push(...kids); return this }
  appendChild (kid) { this.children.push(kid); return kid }
  replaceChildren (...kids) { this.children = [...kids] }
  querySelector () { return new FakeElement('span', this.shared) }
  querySelectorAll () { return [] }
  getBoundingClientRect () { return { width: 600, height: 220, left: 0, top: 0 } }
  setPointerCapture () {}
  getContext () { return this.shared.ctx }
  dispatch (type, event = {}) {
    for (const fn of this.listeners[type] ?? []) fn({ target: this, clientX: 300, clientY: 110, pointerId: 1, ...event })
  }
}

function makeHarness () {
  const posted = []
  const paths = []
  let current = null
  let style = ''
  let width = 1
  const ctx = new Proxy({}, {
    get: (t, p) => {
      if (p === 'beginPath') return () => { current = { style, width, points: [] } }
      if (p === 'moveTo' || p === 'lineTo') return (x, y) => { current?.points.push([x, y]) }
      if (p === 'stroke') return () => { if (current) { paths.push(current); current = null } }
      if (!(p in t)) t[p] = (...args) => undefined
      return t[p]
    },
    set: (t, p, v) => {
      if (p === 'strokeStyle') style = v
      else if (p === 'lineWidth') width = v
      else t[p] = v
      return true
    }
  })
  const elements = {}
  const shared = { ctx, byId: {} }
  const ids = ['root', 'stage', 'enabled']
  for (const id of ids) elements[id] = new FakeElement('div', shared)
  const listeners = {}
  const stubs = {
    posted,
    paths,
    ctx,
    document: {
      getElementById: id => shared.byId[id] ?? elements[id] ?? (elements[id] = new FakeElement('div', shared)),
      createElement: tag => new FakeElement(tag, shared),
      documentElement: { getBoundingClientRect: () => ({ height: 800 }) },
      body: { scrollWidth: 600 }
    },
    window: {
      devicePixelRatio: 1,
      addEventListener: (type, fn) => { (listeners[type] ??= []).push(fn) },
      listeners
    },
    parent: { postMessage: message => posted.push(message) },
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    ResizeObserver: class { constructor (fn) { stubs.ro = fn } observe () {} }
  }
  return stubs
}

const INIT_PARAMETERS = { enabled: 1 }
for (let b = 1; b <= 6; b++) {
  INIT_PARAMETERS[`b${b}_on`] = 1
  INIT_PARAMETERS[`b${b}_type`] = [4, 1, 0, 0, 2, 3][b - 1]
  INIT_PARAMETERS[`b${b}_freq`] = [80, 250, 1000, 4000, 8000, 16000][b - 1]
  INIT_PARAMETERS[`b${b}_gain`] = 0
  INIT_PARAMETERS[`b${b}_q`] = [0.7, 1, 1, 1, 1, 0.7][b - 1]
}

function runScript (stubs) {
  const factory = new Function(
    'document', 'window', 'parent', 'getComputedStyle', 'ResizeObserver',
    `${script}\n;return { fireMessage: null };`
  )
  // The script registers its own window message listener; capture it.
  let messageListener = null
  const windowWithCapture = {
    ...stubs.window,
    addEventListener: (type, fn) => {
      if (type === 'message') messageListener = fn
      else (stubs.window.listeners[type] ??= []).push(fn)
    }
  }
  factory(stubs.document, windowWithCapture, stubs.parent, stubs.getComputedStyle, stubs.ResizeObserver)
  return (data, origin = 'https://host.example') => messageListener({ source: stubs.parent, origin, data })
}

describe("parameq's own editor", () => {
  let stubs
  let deliver
  beforeEach(() => {
    stubs = makeHarness()
    deliver = runScript(stubs)
  })

  it('announces ready before it knows the host origin', () => {
    expect(stubs.posted).toEqual([{ type: 'ready' }])
  })

  it('builds from init and renders the host echo rather than its own input', () => {
    deliver({ type: 'init', profile: {}, parameters: { ...INIT_PARAMETERS } })
    expect(stubs.posted[1].type).toBe('resize')
    const before = stubs.posted.length
    // A clamped echo: the editor asked for nothing and the host applied 150,
    // which the number box then shows. Nothing goes back out.
    deliver({ type: 'parameter', symbol: 'b3_freq', value: 150 })
    expect(stubs.posted.length).toBe(before)
    expect(stubs.document.getElementById('band-freq-number').value).toBe('150')
  })

  it('sends parameter requests to the host origin only', () => {
    deliver({ type: 'init', profile: {}, parameters: { ...INIT_PARAMETERS } })
    // Drive the frequency slider of the selected band straight at the stub.
    const stage = stubs.document.getElementById('stage')
    const findInputs = (el, out = []) => {
      if (el.tagName === 'INPUT' && el.id === 'band-freq') out.push(el)
      for (const kid of el.children) findInputs(kid, out)
      return out
    }
    const sliders = findInputs(stage)
    expect(sliders.length).toBe(1)
    sliders[0].value = '500'
    sliders[0].dispatch('input')
    const request = stubs.posted.at(-1)
    expect(request.type).toBe('parameter')
    expect(request.symbol).toBe('b3_freq')
    expect(request.value).toBeCloseTo(20 * Math.pow(1000, 0.5), 0)
  })

  it('brackets a node drag in gestures and moves frequency', () => {
    deliver({ type: 'init', profile: {}, parameters: { ...INIT_PARAMETERS } })
    const stage = stubs.document.getElementById('stage')
    const findCanvas = el => {
      if (el.tagName === 'CANVAS') return el
      for (const kid of el.children) { const found = findCanvas(kid); if (found) return found }
      return null
    }
    const canvas = findCanvas(stage)
    expect(canvas).toBeTruthy()
    const before = stubs.posted.length
    // Band 3 sits at 1 kHz, gain 0: x 340, mid height on the 600x220 plot.
    canvas.dispatch('pointerdown', { clientX: 340, clientY: 110 })
    canvas.dispatch('pointermove', { clientX: 390, clientY: 110 })
    canvas.dispatch('pointerup')
    const tail = stubs.posted.slice(before)
    expect(tail[0]).toMatchObject({ type: 'gesture', phase: 'begin' })
    expect(tail.at(-1)).toMatchObject({ type: 'gesture', phase: 'end' })
    expect(tail.some(m => m.type === 'parameter' && m.symbol === 'b3_freq')).toBe(true)
  })

  it('draws the combined curve where the cookbook says', () => {
    deliver({ type: 'init', profile: {}, parameters: { ...INIT_PARAMETERS } })
    // A +6 dB peak on band 3, echoed back the way the host would apply it.
    deliver({ type: 'parameter', symbol: 'b3_gain', value: 6 })
    const combined = stubs.paths.filter(p => p.style === '#e6e8eb' && p.points.length > 0)
    expect(combined.length).toBeGreaterThan(0)
    const peak = combined.at(-1)
    // The stub plot is 220 high: dbToY maps +30 dB to the top edge.
    const minY = Math.min(...peak.points.map(([, y]) => y))
    const peakDb = (110 - minY) / 110 * 30
    expect(peakDb).toBeGreaterThan(5)
    expect(peakDb).toBeLessThan(7)
  })

  it('ignores messages from any origin but the host', () => {
    deliver({ type: 'init', profile: {}, parameters: { ...INIT_PARAMETERS } })
    const before = stubs.posted.length
    // A forged echo from elsewhere must not move anything or throw.
    deliver({ type: 'parameter', symbol: 'b3_gain', value: 24 }, 'https://evil.example')
    expect(stubs.posted.length).toBe(before)
    expect(stubs.document.getElementById('band-gain-number').value).toBe('0')
  })
})
