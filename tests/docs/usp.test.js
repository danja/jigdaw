// tests/docs/usp.test.js
//
// docs/usp.md states three figures about the system. A sentence about the
// system is a claim, and nothing tests sentences, so these bind the figures to
// what is counted here.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { resolve, join } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const usp = readFileSync(join(root, 'docs/usp.md'), 'utf8')

describe('docs/usp.md', () => {
  it('states the number of plugins in the tree', () => {
    // A plugin is a directory of plugins/ holding a profile; _jsfx-runtime is a
    // shared runtime and index.json a file.
    const plugins = readdirSync(join(root, 'plugins'))
      .filter(name => statSync(join(root, 'plugins', name)).isDirectory() && !name.startsWith('_'))
    expect(usp).toContain(`**${plugins.length} plugins**`)
  })

  it('states the number of bundled presets', () => {
    const presets = readdirSync(join(root, 'web/presets')).filter(name => name.endsWith('.ttl'))
    expect(usp).toContain(`**${presets.length} presets**`)
  })

  it('states the number of agent tools', () => {
    // One `name:` per tool definition in the surface's source.
    const source = readFileSync(join(root, 'src/mcp/tools.js'), 'utf8')
    const declared = [...source.matchAll(/^\s+name: '([a-z_]+)',/gm)].map(m => m[1])
    expect(new Set(declared).size).toBe(declared.length)
    expect(usp).toContain(`**${declared.length} tools**`)
  })
})
