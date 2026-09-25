// src/mcp/BridgeClient.js
//
// The page's half of the local MCP bridge (src/mcp/BridgeServer.js): connect
// out to it, run each tool call it sends through the page's own tool surface,
// and post the result back. The surface is the one WebMCP and the console
// use (src/mcp/adapter.js), so a call from an agent through the bridge is the
// same call in every respect, including what it is refused.

/**
 * Connect to a bridge at `url` with the token it printed.
 *
 * - `surface`: `{ call(name, input) }`, from registerTools.
 * - `EventSource` and `fetch`: the browser's, injected so a test can stand in.
 * - `onState(state, detail)`: 'connecting', 'connected', 'retrying', 'refused'
 *   or 'closed'. 'refused' means the stream ended for good: a wrong token, or
 *   no bridge on that port.
 * - `onCall(name)`: told of each call, so a person can see what an agent does.
 *
 * Returns `{ close }`.
 */
export function connectBridge ({ url, token, surface, EventSource, fetch, onState = () => {}, onCall = () => {} }) {
  if (!url || !token) throw new Error('connectBridge needs the bridge URL and its token')
  if (typeof surface?.call !== 'function') throw new Error('connectBridge needs the tool surface')
  if (typeof EventSource !== 'function' || typeof fetch !== 'function') throw new Error('connectBridge needs EventSource and fetch')

  let open = false
  const source = new EventSource(`${url}/tab?token=${encodeURIComponent(token)}`)
  onState('connecting')

  source.addEventListener('hello', () => {
    open = true
    onState('connected')
  })

  source.addEventListener('call', async event => {
    let call
    try { call = JSON.parse(event.data) } catch { return }
    const { id, name, input } = call
    onCall(name)
    let result = await surface.call(name, input ?? {})
    let body
    try {
      body = JSON.stringify({ token, id, result })
    } catch (error) {
      // A result that will not serialise would reach the agent as a timeout,
      // which names nothing. Say what happened instead.
      result = { ok: false, error: `${name} returned something that cannot be sent: ${error.message}` }
      body = JSON.stringify({ token, id, result })
    }
    // text/plain, so the browser sends it without a preflight; the bridge
    // reads the body as JSON regardless.
    await fetch(`${url}/tab/result`, { method: 'POST', headers: { 'content-type': 'text/plain' }, body })
      .catch(error => onState('retrying', error.message))
  })

  source.addEventListener('error', () => {
    // CLOSED means the browser has given up: a refusal, or nothing listening.
    // Otherwise it is reconnecting by itself, and says so.
    if (source.readyState === 2) {
      onState(open ? 'closed' : 'refused')
      open = false
    } else {
      onState('retrying')
    }
  })

  return {
    close () {
      source.close()
      open = false
      onState('closed')
    }
  }
}
