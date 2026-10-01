// web/app/Carry.js
//
// The open piece, carried from one page to the other. Leaving by a link to the other page keeps the piece
// (src/host/Handoff.js) and the other page offers it: a bar with Open it and Not now. Opening is the person's
// click, never automatic, because the audio cannot start without one.
import { createHandoff } from '../../src/host/Handoff.js'

/**
 * `self` is this page ('studio' or 'simple'); `offerText` what the bar says when the other page left a piece.
 * Elements: `#carry` (the bar), `#carry-text`, `#carry-open`, `#carry-dismiss`.
 */
export function createCarry (ctx, { self, offerText }) {
  const { document, $, log } = ctx
  let handoff = null

  /** Built when first needed, because the time a piece is kept for is in web/host.json, which the page reads late. */
  async function store () {
    if (handoff) return handoff
    const response = await fetch(new URL('host.json', document.baseURI))
    if (!response.ok) throw new Error(`web/host.json could not be read: ${response.status}`)
    const config = await response.json()
    if (!(config.handoffMinutes > 0)) throw new Error('web/host.json has no handoffMinutes')
    handoff = createHandoff({ maxAgeMs: config.handoffMinutes * 60000 })
    return handoff
  }

  /** Keep the open piece, if there is one, and go to `href`. Going anyway if keeping it fails, saying so. */
  async function leave (href) {
    if (ctx.dispatcher && ctx.dispatcher.project.nodes.length > 0) log('Taking your piece with you...')
    try {
      const d = ctx.dispatcher
      if (d && d.project.nodes.length > 0) {
        const packed = await ctx.sessions.pack()
        await (await store()).put({ from: self, kind: packed.kind, bytes: packed.bytes })
      }
    } catch (error) {
      log(`the piece could not be carried over: ${error.message}`, 'error')
    }
    window.location.href = href
  }

  /** Make a link to the other page carry the piece. */
  function carryOnClick (link) {
    link.addEventListener('click', event => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      event.preventDefault()
      leave(link.href)
    })
  }

  /** Show the bar when the other page left a piece. Quiet when there is none, or storage is not available. */
  async function offer () {
    let waiting = null
    try { waiting = await (await store()).peek() } catch { return }
    if (!waiting || waiting.from === self) return
    $('carry-text').textContent = offerText
    $('carry').hidden = false
    $('carry-open').onclick = async () => {
      $('carry').hidden = true
      try {
        const piece = await (await store()).take()
        if (!piece) { log('the piece is no longer there', 'error'); return }
        await ctx.sessions.openBytes(piece.bytes)
      } catch (error) { log(error.message, 'error') }
    }
    $('carry-dismiss').onclick = async () => {
      $('carry').hidden = true
      try { await (await store()).clear() } catch { /* nothing to forget */ }
    }
  }

  return { leave, carryOnClick, offer }
}
