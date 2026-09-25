// src/mcp/BridgeServer.js
//
// A local MCP server whose tools run in an open Jiggy page.
//
// The session lives in a browser tab, with its audio, and a tab cannot accept
// a connection. So this process holds the MCP endpoint, and the page connects
// out to it: a server-sent event stream carries each tool call down to the
// tab, which runs it through the same surface WebMCP and the console use
// (src/mcp/adapter.js) and posts the result back. Nothing here implements a
// tool. The list of tools comes from src/mcp/tools.js, the one definition.
//
// Local, and only local. Everything listens on loopback, and three checks
// stand between it and anything else on the machine:
//
// - Host. A request whose Host header is not loopback is refused, which is
//   what stops a web page using DNS rebinding to reach this port under a name
//   it controls.
// - Origin. A browser request from a page that is not itself on loopback is
//   refused, on the MCP endpoint and on the tab's.
// - The token. The tab must present the token this process printed when it
//   started. Another page on the machine can reach loopback; it cannot know
//   the token. A person pastes it into the page, which is the pairing.
//
// One tab at a time. A second tab presenting the token replaces the first,
// which is what reloading the page looks like.
import { createServer } from 'node:http'
import { randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { createTools } from './tools.js'

export const MCP_PATH = '/mcp'
export const TAB_PATH = '/tab'
export const RESULT_PATH = '/tab/result'

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

const INSTRUCTIONS = `Drives a Jiggy session, the JigDAW browser host, open in a browser on this machine.

Every tool runs in that page against the live session, which you can hear. Call status first:
it is cheap and says what is loaded. A track is a chain of plugins ending in a fader; clips on
a track play against the transport. Plugins are identified by absolute IRIs; plugins_search
finds them. Changesets are atomic, and expectedRevision guards against editing a session that
moved on.

If a call says no page is connected, the person has to open Jiggy and paste this bridge's
token into its Agent bridge section.`

/** Whether a Host header names this machine. */
export function loopbackHost (host) {
  if (!host) return false
  const name = host.startsWith('[') ? host.slice(0, host.indexOf(']') + 1) : host.split(':')[0]
  return LOOPBACK.has(name)
}

/** Whether an Origin is a page on this machine. Absent is not a browser, and is allowed. */
export function loopbackOrigin (origin) {
  if (origin === undefined) return true
  try {
    const url = new URL(origin)
    return (url.protocol === 'http:' || url.protocol === 'https:') && LOOPBACK.has(url.hostname)
  } catch { return false }
}

function sameToken (given, token) {
  if (typeof given !== 'string') return false
  const a = Buffer.from(given)
  const b = Buffer.from(token)
  return a.length === b.length && timingSafeEqual(a, b)
}

/** The tools' descriptions, from their one definition. Their handlers are never called here. */
function toolList () {
  return createTools({ dispatcher: {} }).map(({ name, description, inputSchema }) => ({ name, description, inputSchema }))
}

/**
 * Build the bridge. Nothing listens until `listen()`.
 *
 * - `callTimeoutMs`: how long a tool call waits for the page. From
 *   configuration; a plugin load can take seconds.
 * - `token`: for a test. Otherwise one is made, and `token` reports it.
 */
export function createBridge ({ callTimeoutMs, token = randomBytes(18).toString('base64url'), log = () => {} }) {
  if (!Number.isInteger(callTimeoutMs) || callTimeoutMs < 1) throw new Error('createBridge needs callTimeoutMs, from configuration')
  const tools = toolList()
  let tab = null // { response, origin }
  const waiting = new Map() // call id -> { resolve, timer }

  /** Send a call down to the tab and wait for its answer. */
  function callTab (name, input) {
    if (!tab) {
      return Promise.resolve({ ok: false, error: 'No Jiggy page is connected. Open Jiggy, and paste this bridge\'s token into its Agent bridge section.' })
    }
    const id = randomUUID()
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        waiting.delete(id)
        resolve({ ok: false, error: `The Jiggy page did not answer ${name} within ${callTimeoutMs} ms.` })
      }, callTimeoutMs)
      waiting.set(id, { resolve, timer })
      tab.response.write(`event: call\ndata: ${JSON.stringify({ id, name, input })}\n\n`)
    })
  }

  /** A fresh MCP server per request: the state is the tab, not the protocol session. */
  function mcpServer () {
    const server = new Server({ name: 'jiggy', title: 'Jiggy', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: INSTRUCTIONS })
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
    server.setRequestHandler(CallToolRequestSchema, async request => {
      const { name, arguments: input = {} } = request.params
      if (!tools.some(t => t.name === name)) {
        return { isError: true, content: [{ type: 'text', text: `No such tool: ${name}` }] }
      }
      log(`call ${name}`)
      const result = await callTab(name, input)
      return { isError: result?.ok === false, content: [{ type: 'text', text: JSON.stringify(result) }] }
    })
    return server
  }

  const refuse = (response, status, message) => {
    response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
    response.end(message)
  }

  /** CORS for the tab's own two requests: its origin only, never "*". */
  const corsFor = origin => (origin
    ? { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-headers': 'content-type', 'access-control-allow-methods': 'GET, POST' }
    : {})

  async function handle (request, response) {
    const url = new URL(request.url, 'http://127.0.0.1')
    const origin = request.headers.origin
    if (!loopbackHost(request.headers.host)) return refuse(response, 403, 'This bridge answers on loopback only.')
    if (!loopbackOrigin(origin)) return refuse(response, 403, 'This bridge answers pages on this machine only.')

    if (url.pathname === MCP_PATH) {
      if (request.method !== 'POST') return refuse(response, 405, 'POST only: this endpoint is stateless.')
      const server = mcpServer()
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
      response.on('close', () => { transport.close(); server.close() })
      await server.connect(transport)
      await transport.handleRequest(request, response)
      return
    }

    if (request.method === 'OPTIONS' && (url.pathname === TAB_PATH || url.pathname === RESULT_PATH)) {
      response.writeHead(204, corsFor(origin))
      response.end()
      return
    }

    if (url.pathname === TAB_PATH && request.method === 'GET') {
      if (!sameToken(url.searchParams.get('token'), token)) return refuse(response, 403, 'Wrong token.')
      if (tab) tab.response.end()
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', ...corsFor(origin) })
      response.write(`event: hello\ndata: ${JSON.stringify({ tools: tools.length })}\n\n`)
      const mine = { response, origin }
      tab = mine
      log('page connected')
      const heartbeat = setInterval(() => response.write(': still here\n\n'), 15000)
      request.on('close', () => {
        clearInterval(heartbeat)
        if (tab === mine) { tab = null; log('page disconnected') }
      })
      return
    }

    if (url.pathname === RESULT_PATH && request.method === 'POST') {
      let body = ''
      for await (const chunk of request) {
        body += chunk
        if (body.length > 8 * 1024 * 1024) return refuse(response, 413, 'Too large.')
      }
      let message
      try { message = JSON.parse(body) } catch { return refuse(response, 400, 'Not JSON.') }
      if (!sameToken(message?.token, token)) return refuse(response, 403, 'Wrong token.')
      const pending = waiting.get(message.id)
      if (pending) {
        clearTimeout(pending.timer)
        waiting.delete(message.id)
        pending.resolve(message.result)
      }
      response.writeHead(204, corsFor(origin))
      response.end()
      return
    }

    refuse(response, 404, 'Nothing here.')
  }

  const http = createServer((request, response) => {
    handle(request, response).catch(error => {
      log(`request failed: ${error.message}`)
      if (!response.headersSent) refuse(response, 500, 'The bridge failed on that request.')
    })
  })

  return {
    token,
    get connected () { return tab !== null },
    /** Listen on loopback. Resolves with the port, which a test can ask to be chosen. */
    listen (port) {
      return new Promise((resolve, reject) => {
        http.once('error', reject)
        http.listen(port, '127.0.0.1', () => resolve(http.address().port))
      })
    },
    close () {
      tab?.response.end()
      for (const { timer } of waiting.values()) clearTimeout(timer)
      http.closeAllConnections?.()
      return new Promise(resolve => http.close(() => resolve()))
    }
  }
}
