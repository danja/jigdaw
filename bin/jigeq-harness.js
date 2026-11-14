// bin/jigeq-harness.js
//
// Start the local JigDAW server and open the standalone JigEQ visual harness.
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

function options (args) {
  let port = Number(process.env.PORT ?? 8750)
  let open = true
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--no-open') {
      open = false
    } else if (args[i] === '--port') {
      port = Number(args[++i])
    } else {
      throw new Error(`unknown argument: ${args[i]}`)
    }
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`PORT must be an integer from 1 to 65535, not ${port}`)
  }
  return { port, open }
}

function openBrowser (url) {
  const command = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      ? ['cmd.exe', ['/c', 'start', '', url]]
      : ['xdg-open', [url]]
  const browser = spawn(command[0], command[1], { detached: true, stdio: 'ignore' })
  browser.once('error', error => {
    console.error(`Could not open a browser automatically: ${error.message}`)
    console.error(`Open ${url} in a browser to continue.`)
  })
  browser.unref()
}

const { port, open } = options(process.argv.slice(2))
const url = `http://127.0.0.1:${port}/jigeq-abc.html`
const server = spawn(process.execPath, [resolve(root, 'bin/serve.js')], {
  cwd: root,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
  stdio: 'inherit'
})

let stopping = false
const stop = signal => {
  if (stopping) return
  stopping = true
  server.kill(signal)
}
process.on('SIGINT', () => stop('SIGINT'))
process.on('SIGTERM', () => stop('SIGTERM'))
server.once('exit', (code, signal) => {
  if (!stopping) process.exitCode = code ?? 1
  else process.exitCode = signal ? 0 : (code ?? 0)
})

let ready = false
for (let attempt = 0; attempt < 50 && server.exitCode === null; attempt++) {
  try {
    const response = await fetch(url)
    if (response.ok) { ready = true; break }
  } catch {}
  await delay(100)
}
if (!ready) {
  stop('SIGTERM')
  throw new Error(`local server did not serve ${url}`)
}

console.log(`JigEQ visual harness: ${url}`)
console.log('Press Ctrl+C to stop the local server.')
if (open) openBrowser(url)
