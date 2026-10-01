// tests/reel/Capabilities.test.js
//
// A script has the capabilities of the tools and no others (docs/livecoding.md). This binds Reel's table to
// the real tool list: every tool is either given a statement or excluded with a reason, so a tool added later
// forces a decision, and a statement can never name a tool that is gone.
import { describe, it, expect } from 'vitest'
import { createTools } from '../../src/mcp/tools.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'
import { SCRIPTABLE, NOT_SCRIPTABLE } from '../../src/reel/Capabilities.js'

const toolNames = createTools({ dispatcher: new OpDispatcher() }).map(t => t.name)

describe('what a script can do', () => {
  it('finds the tools, so the comparison is not vacuous', () => {
    expect(toolNames.length).toBeGreaterThan(30)
  })

  it('names, for every statement, a tool that exists', () => {
    for (const [statement, tool] of Object.entries(SCRIPTABLE)) expect(toolNames, statement).toContain(tool)
  })

  it('classifies every tool exactly once, so a new tool forces a decision', () => {
    const scriptable = Object.values(SCRIPTABLE)
    const excluded = Object.keys(NOT_SCRIPTABLE)
    expect(scriptable.filter(t => excluded.includes(t)), 'in both lists').toEqual([])
    const unclassified = toolNames.filter(t => !scriptable.includes(t) && !excluded.includes(t))
    expect(unclassified, `give each a statement in src/reel/Capabilities.js or exclude it with a reason: ${unclassified.join(', ')}`).toEqual([])
    const stale = excluded.filter(t => !toolNames.includes(t))
    expect(stale, 'excluded, but no longer a tool').toEqual([])
  })

  it('gives every exclusion a reason', () => {
    for (const [tool, reason] of Object.entries(NOT_SCRIPTABLE)) expect(reason.length, tool).toBeGreaterThan(8)
  })

  it('does not let a script reach the destructive or session-replacing tools', () => {
    const scriptable = Object.values(SCRIPTABLE)
    for (const tool of ['node_remove', 'track_remove', 'clip_remove', 'collection_open', 'history_undo', 'history_redo', 'transport_play']) {
      expect(scriptable, tool).not.toContain(tool)
    }
  })
})
