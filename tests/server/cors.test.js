// tests/server/cors.test.js
//
// CORS, measured against the running server rather than read from its source.
//
// This project has had two CORS faults and neither was visible in a config
// file. A cross-origin profile served without Access-Control-Allow-Origin could
// not be loaded at all, and later node and nginx each added the header, which a
// browser rejects outright because two of them is not one of them. Both were
// found by curling through the real thing.
//
// So this starts bin/serve.js and asks it, on every route the page actually
// fetches. Header counting uses rawHeaders: node joins duplicates of most
// headers with a comma, so reading headers['access-control-allow-origin']
// would turn the exact fault this exists to catch into a plausible string.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { spawn } from 'node:child_process'
import { request } from 'node:http'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const PORT = 6091
const ORIGIN = 'https://somewhere-else.example'

let server

/** One request, returning the status and every raw header, undeduplicated. */
function ask (path, { method = 'GET', headers = {} } = {}) {
  return new Promise((ok, fail) => {
    const req = request(
      { host: '127.0.0.1', port: PORT, path, method, headers: { origin: ORIGIN, ...headers } },
      res => {
        res.resume()
        res.on('end', () => {
          const raw = []
          for (let i = 0; i < res.rawHeaders.length; i += 2) {
            raw.push([res.rawHeaders[i].toLowerCase(), res.rawHeaders[i + 1]])
          }
          ok({
            status: res.statusCode,
            raw,
            valuesOf: name => raw.filter(([k]) => k === name).map(([, v]) => v)
          })
        })
      })
    req.on('error', fail)
    req.end()
  })
}

beforeAll(async () => {
  server = spawn(process.execPath, [resolve(root, 'bin/serve.js')], {
    env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => fail(new Error('the server did not start')), 15000)
    server.stdout.on('data', chunk => {
      if (String(chunk).includes('jigdaw server on')) { clearTimeout(timer); ok() }
    })
    server.on('error', fail)
  })
}, 20000)

afterAll(() => { server?.kill() })

// Everything the page fetches cross-origin, plus the two a plugin author's
// origin has to serve. A route missing from this list is a route nothing checks.
const ROUTES = [
  '/',
  '/app.bundle.js',
  '/plugins/index.json',
  '/plugins/pulse/',
  '/plugins/pulse/pulse.wasm',
  '/plugins/pulse/pulse-processor.js',
  '/plugins/bassgen/',
  '/plugins/bassgen/bassgen.wasm',
  '/catalogue/search?q=reverb',
  '/docs/'
]

describe('the server, asked as a browser asks', () => {
  it('answers every route the page fetches', async () => {
    for (const path of ROUTES) {
      const res = await ask(path)
      expect(res.status, `${path} should be served`).toBe(200)
    }
  })

  it('sends exactly one Access-Control-Allow-Origin, never two', async () => {
    for (const path of ROUTES) {
      const values = (await ask(path)).valuesOf('access-control-allow-origin')
      // Two is as fatal as none and looks correct in every config file. It is
      // what sparql.plugin-universe.com does, measured 2026-09-17, and why no
      // browser application can query that endpoint.
      expect(values.length, `${path} returned ${values.length} ACAO headers: ${values.join(' | ')}`)
        .toBe(1)
      expect(values[0]).toBe('*')
    }
  })

  it('answers a preflight, so a plugin origin works for a fussy request', async () => {
    const res = await ask('/plugins/pulse/', {
      method: 'OPTIONS',
      headers: {
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'accept'
      }
    })
    expect(res.status).toBe(204)
    expect(res.valuesOf('access-control-allow-origin')).toEqual(['*'])
    expect(res.valuesOf('access-control-allow-headers')[0]).toMatch(/accept/i)
  })

  it('serves a wasm module as application/wasm', async () => {
    // A worklet compiling a module fetched as text/plain is a failure several
    // steps from its cause.
    const res = await ask('/plugins/pulse/pulse.wasm')
    expect(res.valuesOf('content-type')[0]).toBe('application/wasm')
  })

  it('refuses a search parameter it does not know, rather than ignoring it', async () => {
    // A silently dropped facet returns a full result set that looks like an
    // answer. plugin-universe shipped exactly that.
    const res = await ask('/catalogue/search?text=reverb')
    expect(res.status).toBe(400)
    expect(res.valuesOf('access-control-allow-origin')).toEqual(['*'])
  })
})
