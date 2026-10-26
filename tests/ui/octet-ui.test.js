// tests/ui/octet-ui.test.js
//
// Octet's own editor is hand-written DOM and canvas code that no generated-panel test covers, and its whole job is a
// protocol with a host it cannot see into. The inline script of plugins/octet/ui/index.html runs here against a DOM
// (linkedom) with a recording canvas: the handshake, what it sends and to which origin, that it renders from what the host
// says and never from its own input, a node drag's gestures, the wheel, the keys, and the spectrum the processor sends.
// Real pointer and focus behaviour is checked in a browser, since a DOM without a renderer proves neither.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const html = readFileSync(resolve(root, 'plugins/octet/ui/index.html'), 'utf8')
const script = html.match(/<script>([\s\S]*)<\/script>/)[1]
const HOST = 'https://host.example'

// The plot, as the script lays it out for a 600 by 300 canvas: 38 px of margin on the left, 10 on the right, 10 above and 22
// below, 20 Hz to 20 kHz across and plus and minus 24 dB down.
const PLOT = { x: 38, y: 10, w: 552, h: 268 }
const xOf = hz => PLOT.x + Math.log(hz / 20) / Math.log(1000) * PLOT.w
const yOf = db => PLOT.y + (24 - db) / 48 * PLOT.h

function harness () {
  const { document, window } = parseHTML(html.replace(/<script>[\s\S]*<\/script>/, ''))
  const posted = []
  const parent = { postMessage: (message, target) => posted.push({ message, target }) }
  const calls = { fillRect: [], fillText: [], strokes: 0, arcs: 0 }
  const ctx = new Proxy({}, {
    get: (t, p) => {
      if (p === 'fillRect') return (...a) => calls.fillRect.push(a)
      if (p === 'fillText') return (...a) => calls.fillText.push(a)
      if (p === 'stroke') return () => { calls.strokes++ }
      if (p === 'arc') return () => { calls.arcs++ }
      if (!(p in t)) t[p] = () => undefined
      return t[p]
    },
    set: (t, p, v) => { t[p] = v; return true }
  })
  const create = document.createElement.bind(document)
  document.createElement = tag => {
    const el = create(tag)
    // linkedom gives a select a value it can read and not set, which a real one can do.
    if (tag === 'select') {
      let chosen = ''
      Object.defineProperty(el, 'value', { get: () => chosen, set: v => { chosen = String(v) }, configurable: true })
    }
    if (tag === 'canvas') {
      el.getContext = () => ctx
      el.getBoundingClientRect = () => ({ left: 0, top: 0, width: 600, height: 300 })
      el.setPointerCapture = () => {}
      Object.defineProperty(el, 'clientWidth', { value: 600 })
      Object.defineProperty(el, 'clientHeight', { value: 300 })
    }
    return el
  }
  document.documentElement.getBoundingClientRect = () => ({ height: 900, width: 600 })
  Object.defineProperty(document.body, 'scrollWidth', { value: 600 })
  const frames = []
  window.requestAnimationFrame = fn => { frames.push(fn) }
  window.devicePixelRatio = 1
  const env = {
    document, window, parent,
    getComputedStyle: () => ({ getPropertyValue: () => '#888' }),
    requestAnimationFrame: window.requestAnimationFrame,
    ResizeObserver: class { observe () {} }
  }
  new Function(...Object.keys(env), `${script}`)(...Object.values(env))

  const event = (type, props = {}) => {
    const e = new window.Event(type, { bubbles: true, cancelable: true })
    for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
    return e
  }
  const fromHost = (data, origin = HOST, source = parent) => window.dispatchEvent(event('message', { data, origin, source }))
  const flush = () => { while (frames.length) frames.shift()() }
  const sent = type => posted.filter(p => p.message.type === type)
  const requests = () => sent('parameter').map(p => [p.message.symbol, p.message.value])
  const canvas = () => document.getElementById('plot')
  const $ = id => document.getElementById(id)
  return { document, window, posted, calls, event, fromHost, flush, sent, requests, canvas, $, parent }
}

const init = (h, parameters = {}) => h.fromHost({ type: 'init', profile: {}, parameters, capabilities: [] })

