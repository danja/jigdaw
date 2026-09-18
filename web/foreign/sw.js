// web/foreign/sw.js
//
// The virtual origin a foreign plugin is served from. Contract section 12.3.
//
// A foreign plugin's code is inside one verified container, and everything it
// loads must resolve inside those bytes or be refused. A blob URL cannot do
// that: 22 of the 23 plugins in webaudiomodules/wam-examples locate themselves
// with `new URL('.', import.meta.url)`, and a blob URL has no directory, so
// every one of them breaks. A worker serving a scoped path gives them a real
// base to resolve against, and gives the host somewhere to refuse.
//
// The rule that makes this a boundary rather than a cache: **this worker never
// calls fetch**. A request under its scope is answered from the container or is
// answered 404. There is no path by which a plugin reaches the network through
// here, which is what section 12.3 requires and what a review of this file
// should check first.

// The paths this worker answers for. Fixed rather than derived from the scope,
// because the two are different things and conflating them was a bug.
//
// A service worker only intercepts requests from clients it CONTROLS, and a
// client is controlled when its own URL is inside the registration scope. The
// host page is at / and this worker was scoped to /foreign/, so the page was
// never controlled and none of its requests reached here: the import of a
// container's entry point went straight to the server and 404ed. Measured in
// Chrome, 2026-09-18.
//
// So the scope is the whole origin, and this prefix is what decides whether a
// request is ours. Everything outside it is passed through untouched, and
// inside it an unknown container id is passed through too, so the only requests
// this worker answers are for containers a page has installed.
const PREFIX = '/foreign/'

const containers = new Map()

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()))

self.addEventListener('message', event => {
  const message = event.data
  if (message?.type !== 'jigdaw-install-container') return
  containers.set(message.id, { files: message.files, refusals: [] })
  event.ports[0]?.postMessage({ ok: true, id: message.id, count: message.files.size })
})

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(PREFIX)) return

  const rest = url.pathname.slice(PREFIX.length)
  const slash = rest.indexOf('/')
  if (slash < 0) return

  const id = rest.slice(0, slash)
  const path = rest.slice(slash + 1)
  const container = containers.get(id)
  if (!container) return

  event.respondWith(answer(container, path, id))
})

function answer (container, path, id) {
  const file = container.files.get(path)
  if (!file) {
    // Recorded so the page can tell a person that a plugin reached outside
    // itself, which is worth knowing even when it carries on working.
    container.refusals.push(path)
    report(id, path)
    return new Response(
      `refused: ${path} is not in this container. Contract section 12.3.`,
      { status: 404, headers: { 'content-type': 'text/plain' } })
  }
  return new Response(file.bytes, {
    status: 200,
    headers: {
      'content-type': file.mediaType,
      // The container is already verified as a whole, and nothing here is
      // revalidated, so it must not be cached under these URLs: the id is a
      // digest and a second container would never reuse one, but a stale entry
      // outliving its page would be a file served from nowhere.
      'cache-control': 'no-store'
    }
  })
}

async function report (id, path) {
  for (const client of await self.clients.matchAll()) {
    client.postMessage({ type: 'jigdaw-container-refusal', id, path })
  }
}
