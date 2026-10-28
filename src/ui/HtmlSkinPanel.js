// src/ui/HtmlSkinPanel.js
//
// Draws an HTML skin (docs/html-skins.md) and operates it. The nodes are already built from an allowlist
// (src/ui/HtmlSkin.js); this puts them in a shadow root, gives each control what a person or a tool relies on, and answers
// the same calls as src/ui/SkinPanel.js, so Panel.js draws either.
//
// The controls are the platform's own, so the role, the keys and the focus order are not ours to build, and the author's
// markup supplies none of what an assistive technology reads: the accessible name is the port's name, the value text the
// value with its unit, the description the port's comment. The host's own rules are written here, outside the author's
// cascade layer, which is what makes them win: a skin cannot shrink a target below 44 pixels or remove the focus ring.
//
// Like the generated panel it renders what the host says and not what it was asked for (messaging.md section 2.3): the
// control moves in update(), never in its own event.
import { formatValue, spokenValue } from './PortText.js'
import { attachSliderDrag } from './SliderDrag.js'

// The host's rules. Unlayered, so they beat every declaration the author wrote in the `skin` layer.
const HOST_SHEET = [
  ':host{display:block;contain:layout paint style;isolation:isolate;container-type:inline-size}',
  'input[type=range],select{min-height:44px}',
  // The drag is ours (SliderDrag.js), so the browser must not take a touch for a scroll halfway through it.
  'input[type=range]{touch-action:none}',
  'input[type=checkbox]{min-width:44px;min-height:44px}',
  'select{font-size:max(16px,1em)}',
  'input:focus-visible,select:focus-visible{outline:2px solid #7fb3ff;outline-offset:2px}',
  '.control-help{min-height:1.4em;margin:6px 0 0}',
  '.visually-hidden{position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}'
].join('')

const clamp = (n, low, high) => Math.min(high, Math.max(low, n))

/**
 * @param {Document} document
 * @param {{ root: Element, css: string, controls: object[], texts: object[], names: object[], help: Element[] }} skin from buildHtmlSkin
 * @param {{ symbol: string, name: string, minimum: number, maximum: number }[]} ports the profile's
 * @param {(symbol: string, value: number) => void} onChange
 * @param {{ scope: string }} options
 * @returns {{ element: Element, update: Function, fit: Function, bound: Set<string>, onCramped: Function, cramped: boolean, warnings: string[] }}
 */
