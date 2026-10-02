// src/host/CompositeParameters.js
//
// Which real parameters an exposed port of a composite moves. docs/nested-plugins.md
// section 2.2.
//
// A port drives a (member, symbol) pair, and when that member is itself a composite the symbol
// is one of its own exposed ports, which drives something further in. This follows the chain
// to the plugins that actually have the parameter. The value is passed through unchanged at every
// step, so what is returned is where to write it, and nothing to scale.

/**
 * @param tree   a resolved composite tree (CompositeResolver)
 * @param symbol an exposed port of that composite
 * @returns {{ path: string[], symbol: string }[]} the plugins' own parameters, each located by the
 *   member IRIs from the composite inward. Empty when the composite exposes no such port.
 */
export function parameterTargets (tree, symbol) {
  const port = tree.composite.ports.find(p => p.symbol === symbol)
  if (!port) return []
  return port.drives.flatMap(drive => {
    const member = tree.members.find(m => m.id === drive.node)
    if (!member) return []
    if (member.tree.kind === 'composite') {
      return parameterTargets(member.tree, drive.portSymbol).map(t => ({ ...t, path: [member.id, ...t.path] }))
    }
    return [{ path: [member.id], symbol: drive.portSymbol }]
  })
}
