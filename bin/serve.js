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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const port = Number(process.env.PORT ?? 8748)
// Loopback by default. Nothing but nginx is published, and the store this will
// grow into exposes a SPARQL update endpoint. See docs/deployment.md.
const host = process.env.HOST ?? '127.0.0.1'

const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
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
function safeResolve (urlPath) {
  const clean = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '')
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

const server = createServer(async (request, response) => {
  if (request.method === 'OPTIONS') return send(response, 204, '')
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return send(response, 405, 'method not allowed')
  }

  const url = new URL(request.url, `http://localhost:${port}`)
  const path = url.pathname

  if (path === '/') {
    if (await serveFile(response, join(root, 'web/index.html'))) return
  }

  // A plugin directory is an IRI, not a listing.
  if (/^\/plugins\/[^/]+\/$/.test(path)) {
    const dir = safeResolve(path)
    if (dir && await servePluginIRI(request, response, dir)) return
    return send(response, 404, `no plugin at ${path}`)
  }

  // web/ is served at the root so the page is at / rather than /web/.
  const candidates = [safeResolve(join('/web', path)), safeResolve(path)].filter(Boolean)
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
