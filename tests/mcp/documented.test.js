// tests/mcp/documented.test.js
//
// docs/webmcp.md specifies the agent surface and src/mcp/tools.js builds it, and
// nothing connected the two. Nine tools sat in that document unbuilt for long
// enough that the plan's own summary of the phase had gone stale about how many
// there were.
//
// This binds the direction that actually drifts: a tool that exists and is not
// written down. An agent cannot read the source, so an undocumented tool is one
// nobody can be expected to call, and the description is the whole interface.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTools } from '../../src/mcp/tools.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'

const root = resolve(import.meta.dirname, '../..')
const spec = readFileSync(resolve(root, 'docs/webmcp.md'), 'utf8')
const built = createTools({ dispatcher: new OpDispatcher() }).map(t => t.name)

/** Whether the specification names a tool, in backticks, anywhere. */
const documents = name => spec.includes(`\`${name}\``)

// Only names carrying an underscore are collected in the other direction. A
// single word in backticks is far more often prose than a tool name, and a
// pattern that matched those would report most of the document as missing.
const mentioned = new Set([...spec.matchAll(/`([a-z][a-z_]*_[a-z_]+)`/g)].map(m => m[1]))

describe('the agent surface and the document that specifies it', () => {
  it('finds tools in both, so neither list is read vacuously', () => {
    expect(built.length).toBeGreaterThan(10)
    expect(mentioned.size).toBeGreaterThan(10)
  })

  it('documents every tool that exists', () => {
    const undocumented = built.filter(name => !documents(name))
    expect(undocumented, `built but absent from docs/webmcp.md: ${undocumented.join(', ')}`)
      .toEqual([])
  })

  it('knows which specified tools are still unbuilt', () => {
    // Not a failure: the document is a design and the phases are real. It is a
    // failure for the list to be wrong, because then nobody knows what is left.
    // Remove a name here in the same change that builds it.
    const notYet = ['node_add', 'transport_play', 'transport_stop',
      'project_new', 'project_open', 'project_save']
    const actuallyMissing = [...mentioned].filter(name => !built.includes(name)).sort()
    expect(actuallyMissing).toEqual([...notYet].sort())
  })

  it('gives every tool a description an agent could act on', () => {
    for (const tool of createTools({ dispatcher: new OpDispatcher() })) {
      expect(tool.description.length, `${tool.name} has no useful description`).toBeGreaterThan(30)
    }
  })
})
