// tests/mcp/BridgeServer.test.js
//
// Driven by the SDK's own MCP client over real HTTP, so the bridge is checked
// against a client that refuses what a real one refuses, rather than against a
// hand-made JSON-RPC request that only proves this file agrees with itself.
// The tab is played by reading the event stream and posting answers back, the
// same two requests the page makes.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { request as httpRequest } from 'node:http'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { createBridge, loopbackHost, loopbackOrigin } from '../../src/mcp/BridgeServer.js'
import { createTools } from '../../src/mcp/tools.js'

const TOKEN = 'test-token-0123456789'
let bridge
let port
let base

beforeEach(async () => {
  bridge = createBridge({ callTimeoutMs: 400, token: TOKEN })
  port = await bridge.listen(0)
  base = `http://127.0.0.1:${port}`
})
afterEach(async () => { await bridge.close() })

async function mcpClient () {
  const client = new Client({ name: 'test', version: '0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)))
  return client
}

/**
 * A tab: opens the event stream and answers each call with `answer(name, input)`,
 * or not at all if `answer` returns undefined.
 */
async function tab (answer) {
  const controller = new AbortController()
  const response = await fetch(`${base}/tab?token=${TOKEN}`, { signal: controller.signal })
  expect(response.status).toBe(200)
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const seen = []
  let buffer = ''
  const pump = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) return
        buffer += decoder.decode(value, { stream: true })
        let end
        while ((end = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, end)
          buffer = buffer.slice(end + 2)
          const event = /^event: (\w+)/m.exec(block)?.[1]
          const data = /^data: (.*)$/m.exec(block)?.[1]
          if (!event) continue
          seen.push({ event, data: JSON.parse(data) })
          if (event === 'call') {
            const { id, name, input } = JSON.parse(data)
            const result = answer(name, input)
            if (result !== undefined) {
              await fetch(`${base}/tab/result`, { method: 'POST', body: JSON.stringify({ token: TOKEN, id, result }) })
            }
          }
        }
      }
    } catch { /* aborted */ }
  })()
  // Wait for the hello, so the bridge knows the tab is there.
  while (!seen.some(e => e.event === 'hello')) await new Promise(resolve => setTimeout(resolve, 5))
  return { seen, close: () => { controller.abort(); return pump } }
}

/** A raw request, for headers fetch will not let a caller set. */
function raw (path, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, res => {
      let body = ''
      res.on('data', c => { body += c })
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }))
    })
    req.on('error', reject)
    req.end()
  })
}

describe('what counts as this machine', () => {
  it('knows a loopback Host, with or without a port', () => {
    for (const host of ['127.0.0.1:8749', 'localhost', 'localhost:1', '[::1]:8749']) expect(loopbackHost(host), host).toBe(true)
    for (const host of ['evil.example', 'evil.example:8749', '127.0.0.1.evil.example', '', undefined]) expect(loopbackHost(host), host).toBe(false)
  })

  it('knows a loopback Origin, and lets a request with none through', () => {
    expect(loopbackOrigin(undefined)).toBe(true)
    expect(loopbackOrigin('http://127.0.0.1:8748')).toBe(true)
    expect(loopbackOrigin('http://localhost:8748')).toBe(true)
    expect(loopbackOrigin('https://strandz.it')).toBe(false)
    expect(loopbackOrigin('null')).toBe(false)
  })
})

describe('the MCP endpoint', () => {
  it('lists exactly the tools src/mcp/tools.js defines, with their schemas', async () => {
    const client = await mcpClient()
    const { tools } = await client.listTools()
    const defined = createTools({ dispatcher: {} })
    expect(tools.map(t => t.name).sort()).toEqual(defined.map(t => t.name).sort())
    const status = tools.find(t => t.name === 'clip_add')
    expect(status.inputSchema).toEqual(defined.find(t => t.name === 'clip_add').inputSchema)
    await client.close()
  })

  it('says how to connect a page when none is connected', async () => {
    const client = await mcpClient()
    const result = await client.callTool({ name: 'status', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/No Jiggy page is connected/)
    await client.close()
  })

  it('runs a call in the page and returns what the page answered', async () => {
    const page = await tab((name, input) => ({ ok: true, name, echoed: input }))
    const client = await mcpClient()
    const result = await client.callTool({ name: 'track_add', arguments: { label: 'Drums' } })
    expect(result.isError).toBe(false)
    expect(JSON.parse(result.content[0].text)).toEqual({ ok: true, name: 'track_add', echoed: { label: 'Drums' } })
    await client.close()
    await page.close()
  })

  it('marks a failure the page reports as an error', async () => {
    const page = await tab(() => ({ ok: false, error: 'no such track: t9' }))
    const client = await mcpClient()
    const result = await client.callTool({ name: 'track_remove', arguments: { trackId: 't9' } })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/no such track/)
    await client.close()
    await page.close()
  })

  it('gives up on a page that does not answer, and says so', async () => {
    const page = await tab(() => undefined)
    const client = await mcpClient()
    const result = await client.callTool({ name: 'status', arguments: {} })
    expect(result.isError).toBe(true)
    expect(result.content[0].text).toMatch(/did not answer status within 400 ms/)
    await client.close()
    await page.close()
  })

  it('refuses a tool that does not exist without troubling the page', async () => {
    const page = await tab(() => ({ ok: true }))
    const client = await mcpClient()
    const result = await client.callTool({ name: 'format_disk', arguments: {} })
    expect(result.isError).toBe(true)
    expect(page.seen.filter(e => e.event === 'call')).toEqual([])
    await client.close()
    await page.close()
  })
})

