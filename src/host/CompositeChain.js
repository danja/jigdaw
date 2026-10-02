// src/host/CompositeChain.js
//
// The members of a composite plugin in signal order, when the composite is a straight chain.
// docs/nested-plugins.md section 12.
//
// A host that renders a chain and not a graph (src/host/ReferenceHost.js, deliberately: a mixing graph
// there would duplicate the compiler's logic and let the two drift) can still run the commonest
// composite, a rack of effects in a fixed order, by flattening it into the chain. One with a branch,
// a parallel path, a modulation connection or MIDI inside it needs a graph, and is refused by name
// rather than rendered as something it is not.
import { expandComposites } from '../ops/CompositeExpansion.js'

const AUDIO = 'http://purl.org/stuff/transmissions/Audio'
const OUTSIDE = '\u0000outside'
const ROOT = '\u0000composite'

/**
 * @param tree a resolved composite tree (CompositeResolver)
 * @returns {{ path: string[], tree }[]} the leaf plugins first to last, located by member IRIs from the composite inward
 * @throws when the composite is not a single straight chain of audio, naming why
 */
export function chainOrder (tree) {
  const composite = tree.composite
  const refuse = why => {
    throw new Error(`${composite.label ?? composite.iri} is not a straight chain (${why}), and this host renders chains. ` +
      'It needs a host with a graph, such as Jiggy.')
  }

  const flat = expandComposites({
    nodes: [{ id: OUTSIDE }, { id: ROOT }, { id: `${OUTSIDE}out` }],
    connections: [
      ...(composite.audioInputs > 0 ? [{ id: 'in', from: { node: OUTSIDE, portIndex: 0 }, to: { node: ROOT, portIndex: 0 }, signalKind: AUDIO }] : []),
      ...(composite.audioOutputs > 0 ? [{ id: 'out', from: { node: ROOT, portIndex: 0 }, to: { node: `${OUTSIDE}out`, portIndex: 0 }, signalKind: AUDIO }] : [])
    ],
    treeOf: id => (id === ROOT ? tree : null)
  })

  const members = flat.nodes.filter(n => n.path[0] === ROOT)
  const isMember = id => members.some(n => n.id === id)
  const edges = flat.connections.filter(c => isMember(c.from.node) && isMember(c.to.node))
  if (edges.some(c => c.signalKind !== AUDIO)) refuse('it carries MIDI between its members')
  if (edges.some(c => c.from.portIndex === undefined || c.to.portIndex === undefined)) refuse('it has a modulation connection')
  if (edges.some(c => c.from.portIndex !== 0 || c.to.portIndex !== 0)) refuse('a member uses an audio port other than the first')

  const next = new Map()
  const previous = new Map()
  for (const { from, to } of edges) {
    if (next.has(from.node) || previous.has(to.node)) refuse('a signal splits or joins')
    next.set(from.node, to.node)
    previous.set(to.node, from.node)
  }
  // Boundary edges count as well, or a fan-out into two members at the input would pass for a chain.
  for (const c of flat.connections) {
    if (isMember(c.to.node) && !isMember(c.from.node) && previous.has(c.to.node)) refuse('a signal splits or joins')
    if (isMember(c.from.node) && !isMember(c.to.node) && next.has(c.from.node)) refuse('a signal splits or joins')
  }

  const starts = members.filter(n => !previous.has(n.id))
  if (starts.length !== 1) refuse(starts.length === 0 ? 'it loops' : 'it has more than one start')
  const order = []
  // Each member has at most one successor and the start has no predecessor, so this cannot revisit a node: a loop is either
  // the whole composite (no start, above) or separate from the path, which the length check below catches.
  for (let at = starts[0].id; at !== undefined; at = next.get(at)) order.push(at)
  if (order.length !== members.length) refuse('some members are not on the one path')

  const byId = new Map(members.map(n => [n.id, n]))
  return order.map(id => {
    const path = byId.get(id).path.slice(1)
    let node = tree
    for (const step of path) node = node.members.find(m => m.id === step).tree
    return { path, tree: node }
  })
}
