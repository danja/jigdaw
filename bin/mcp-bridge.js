// bin/mcp-bridge.js
//
// The local MCP bridge: an MCP endpoint on loopback whose tools run in an open
// Jiggy page (src/mcp/BridgeServer.js). Local only, never deployed: it needs
// the npm install the deployment does not have.
//
//   npm run mcp-bridge
//
// It prints a token. Paste it into the page's Agent bridge section to pair
// that tab, then point an MCP client at the printed URL, for example:
//
//   claude mcp add --transport http jiggy http://127.0.0.1:8749/mcp
//
// The port and the call timeout come from web/host.json, which the page reads
// too, so the two cannot disagree about where the bridge is.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { readHostConfig } from '../src/host/HostConfig.js'
import { createBridge, MCP_PATH } from '../src/mcp/BridgeServer.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const settings = readHostConfig(JSON.parse(await readFile(resolve(root, 'web/host.json'), 'utf8')))

const bridge = createBridge({
  callTimeoutMs: settings.bridgeCallTimeoutMs,
  log: message => console.log(`[bridge] ${message}`)
})
const port = await bridge.listen(settings.bridgePort)

console.log(`Jiggy MCP bridge on http://127.0.0.1:${port}${MCP_PATH}`)
console.log('')
console.log(`  token: ${bridge.token}`)
console.log('')
console.log('Paste the token into the Agent bridge section of an open Jiggy page, on this machine.')
console.log(`Then, for example: claude mcp add --transport http jiggy http://127.0.0.1:${port}${MCP_PATH}`)

const stop = () => bridge.close().then(() => process.exit(0))
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