export function createHtmlSkinPanel (document, skin, ports, onChange, { scope }) {
  const host = document.createElement('div')
  host.className = 'skin html-skin-host'
  // A stable id, which src/ui/Focus.js needs to put the keyboard back inside the shadow root after a redraw.
  host.id = `${scope}#skin-host`.replace(/[^\w-]/g, '_')
  // No shadow root where there is no browser (a DOM under test). The built nodes and the host rules are the same.
  const shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host
  const sheet = document.createElement('style')
  sheet.textContent = `${skin.css}${HOST_SHEET}`
  shadow.append(sheet, skin.root)

  const bySymbol = new Map(ports.map(p => [p.symbol, p]))
  const bound = new Set()
  const warnings = []
  const setters = new Map()
  const onValue = (symbol, fn) => { if (!setters.has(symbol)) setters.set(symbol, []); setters.get(symbol).push(fn) }

  // Help is the host's: one line that follows the pointer and the focus, as the generated panel's does. An element the
  // author marked with data-param-help says where it goes; with none, the line is drawn after the skin.
  let focused = null
  const lines = skin.help.length ? skin.help : [Object.assign(document.createElement('p'), { className: 'control-help' })]
  if (!skin.help.length) skin.root.append(lines[0])
  for (const line of lines) line.setAttribute('aria-hidden', 'true')
  const showHelp = port => {
    for (const line of lines) {
      line.replaceChildren()
      if (!port?.comment) continue
      const name = document.createElement('b')
      name.textContent = port.name ?? port.symbol
      line.append(name, document.createTextNode(` ${port.comment}`))
    }
  }

  for (const { element, symbol } of skin.names) element.textContent = bySymbol.get(symbol)?.name ?? symbol

  const labelFor = new Map([...skin.root.querySelectorAll('label[for]')].map(l => [l.getAttribute('for'), l]))
  const namedByHost = new Set(skin.names.map(n => n.element))

  for (const { element, port, kind } of skin.controls) {
    bound.add(port.symbol)
    const id = element.getAttribute('id')
    // The author's label text is theirs, but the name a person hears is the port's. If the visible label is not part of
    // that name, a person using speech control says the label and is not understood (WCAG 2.5.3), and only the author can fix it.
    const label = id ? labelFor.get(id) : null
    if (label && !namedByHost.has(label) && label.textContent.trim() && !port.name.toLowerCase().includes(label.textContent.trim().toLowerCase())) {
      warnings.push(`the label "${label.textContent.trim()}" is not part of the port's name "${port.name}"`)
    }
    element.setAttribute('aria-label', port.name ?? port.symbol)
    if (!id) element.setAttribute('id', `${scope}#skin-${port.symbol}`.replace(/[^\w-]/g, '_'))

    if (kind === 'select') {
      element.replaceChildren(...port.scalePoints.map(sp => Object.assign(document.createElement('option'), { value: String(sp.value), textContent: sp.label })))
      element.addEventListener('change', () => onChange(port.symbol, Number(element.value)))
      onValue(port.symbol, value => { for (const option of element.options) option.selected = option.value === String(value) })
    } else if (kind === 'checkbox') {
      element.addEventListener('change', () => onChange(port.symbol, element.checked ? port.maximum : port.minimum))
      onValue(port.symbol, value => { element.checked = value >= (port.minimum + port.maximum) / 2 })
    } else {
      element.min = String(port.minimum)
      element.max = String(port.maximum)
      element.step = String((port.maximum - port.minimum) / 200)
      element.addEventListener('input', () => onChange(port.symbol, Number(element.value)))
      attachSliderDrag(element, port)
      onValue(port.symbol, value => {
        element.value = String(clamp(value, port.minimum, port.maximum))
        element.setAttribute('aria-valuetext', spokenValue(port, value))
      })
    }

    if (port.comment) {
      const words = document.createElement('span')
      words.className = 'visually-hidden'
      words.id = `${element.getAttribute('id')}-help`
      words.textContent = port.comment
      element.after(words)
      element.setAttribute('aria-describedby', words.id)
      element.addEventListener('pointerenter', () => showHelp(port))
      element.addEventListener('pointerleave', () => showHelp(focused))
      element.addEventListener('focus', () => { focused = port; showHelp(port) })
      element.addEventListener('blur', () => { focused = null; showHelp(null) })
      element.addEventListener('keydown', event => { if (event.key === 'Escape') showHelp(null) })
    }
  }

  for (const { element, symbol } of skin.texts) {
    const port = bySymbol.get(symbol)
    if (!port) continue
    // Hidden from assistive technology: the control beside it reports its value already.
    element.setAttribute('aria-hidden', 'true')
    onValue(symbol, value => {
      const named = port.scalePoints?.find(sp => sp.value === value)
      element.textContent = named ? named.label : formatValue(port, value)
    })
  }

  // A skin that cannot be used at this width is put away and the generated controls take its place, as for an SVG skin.
  // Judged on the result: content wider than the room it was given, or a control with no size at all.
  let cramped = false
  const listeners = []
  const measure = () => {
    const room = host.clientWidth
    if (!room) return null
    if (skin.root.scrollWidth > room + 1) return true
    return skin.controls.some(c => {
      const box = c.element.getBoundingClientRect?.()
      return box && box.width === 0 && box.height === 0
    })
  }

  return {
    element: host,
    bound,
    warnings,
    get cramped () { return cramped },
    update (symbol, value) { for (const fn of setters.get(symbol) ?? []) fn(value) },
    onCramped (fn) { listeners.push(fn) },
    fit () {
      // The panel hides this element when cramped, and a hidden element has no layout. Showing it for the measurement
      // and hiding it again happens inside one task, so nothing is painted in between.
      const wasHidden = host.hidden
      host.hidden = false
      const next = measure()
      host.hidden = wasHidden
      if (next === null || next === cramped) return
      cramped = next
      for (const fn of listeners) fn(cramped)
    }
  }
}
