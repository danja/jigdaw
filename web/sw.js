// web/sw.js
//
// Jiggy's one service worker: the app shell and offline use, with the foreign
// plugin container worker inside it. docs/pwa.md says why there is one and not
// two: a scope has one registration, and a second script at the same scope
// would replace the container worker without a word.
//
// The container worker (foreign/sw.js) is imported unchanged, keeps its own
// listeners and its own rule of never calling fetch, and answers everything
// under its prefix. This file answers nothing there: two fetch listeners may
// coexist only while one of them responds, and a request left alone here is
// the container worker's.
//
// Nothing here weakens the checks on plugin code. Each request is passed on as
// it arrived, so an `integrity` attribute on it survives, and a cached response
// handed to such a request is checked by the browser like any other. A cached
// plugin file that has been altered fails its digest and the plugin does not load.
importScripts('foreign/sw.js', 'precache.js')

const APP = self.APP_PRECACHE
const SHELL_CACHE = `jiggy-shell-${APP.version}`
const RUNTIME_CACHE = 'jiggy-runtime'
const SCOPE = new URL(self.registration.scope)
// The container worker's prefix is absolute, written for a root deployment, so
// both that and the same folder under this scope are left to it.
const CONTAINER_PATHS = ['/foreign/', new URL('foreign/', SCOPE).pathname]

const shellUrl = path => new URL(path, SCOPE).href

self.addEventListener('install', event => {
  // Every file or none: a shell with a file missing is a page that half loads
  // offline, so one failure fails the install and the old worker stays.
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE)
    await Promise.all(APP.files.map(async ({ path }) => {
      // Past the HTTP cache, so the precache holds what the server has now.
      const response = await fetch(new Request(shellUrl(path), { cache: 'reload' }))
      if (!response.ok) throw new Error(`precache: ${path} answered ${response.status}`)
      await cache.put(shellUrl(path), response)
    }))
  })())
})

self.addEventListener('activate', event => {
  // Other shells go; the runtime cache is kept, since a plugin opened before
  // is still the plugin. Only this app's caches are touched.
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith('jiggy-shell-') && name !== SHELL_CACHE) await caches.delete(name)
    }
  })())
})

/** Whether the app worker should look at a request at all. */
function ours (request, url) {
  if (request.method !== 'GET') return false
  if (url.origin !== self.location.origin) return false
  if (CONTAINER_PATHS.some(p => url.pathname.startsWith(p))) return false
  // A query is the catalogue or a search: never kept, or an old answer is served as a new one.
  if (url.search !== '') return false
  // A range request gets a partial answer, which is not a file.
  if (request.headers.has('range')) return false
  return true
}

/**
 * One URL answers Turtle, JSON-LD or HTML by the Accept header, so the copy is
 * kept under the URL and the Accept together. Otherwise a copy of the Turtle
 * is handed to a request for the page.
 */
const runtimeKey = (url, accept) => `${url.href}?__accept=${encodeURIComponent(accept)}`

async function respond (request, url) {
  const accept = request.headers.get('accept') ?? ''
  try {
    // Network first: online, the answer is current. The request goes on as it
    // is, integrity attribute and all.
    const response = await fetch(request)
    // Only a whole, plain answer is kept.
    if (response.status === 200 && response.type === 'basic') {
      const cache = await caches.open(RUNTIME_CACHE)
      await cache.put(runtimeKey(url, accept), response.clone())
    }
    return response
  } catch (networkError) {
    const shell = await caches.open(SHELL_CACHE)
    const held = await shell.match(url.href) ??
      (request.mode === 'navigate' ? await shell.match(shellUrl('./')) : undefined) ??
      await (await caches.open(RUNTIME_CACHE)).match(runtimeKey(url, accept))
    if (held) return held
    throw networkError
  }
}

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (!ours(event.request, url)) return
  event.respondWith(respond(event.request, url))
})
