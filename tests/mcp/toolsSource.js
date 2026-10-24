// tests/mcp/toolsSource.js
//
// The text of the agent tools, which is src/mcp/tools.js and every group under src/mcp/tools/. A guard that reads the tools as text
// reads all of them: it once read only the front door, and a tool moved into a group would have left the guard looking at nothing.
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

export function toolsSource (root) {
  const dir = resolve(root, 'src/mcp/tools')
  const files = readdirSync(dir).filter(name => name.endsWith('.js')).sort().map(name => resolve(dir, name))
  return [resolve(root, 'src/mcp/tools.js'), ...files].map(path => readFileSync(path, 'utf8')).join('\n')
}