describe('the handshake', () => {
  it('says ready to any origin when it loads, and sends nothing else before the host speaks', () => {
    const h = harness()
    expect(h.posted).toEqual([{ message: { type: 'ready' }, target: '*' }])
  })

  it('ignores everything until init, and a message that is not from its parent', () => {
    const h = harness()
    h.fromHost({ type: 'parameter', symbol: 'output', value: 3 })
    h.fromHost({ type: 'init', parameters: {} }, HOST, {})
    expect(h.canvas()).toBeNull()
    expect(h.posted).toHaveLength(1)
  })

  it('builds the editor on init and addresses everything after to the origin the init came from', () => {
    const h = harness()
    init(h)
    expect(h.canvas()).not.toBeNull()
    const after = h.posted.slice(1)
    expect(after.length).toBeGreaterThan(0)
    for (const p of after) expect(p.target).toBe(HOST)
    expect(h.sent('resize')[0].message.height).toBeGreaterThan(0)
  })

  it('refuses a message from another origin once it knows the host', () => {
    const h = harness()
    init(h)
    h.fromHost({ type: 'parameter', symbol: 'band3_type', value: 1 }, 'https://evil.example')
    expect(h.$('band-type').value).toBe('3')
    h.fromHost({ type: 'parameter', symbol: 'band3_type', value: 1 })
    expect(h.$('band-type').value).toBe('1')
  })

  it('takes the parameter values the init carries, and keeps the defaults for the rest', () => {
    const h = harness()
    init(h, { band3_freq: 1234, output: 3 })
    h.flush()
    h.canvas().dispatchEvent(h.event('focus'))
    expect(h.$('band-freq-number').value).toBe('1234')
    expect(h.$('output-level-number').value).toBe('3')
    expect(h.$('cc-channel').value).toBe('1')
  })
})

