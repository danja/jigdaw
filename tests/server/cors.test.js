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
  '/catalogue/search?q=reverb'
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

/** The same, but keeping the body, which the key document needs. */
function askBody (path) {
  return new Promise((ok, fail) => {
    const req = request({ host: '127.0.0.1', port: PORT, path, method: 'GET' }, res => {
      let body = ''
      res.setEncoding('utf8')
      res.on('data', chunk => { body += chunk })
      res.on('end', () => ok({ status: res.statusCode, body }))
    })
    req.on('error', fail)
    req.end()
  })
}

describe('the signing key route', () => {
  // docs/plugin-bundles.md section 6.3: a verification method is an IRI a
  // verifier dereferences, and the key inside a bundle is only a copy. Until
  // this route existed there was nowhere for the other copy to live, so every
  // JigDAW signature could only ever be checked against itself.
  //
  // Served without a file extension, because the IRI is the identity and .ttl
  // is a fact about a file.
  const file = resolve(root, 'web/keys/route-test.ttl')
  let multibase

  beforeAll(async () => {
    const { mkdir, writeFile } = await import('node:fs/promises')
    const { generateKeyPair } = await import('../../src/host/Signature.js')
    const { publicKeyDocument } = await import('../../bin/keys.js')
    const pair = await generateKeyPair()
    multibase = pair.publicKeyMultibase
    await mkdir(resolve(root, 'web/keys'), { recursive: true })
    await writeFile(file, publicKeyDocument({
      verificationMethod: 'https://strandz.it/jigdaw/keys/route-test#ed25519',
      publicKeyMultibase: multibase
    }))
  })

  afterAll(async () => {
    const { rm } = await import('node:fs/promises')
    await rm(file, { force: true })
  })

  it('serves a published key as Turtle, with exactly one CORS header', async () => {
    const response = await ask('/keys/route-test')
    expect(response.status).toBe(200)
    expect(response.valuesOf('content-type')).toEqual(['text/turtle; charset=utf-8'])
    expect(response.valuesOf('access-control-allow-origin')).toEqual(['*'])
  })

  it('serves the key that was published, not a copy of something else', async () => {
    const response = await askBody('/keys/route-test')
    expect(response.body).toContain(multibase)
    expect(response.body).toContain('sec:Multikey')
  })

  it('answers 404 for a key nobody published', async () => {
    expect((await ask('/keys/nobody')).status).toBe(404)
  })

  it('takes a name, not a path', async () => {
    // Anything else would be a file server rooted at web/keys, which is where a
    // private key would eventually be read from by accident. /keys/../x is not
    // tested here because the browser and node both normalise it away before it
    // arrives; what happens to it afterwards is the allowlist's job, below.
    // The .ttl form is still reachable through the ordinary web/ handler, which
    // is untidy but harmless: it is a public document either way. What matters
    // is that the route itself takes a name.
    for (const path of ['/keys/a/b', '/keys/.hidden', '/keys/route%2Dtest/x']) {
      expect((await ask(path)).status, path).not.toBe(200)
    }
  })
})

describe('what the server does not serve', () => {
  // bin/serve.js runs the live site, and it used to serve the whole working
  // tree: /package.json, /AGENTS.md, and /.git/HEAD and /.git/index, from which
  // the repository can be reconstructed. Measured on strandz.it, 2026-09-18.
  //
  // Nothing in this repository is secret so nothing was leaked, but that is a
  // property of today's tree rather than of the server. A gitignored file is
  // still on the server's disk, and gitignore is exactly where a key lives.
  const REFUSED = [
    '/package.json', '/package-lock.json', '/AGENTS.md', '/TODO.md', '/MISTAKES.md',
    '/.git/HEAD', '/.git/config', '/.git/index', '/.gitignore', '/install.sh',
    '/node_modules/vitest/package.json', '/native/jigdaw-adapter/src/Chain.cpp'
  ]

  it.each(REFUSED)('refuses %s', async path => {
    expect((await ask(path)).status).not.toBe(200)
  })

  it('still serves everything the page and the plugins need', async () => {
    // The other half, and the one that makes this a change rather than a
    // breakage. An allowlist that is too tight breaks the site quietly.
    for (const path of ['/', '/app.bundle.js', '/src/host/ForeignLoader.js',
      '/plugins/pulse/pulse.wasm', '/plugins/pulse/', '/foreign/probe.html']) {
      expect((await ask(path)).status, path).toBe(200)
    }
  })

  it('refuses a dotfile, and an escape that normalises somewhere unserved', async () => {
    // `.` and `..` are normalised away before the check sees them, which is
    // right: `/plugins/./pulse/` is `/plugins/pulse/` and not an escape. What
    // stops `/src/../package.json` is the allowlist, after normalisation, and
    // what stops a dotfile is the segment check.
    for (const path of ['/src/../package.json', '/docs/.hidden', '/web/../.gitignore']) {
      expect((await ask(path)).status, path).not.toBe(200)
    }
    expect((await ask('/plugins/./pulse/profile.ttl')).status,
      'a . segment normalises away and is not an escape').toBe(200)
  })
})
