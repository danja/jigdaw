// src/plugin-ui/JigUi.js
//
// The page side of a plugin's own editor (docs/plugin-ui.md). It speaks docs/messaging.md section 2 so an
// author does not have to, and binds elements to ports by attribute:
//
//   <input type="range" data-param="threshold">     a slider; range, step and unit come from the port
//   <input type="checkbox" data-param="comp_enable"> a switch
//   <select data-param="comp_mode"></select>         options filled in from the port's scale points
//   <span data-param-name="threshold"></span>        the port's lv2:name
//   <output data-param-text="threshold"></output>    the value with its unit, "-18 dB"
//   <p data-param-help></p>                          a line that says what the hovered or focused control does
//
// Nothing here is trusted by the host and nothing here reaches the audio graph: every call is a message, and the
// control draws the value the host sends back, never the value it asked for (messaging.md 2.3).
//
// bin/inline-ui.js puts this file and PortText.js into one script in the editor's HTML, so the plugin's
// jig:integrity digest covers everything that runs in the frame. That is why this file imports nothing it
// cannot have inlined and exports one function.
import { formatValue, spokenValue } from '../ui/PortText.js'
import { createDial } from '../ui/Dial.js'

const LV2 = 'http://lv2plug.in/ns/lv2core#'

/** The widget for a port, decided by the same rule as ProfileReader.widgetFor (contract section 5.3). */
function widgetOf (port) {
  const props = port.portProperty ?? []
  const points = port.scalePoint ?? []
  if (props.includes(`${LV2}toggled`) || (props.includes(`${LV2}enumeration`) && points.length === 2)) return 'switch'
  if (props.includes(`${LV2}enumeration`) && points.length > 2) return 'selector'
  return 'dial'
}

function readPorts (profile) {
  const ports = new Map()
  for (const p of profile?.port ?? []) {
    const port = {
      symbol: p.symbol,
      name: p.name ?? p.symbol,
      minimum: Number(p.minimum),
      maximum: Number(p.maximum),
      default: Number(p.default),
      unit: p.unit ?? null,
      logarithmic: (p.portProperty ?? []).includes('http://lv2plug.in/ns/ext/port-props#logarithmic'),
      comment: p.comment ?? null,
      scalePoints: [...(p.scalePoint ?? [])].map(sp => ({ label: sp.label, value: Number(sp.value) })).sort((a, b) => a.value - b.value)
    }
    port.widget = widgetOf(p)
    ports.set(port.symbol, port)
  }
  return ports
}

/**
 * @param {{ window: Window, document: Document, parent: Window }} env the frame's own globals, passed so a test can supply them
 * @returns the bridge: { ready, ports, value, text, on, begin, set, end, change, bind, onPlugin, sendPlugin }
 */
