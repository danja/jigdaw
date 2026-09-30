// tests/web/Pwa.test.js
//
// The installable shell: manifest, icons, the precache list and the service
// worker. The worker is run for real, in a vm, with a fake of the browser's cache
// and fetch that refuses what the real ones refuse: a cache.put of a partial or an
// already read response, a second respondWith on one event. A fake more lenient than
// the browser would pass a worker the browser rejects (CLAUDE.md).
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import vm from 'node:vm'
import { buildPrecache, shellFiles } from '../../bin/build-precache.js'
import { digestOf, verifyIntegrity } from '../../src/host/Integrity.js'

const root = resolve(import.meta.dirname, '../..')
const web = name => join(root, 'web', name)
const read = name => readFileSync(web(name), 'utf8')

describe('the manifest', () => {
  const manifest = JSON.parse(read('manifest.webmanifest'))

  it('names the app and starts and scopes it relative to where it is served, so a path deployment works', () => {
    expect(manifest.name).toBe('Jiggy')
    // The installed app opens the simple page; the studio is one link away and inside the scope.
    expect(manifest.start_url).toBe('simple.html')
    expect(manifest.scope).toBe('./')
    expect(manifest.display).toBe('standalone')
  })

  it('has icons of the sizes it says, as PNG, including a maskable one, and the files exist', () => {
    for (const icon of manifest.icons) {
      const file = web(icon.src)
      expect(existsSync(file), icon.src).toBe(true)
      const bytes = readFileSync(file)
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
      const [w, h] = icon.sizes.split('x').map(Number)
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([w, h])
    }
    const sizes = manifest.icons.filter(i => i.purpose === 'any').map(i => i.sizes)
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']))
    expect(manifest.icons.some(i => i.purpose === 'maskable')).toBe(true)
  })

  it('is linked from the page, with the theme colour the manifest gives and an icon for iOS', () => {
    const html = read('index.html')
    expect(html).toContain('<link rel="manifest" href="manifest.webmanifest">')
    expect(html).toContain(`<meta name="theme-color" content="${manifest.theme_color}">`)
    const apple = /rel="apple-touch-icon" href="([^"]+)"/.exec(html)?.[1]
    expect(apple && existsSync(web(apple))).toBe(true)
  })
})

describe('the precache list', () => {
  it('is what the build would write now, so a stale list fails here', () => {
    expect(read('precache.js')).toBe(buildPrecache())
  })

  it('lists every file that exists, and only those', () => {
    const listed = shellFiles()
    for (const [path, disk] of listed) expect(existsSync(join(root, disk)), `${path} -> ${disk}`).toBe(true)
  })

  it('holds what the page fetches to start, and every bundled preset and icon, found by walking the folders', () => {
    const paths = shellFiles().map(([p]) => p)
    for (const needed of ['./', 'app.bundle.js', 'host.json', 'vocabs/shapes.ttl', 'manifest.webmanifest', 'presets/index.json']) {
      expect(paths, needed).toContain(needed)
    }
    for (const f of readdirSync(web('presets')).filter(f => f.endsWith('.ttl'))) expect(paths).toContain(`presets/${f}`)
    for (const f of readdirSync(web('icons')).filter(f => f.endsWith('.png'))) expect(paths).toContain(`icons/${f}`)
  })

  it('changes its version when a file changes', () => {
    const version = text => /"version": "([0-9a-f]+)"/.exec(text)[1]
    expect(version(read('precache.js'))).toMatch(/^[0-9a-f]{12}$/)
  })
})

// ── the worker, run ───────────────────────────────────────────────────────────

const SCOPE = 'https://site.test/'
const basic = (body, { status = 200, headers = {} } = {}) => {
  const response = new Response(body, { status, headers })
  Object.defineProperty(response, 'type', { value: 'basic' })
  return response
}

