// src/ops/CompositeUnpack.js
//
// What turning a composite plugin's node back into its members involves, worked out and not yet done. docs/nested-plugins.md section 12.
//
// Pure: it reads the project, the composite's resolved tree and its saved state, and returns a plan the dispatcher carries out. The
// boundary rules are not written again here. The composite is expanded one level, with its members presented as plugins, by the same
// function that wires the engine, so an unpacked rack is joined to what was around it exactly as the rack was.
//
// Sound is the test of a good plan: a member gets the value it had inside the rack. That is the author's voicing, then each exposed
// port's value (the person's setting, else the port's default) written onto the member parameter it drives. A member that is itself a
// composite receives settings in its own exposed symbols, which is what a node of it takes.
import { expandComposites } from './CompositeExpansion.js'
import { isMidi } from '../engine/EventRouter.js'

const keyOf = c => JSON.stringify([c.from.node, c.from.portIndex ?? c.from.portSymbol, c.to.node, c.to.portIndex ?? c.to.portSymbol, c.signalKind])
const OUTSIDE = '\u0000outside'

/** A composite whose members are shown as plugins, so one level of it expands and no deeper. */
const shallow = tree => ({
  ...tree,
  members: tree.members.map(m => ({ ...m, tree: { kind: 'plugin', iri: m.plugin, profile: {}, granted: [] } }))
})

/**
 * @param project  `nodes`, `node(id)`, `connections`, `track(id)`, as the model has them
 * @param nodeId   the composite's node
 * @param tree     the node's resolved tree
 * @param state    what getNodeState returned for it, or null
 * @returns {{ track, bypassed, members, connections, midiInput, audioInput }}
 *   members:     { key, plugin, label, settings, state } where `key` is the member IRI inside the composite
 *   connections: { from, to, signalKind } with an endpoint `{ member, portIndex | portSymbol }` or `{ node, ... }` for something outside
 *   midiInput, audioInput: the member key that takes over as the track's, when the composite was
 */
export function planUnpack ({ project, nodeId, tree, state = null }) {
  const node = project.node(nodeId)
  if (!node) throw new Error(`no such node: ${nodeId}`)
  const composite = tree.composite

  const flat = expandComposites({
    nodes: project.nodes.map(n => ({ id: n.id })),
    connections: project.connections,
    treeOf: id => (id === nodeId ? shallow(tree) : null)
  })
  const memberOfFlat = new Map(flat.nodes.filter(n => n.path[0] === nodeId && n.path.length === 2).map(n => [n.id, n.path[1]]))
  const endpoint = e => (memberOfFlat.has(e.node) ? { ...e, node: undefined, member: memberOfFlat.get(e.node) } : e)

  // Connections the composite did not touch stay as they are. Everything else in the expansion is new: the rack's own wiring, the
  // outside joined to its members, and an input wired straight to an output, which joins the outside to the outside.
  const untouched = new Set(project.connections.filter(c => c.from.node !== nodeId && c.to.node !== nodeId).map(keyOf))
  const connections = flat.connections
    .filter(c => !untouched.has(keyOf(c)))
    .map(c => ({ from: clean(endpoint(c.from)), to: clean(endpoint(c.to)), signalKind: c.signalKind }))

  const settings = new Map(composite.members.map(m => [m.id, Object.fromEntries(m.settings.map(s => [s.symbol, s.value]))]))
  for (const port of composite.ports) {
    const value = node.settings.get(port.symbol) ?? port.defaultValue
    if (value === null || value === undefined) continue
    for (const drive of port.drives) {
      const target = settings.get(drive.node)
      if (target) target[drive.portSymbol] = value
    }
  }

  const labelOf = member => {
    const inner = tree.members.find(m => m.id === member.id).tree
    return (inner.kind === 'plugin' ? inner.profile.label : inner.composite.label) ?? member.id.split('#').pop()
  }
  const members = composite.members.map(m => ({
    key: m.id,
    plugin: m.plugin,
    label: labelOf(m),
    settings: settings.get(m.id),
    state: state?.members?.[m.id] ?? null
  }))

  // Where the track's clips entered the composite, if they did: the member its boundary input was wired to.
  const takeover = kind => {
    const via = composite.connections.find(c => c.from.node === composite.iri && c.signalKind === kind)
    if (!via) return null
    const probe = expandComposites({
      nodes: [{ id: OUTSIDE }, { id: nodeId }],
      connections: [{ id: 'p', from: { node: OUTSIDE, portIndex: 0 }, to: { node: nodeId, portIndex: 0 }, signalKind: kind }],
      treeOf: id => (id === nodeId ? shallow(tree) : null)
    })
    // The same deterministic ids as the expansion above, so the member is a lookup.
    const hit = probe.connections.find(c => memberOfFlat.has(c.to.node))
    return hit ? memberOfFlat.get(hit.to.node) : null
  }
  const track = project.track(node.track)
  const midiKind = composite.connections.find(c => c.from.node === composite.iri && isMidi(c.signalKind))?.signalKind
  const audioKind = composite.connections.find(c => c.from.node === composite.iri && !isMidi(c.signalKind))?.signalKind

  return {
    track: node.track,
    bypassed: node.bypassed === true,
    members,
    connections,
    midiInput: track?.midiInput === nodeId && midiKind ? takeover(midiKind) : null,
    audioInput: track?.audioInput === nodeId && audioKind ? takeover(audioKind) : null
  }
}

/** An endpoint without the keys that are undefined, so it compares and serialises plainly. */
function clean (e) {
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== undefined))
}
