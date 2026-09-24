// src/ops/OpenProject.js
//
// Replace whatever is open with a project that ProjectReader has read. The one
// sequence behind opening a saved file and opening a preset, so a test that
// loads every bundled preset exercises the same code a person's click does.

/**
 * The nodes in the order signal flows through them: every node after the ones
 * feeding it, ties kept in the order given.
 *
 * A graph has no order of its own, and the rack stacks nodes in the order they
 * were added, so without this a session opened as the reader happened to list
 * it: alphabetically, which put a plate reverb above the synth feeding it. A
 * node in a feedback loop has no position after all of its sources, so what a
 * cycle leaves is appended in the order given rather than dropped.
 */
export function inSignalOrder (nodes, connections) {
  const feeding = new Map(nodes.map(n => [n.id, new Set()]))
  for (const c of connections) {
    if (feeding.has(c.to.node) && feeding.has(c.from.node) && c.from.node !== c.to.node) {
      feeding.get(c.to.node).add(c.from.node)
    }
  }
  const placed = new Set()
  const ordered = []
  let progress = true
  while (progress) {
    progress = false
    for (const node of nodes) {
      if (placed.has(node.id) || [...feeding.get(node.id)].some(id => !placed.has(id))) continue
      placed.add(node.id)
      ordered.push(node)
      progress = true
      break
    }
  }
  return [...ordered, ...nodes.filter(n => !placed.has(n.id))]
}

/**
 * Plugins first and connections after, because a connection names nodes that
 * have to exist, and each plugin has to be fetched and instantiated before its
 * node means anything. A plugin that cannot be loaded is reported and skipped
 * rather than abandoning the rest: an unreachable origin should cost one node,
 * not the session.
 *
 * `onLoading(pluginIri)` is called before each fetch, for a log.
 * `onCleared()` is called once the old nodes are gone and before any new one
 * exists, which is when a surface caching anything by node id has to drop it:
 * the new nodes can reuse the old ids for different plugins.
 *
 * Returns `{ ok, loaded, total, errors }`. `ok` is false only when the current
 * session could not be cleared, in which case nothing was loaded; a node that
 * failed is in `errors` and does not make the whole open fail.
 */
export async function openProject (dispatcher, read, { onLoading = () => {}, onCleared = () => {} } = {}) {
  const existing = [...dispatcher.project.nodes].map(n => ({ op: 'removeNode', id: n.id }))
  if (existing.length > 0) {
    const cleared = dispatcher.apply(existing)
    if (!cleared.ok) return { ok: false, loaded: new Set(), total: 0, errors: [cleared.message] }
  }
  onCleared()

  const errors = []
  const loaded = new Set()
  const additions = inSignalOrder(
    read.changes.filter(c => c.op === 'addNode'),
    read.changes.filter(c => c.op === 'addConnection'))
  for (const change of additions) {
    onLoading(change.pluginIri)
    // The whole change, not a chosen few of its fields. The reader produces
    // everything a node carries, state included, and picking some of them
    // here is how a saved mix came back at unity.
    const { op, pluginIri, ...node } = change
    const result = await dispatcher.addPlugin(pluginIri, node)
    if (!result.ok) { errors.push(`${change.id}: ${result.message}`); continue }
    loaded.add(change.id)
    for (const [symbol, value] of Object.entries(change.settings ?? {})) {
      const set = dispatcher.setParameter(change.id, symbol, value)
      if (!set.ok) errors.push(`${change.id}.${symbol}: ${set.message}`)
    }
  }

  // Only between nodes that actually loaded. A connection to a node that failed
  // would be refused by the model and reported as a second error about the same
  // failure.
  const rest = read.changes.filter(c =>
    c.op !== 'addNode' &&
    (c.op !== 'addConnection' || (loaded.has(c.from.node) && loaded.has(c.to.node))))
  if (rest.length > 0) {
    const applied = dispatcher.apply(rest)
    if (!applied.ok) errors.push(applied.message)
  }

  // Opening is not itself an edit to undo, and stepping back across it would
  // try to restore nodes from whatever was open before.
  dispatcher.clearHistory()
  return { ok: true, loaded, total: additions.length, errors }
}
