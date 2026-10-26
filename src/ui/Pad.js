// src/ui/Pad.js
//
// A two-axis pad: a square the pointer drags across to set two of a plugin's ports at once, left to right for one and bottom to top for
// the other (docs/plugin-profiles.md, "A pad for two controls"). GarageBand's Drummer pad is the idea. A pad may carry a word for each end
// of each axis ("simple", "busy"), drawn at the ends and said in the caption.
//
// A pad is a shortcut and never the only way. Both ports stay on the panel as ordinary controls, which a keyboard and a screen reader
// use, so the pad is hidden from assistive technology and has no stop of its own in the tab order; what it does is what those two
// controls do, said in words in the caption under it. The mapping is linear across each port's own range.

/** Where in 0..1 a value sits across a port's range. A port with no range is the middle, since nothing says otherwise. */
export function fractionOf (value, port) {
  const span = port.maximum - port.minimum
  if (!(span > 0)) return 0.5
  return Math.min(1, Math.max(0, (value - port.minimum) / span))
}

/** The value a fraction of the way across a port's range. */
export function valueAt (fraction, port) {
  const f = Math.min(1, Math.max(0, fraction))
  return port.minimum + f * (port.maximum - port.minimum)
}

/**
 * `pad` is `{ label, x, y }` with the two ports' symbols; `ports` is the profile's ports. `onSet(symbol, value)` is called for the
 * across port and then the up port, each time the pointer moves. Returns `{ element, update(symbol, value) }`: `update` moves the
 * puck when either port changes some other way (a knob, a preset, automation), so the pad always shows where the two are.
 */
export function createPad (document, { pad, ports, onSet, id }) {
  const portX = ports.find(p => p.symbol === pad.x)
  const portY = ports.find(p => p.symbol === pad.y)
  if (!portX || !portY) throw new Error(`pad ${pad.label}: ${pad.x} and ${pad.y} must both be ports of the plugin`)

  const element = document.createElement('div')
  element.className = 'pad'
  element.setAttribute('role', 'group')
  const captionId = `${id}-caption`
  element.setAttribute('aria-labelledby', captionId)

  const surface = document.createElement('div')
  surface.className = 'pad-surface'
  // Pointer only, and said so: the two controls beside it are how a keyboard sets these.
  surface.setAttribute('aria-hidden', 'true')
  const puck = document.createElement('div')
  puck.className = 'pad-puck'
  surface.append(puck)

  // Words at the ends of the axes, drawn inside the square where the pointer goes, and the same words in the caption below so they are
  // read as well as seen. Each is optional, and an axis with only one end named says only that one.
  const end = (className, text) => {
    if (!text) return
    const label = document.createElement('span')
    label.className = `pad-end ${className}`
    label.textContent = text
    surface.append(label)
  }
  end('pad-end-left', pad.xLow)
  end('pad-end-right', pad.xHigh)
  end('pad-end-bottom', pad.yLow)
  end('pad-end-top', pad.yHigh)
  const axis = (port, low, high) => `${port.name ?? port.symbol}${low && high ? `, from ${low} to ${high}` : low ? `, low is ${low}` : high ? `, high is ${high}` : ''}`

  const caption = document.createElement('p')
  caption.className = 'pad-caption'
  caption.id = captionId
  const name = document.createElement('b')
  name.textContent = pad.label
  caption.append(name, document.createTextNode(` Across is ${axis(portX, pad.xLow, pad.xHigh)}, up is ${axis(portY, pad.yLow, pad.yHigh)}.`))

  element.append(surface, caption)

  const at = { x: 0.5, y: 0.5 }
  const place = () => {
    puck.style.left = `${at.x * 100}%`
    puck.style.top = `${(1 - at.y) * 100}%`
  }
  place()

  const set = event => {
    const box = surface.getBoundingClientRect()
    if (!(box.width > 0 && box.height > 0)) return
    at.x = Math.min(1, Math.max(0, (event.clientX - box.left) / box.width))
    at.y = Math.min(1, Math.max(0, 1 - (event.clientY - box.top) / box.height))
    place()
    // Both values are worked out before either is sent. Sending one makes the host redraw, which pushes every port's last value back
    // through update(), including the other axis's old one, and the second value would then be read from that and not from the pointer.
    const across = valueAt(at.x, portX)
    const up = valueAt(at.y, portY)
    onSet(portX.symbol, across)
    onSet(portY.symbol, up)
  }

  // The move and the release are listened for on the document once the pointer is down, so a drag that leaves the square still ends
  // where it was let go (CLAUDE.md, the pointer rule).
  surface.addEventListener('pointerdown', event => {
    if (event.button !== 0) return
    event.preventDefault()
    set(event)
    const stop = () => {
      document.removeEventListener('pointermove', set)
      document.removeEventListener('pointerup', stop)
      document.removeEventListener('pointercancel', stop)
    }
    document.addEventListener('pointermove', set)
    document.addEventListener('pointerup', stop)
    document.addEventListener('pointercancel', stop)
  })

  return {
    element,
    update (symbol, value) {
      if (symbol === portX.symbol) at.x = fractionOf(value, portX)
      else if (symbol === portY.symbol) at.y = fractionOf(value, portY)
      else return
      place()
    }
  }
}
