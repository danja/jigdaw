// src/ops/CompositeExpansion.js
//
// What a project's nodes and connections become when some nodes are composite
// plugins: the members in place of the composite, and the connections rewritten
// to reach them. docs/nested-plugins.md section 5.
//
// Pure, and the same kind of function as Bypass.js: the model keeps one node for
// the composite and every connection as written, and the dispatcher hands the
// engine and the compiler this expansion instead. It runs after bypass has
// stepped over a bypassed composite, which leaves the composite's members in the
// graph and unconnected from outside; they are marked bypassed so the caller can
// keep them silent.
//
// A member's id is `JSON.stringify([parentId, memberIri])`, and its `path` is the
// same chain as an array. The id is an opaque key for the engine and the
// compiler. Nothing takes it apart: anything that needs to know where a member
// sits reads `path`.

const innerId = (parentId, memberIri) => JSON.stringify([parentId, memberIri])

/** The flat id of the member at the end of a path of member IRIs, inside the node `nodeId`. The inverse of a node's `path`. */
export const flatIdOf = (nodeId, path) => path.reduce(innerId, nodeId)
const keyOf = (kind, index) => `${kind}\u0000${index}`

/**
 * The boundary of one composite as maps, with every inner endpoint already renamed to
 * the flat id of its member.
 *   inputs   kind and index -> endpoints inside that the input feeds
 *   outputs  kind and index -> endpoints inside that feed the output, or { passFrom } for an
 *            input wired straight to the output
 *   params   symbol -> the member parameters an exposed port drives
 *   inner    connections between members, and from a member to an exposed parameter's targets
 */
function boundaryOf (parent, composite) {
  const rename = e => ({ ...e, node: innerId(parent.id, e.node) })
  const inputs = new Map()
  const outputs = new Map()
  const params = new Map(composite.ports.map(p => [p.symbol, p.drives.map(rename)]))
  const inner = []
  const add = (map, key, value) => map.set(key, [...(map.get(key) ?? []), value])

  for (const c of composite.connections) {
    const fromBoundary = c.from.node === composite.iri
    const toBoundary = c.to.node === composite.iri
    if (fromBoundary && toBoundary) {
      add(outputs, keyOf(c.signalKind, c.to.portIndex), { passFrom: keyOf(c.signalKind, c.from.portIndex) })
    } else if (fromBoundary) {
      add(inputs, keyOf(c.signalKind, c.from.portIndex), rename(c.to))
    } else if (toBoundary && c.to.portSymbol !== undefined) {
      // An inner source modulating an exposed parameter reaches whatever the parameter drives.
      for (const target of params.get(c.to.portSymbol) ?? []) {
        inner.push({ id: innerId(parent.id, c.id), from: rename(c.from), to: target, signalKind: c.signalKind })
      }
    } else if (toBoundary) {
      add(outputs, keyOf(c.signalKind, c.to.portIndex), rename(c.from))
    } else {
      inner.push({ id: innerId(parent.id, c.id), from: rename(c.from), to: rename(c.to), signalKind: c.signalKind })
    }
  }
  return { inputs, outputs, params, inner }
}

/**
 * @param nodes     outer nodes, `{ id, plugin }`
 * @param connections `{ id, from, to, signalKind }`, endpoints `{ node, portIndex | portSymbol }`
 * @param treeOf    nodeId -> the tree resolveComposite returned for that node's plugin, or null
 * @param bypassed  nodeId -> boolean, for the outer nodes
 * @returns {{ nodes: { id, path, plugin, bypassed }[], connections }}
 */
export function expandComposites ({ nodes, connections, treeOf = () => null, bypassed = () => false }) {
  let pending = nodes.map(n => ({
    id: n.id, path: [n.id], plugin: n.plugin ?? null, bypassed: bypassed(n.id) === true,
    tree: treeOf(n.id)?.kind === 'composite' ? treeOf(n.id) : null
  }))
  let list = connections.map(c => c)

  // Each pass expands one composite, and a composite's members may be composites for the next
  // pass. A resolved tree is finite and acyclic, so this ends, and the bound only turns a bug into an error.
  for (let guard = pending.length + 1000; guard > 0; guard--) {
    const parent = pending.find(n => n.tree !== null)
    if (!parent) break
    const { composite, members } = parent.tree
    const { inputs, outputs, params, inner } = boundaryOf(parent, composite)

    const intoParent = key => list
      .filter(c => c.to.node === parent.id && c.to.portSymbol === undefined && keyOf(c.signalKind, c.to.portIndex) === key)
      .map(c => c.from)

    const rewritten = []
    for (const c of list) {
      if (c.from.node !== parent.id && c.to.node !== parent.id) { rewritten.push(c); continue }
      const sources = c.from.node !== parent.id
        ? [c.from]
        : (outputs.get(keyOf(c.signalKind, c.from.portIndex)) ?? []).flatMap(e => e.passFrom === undefined ? [e] : intoParent(e.passFrom))
      const targets = c.to.node !== parent.id
        ? [c.to]
        : c.to.portSymbol !== undefined
            ? params.get(c.to.portSymbol) ?? []
            : (inputs.get(keyOf(c.signalKind, c.to.portIndex)) ?? []).filter(e => e.passFrom === undefined)
      // A side with nothing behind it inside means the connection ends at the boundary, and is dropped.
      sources.forEach((from, i) => targets.forEach((to, j) => {
        rewritten.push({ id: sources.length * targets.length === 1 ? c.id : `${c.id}#${i}.${j}`, from, to, signalKind: c.signalKind })
      }))
    }

    pending = [
      ...pending.filter(n => n !== parent),
      ...composite.members.map(m => {
        const tree = members.find(x => x.id === m.id).tree
        return {
          id: innerId(parent.id, m.id), path: [...parent.path, m.id], plugin: m.plugin,
          bypassed: parent.bypassed, tree: tree.kind === 'composite' ? tree : null
        }
      })
    ]
    list = [...rewritten, ...inner]
  }
  if (pending.some(n => n.tree !== null)) throw new Error('a composite did not finish expanding')

  return { nodes: pending.map(({ id, path, plugin, bypassed: out }) => ({ id, path, plugin, bypassed: out })), connections: list }
}