describe('what the controls show and ask for', () => {
  let h
  beforeEach(() => { h = harness(); init(h) })

  it('draws a node for each of eight bands, in a strip named for the plot\'s own states', () => {
    const buttons = h.document.querySelectorAll('.bands button')
    expect(buttons).toHaveLength(8)
    expect(buttons[2].getAttribute('aria-label')).toBe('Band 3, Bell, 250 Hz, +0.0 dB, Q 1.00, on')
    expect(buttons[0].getAttribute('aria-label')).toBe('Band 1, HP 48, 30 Hz, off')
    expect(buttons[0].getAttribute('aria-pressed')).toBe('false')
    expect(buttons[2].getAttribute('aria-pressed')).toBe('true')
  })

  it('leaves out the gain of a cut and the Q of a cut, since nothing they do could be heard', () => {
    h.fromHost({ type: 'parameter', symbol: 'band3_type', value: 1 })
    expect(h.$('band-gain').parentElement.hidden).toBe(true)
    expect(h.$('band-gain-number').parentElement.hidden).toBe(true)
    expect(h.$('band-q').parentElement.hidden).toBe(true)
    h.fromHost({ type: 'parameter', symbol: 'band3_type', value: 4 })   // a notch has a Q and no gain
    expect(h.$('band-gain').parentElement.hidden).toBe(true)
    expect(h.$('band-q').parentElement.hidden).toBe(false)
    h.fromHost({ type: 'parameter', symbol: 'band3_type', value: 3 })
    expect(h.$('band-gain').parentElement.hidden).toBe(false)
  })

  it('leaves out the channel choice in Stereo mode and names the channels for the mode', () => {
    const row = () => h.document.querySelector('.segments input[name="channel"]').closest('.row')
    expect(row().hidden).toBe(true)
    h.fromHost({ type: 'parameter', symbol: 'mode', value: 2 })
    expect(row().hidden).toBe(false)
    expect([...row().querySelectorAll('span')].map(s => s.textContent).slice(1)).toEqual(['M + S', 'Mid', 'Side'])
    h.fromHost({ type: 'parameter', symbol: 'mode', value: 1 })
    expect([...row().querySelectorAll('span')].map(s => s.textContent).slice(1)).toEqual(['L + R', 'Left', 'Right'])
  })

  it('asks for a change and shows it only when the host says it took effect', () => {
    h.$('band-type').value = '5'
    h.$('band-type').dispatchEvent(h.event('change'))
    expect(h.requests()).toContainEqual(['band3_type', 5])
    // Nothing has come back, so the band is still what it was.
    expect(h.document.querySelectorAll('.bands button')[2].querySelector('.t').textContent).toBe('Bell')
    h.fromHost({ type: 'parameter', symbol: 'band3_type', value: 2 })   // the host clamped or chose otherwise
    expect(h.document.querySelectorAll('.bands button')[2].querySelector('.t').textContent).toBe('Low shelf')
  })

  it('maps the frequency and Q sliders logarithmically, and a typed value is clamped to the range', () => {
    const freq = h.$('band-freq')
    freq.value = '500'
    freq.dispatchEvent(h.event('input'))
    const [, hz] = h.requests().find(([symbol]) => symbol === 'band3_freq')
    expect(hz).toBeCloseTo(20 * 1000 ** 0.5, 6)
    const number = h.$('band-freq-number')
    number.value = '99999'
    number.dispatchEvent(h.event('change'))
    expect(h.requests().filter(([s]) => s === 'band3_freq').at(-1)[1]).toBe(20000)
    const q = h.$('band-q')
    q.value = '0'
    q.dispatchEvent(h.event('input'))
    expect(h.requests().filter(([s]) => s === 'band3_q').at(-1)[1]).toBeCloseTo(0.1, 9)
  })

  it('brackets a slider drag as one gesture for the control it moves', () => {
    const gain = h.$('band-gain')
    gain.dispatchEvent(h.event('pointerdown'))
    gain.dispatchEvent(h.event('pointerup'))
    expect(h.sent('gesture').map(g => [g.message.symbol, g.message.phase])).toEqual([['band3_gain', 'begin'], ['band3_gain', 'end']])
  })

  it('chooses the stereo mode, the spectrum tap, the CC channel and the CC band', () => {
    const radio = (name, value) => {
      const input = [...h.document.querySelectorAll(`input[name="${name}"]`)].find(i => i.value === String(value))
      input.checked = true
      input.dispatchEvent(h.event('change'))
    }
    radio('mode', 2)
    radio('source', 0)
    h.$('cc-channel').value = '40'
    h.$('cc-channel').dispatchEvent(h.event('change'))
    h.$('cc-band').value = '6'
    h.$('cc-band').dispatchEvent(h.event('change'))
    expect(h.requests()).toEqual(expect.arrayContaining([['mode', 2], ['spectrum_source', 0], ['cc_channel', 16], ['cc_band', 6]]))
  })

  it('switches a band with its checkbox and chooses a band from the strip', () => {
    h.document.querySelectorAll('.bands button')[0].dispatchEvent(h.event('click'))
    expect(h.$('band-on').checked).toBe(false)
    h.$('band-on').checked = true
    h.$('band-on').dispatchEvent(h.event('change'))
    expect(h.requests()).toContainEqual(['band1_on', 1])
  })
})

