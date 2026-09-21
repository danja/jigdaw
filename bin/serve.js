// bin/serve.js
//
// A development server that serves what the contract says a plugin host and a
// plugin origin must serve. It is not production hosting; it exists so the
// browser exercises the real path rather than a convenient one.
//
//   Access-Control-Allow-Origin on everything, because a profile or a processor
//   without it is unreadable rather than merely untrusted (contract 1.3);
//   content negotiation on a plugin IRI, Turtle or JSON-LD or HTML (1.2);
//   application/wasm, because WebAssembly.compileStreaming refuses anything
//   else, and text/javascript for a worklet module.
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, extname, normalize } from 'node:path'
import { Catalogue, FACET_NAMES } from '../src/catalogue/Catalogue.js'
import { LocalCatalogue } from '../src/catalogue/LocalCatalogue.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 8748)
// Loopback by default. Nothing but nginx is published, and the store this will
// grow into exposes a SPARQL update endpoint. See docs/deployment.md.
const host = process.env.HOST ?? '127.0.0.1'

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jsonld': 'application/ld+json; charset=utf-8',
  '.ttl': 'text/turtle; charset=utf-8',
  '.wasm': 'application/wasm',
  '.css': 'text/css; charset=utf-8',
  '.wav': 'audio/wav'
})

const CORS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'accept, content-type',
  // Required of every cross-origin subresource under COEP require-corp, so a
  // host that opts into cross-origin isolation can still load these.
  'cross-origin-resource-policy': 'cross-origin'
})

function send (response, status, body, headers = {}) {
  response.writeHead(status, { ...CORS, ...headers })
  response.end(body)
}

/** Refuse any path that escapes the repository. */
/// Directories served from the repository root, beside web/. Everything the
/// page and the plugins need, and nothing else.
const SERVED_FROM_ROOT = new Set(['src', 'plugins', 'examples', 'vocabs', 'docs'])

function safeResolve (urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
  // A dot segment is either an escape attempt or a dotfile, and neither is
  // something this server has any business handing out.
  if (clean.split(/[/\\]/).some(segment => segment.startsWith('.') && segment !== '')) return null
  const full = resolve(root, '.' + (clean.startsWith('/') ? clean : `/${clean}`))
  return full.startsWith(root) ? full : null
}

async function serveFile (response, path) {
  try {
    const body = await readFile(path)
    send(response, 200, body, {
      'content-type': TYPES[extname(path)] ?? 'application/octet-stream',
      'content-length': body.length
    })
    return true
  } catch {
    return false
  }
}

function prefers (accept, type) {
  return (accept ?? '').toLowerCase().includes(type)
}

/**
 * A plugin IRI. Content negotiated, with HTML the default so that pasting the
 * IRI into a browser shows something useful. Contract section 1.2.
 */
async function servePluginIRI (request, response, dir) {
  const accept = request.headers.accept
  if (prefers(accept, 'text/turtle') || prefers(accept, 'application/ld+json')) {
    return serveFile(response, join(dir, 'profile.ttl'))
  }
  if (prefers(accept, 'text/html') || !accept) {
    let profile = ''
    try { profile = await readFile(join(dir, 'profile.ttl'), 'utf8') } catch { return false }
    const label = /rdfs:label "([^"]+)"/.exec(profile)?.[1] ?? 'Plugin'
    send(response, 200, `<!doctype html><meta charset=utf-8><title>${label}</title>
<style>body{font:14px/1.6 system-ui;margin:40px auto;max-width:44rem;background:#14161a;color:#e6e6e6}
pre{background:#0e1013;padding:16px;border-radius:6px;overflow:auto;font-size:12px}</style>
<h1>${label}</h1>
<p>A JigDAW plugin. This is the human-readable view; ask for <code>text/turtle</code> to get the profile.</p>
<pre>${profile.replace(/[<&]/g, c => ({ '<': '&lt;', '&': '&amp;' }[c]))}</pre>`,
    { 'content-type': TYPES['.html'] })
    return true
  }
  return serveFile(response, join(dir, 'profile.ttl'))
}

