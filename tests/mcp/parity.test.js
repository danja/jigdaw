// tests/mcp/parity.test.js
//
// docs/webmcp.md says there are no agent-only operations and no editor-only ones: the tools are the
// dispatcher's operations. Nothing held that to account, and an Op added to the dispatcher for the
// editor is simply absent from the agent surface until somebody notices. This walks every member of
// the dispatcher and requires it to be classified, so a new one forces a decision, and checks each
// classification against what tools.js really does.
//
// What it walks: the members of OpDispatcher.prototype. What it does not see: an Op made some other
// way than a method on that class, such as a new module the editor calls directly. That is the gap in
// the guard, and the rule in docs/architecture.md (every operation is one Op) is what covers it.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createTools } from '../../src/mcp/tools.js'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'

const root = resolve(import.meta.dirname, '../..')
const source = readFileSync(resolve(root, 'src/mcp/tools.js'), 'utf8')
const toolNames = createTools({ dispatcher: new OpDispatcher() }).map(t => t.name)

// op: an edit an agent can make, through the named tool. read: used by tools to answer a question.
// plumbing: the editor, the engine or the undo machinery calling the dispatcher, with no edit for an
// agent to make. gap: an edit or a question the dispatcher answers and no tool does, known and listed.
const CLASSIFIED = {
  apply: { kind: 'op', tool: 'graph_apply_changes' },
  setParameter: { kind: 'op', tool: 'parameter_set' },
  setParameters: { kind: 'op', tool: 'parameters_set_batch' },
  unpackComposite: { kind: 'op', tool: 'node_unpack' },
  packSelection: { kind: 'read' },
  resetParameter: { kind: 'op', tool: 'parameter_reset' },
  setTrackChannel: { kind: 'op', tool: 'track_set_channel' },
  undo: { kind: 'op', tool: 'history_undo' },
  redo: { kind: 'op', tool: 'history_redo' },
  canUndo: { kind: 'read' },
  canRedo: { kind: 'read' },
  project: { kind: 'read' },
  revision: { kind: 'read' },
  engineNode: { kind: 'read' },
  compile: { kind: 'read' },
  transport: { kind: 'read' },

  // Loading is injected by the page (a plugin is fetched, checked and compiled in the browser), so the
  // tool is plugin_load and the dispatcher method is called from that callback, not from tools.js.
  addPlugin: { kind: 'injected', tool: 'plugin_load' },

  router: { kind: 'plumbing', why: 'the MIDI router, read by the engine and the editor' },
  foreignTrust: { kind: 'plumbing', why: 'the trust prompt for a foreign plugin is a person\'s decision' },
  foreignSupport: { kind: 'plumbing', why: 'what the host can run, read by the loader' },
  sendTransport: { kind: 'plumbing', why: 'the transport clock, one message per quantum' },
  midiActivity: { kind: 'plumbing', why: 'a meter for the editor' },
  audioParams: { kind: 'plumbing', why: 'the envelope player finding the AudioParams a parameter is, one per member parameter for a composite' },
  sendEvents: { kind: 'plumbing', why: 'the scheduler sending notes, at stream positions' },
  relayToPlugin: { kind: 'plumbing', why: 'a plugin\'s own user interface talking to its processor' },
  onPluginMessage: { kind: 'plumbing', why: 'a plugin\'s own user interface listening to its processor' },
  subscribe: { kind: 'plumbing', why: 'the editor redrawing on a change' },
  clearHistory: { kind: 'plumbing', why: 'the page opening a session, which starts a history' },
  withoutRecording: { kind: 'plumbing', why: 'UndoHistory driving the dispatcher while it reconciles' },
  grouped: { kind: 'plumbing', why: 'makes a Reel script\'s run one undo step; the agent surface gets it with script_run (docs/livecoding.md)' },

  alignTracks: { kind: 'gap', why: 'a host preference with no tool' },
  setAlignTracks: { kind: 'gap', why: 'a host preference with no tool' },
  trackLatencies: { kind: 'gap', why: 'the per-track delays the engine applied; diagnostics does not report them' },
  audibility: { kind: 'gap', why: 'what mute and solo make audible; project_get shows the flags, not the result' },
  getNodeState: { kind: 'gap', why: 'a stateful plugin\'s live state, read when a session is saved' },
  loadAsset: { kind: 'gap', why: 'hands a plugin bytes; needs a decision on how an agent would supply them' }
}

const members = Object.getOwnPropertyNames(OpDispatcher.prototype).filter(n => n !== 'constructor').sort()
const used = name => new RegExp(`dispatcher\\.${name}\\b`).test(source)

describe('the dispatcher and the agent surface', () => {
  it('finds the dispatcher\'s members and the tools, so neither list is read vacuously', () => {
    expect(members.length).toBeGreaterThan(20)
    expect(toolNames.length).toBeGreaterThan(30)
  })

  it('classifies every member of the dispatcher, so a new Op forces a decision', () => {
    const unclassified = members.filter(name => !(name in CLASSIFIED))
    expect(unclassified, `add to CLASSIFIED in tests/mcp/parity.test.js, and to tools.js if an agent should have it: ${unclassified.join(', ')}`).toEqual([])
  })

  it('has no classification for a member that is not there', () => {
    expect(Object.keys(CLASSIFIED).filter(name => !members.includes(name))).toEqual([])
  })

  it('names, for every op, a tool that exists and whose handler calls it', () => {
    for (const [name, c] of Object.entries(CLASSIFIED)) {
      if (c.kind !== 'op') continue
      expect(toolNames, `${name} -> ${c.tool}`).toContain(c.tool)
      expect(used(name), `${c.tool} does not call dispatcher.${name}`).toBe(true)
    }
    expect(toolNames).toContain(CLASSIFIED.addPlugin.tool)
  })

  it('finds every read in use, and no plumbing or known gap in use', () => {
    // A gap that a tool now calls is no longer a gap, and plumbing that a tool calls is not
    // plumbing: either way the table is stale, which is the thing this exists to prevent.
    for (const [name, c] of Object.entries(CLASSIFIED)) {
      if (c.kind === 'read') expect(used(name), `${name} is classified as a read and no tool uses it`).toBe(true)
      if (c.kind === 'plumbing' || c.kind === 'gap') expect(used(name), `${name} is classified as ${c.kind} and a tool uses it`).toBe(false)
    }
  })

  it('lists the known gaps, so closing one is a deliberate edit', () => {
    const gaps = Object.entries(CLASSIFIED).filter(([, c]) => c.kind === 'gap').map(([n]) => n).sort()
    expect(gaps).toEqual(['alignTracks', 'audibility', 'getNodeState', 'loadAsset', 'setAlignTracks', 'trackLatencies'])
  })
})
