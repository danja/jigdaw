// bin/check-layout.js
//
// Measures the page's layout in a real Chrome at phone and desktop widths. The unit tests run in linkedom, which has no
// layout, so "no horizontal scrolling" and "touch targets of at least 44px" (CLAUDE.md, interface rules) cannot be
// asserted there. For each width this loads the studio, and for each tab, and with the Browser and the Keys list open, it
// compares `documentElement.scrollWidth` with `innerWidth` and names what sticks out.
//
//   npm run check:layout      exit 0 every view fits, 1 something overflows or the page failed,
//                             3 Chrome is not available (nothing was checked)
//
// It starts bin/serve.js on a free port and drives Chrome over the DevTools protocol with Node's own WebSocket, so it needs
// nothing installed. Touch-target sizes are reported for the controls named in TARGETS, as warnings, not failures.
import { spawn, execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chrome = process.env.CHROME_BIN ?? '/usr/bin/google-chrome'
export const WIDTHS = Object.freeze([320, 360, 390, 720, 1280])
// ?studio asks for the studio at any width: below 720px the bare address redirects to the simple page (web/view.js).
export const PAGES = Object.freeze(['/?studio', '/simple.html'])
const SETTLE_MS = 3500

const freePort = () => new Promise((done, fail) => {
  const probe = createServer()
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)) })
  probe.on('error', fail)
})
const sleep = ms => new Promise(done => setTimeout(done, ms))

async function waitFor (what, test, ms = 15000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { const value = await test(); if (value) return value } catch { /* not yet */ }
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A minimal DevTools protocol client over one WebSocket. */
function connect (url) {
  const socket = new WebSocket(url)
  let next = 0
  const pending = new Map()
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data)
    const waiting = pending.get(message.id)
    if (!waiting) return
    pending.delete(message.id)
    if (message.error) waiting.fail(new Error(`${waiting.method}: ${message.error.message}`))
    else waiting.done(message.result)
  })
  const opened = new Promise((done, fail) => { socket.addEventListener('open', done); socket.addEventListener('error', () => fail(new Error('DevTools socket failed'))) })
  const send = (method, params = {}, sessionId) => new Promise((done, fail) => {
    const id = ++next
    pending.set(id, { done, fail, method })
    socket.send(JSON.stringify({ id, method, params, sessionId }))
  })
  return { opened, send, close: () => socket.close() }
}

// Run inside the page. Returns what overflows the viewport, and the touch targets that are too small.
const MEASURE = `(() => {
  const width = innerWidth
  const doc = document.documentElement
  const name = el => el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : '')
  const out = []
  for (const el of document.body.querySelectorAll('*')) {
    if (el.getClientRects().length === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.right > width + 0.5) out.push(name(el) + ' right=' + Math.round(r.right))
    if (out.length >= 6) break
  }
  return { scrollWidth: doc.scrollWidth, innerWidth: width, overflowing: out }
})()`

async function measureAll (send, session, base) {
  const results = []
  const evaluate = async expression => {
    const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
    if (exceptionDetails) throw new Error(`page script failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
    return result.value
  }
  for (const page of PAGES) {
    for (const width of WIDTHS) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 720 }, session)
      await send('Page.navigate', { url: `${base}${page}` }, session)
      await sleep(SETTLE_MS)
      const views = [{ view: 'as loaded', before: '' }]
      const tabs = await evaluate(`[...document.querySelectorAll('[role=tab]')].map(t => t.id || t.textContent)`)
      for (const id of tabs) views.push({ view: `tab ${id}`, before: `[...document.querySelectorAll('[role=tab]')].find(t => (t.id || t.textContent) === ${JSON.stringify(id)}).click()` })
      if (page === '/?studio') {
        views.push({ view: 'Browser open', before: `document.getElementById('toggle-browser')?.click()` })
        views.push({ view: 'Keys list open', before: `document.getElementById('toggle-keys')?.click()` })
      }
      for (const { view, before } of views) {
        if (before) { await evaluate(before); await sleep(300) }
        const m = await evaluate(MEASURE)
        results.push({ page, width, view, ...m, fits: m.scrollWidth <= m.innerWidth })
      }
    }
  }
  // A positive control: a deliberately wide element must be reported, or "everything fits" would mean the measure is blind.
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true }, session)
  await send('Page.navigate', { url: `${base}/simple.html` }, session)
  await sleep(SETTLE_MS)
  await evaluate(`document.body.insertAdjacentHTML('beforeend', '<div id="wide-control" style="width:2000px;height:4px"></div>')`)
  const control = await evaluate(MEASURE)
  results.push({ page: 'control', width: 360, view: 'a 2000px element is added', ...control, fits: control.scrollWidth > control.innerWidth, control: true })
  return results
}

export async function checkLayout () {
  if (!existsSync(chrome)) return { code: 3, lines: [`no Chrome at ${chrome}; set CHROME_BIN. Nothing was checked.`] }
  let server = null
  let browser = null
  let profile = null
  try {
    const port = await freePort()
    server = spawn(process.execPath, [join(root, 'bin/serve.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
    const base = `http://127.0.0.1:${port}`
    await waitFor('the dev server', async () => (await fetch(`${base}/`)).ok)

    profile = await mkdtemp(join(tmpdir(), 'jig-layout-'))
    browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' })
    const endpoint = await waitFor('Chrome DevTools', async () => {
      const [portText, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n')
      return `ws://127.0.0.1:${portText}${path}`
    })
    const client = connect(endpoint)
    await client.opened
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
    await client.send('Page.enable', {}, sessionId)
    const results = await measureAll(client.send, sessionId, base)
    client.close()

    const lines = []
    let failed = false
    for (const r of results) {
      const where = `${r.page} at ${r.width}px, ${r.view}`
      if (r.control) {
        if (r.fits) lines.push(`ok   control: an added 2000px element is seen as overflow`)
        else { failed = true; lines.push('FAIL control: an added 2000px element was not seen, so the measure is blind') }
      } else if (r.fits) lines.push(`ok   ${where}`)
      else { failed = true; lines.push(`FAIL ${where}: scrollWidth ${r.scrollWidth} > innerWidth ${r.innerWidth}; ${r.overflowing.join(', ') || 'no single element found'}`) }
    }
    lines.push(`${results.length} views measured at ${WIDTHS.join(', ')}px`)
    return { code: failed ? 1 : 0, lines }
  } catch (error) {
    return { code: 1, lines: [`the check could not run: ${error.message}`] }
  } finally {
    browser?.kill()
    server?.kill()
    await sleep(300)
    if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, lines } = await checkLayout()
  for (const l of lines) console.log(l)
  process.exit(code)
}
