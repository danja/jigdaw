// tests/ui/PluginFrame.test.js
//
// The frame is a security boundary, so the fakes here refuse what the real
// platform refuses (CLAUDE.md: a fake more permissive than the real thing
// turns a specification error into a passing test). The frame's window
// refuses a message addressed to "*", which messaging.md 2.1 forbids, and
// anything postMessage could not structured-clone, which a real window
// refuses with a DataCloneError.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createPluginFrame, frameableOrigin, FRAME_HEIGHT } from '../../src/ui/PluginFrame.js'

const HOST = 'https://host.example'
const PLUGIN = 'https://plugins.example'
const UI = { location: `${PLUGIN}/tremolo/ui/index.html` }

let document
beforeEach(() => { ({ document } = parseHTML('<!doctype html><body></body>')) })

/** The page's window: somewhere message listeners are registered. */
function hostWindow () {
  const listeners = new Set()
  return {
    listeners,
    addEventListener (type, fn) { if (type === 'message') listeners.add(fn) },
    removeEventListener (type, fn) { if (type === 'message') listeners.delete(fn) },
    deliver (event) { for (const fn of [...listeners]) fn(event) }
  }
}

/** The frame's window, refusing what a real one refuses. */
function frameWindow () {
  return {
    received: [],
    postMessage (message, targetOrigin) {
      if (targetOrigin === '*') throw new Error('messaging.md 2.1: never "*"')
      if (targetOrigin !== PLUGIN) return // a real window drops a mismatched target silently
      this.received.push(structuredClone(message))
    }
  }
}

function build (over = {}) {
  const win = hostWindow()
  const inside = frameWindow()
  const seen = { parameters: [], gestures: [], relays: [], refused: [] }
  let clock = 0
  const frame = createPluginFrame(document, {
    ui: UI,
    label: 'Tremolo',
    hostOrigin: HOST,
    window: win,
    relayLimit: 3,
    now: () => clock,
    init: () => ({ profile: { '@id': 'p' }, parameters: { rate: 5 }, capabilities: [] }),
    onParameter: (s, v) => seen.parameters.push([s, v]),
    onGesture: (s, p) => seen.gestures.push([s, p]),
    onRelay: p => seen.relays.push(p),
    onRefused: m => seen.refused.push(m),
    ...over
  })
  Object.defineProperty(frame.element, 'contentWindow', { value: inside })
  const fromFrame = (data, { origin = PLUGIN, source = inside } = {}) => win.deliver({ data, origin, source })
  return { frame, win, inside, seen, fromFrame, tick: ms => { clock += ms } }
}

describe('which interfaces may be framed', () => {
  it('refuses one on the host\'s own origin, which would run with the host\'s access', () => {
    expect(frameableOrigin(`${HOST}/plugins/x/ui.html`, HOST).ok).toBe(false)
    expect(() => build({ ui: { location: `${HOST}/plugins/x/ui.html` } })).toThrow(/9\.1/)
  })

  it('refuses anything but http and https', () => {
    expect(frameableOrigin('data:text/html,<p>hi', HOST).ok).toBe(false)
    expect(frameableOrigin('javascript:alert(1)', HOST).ok).toBe(false)
    expect(frameableOrigin('not a url', HOST).ok).toBe(false)
  })

  it('accepts another origin, and names it', () => {
    expect(frameableOrigin(UI.location, HOST)).toEqual({ ok: true, origin: PLUGIN })
  })
})