describe('what it refuses', () => {
  it('refuses a request whose Host is not this machine, which is DNS rebinding', async () => {
    const response = await raw('/mcp', { method: 'POST', headers: { host: 'evil.example:8749', 'content-type': 'application/json' } })
    expect(response.status).toBe(403)
  })

  it('refuses a browser request from a page on another origin, on both endpoints', async () => {
    expect((await raw('/mcp', { method: 'POST', headers: { origin: 'https://evil.example' } })).status).toBe(403)
    expect((await raw(`/tab?token=${TOKEN}`, { headers: { origin: 'https://evil.example' } })).status).toBe(403)
  })

  it('refuses a tab without the token, and a result without it', async () => {
    expect((await raw('/tab?token=guess')).status).toBe(403)
    expect((await raw('/tab')).status).toBe(403)
    const posted = await fetch(`${base}/tab/result`, { method: 'POST', body: JSON.stringify({ token: 'guess', id: 'x', result: {} }) })
    expect(posted.status).toBe(403)
  })

  it('answers the tab\'s own origin in CORS, never "*"', async () => {
    const preflight = await raw('/tab/result', { method: 'OPTIONS', headers: { origin: 'http://127.0.0.1:8748' } })
    expect(preflight.headers['access-control-allow-origin']).toBe('http://127.0.0.1:8748')
  })
})

describe('one page at a time', () => {
  it('hands calls to the page that connected last, as a reload does', async () => {
    const first = await tab(() => ({ ok: true, from: 'first' }))
    const second = await tab(() => ({ ok: true, from: 'second' }))
    const client = await mcpClient()
    const result = await client.callTool({ name: 'status', arguments: {} })
    expect(JSON.parse(result.content[0].text).from).toBe('second')
    await client.close()
    await first.close()
    await second.close()
  })

  it('knows when the page has gone', async () => {
    const page = await tab(() => ({ ok: true }))
    expect(bridge.connected).toBe(true)
    await page.close()
    for (let i = 0; i < 50 && bridge.connected; i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(bridge.connected).toBe(false)
  })
})

describe('configuration', () => {
  it('needs its call timeout given, not defaulted', () => {
    expect(() => createBridge({})).toThrow(/callTimeoutMs/)
  })
})

describe('end to end, through the page\'s own client', () => {
  // The whole path: an agent's MCP client, the bridge, the page's client
  // (src/mcp/BridgeClient.js) and the page's tool surface over a real
  // dispatcher. EventSource is the eventsource package the SDK itself depends
  // on, because node's own is still behind a flag.
  it('adds a track in the page when an agent asks', async () => {
    const { EventSource } = await import('eventsource')
    const { OpDispatcher } = await import('../../src/ops/OpDispatcher.js')
    const { registerTools } = await import('../../src/mcp/adapter.js')
    const { connectBridge } = await import('../../src/mcp/BridgeClient.js')

    const dispatcher = new OpDispatcher()
    const { surface } = registerTools({ dispatcher, target: {} })
    const states = []
    const calls = []
    const page = connectBridge({
      url: base, token: TOKEN, surface, EventSource, fetch,
      onState: s => states.push(s), onCall: n => calls.push(n)
    })
    for (let i = 0; i < 100 && !states.includes('connected'); i++) await new Promise(resolve => setTimeout(resolve, 10))
    expect(states).toContain('connected')

    const client = await mcpClient()
    const added = await client.callTool({ name: 'track_add', arguments: { label: 'Drums' } })
    expect(added.isError).toBe(false)
    const { trackId } = JSON.parse(added.content[0].text)
    expect(dispatcher.project.track(trackId).label).toBe('Drums')

    const status = JSON.parse((await client.callTool({ name: 'status', arguments: {} })).content[0].text)
    expect(status.tracks).toBe(1)
    expect(calls).toEqual(['track_add', 'status'])

    await client.close()
    page.close()
  })
})