// The catalogue is queried here rather than from the page. Three reasons, and
// the first is the one that decides it: the queries stay in files under
// sparql/queries/, as AGENTS.md requires, instead of being bundled into the
// browser as strings. It also means one place to cache, and it does not depend
// on an upstream endpoint's CORS headers being right.
const catalogue = new Catalogue({
  endpoint: process.env.CATALOGUE_ENDPOINT ?? undefined
})

// This host's own plugins. Until they are harvested upstream, nothing else
// knows they exist, and a browser that lists hundreds of plugins none of which
// can run is a list rather than a browser.
const local = new LocalCatalogue()

// A small cache, because a person typing into a search box produces a request
// per keystroke and the upstream is someone else's server.
const CACHE_TTL = 60_000
const cache = new Map()

function cached (key) {
  const entry = cache.get(key)
  if (!entry) return null
  if (Date.now() - entry.at > CACHE_TTL) { cache.delete(key); return null }
  return entry.value
}

function remember (key, value) {
  // Bounded. An unbounded cache on a public endpoint is a memory leak with a
  // query string for a key.
  if (cache.size > 200) cache.delete(cache.keys().next().value)
  cache.set(key, { at: Date.now(), value })
}

async function serveCatalogue (request, response, url) {
  const key = url.pathname + url.search
  const hit = cached(key)
  if (hit) {
    return send(response, 200, hit, { 'content-type': TYPES['.json'], 'x-cache': 'hit' })
  }

  try {
    let result = null
    if (url.pathname === '/catalogue/search') {
      // A parameter this does not know is reported, never ignored. A silently
      // dropped facet returns a full result set that looks like an answer:
      // plugin-universe shipped exactly this, where ?category=reverb was
      // quietly ignored on one listing and nothing said so.
      const known = new Set(['q', 'limit', 'loadable', ...FACET_NAMES])
      const unknown = [...url.searchParams.keys()].filter(k => !known.has(k))
      if (unknown.length > 0) {
        return send(response, 400, JSON.stringify({
          error: `unknown parameter: ${unknown.join(', ')}`,
          known: [...known]
        }), { 'content-type': TYPES['.json'] })
      }

      const facets = {}
      for (const name of FACET_NAMES) {
        const value = url.searchParams.get(name)
        if (value) facets[name] = value
      }
      const query = {
        text: url.searchParams.get('q') ?? '',
        limit: Number(url.searchParams.get('limit') ?? 30),
        ...facets
      }

      // Ours first, always. They are the ones that can actually be loaded, and
      // burying them under several hundred that cannot is the complaint this
      // answers.
      const mine = await local.search(query)

      // `loadable` restricts the answer to plugins this host can run. It is the
      // default in the page, because that is what a person means by a plugin
      // browser, and it is a parameter rather than a hardcoded filter so the
      // rest of the catalogue stays one query away.
      const loadableOnly = url.searchParams.get('loadable') !== 'false'

      let upstream = []
      if (!loadableOnly) {
        try {
          upstream = await catalogue.search(query)
        } catch (error) {
          // A catalogue that is down must not hide the plugins we hold
          // ourselves, so this is reported alongside them rather than instead.
          result = { results: mine, upstreamError: error.message }
        }
      }

      if (!result) {
        const seen = new Set(mine.map(m => m.iri))
        result = {
          results: [...mine, ...upstream.filter(u => !seen.has(u.iri))],
          loadable: mine.length,
          loadableOnly
        }
      }
    } else {
      const iri = url.searchParams.get('iri')
      if (!iri) return send(response, 400, JSON.stringify({ error: 'describe needs an iri' }), { 'content-type': TYPES['.json'] })
      // Ours is authoritative for our own plugins: it reads the profile the
      // host actually serves, rather than someone's copy of it.
      result = (await local.describe(iri)) ?? await catalogue.describe(iri)
    }

    const body = JSON.stringify(result)
    remember(key, body)
    send(response, 200, body, { 'content-type': TYPES['.json'], 'x-cache': 'miss' })
  } catch (error) {
    // Named, so a failure reads as "the catalogue is down" rather than as the
    // search being broken.
    send(response, 502, JSON.stringify({ error: `catalogue: ${error.message}` }),
      { 'content-type': TYPES['.json'] })
  }
}

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, '')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return send(response, 405, 'method not allowed')
  }

  const url = new URL(request.url, `http://localhost:${port}`)
  const path = url.pathname

  if (path === '/catalogue/search' || path === '/catalogue/describe') {
    return serveCatalogue(request, response, url)
  }

  // The container worker needs a scope above its own path. A service worker
  // only intercepts requests from clients it controls, and a client is
  // controlled when its own URL is in scope; the page is at / and the script is
  // at /foreign/sw.js, so without this header the worker sees nothing the page
  // asks for. It answers only for /foreign/<container>/ regardless.
  if (path === '/foreign/sw.js') {
    const file = safeResolve('/web/foreign/sw.js')
    if (file) {
      try {
        const body = await readFile(file)
        return send(response, 200, body, {
          'content-type': TYPES['.js'],
          'content-length': body.length,
          'service-worker-allowed': '/'
        })
      } catch { /* fall through to the ordinary handler's 404 */ }
    }
  }

  // A signing key. docs/plugin-bundles.md section 6.3: a verification method is
  // an IRI a verifier dereferences, and the key inside a bundle is only a copy.
  //
  // Served without an extension, because the IRI is the identity and .ttl is a
  // fact about a file. The document describes fragments of itself, so one
  // document can carry several keys and a rotation adds one rather than
  // replacing the IRI everything already signed with.
  const key = /^\/keys\/([A-Za-z0-9_-]+)$/.exec(path)
  if (key) {
    const file = safeResolve(`/web/keys/${key[1]}.ttl`)
    if (file && await serveFile(response, file)) return
    return send(response, 404, `no key published at ${path}`)
  }

  if (path === '/') {
    if (await serveFile(response, join(root, 'web/index.html'))) return
  }

  // A plugin directory is an IRI, not a listing.
  if (/^\/plugins\/[^/]+\/$/.test(path)) {
    const dir = safeResolve(path)
    if (dir && await servePluginIRI(request, response, dir)) return
    return send(response, 404, `no plugin at ${path}`)
  }

  // web/ is served at the root so the page is at / rather than /web/. A path
  // that is not under web/ is served from the repository only if its first
  // segment is on the list below.
  //
  // It used to be served from the repository unconditionally, which meant the
  // live site served the whole working tree: `/package.json`, `/AGENTS.md`,
  // and `/.git/HEAD` and `/.git/index`, from which the entire history can be
  // reconstructed. Measured on strandz.it, 2026-09-18. Nothing in this
  // repository is secret, so nothing was leaked, but "nothing secret is in the
  // tree" is a property of today rather than a property of the server: a file
  // that is gitignored is still on the server's disk and was still served, and
  // gitignore is exactly where a key would be.
  //
  // An allowlist rather than a denylist, because a denylist is a list of the
  // mistakes somebody has already thought of.
  const first = path.split('/')[1] ?? ''
  const fromRoot = SERVED_FROM_ROOT.has(first) ? safeResolve(path) : null
  const candidates = [safeResolve(join('/web', path)), fromRoot].filter(Boolean)
  for (const candidate of candidates) {
    const info = await stat(candidate).catch(() => null)
    if (info?.isFile() && await serveFile(response, candidate)) return
  }

  send(response, 404, `not found: ${path}`)
})

server.listen(port, host, () => {
  console.log(`jigdaw server on http://${host}:${port}`)
  console.log(`  page:   http://127.0.0.1:${port}/`)
  console.log(`  plugin: http://127.0.0.1:${port}/plugins/cascade/`)
})