describe('the frame element', () => {
  it('is sandboxed to scripts on its own origin, and titled for a screen reader', () => {
    const { frame } = build()
    expect(frame.element.tagName).toBe('IFRAME')
    expect(frame.element.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin')
    expect(frame.element.getAttribute('title')).toBe('Tremolo editor')
    expect(frame.element.getAttribute('src')).toBe(UI.location)
  })

  it('needs its limits and handlers rather than inventing them', () => {
    expect(() => build({ relayLimit: 0 })).toThrow(/relayLimit/)
    expect(() => build({ init: undefined })).toThrow(/init/)
  })
})

describe('messages from the frame', () => {
  it('answers ready with init, addressed to the frame\'s origin', () => {
    const { inside, fromFrame } = build()
    fromFrame({ type: 'ready' })
    expect(inside.received).toEqual([{ type: 'init', profile: { '@id': 'p' }, parameters: { rate: 5 }, capabilities: [] }])
  })

  it('ignores a message from any other origin, or any other window', () => {
    const { inside, seen, fromFrame } = build()
    fromFrame({ type: 'ready' }, { origin: 'https://evil.example' })
    fromFrame({ type: 'ready' }, { source: {} })
    expect(inside.received).toEqual([])
    fromFrame({ type: 'ready' })
    fromFrame({ type: 'parameter', symbol: 'rate', value: 9 }, { origin: HOST })
    expect(seen.parameters).toEqual([])
  })

  it('passes a parameter request on, and ignores one before init or malformed', () => {
    const { seen, fromFrame } = build()
    fromFrame({ type: 'parameter', symbol: 'rate', value: 7 })
    expect(seen.parameters).toEqual([])
    fromFrame({ type: 'ready' })
    fromFrame({ type: 'parameter', symbol: 'rate', value: 7 })
    fromFrame({ type: 'parameter', symbol: 'rate', value: 'loud' })
    fromFrame({ type: 'parameter', value: 1 })
    expect(seen.parameters).toEqual([['rate', 7]])
  })

  it('passes gestures on, only as begin or end', () => {
    const { seen, fromFrame } = build()
    fromFrame({ type: 'ready' })
    fromFrame({ type: 'gesture', symbol: 'rate', phase: 'begin' })
    fromFrame({ type: 'gesture', symbol: 'rate', phase: 'sideways' })
    expect(seen.gestures).toEqual([['rate', 'begin']])
  })

  it('takes a resize within bounds, and clamps one outside them', () => {
    const { frame, fromFrame } = build()
    fromFrame({ type: 'resize', width: 300, height: 240 })
    expect(frame.element.style.height).toBe('240px')
    fromFrame({ type: 'resize', height: 100000 })
    expect(frame.element.style.height).toBe(`${FRAME_HEIGHT.maximum}px`)
    fromFrame({ type: 'resize', height: 1 })
    expect(frame.element.style.height).toBe(`${FRAME_HEIGHT.minimum}px`)
  })

  it('ignores a type it does not know', () => {
    const { seen, inside, fromFrame } = build()
    fromFrame({ type: 'ready' })
    fromFrame({ type: 'eval', code: 'alert(1)' })
    expect(seen).toMatchObject({ parameters: [], gestures: [], relays: [] })
    expect(inside.received).toHaveLength(1)
  })
})

describe('the opaque relay', () => {
  it('relays a payload both ways without reading it', () => {
    const { frame, inside, seen, fromFrame } = build()
    fromFrame({ type: 'ready' })
    fromFrame({ type: 'plugin', payload: { spectrum: [1, 2, 3] } })
    expect(seen.relays).toEqual([{ spectrum: [1, 2, 3] }])
    frame.relay({ peak: 0.5 })
    expect(inside.received.at(-1)).toEqual({ type: 'plugin', payload: { peak: 0.5 } })
  })

  it('throttles a flood, says so once, and recovers the next second', () => {
    const { frame, inside, seen, fromFrame, tick } = build()
    fromFrame({ type: 'ready' })
    for (let i = 0; i < 10; i++) fromFrame({ type: 'plugin', payload: i })
    expect(seen.relays).toEqual([0, 1, 2])
    expect(seen.refused).toHaveLength(1)
    for (let i = 0; i < 10; i++) frame.relay(i)
    expect(inside.received.filter(m => m.type === 'plugin')).toHaveLength(3)
    tick(1000)
    fromFrame({ type: 'plugin', payload: 'later' })
    expect(seen.relays.at(-1)).toBe('later')
  })

  it('would fail loudly on a payload a real window cannot clone, rather than pass it', () => {
    // The fake refuses what postMessage refuses, so a host that tried to relay
    // a function would find out here and not first in a browser.
    const { frame, fromFrame } = build()
    fromFrame({ type: 'ready' })
    expect(() => frame.relay({ run: () => {} })).toThrow()
  })
})

describe('telling the frame what was applied', () => {
  it('sends a parameter only after init, to the frame\'s origin', () => {
    const { frame, inside, fromFrame } = build()
    frame.parameter('rate', 3)
    expect(inside.received).toEqual([])
    fromFrame({ type: 'ready' })
    frame.parameter('rate', 3)
    expect(inside.received.at(-1)).toEqual({ type: 'parameter', symbol: 'rate', value: 3 })
  })

  it('stops listening once disposed', () => {
    const { frame, win } = build()
    expect(win.listeners.size).toBe(1)
    frame.dispose()
    expect(win.listeners.size).toBe(0)
  })
})
