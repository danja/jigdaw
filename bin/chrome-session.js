// bin/chrome-session.js
//
// What the checks that drive a real Chrome share: a free port, the development server started on it, a headless Chrome
// reached over the DevTools protocol with Node's own WebSocket (nothing to install), and everything shut down afterwards.
// `withChrome` hands the check one page and an `evaluate` that runs a script in it; a check that cannot run, because there
// is no Chrome, says so with exit 3 and has checked nothing.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { createServer } from 'node:net'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const chromePath = () => process.env.CHROME_BIN ?? '/usr/bin/google-chrome'

export const freePort = () => new Promise((done, fail) => {
  const probe = createServer()
  probe.listen(0, '127.0.0.1', () => { const { port } = probe.address(); probe.close(() => done(port)) })
  probe.on('error', fail)
})
export const sleep = ms => new Promise(done => setTimeout(done, ms))

export async function waitFor (what, test, ms = 15000) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    try { const value = await test(); if (value) return value } catch { /* not yet */ }
    await sleep(100)
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** A minimal DevTools protocol client over one WebSocket. */
export function connect (url) {
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

/**
 * Run `check({ base, send, session, evaluate })` against the development server in a headless Chrome. Resolves with what
 * the check returns, `{ code: 3, lines }` when there is no Chrome, or `{ code: 1, lines }` when the check could not run.
 * `evaluate(expression, { gesture })` runs a script in the page and returns its value, awaiting a promise; `gesture: true`
 * counts as a click for the browser, which audio needs.
 */
export async function withChrome (check, { flags = [] } = {}) {
  const chrome = chromePath()
  if (!existsSync(chrome)) return { code: 3, lines: [`no Chrome at ${chrome}; set CHROME_BIN. Nothing was checked.`] }
  let server = null
  let browser = null
  let profile = null
  try {
    const port = await freePort()
    server = spawn(process.execPath, [join(root, 'bin/serve.js')], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: 'ignore' })
    const base = `http://127.0.0.1:${port}`
    await waitFor('the dev server', async () => (await fetch(`${base}/`)).ok)

    profile = await mkdtemp(join(tmpdir(), 'jig-chrome-'))
    browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', ...flags, `--user-data-dir=${profile}`, '--remote-debugging-port=0', 'about:blank'], { stdio: 'ignore' })
    const endpoint = await waitFor('Chrome DevTools', async () => {
      const [portText, path] = (await readFile(join(profile, 'DevToolsActivePort'), 'utf8')).trim().split('\n')
      return `ws://127.0.0.1:${portText}${path}`
    })
    const client = connect(endpoint)
    await client.opened
    const { targetId } = await client.send('Target.createTarget', { url: 'about:blank' })
    const { sessionId } = await client.send('Target.attachToTarget', { targetId, flatten: true })
    await client.send('Page.enable', {}, sessionId)
    const evaluate = async (expression, { gesture = false } = {}) => {
      const { result, exceptionDetails } = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: gesture }, sessionId)
      if (exceptionDetails) throw new Error(`page script failed: ${exceptionDetails.exception?.description ?? exceptionDetails.text}`)
      return result.value
    }
    try { return await check({ base, send: client.send, session: sessionId, evaluate }) } finally { client.close() }
  } catch (error) {
    return { code: 1, lines: [`the check could not run: ${error.message}`] }
  } finally {
    browser?.kill()
    server?.kill()
    await sleep(300)
    if (profile) await rm(profile, { recursive: true, force: true }).catch(() => {})
  }
}
