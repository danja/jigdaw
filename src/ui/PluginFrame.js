// src/ui/PluginFrame.js
//
// A plugin's own user interface, in a sandboxed frame on another origin.
// Contract section 9 and docs/messaging.md section 2.
//
// The frame is code the host does not control, so everything about it is a
// boundary:
//
// - It MUST NOT be same-origin with the host (contract 9.1). An interface
//   served from the host's own origin is refused rather than framed. The
//   sandbox keeps allow-same-origin so the frame has its own, real origin:
//   without it the origin is opaque, a message to it can only be addressed to
//   "*", and messaging.md 2.1 forbids "*" in both directions. Cross-origin by
//   URL and sandboxed by attribute together are what 9.1 asks for.
// - A message is accepted only from that frame's window and only from its
//   origin (2.1), and is sent only to that origin.
// - It gets no reference to the context, the node, the port or the project
//   (9.2). It gets the profile as JSON-LD and the current parameter values,
//   and every change it asks for goes to the dispatcher like any other edit
//   (9.3), which then tells it what was actually applied.
// - A plugin payload is relayed without being read (2.4), and at a bounded
//   rate in each direction, so a frame that floods the relay is throttled
//   rather than allowed to starve the page.

/** How tall a frame may ask to be, in CSS pixels. messaging.md 2.3: the host MAY refuse. */
export const FRAME_HEIGHT = Object.freeze({ minimum: 80, maximum: 900 })

/**
 * Whether an interface at `location` may be framed by a host at `hostOrigin`.
 * Returns `{ ok, origin }` or `{ ok: false, message }`.
 */
export function frameableOrigin (location, hostOrigin) {
  let url
  try { url = new URL(location) } catch { return { ok: false, message: `not a URL: ${location}` } }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return { ok: false, message: `a plugin interface is fetched over http or https, not ${url.protocol}` }
  }
  if (url.origin === hostOrigin) {
    return {
      ok: false,
      message: `the interface at ${location} is on this page's own origin, and contract section 9.1 ` +
        'forbids framing it there: it would run with this page\'s access. Serve the plugin from another origin.'
    }
  }
  return { ok: true, origin: url.origin }
}

/**
 * A counter of how many messages went through in the last second.
 * `take()` is false once `limit` have gone through inside one second.
 */
function rateLimit (limit, now) {
  let windowStart = now()
  let count = 0
  return {
    take () {
      const t = now()
      if (t - windowStart >= 1000) { windowStart = t; count = 0 }
      if (count >= limit) return false
      count += 1
      return true
    }
  }
}

/**
 * Build a frame.
 *
 * - `ui.location`: where the interface is, already resolved.
 * - `label`: the plugin's name, for the frame's title.
 * - `hostOrigin`: this page's origin.
 * - `window`: this page's window, which the frame's messages arrive at.
 * - `relayLimit`: plugin payloads per second, in each direction.
 * - `init()`: what to send when the frame reports ready,
 *   `{ profile, parameters, capabilities }`.
 * - `onParameter(symbol, value)`, `onGesture(symbol, phase)`, `onRelay(payload)`:
 *   what the frame asked for. A parameter request is only a request.
 * - `onRefused(message)`: told once when a relay payload is dropped for rate.
 *
 * Returns `{ element, parameter, relay, dispose }`. Throws when the origin
 * cannot be framed, so a caller shows its generated panel instead.
 */
export function createPluginFrame (document, {
  ui, label, hostOrigin, window, relayLimit, init,
  onParameter, onGesture = () => {}, onRelay = () => {}, onRefused = () => {},
  now = () => Date.now()
}) {
  if (!ui?.location) throw new Error('createPluginFrame needs the interface location')
  if (!Number.isInteger(relayLimit) || relayLimit < 1) throw new Error('createPluginFrame needs a relayLimit of at least one per second')
  if (typeof init !== 'function' || typeof onParameter !== 'function') {
    throw new Error('createPluginFrame needs init and onParameter')
  }
  const allowed = frameableOrigin(ui.location, hostOrigin)
  if (!allowed.ok) throw new Error(allowed.message)
  const origin = allowed.origin

  const element = document.createElement('iframe')
  // allow-scripts so it runs, allow-same-origin so it keeps its own origin
  // (see the header). Nothing else: no popups, no top navigation, no forms.
  element.setAttribute('sandbox', 'allow-scripts allow-same-origin')
  element.setAttribute('title', `${label} editor`)
  element.setAttribute('referrerpolicy', 'no-referrer')
  element.className = 'plugin-frame'
  element.style.height = `${FRAME_HEIGHT.minimum * 2}px`
  element.src = ui.location

  let initialised = false
  let warned = false
  const inbound = rateLimit(relayLimit, now)
  const outbound = rateLimit(relayLimit, now)

  const post = message => {
    // A frame that has navigated away, or not loaded, has no window to post to.
    element.contentWindow?.postMessage(message, origin)
  }

  const refuse = direction => {
    if (warned) return
    warned = true
    onRefused(`${label}: plugin messages ${direction} are arriving faster than ${relayLimit} a second, and the excess is dropped`)
  }

  const listener = event => {
    if (event.source !== element.contentWindow || event.origin !== origin) return
    const message = event.data
    if (!message || typeof message !== 'object') return
    switch (message.type) {
      case 'ready':
        initialised = true
        post({ type: 'init', ...init() })
        return
      case 'parameter':
        if (!initialised) return
        if (typeof message.symbol !== 'string' || !Number.isFinite(message.value)) return
        onParameter(message.symbol, message.value)
        return
      case 'gesture':
        if (!initialised) return
        if (typeof message.symbol !== 'string' || (message.phase !== 'begin' && message.phase !== 'end')) return
        onGesture(message.symbol, message.phase)
        return
      case 'resize': {
        if (!Number.isFinite(message.height)) return
        const height = Math.min(FRAME_HEIGHT.maximum, Math.max(FRAME_HEIGHT.minimum, Math.round(message.height)))
        element.style.height = `${height}px`
        return
      }
      case 'plugin':
        if (!initialised) return
        if (!inbound.take()) { refuse('from the interface'); return }
        onRelay(message.payload)
        return
      default:
        // Unknown types are ignored, per messaging.md section 4.
    }
  }
  window.addEventListener('message', listener)

  return {
    element,
    /** Tell the frame what a parameter is now, after the host applied it. */
    parameter (symbol, value) {
      if (initialised) post({ type: 'parameter', symbol, value })
    },
    /** Relay a payload from the processor. */
    relay (payload) {
      if (!initialised) return
      if (!outbound.take()) { refuse('from the processor'); return }
      post({ type: 'plugin', payload })
    },
    dispose () {
      window.removeEventListener('message', listener)
      element.remove()
    }
  }
}