function fakeCaches () {
  const stores = new Map()
  const strip = key => (typeof key === 'string' ? key : key.url).replace(/#.*$/, '')
  const cache = name => ({
    async put (request, response) {
      if (response.status === 206) throw new TypeError('Cache.put cannot store a partial response')
      if (response.bodyUsed) throw new TypeError('Cache.put was given a response whose body was already read')
      if (response.headers.get('vary') === '*') throw new TypeError('Cache.put cannot store Vary: *')
      const body = await response.arrayBuffer()
      stores.get(name).set(strip(request), { body, status: response.status, headers: [...response.headers] })
    },
    async match (request) {
      const held = stores.get(name).get(strip(request))
      return held ? new Response(held.body, { status: held.status, headers: held.headers }) : undefined
    }
  })
  return {
    stores,
    async open (name) { if (!stores.has(name)) stores.set(name, new Map()); return cache(name) },
    async keys () { return [...stores.keys()] },
    async delete (name) { return stores.delete(name) }
  }
}

/** Load web/sw.js, with foreign/sw.js and precache.js imported into it, in a fake worker global. */
function loadWorker ({ network, scope = SCOPE }) {
  const listeners = { install: [], activate: [], fetch: [], message: [] }
  const caches = fakeCaches()
  const fetched = []
  const self = {
    registration: { scope },
    location: { origin: 'https://site.test' },
    addEventListener: (type, fn) => listeners[type]?.push(fn),
    skipWaiting () {},
    clients: { claim () {}, matchAll: async () => [] }
  }
  const context = vm.createContext({
    self,
    caches,
    Request,
    Response,
    URL,
    Headers,
    console,
    fetch: async request => { fetched.push(request); return network(request) },
    importScripts: (...names) => {
      for (const name of names) vm.runInContext(readFileSync(web(name), 'utf8'), context, { filename: name })
    }
  })
  context.self = Object.assign(self, context)
  vm.runInContext(readFileSync(web('sw.js'), 'utf8'), context, { filename: 'sw.js' })

  const waitAll = async type => {
    const waits = []
    for (const fn of listeners[type]) fn({ waitUntil: p => waits.push(p) })
    await Promise.all(waits)
  }
  return {
    caches,
    fetched,
    listeners,
    install: () => waitAll('install'),
    activate: () => waitAll('activate'),
    /** Deliver a fetch the way the browser does. `responded` is which listeners answered. */
    async fetch (request) {
      let promise = null
      let answers = 0
      const event = {
        request,
        respondWith (p) {
          // One answer per event, as the real one.
          if (answers > 0) throw new Error('InvalidStateError: respondWith was already called')
          answers++
          promise = Promise.resolve(p)
        }
      }
      for (const fn of listeners.fetch) fn(event)
      return { answered: answers > 0, response: promise ? await promise : null }
    }
  }
}

const get = (path, { accept = null, mode = 'cors', headers = {}, integrity } = {}) =>
  new Request(new URL(path, SCOPE), { headers: { ...(accept ? { accept } : {}), ...headers }, mode, ...(integrity ? { integrity } : {}) })

const filesAt = () => Object.fromEntries(shellFiles().map(([p]) => [new URL(p, SCOPE).href, `body of ${p}`]))

describe('the service worker, installing and activating', () => {
  it('keeps every file of the shell, fetched past the HTTP cache', async () => {
    const content = filesAt()
    const w = loadWorker({ network: async r => basic(content[r.url]) })
    await w.install()
    const shell = [...w.caches.stores.keys()].find(n => n.startsWith('jiggy-shell-'))
    expect([...w.caches.stores.get(shell).keys()].sort()).toEqual(Object.keys(content).sort())
    expect(w.fetched.every(r => r.cache === 'reload')).toBe(true)
  })

  it('fails the whole install if any file is missing, so a half shell is never used', async () => {
    const content = filesAt()
    const missing = new URL('host.json', SCOPE).href
    const w = loadWorker({ network: async r => (r.url === missing ? basic('nope', { status: 404 }) : basic(content[r.url])) })
    await expect(w.install()).rejects.toThrow(/host\.json answered 404/)
  })

  it('deletes the shells of other versions on activate, and leaves the runtime cache and other apps alone', async () => {
    const w = loadWorker({ network: async r => basic('x') })
    await w.caches.open('jiggy-shell-old')
    await w.caches.open('jiggy-runtime')
    await w.caches.open('someone-elses-cache')
    await w.install()
    await w.activate()
    const names = await w.caches.keys()
    expect(names).not.toContain('jiggy-shell-old')
    expect(names).toEqual(expect.arrayContaining(['jiggy-runtime', 'someone-elses-cache']))
  })
})

describe('the service worker, answering', () => {
  let online
  let w
  beforeEach(async () => {
    online = true
    const content = filesAt()
    w = loadWorker({
      network: async r => {
        if (!online) throw new TypeError('Failed to fetch')
        const url = new URL(r.url)
        if (content[r.url]) return basic(content[r.url])
        if (url.pathname === '/plugins/p/') {
          return basic((r.headers.get('accept') ?? '').includes('turtle') ? '@prefix ttl' : '<html>page</html>')
        }
        return basic('missing', { status: 404 })
      }
    })
    await w.install()
    await w.activate()
  })

  it('answers from the network while online, and passes the request on as it arrived, integrity attribute and all', async () => {
    const digest = await digestOf(new TextEncoder().encode('@prefix ttl'))
    const request = get('plugins/p/', { accept: 'text/turtle', integrity: digest })
    const { response } = await w.fetch(request)
    expect(await response.text()).toBe('@prefix ttl')
    // The request itself, not a copy that has lost what it carried.
    expect(w.fetched.at(-1)).toBe(request)
    expect(w.fetched.at(-1).integrity).toBe(digest)
  })

  it('serves what it kept when the network is gone, so a plugin opened once works offline', async () => {
    await w.fetch(get('plugins/p/', { accept: 'text/turtle' }))
    online = false
    const { response } = await w.fetch(get('plugins/p/', { accept: 'text/turtle' }))
    expect(await response.text()).toBe('@prefix ttl')
  })

  it('never hands a copy kept for one Accept to a request with another', async () => {
    await w.fetch(get('plugins/p/', { accept: 'text/turtle' }))
    online = false
    await expect(w.fetch(get('plugins/p/', { accept: 'text/html' }))).rejects.toThrow(/Failed to fetch/)
  })

  it('says so, with the network error, when it has neither the network nor a copy', async () => {
    online = false
    await expect(w.fetch(get('plugins/never-seen/'))).rejects.toThrow(/Failed to fetch/)
  })

  it('serves a page from the shell offline, and any address of the app as the app', async () => {
    online = false
    const asset = await w.fetch(get('app.bundle.js'))
    expect(await asset.response.text()).toBe('body of app.bundle.js')
    // A navigation request cannot be constructed in script (the real Request refuses mode
    // "navigate" too), so it is given as the shape the worker reads.
    const navigation = await w.fetch({ url: new URL('some/deep/link', SCOPE).href, method: 'GET', mode: 'navigate', headers: new Headers() })
    expect(await navigation.response.text()).toBe('body of ./')
  })

  it('does not keep a failure, a partial answer or an answer that is not plain', async () => {
    await w.fetch(get('plugins/gone/'))
    const stores = w.caches.stores
    expect(stores.get('jiggy-runtime')?.size ?? 0).toBe(0)
    const partial = loadWorker({ network: async () => basic('half', { status: 206 }) })
    await partial.fetch(get('plugins/x/'))
    expect(partial.caches.stores.get('jiggy-runtime')?.size ?? 0).toBe(0)
    const opaque = loadWorker({ network: async () => new Response('x') })
    await opaque.fetch(get('plugins/x/'))
    expect(opaque.caches.stores.get('jiggy-runtime')?.size ?? 0).toBe(0)
  })

  it('leaves alone what it must not touch: other methods, other origins, queries, ranges and the container', async () => {
    const cases = [
      new Request(new URL('plugins/p/', SCOPE), { method: 'POST', body: 'x' }),
      new Request('https://elsewhere.test/plugins/p/'),
      get('catalogue/search?q=reverb'),
      get('media/loop.wav', { headers: { range: 'bytes=0-99' } }),
      get('foreign/container.js')
    ]
    for (const request of cases) {
      const { answered } = await w.fetch(request)
      expect(answered, request.url).toBe(false)
    }
    expect(w.caches.stores.get('jiggy-runtime')?.size ?? 0).toBe(0)
  })

  it('coexists with the container worker: both are loaded, and one request is answered at most once', async () => {
    // web/foreign/sw.js is imported into the same global. A container path is its own, so the
    // app listener stays out, and an ordinary path is answered exactly once.
    const own = await w.fetch(get('foreign/anything'))
    expect(own.answered).toBe(false)
    const ordinary = await w.fetch(get('host.json'))
    expect(ordinary.answered).toBe(true)
  })

  it('a cached plugin file that has been altered fails the digest the profile declares', async () => {
    const original = new TextEncoder().encode('the plugin code')
    const declared = await digestOf(original)
    const w2 = loadWorker({ network: async () => basic('the plugin code') })
    await w2.fetch(get('plugins/p/code.js'))
    // Someone alters the kept copy.
    w2.caches.stores.get('jiggy-runtime').forEach((held, key) => w2.caches.stores.get('jiggy-runtime').set(key, { ...held, body: new TextEncoder().encode('evil code').buffer }))
    const w3 = w2
    // Offline, the altered copy is what the worker holds; the host's own check is what stops it.
    const offline = loadWorker({ network: async () => { throw new TypeError('Failed to fetch') } })
    offline.caches.stores.set('jiggy-runtime', w3.caches.stores.get('jiggy-runtime'))
    const { response } = await offline.fetch(get('plugins/p/code.js'))
    const bytes = new Uint8Array(await response.arrayBuffer())
    await expect(verifyIntegrity(bytes, declared)).rejects.toThrow(/integrity mismatch/)
    await expect(verifyIntegrity(original, declared)).resolves.toBeTruthy()
  })
})

describe('the worker file', () => {
  it('imports the container worker unchanged and the precache, and calls fetch only in its own code', () => {
    const code = read('sw.js').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(code).toContain("importScripts('foreign/sw.js', 'precache.js')")
    // The container worker's rule is asserted on its own file (tests/docs/conventions.test.js).
    const foreign = read('foreign/sw.js').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(foreign).not.toMatch(/\bfetch\s*\(/)
  })

  it('is the script the container origin registers, so there is one registration and not two', () => {
    const origin = readFileSync(join(root, 'src/host/ForeignOrigin.js'), 'utf8')
    // web/sw.js, next to the page, and not foreign/sw.js, which would replace it.
    expect(origin).toContain("const workerFor = base => new URL('sw.js', base)")
    const code = origin.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(code).not.toContain('foreign/sw.js')
  })
})


describe('under a path, not only at the root', () => {
  const ROOT = 'https://site.test/'
  const UNDER = 'https://site.test/jigdaw/'
  const install = (w, id, files) => {
    const posted = []
    for (const fn of w.listeners.message) {
      fn({ data: { type: 'jigdaw-install-container', id, files }, ports: [{ postMessage: m => posted.push(m) }] })
    }
    return posted
  }
  const container = new Map([['index.js', { bytes: new TextEncoder().encode('container code'), mediaType: 'text/javascript' }]])

  for (const [name, scope, prefix] of [['the root', ROOT, '/foreign/'], ['a path', UNDER, '/jigdaw/foreign/']]) {
    it(`serves a container from ${prefix} when the worker is registered at ${name}, and refuses a file it does not hold`, async () => {
      const w = loadWorker({ network: async () => basic('page'), scope })
      await w.install().catch(() => {})
      const posted = install(w, 'abc', container)
      expect(posted).toEqual([{ ok: true, id: 'abc', count: 1 }])
      const held = await w.fetch(new Request(new URL(`${prefix}abc/index.js`, 'https://site.test/')))
      expect(held.answered).toBe(true)
      expect(await held.response.text()).toBe('container code')
      const refused = await w.fetch(new Request(new URL(`${prefix}abc/other.js`, 'https://site.test/')))
      expect(refused.response.status).toBe(404)
    })
  }

  it('does not answer at the old absolute prefix when registered under a path, and the app worker stays out of both', async () => {
    const w = loadWorker({ network: async () => basic('page'), scope: UNDER })
    install(w, 'abc', container)
    // /foreign/abc/index.js is not this app's, so it is nobody's here: passed on, unanswered.
    const wrong = await w.fetch(new Request('https://site.test/foreign/abc/index.js'))
    expect(wrong.answered).toBe(false)
    const own = await w.fetch(new Request('https://site.test/jigdaw/foreign/abc/index.js'))
    expect(own.answered).toBe(true)
    expect(own.response.status).toBe(200)
  })

  it('the app worker leaves the container folder alone in either place, and still answers the rest of the app', async () => {
    const w = loadWorker({ network: async () => basic('page'), scope: UNDER })
    await w.install().catch(() => {})
    expect((await w.fetch(new Request('https://site.test/jigdaw/foreign/unknown/x.js'))).answered).toBe(false)
    expect((await w.fetch(new Request('https://site.test/jigdaw/host.json'))).answered).toBe(true)
  })

  it('derives the container origin paths from the page base, so they cannot be written for the root only', () => {
    const origin = readFileSync(join(root, 'src/host/ForeignOrigin.js'), 'utf8')
    const code = origin.split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(code).toContain("new URL('foreign/', base).pathname")
    expect(code).not.toMatch(/'\/foreign\/'|'\/sw\.js'/)
    const worker = read('foreign/sw.js').split('\n').filter(l => !l.trim().startsWith('//')).join('\n')
    expect(worker).toContain("new URL('foreign/', self.registration.scope).pathname")
    expect(worker).not.toMatch(/PREFIX = '\/foreign\/'/)
  })
})