describe('the plot', () => {
  let h
  beforeEach(() => { h = harness(); init(h); h.flush() })
  const pointer = (type, x, y, props = {}) => h.canvas().dispatchEvent(h.event(type, { button: 0, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', ...props }))

  it('draws the grid, a curve for each active band and the total, and a node for every band', () => {
    h.flush()
    expect(h.calls.strokes).toBeGreaterThan(5)
    expect(h.calls.arcs).toBeGreaterThanOrEqual(8)
    expect(h.calls.fillText.some(([t]) => t === '1 k')).toBe(true)
    expect(h.calls.fillText.map(([t]) => t)).toEqual(expect.arrayContaining(['1', '2', '3', '4', '5', '6', '7', '8']))
  })

  it('drags a node for frequency and gain as one gesture, rendering only from what comes back', () => {
    const x0 = xOf(250), y0 = yOf(0)
    pointer('pointerdown', x0, y0)
    expect(h.sent('gesture').map(g => [g.message.symbol, g.message.phase])).toEqual([['band3_freq', 'begin'], ['band3_gain', 'begin']])
    const x1 = xOf(2000), y1 = yOf(9)
    pointer('pointermove', x1, y1)
    const asked = Object.fromEntries(h.requests())
    expect(asked.band3_freq).toBeCloseTo(2000, 0)
    expect(asked.band3_gain).toBeCloseTo(9, 1)
    expect(h.$('band-freq-number').value).toBe('250')   // not moved until the host says so
    pointer('pointerup', x1, y1)
    expect(h.sent('gesture').slice(2).map(g => [g.message.symbol, g.message.phase])).toEqual([['band3_freq', 'end'], ['band3_gain', 'end']])
    h.fromHost({ type: 'parameter', symbol: 'band3_freq', value: 2001 })
    expect(h.$('band-freq-number').value).toBe('2001')
  })

  it('clamps a dragged gain to the band\'s range, though the plot runs wider', () => {
    pointer('pointerdown', xOf(250), yOf(0))
    pointer('pointermove', xOf(250), yOf(24))
    expect(h.requests().filter(([s]) => s === 'band3_gain').at(-1)[1]).toBe(18)
    pointer('pointermove', xOf(250), yOf(-24))
    expect(h.requests().filter(([s]) => s === 'band3_gain').at(-1)[1]).toBe(-18)
    pointer('pointerup', xOf(250), yOf(-24))
  })

  it('turns on a band that is off when it is grabbed, so a drag always has a result, and drags a cut by frequency only', () => {
    pointer('pointerdown', xOf(30), yOf(0))
    expect(h.requests()).toContainEqual(['band1_on', 1])
    expect(h.sent('gesture').map(g => g.message.symbol)).toEqual(['band1_freq'])
    pointer('pointermove', xOf(80), yOf(10))
    expect(h.requests().some(([s]) => s === 'band1_gain')).toBe(false)
    pointer('pointerup', xOf(80), yOf(10))
  })

  it('does nothing for a press on empty plot, or with another button', () => {
    pointer('pointerdown', xOf(60), yOf(15))
    pointer('pointerdown', xOf(250), yOf(0), { button: 2 })
    expect(h.sent('gesture')).toEqual([])
    expect(h.requests()).toEqual([])
  })

  it('reaches further for a finger than for a mouse', () => {
    pointer('pointerdown', xOf(250) + 20, yOf(0), { pointerType: 'mouse' })
    expect(h.sent('gesture')).toEqual([])
    pointer('pointerdown', xOf(250) + 20, yOf(0), { pointerType: 'touch' })
    expect(h.sent('gesture').length).toBe(2)
    pointer('pointerup', 0, 0)
  })

  it('changes the selected band\'s Q with the wheel, up for up, and leaves a band without a Q to scroll the page', () => {
    const wheel = deltaY => {
      const e = h.event('wheel', { clientX: xOf(1000), clientY: yOf(0), deltaY, deltaMode: 0 })
      h.canvas().dispatchEvent(e)
      return e
    }
    const up = wheel(-100)
    expect(up.defaultPrevented).toBe(true)
    expect(h.requests().at(-1)[0]).toBe('band3_q')
    expect(h.requests().at(-1)[1]).toBeCloseTo(1.12, 6)
    wheel(100)
    expect(h.requests().at(-1)[1]).toBeCloseTo(1 / 1.12, 6)
    h.fromHost({ type: 'parameter', symbol: 'band3_type', value: 1 })
    const before = h.requests().length
    expect(wheel(-100).defaultPrevented).toBe(false)
    expect(h.requests()).toHaveLength(before)
  })

  describe('from the keyboard', () => {
    const key = (k, props = {}) => {
      const e = h.event('keydown', { key: k, ...props })
      h.canvas().dispatchEvent(e)
      return e
    }

    it('is reachable and describes itself', () => {
      expect(h.canvas().getAttribute('tabindex')).toBe('0')
      expect(h.canvas().getAttribute('aria-label')).toMatch(/Number keys 1 to 8/)
      h.canvas().dispatchEvent(h.event('focus'))
      expect(h.document.querySelector('[role=status]').textContent).toBe('Band 3, Bell, 250 Hz, +0.0 dB, Q 1.00, on')
    })

    it('chooses a band with 1 to 8 and says which', () => {
      key('6')
      expect(h.document.querySelector('[role=status]').textContent).toMatch(/^Band 6, Bell, 4\.00 kHz/)
      key('3')
      key('ArrowUp')
      expect(h.requests().at(-1)[0]).toBe('band3_gain')
    })

    it('moves frequency by a semitone, gain by half a decibel and Q by a step, with Shift for more and Alt for less', () => {
      key('ArrowRight')
      expect(h.requests().at(-1)).toEqual(['band3_freq', expect.closeTo(250 * 2 ** (1 / 12), 6)])
      key('ArrowLeft', { shiftKey: true })
      expect(h.requests().at(-1)).toEqual(['band3_freq', expect.closeTo(250 * 2 ** (-4 / 12), 6)])
      key('ArrowUp')
      expect(h.requests().at(-1)).toEqual(['band3_gain', 0.5])
      key('ArrowDown', { altKey: true })
      expect(h.requests().at(-1)).toEqual(['band3_gain', -0.125])
      key('PageUp')
      expect(h.requests().at(-1)).toEqual(['band3_q', expect.closeTo(1.12, 6)])
    })

    it('switches the band with Enter, and handles no key it does not use', () => {
      key('Enter')
      expect(h.requests().at(-1)).toEqual(['band3_on', 0])
      expect(key('Tab').defaultPrevented).toBe(false)
      expect(key('ArrowRight', { ctrlKey: true }).defaultPrevented).toBe(false)
    })

    it('does nothing for the gain of a cut, which has none', () => {
      h.fromHost({ type: 'parameter', symbol: 'band3_type', value: 1 })
      const before = h.requests().length
      key('ArrowUp')
      key('PageUp')
      expect(h.requests()).toHaveLength(before)
    })
  })
})

describe('the spectrum the processor sends', () => {
  let h
  beforeEach(() => { h = harness(); init(h); h.flush(); h.calls.fillRect.length = 0 })
  const levels = fn => Float32Array.from({ length: 64 }, (_, k) => fn(k))
  const plugin = payload => { h.fromHost({ type: 'plugin', payload }); h.flush() }

  it('draws a bar for each band above the floor, behind the curves', () => {
    plugin({ rate: 48000, source: 2, levels: levels(k => (k === 10 ? -20 : k === 42 ? -3 : -90)) })
    expect(h.calls.fillRect).toHaveLength(2)
    const [x, y, w, bar] = h.calls.fillRect.find(r => Math.abs(r[0] - (PLOT.x + 42 * PLOT.w / 64 - -0.5)) < 1)
    expect(w).toBeCloseTo(PLOT.w / 64 - 1, 6)
    expect(bar).toBeCloseTo((87 / 90) * PLOT.h * 0.9, 6)
    expect(y + bar).toBeCloseTo(PLOT.y + PLOT.h, 6)
    void x
  })

  it('says which tap it is drawing, and draws nothing when the host says the analyser is off', () => {
    plugin({ rate: 48000, source: 2, levels: levels(() => -30) })
    expect(h.calls.fillText.some(([t]) => t === 'spectrum: after the EQ')).toBe(true)
    h.fromHost({ type: 'parameter', symbol: 'spectrum_source', value: 1 })
    h.flush()
    expect(h.calls.fillText.some(([t]) => t === 'spectrum: before the EQ')).toBe(true)
    h.calls.fillRect.length = 0
    h.fromHost({ type: 'parameter', symbol: 'spectrum_source', value: 0 })
    h.flush()
    expect(h.calls.fillRect).toEqual([])
  })

  it('takes a plain array as well as a typed one, and limits a level to the scale', () => {
    plugin({ rate: 48000, source: 2, levels: Array.from({ length: 64 }, () => 40) })
    const [, , , bar] = h.calls.fillRect[0]
    expect(bar).toBeCloseTo(PLOT.h * 0.9, 6)   // 6 dB is above the 0 dB the bar tops out at, so it is full height
  })

  it('ignores a payload that is not 64 numbers, or not an object, rather than drawing it', () => {
    for (const bad of [null, 'levels', 7, {}, { levels: [1, 2, 3] }, { levels: 'x'.repeat(64) }, { levels: new Float32Array(63) }]) {
      h.calls.fillRect.length = 0
      plugin(bad)
      expect(h.calls.fillRect, JSON.stringify(bad)).toEqual([])
    }
  })

  it('draws a level that is not a number as the floor, so nothing it sends can put a bar off the plot', () => {
    plugin({ rate: 48000, source: 2, levels: Array.from({ length: 64 }, () => 'loud') })
    expect(h.calls.fillRect).toEqual([])
  })

  it('does not take a plugin message from another origin', () => {
    h.fromHost({ type: 'plugin', payload: { rate: 48000, source: 2, levels: levels(() => -10) } }, 'https://evil.example')
    h.flush()
    expect(h.calls.fillRect).toEqual([])
  })
})