export function createBridge ({ window, document, parent }) {
  // The host's origin, learnt from its init. Until then nothing is sent but `ready`, which carries nothing,
  // and nothing received is believed (messaging.md 2.1).
  let host = null
  let ports = new Map()
  const values = new Map()
  const listeners = new Map()
  const pluginListeners = []
  const open = new Set()
  // An element is bound once, however often bind() runs.
  const bound = new WeakSet()
  // The help line follows the pointer and the focus, as the generated panel's does (src/ui/Panel.js): one sentence
  // for whichever control is hovered or focused, and when the pointer leaves, for the one that has the focus.
  let focused = null
  const helpLines = () => [...document.querySelectorAll('[data-param-help]')]
  const showHelp = port => {
    for (const line of helpLines()) {
      line.replaceChildren()
      if (!port?.comment) continue
      const name = document.createElement('b')
      name.textContent = port.name
      line.append(name, document.createTextNode(` ${port.comment}`))
    }
  }
  let resolveReady
  const ready = new Promise(resolve => { resolveReady = resolve })

  const send = message => { if (host) parent.postMessage(message, host) }
  const safely = (fn, ...args) => {
    try { fn(...args) } catch (error) { window.console?.error?.(error) }
  }

  const bridge = {
    ready,
    get ports () { return ports },
    value: symbol => values.get(symbol),

    /** The value as the eye and the ear should have it: { text: "-18 dB", spoken: "-18 decibels" }. */
    text (symbol, value = values.get(symbol)) {
      const port = ports.get(symbol)
      if (!port || !Number.isFinite(value)) return { text: '', spoken: '' }
      const named = port.scalePoints.find(sp => sp.value === value)
      if (named) return { text: named.label, spoken: named.label }
      return { text: formatValue(port, value), spoken: spokenValue(port, value) }
    },

    /** Call `fn(value, text)` now, if the value is known, and on every change the host applies. */
    on (symbol, fn) {
      if (!listeners.has(symbol)) listeners.set(symbol, [])
      listeners.get(symbol).push(fn)
      if (values.has(symbol)) safely(fn, values.get(symbol), bridge.text(symbol))
    },

    begin (symbol) {
      if (open.has(symbol)) return
      open.add(symbol)
      send({ type: 'gesture', symbol, phase: 'begin' })
    },
    /** A request. The control does not move until the host answers with the value it applied. */
    set (symbol, value) { send({ type: 'parameter', symbol, value: Number(value) }) },
    end (symbol) {
      if (!open.delete(symbol)) return
      send({ type: 'gesture', symbol, phase: 'end' })
    },
    /** One whole edit, for a click or a key, which has no drag to bracket. */
    change (symbol, value) {
      bridge.begin(symbol)
      bridge.set(symbol, value)
      bridge.end(symbol)
    },

    /** Called with the payload of each `plugin` message the processor sends (messaging.md 2.4). */
    onPlugin (fn) { pluginListeners.push(fn) },
    sendPlugin (payload) { send({ type: 'plugin', payload }) },

    /** Bind every `data-param*` element under `root`. Safe to call again for elements added later. */
    bind (root = document) {
      // Before init there are no ports to bind to; the init handler binds the whole document itself.
      if (host === null) { ready.then(() => bridge.bind(root)); return }
      for (const el of root.querySelectorAll('[data-param]')) bindControl(el)
      for (const el of root.querySelectorAll('[data-param-name]')) {
        const port = ports.get(el.getAttribute('data-param-name'))
        if (port) el.textContent = port.name
      }
      for (const el of root.querySelectorAll('[data-param-help]')) el.setAttribute('aria-hidden', 'true')
      for (const el of root.querySelectorAll('[data-param-text]')) {
        if (bound.has(el)) continue
        bound.add(el)
        bridge.on(el.getAttribute('data-param-text'), (value, text) => { el.textContent = text.text })
      }
    }
  }

  function bindControl (el) {
    if (bound.has(el)) return
    const symbol = el.getAttribute('data-param')
    const port = ports.get(symbol)
    // A binding to a port the plugin does not declare is left alone and reported, not drawn disabled: a
    // control nobody can use is not shown.
    if (!port) { window.console?.error?.(`jig: data-param="${symbol}" names no port of this plugin`); el.hidden = true; return }
    bound.add(el)

    if (el.tagName === 'SELECT') {
      el.replaceChildren(...port.scalePoints.map(sp => {
        const option = document.createElement('option')
        option.value = String(sp.value)
        option.textContent = sp.label
        return option
      }))
      el.addEventListener('change', () => bridge.change(symbol, el.value))
      bridge.on(symbol, value => { for (const option of el.options) option.selected = option.value === String(value) })
    } else if (el.type === 'checkbox') {
      el.addEventListener('change', () => bridge.change(symbol, el.checked ? port.maximum : port.minimum))
      bridge.on(symbol, value => { el.checked = value >= (port.minimum + port.maximum) / 2 })
    } else {
      // `data-knob` draws the range as a rotary knob (src/ui/Dial.js). It is still this input underneath, so the name, the role, the
      // value and every key are the native ones; the knob replaces the pixels and the pointer.
      let dial = null
      if (el.hasAttribute('data-knob')) {
        const anchor = document.createComment('')
        el.before(anchor)
        dial = createDial(document, port, el.id, { input: el, begin: () => bridge.begin(symbol), end: () => bridge.end(symbol) })
        anchor.replaceWith(dial.element)
      } else {
        el.min = String(port.minimum)
        el.max = String(port.maximum)
        el.step = String((port.maximum - port.minimum) / 200)
        // A drag is one gesture, so automation records it as one. A key press or a tap has no pointer to
        // bracket it, and input without a gesture open is a whole edit of its own.
        el.addEventListener('pointerdown', () => bridge.begin(symbol))
        for (const type of ['pointerup', 'pointercancel']) el.addEventListener(type, () => bridge.end(symbol))
      }
      const current = () => dial ? dial.read() : el.value
      el.addEventListener('input', () => {
        if (open.has(symbol)) bridge.set(symbol, current())
        else bridge.change(symbol, current())
      })
      bridge.on(symbol, (value, text) => {
        if (dial) { dial.write(value); dial.render(value) } else el.value = String(value)
        // "-18" and "-18 decibels" are different information (WCAG 4.1.2).
        el.setAttribute('aria-valuetext', text.spoken)
      })
    }
    // What the control does, said to a screen reader on focus. The same words are in the help line, which is hidden
    // from assistive technology so they are not said twice.
    if (port.comment) {
      const words = document.createElement('span')
      words.id = `jig-help-${symbol}`
      words.textContent = port.comment
      words.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap'
      el.after(words)
      el.setAttribute('aria-describedby', words.id)
      el.addEventListener('pointerenter', () => showHelp(port))
      el.addEventListener('pointerleave', () => showHelp(focused))
      el.addEventListener('focus', () => { focused = port; showHelp(port) })
      el.addEventListener('blur', () => { focused = null; showHelp(null) })
      el.addEventListener('keydown', event => { if (event.key === 'Escape') showHelp(null) })
    }
    // A control with no visible label of its own still has a name.
    if (!el.labels?.length && !el.hasAttribute('aria-label') && !el.hasAttribute('aria-labelledby')) el.setAttribute('aria-label', port.name)
  }

  function apply (symbol, value) {
    values.set(symbol, value)
    for (const fn of listeners.get(symbol) ?? []) safely(fn, value, bridge.text(symbol, value))
  }

  window.addEventListener('message', event => {
    if (event.source !== parent) return
    if (host === null) {
      if (event.data?.type !== 'init') return
      host = event.origin
      ports = readPorts(event.data.profile)
      const given = event.data.parameters ?? {}
      for (const port of ports.values()) values.set(port.symbol, Number.isFinite(given[port.symbol]) ? given[port.symbol] : port.default)
      bridge.bind(document)
      for (const [symbol, value] of values) apply(symbol, value)
      resolveReady({ ports, parameters: Object.fromEntries(values) })
      return
    }
    if (event.origin !== host) return
    const message = event.data
    if (message?.type === 'parameter' && ports.has(message.symbol)) apply(message.symbol, Number(message.value))
    else if (message?.type === 'plugin') for (const fn of pluginListeners) safely(fn, message.payload)
  })

  // Ask for the height the content takes, whenever that changes. The whole document, margins included, which is
  // what the frame has to be for nothing to scroll. The host MAY refuse (messaging.md 2.3).
  if (window.ResizeObserver) {
    new window.ResizeObserver(() => {
      send({ type: 'resize', width: document.body.scrollWidth, height: Math.ceil(document.documentElement.getBoundingClientRect().height) })
    }).observe(document.body)
  }

  // The host's origin is not known yet, so ready goes to any. It carries nothing.
  parent.postMessage({ type: 'ready' }, '*')
  return bridge
}
