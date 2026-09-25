// web/app/Bridge.js
//
// The page's end of the local MCP bridge: the Agent bridge section, where a
// person pastes the token bin/mcp-bridge.js printed and connects this tab to
// it. The work is src/mcp/BridgeClient.js; this is the form and its status.

import { connectBridge } from '../../src/mcp/BridgeClient.js'

const SAID = Object.freeze({
  connecting: 'Connecting.',
  connected: 'Connected. An MCP client pointed at the bridge now drives this session.',
  retrying: 'Lost the bridge; trying again.',
  refused: 'Refused. Check the token, and that npm run mcp-bridge is running on this machine.',
  closed: 'Not connected.'
})

export function createBridgeLink (ctx) {
  const { window, $, log } = ctx
  let link = null

  function show (state, detail) {
    $('bridge-status').textContent = detail ? `${SAID[state]} ${detail}` : SAID[state]
    const live = state === 'connecting' || state === 'connected' || state === 'retrying'
    $('bridge-connect').textContent = live ? 'Disconnect' : 'Connect'
    if (!live) link = null
  }

  async function connect () {
    const token = $('bridge-token').value.trim()
    if (!token) { show('refused', 'There is no token.'); return }
    await ctx.runtime.ensureRunning()
    link = connectBridge({
      url: `http://127.0.0.1:${ctx.hostConfig.bridgePort}`,
      token,
      surface: ctx.mcpSurface,
      EventSource: window.EventSource,
      // Bound: a detached fetch throws "Illegal invocation" in a browser.
      fetch: window.fetch.bind(window),
      onState: show,
      onCall: name => log(`agent: ${name}`)
    })
  }

  function mount () {
    $('bridgebar').addEventListener('submit', event => {
      event.preventDefault()
      if (link) { link.close(); return }
      connect().catch(error => { show('refused', error.message); log(`bridge: ${error.message}`, 'error') })
    })
  }

  return { mount }
}
