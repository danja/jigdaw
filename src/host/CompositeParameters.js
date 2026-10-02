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

/**
 * What the composite's author set, as writes in the order to apply them: each exposed port's default on the
 * parameters it drives, and each member's own settings. Inner composites come first, so the outer author's
 * choice is the last word, and a person's own settings from a saved session go on top of all of it.
 *
 * @returns {{ path: string[], symbol: string, value: number }[]} located by member IRIs from the composite inward;
 *   a port with no declared default writes nothing.
 */
export function voicing (tree, prefix = []) {
  const writes = []
  for (const member of tree.members) {
    if (member.tree.kind === 'composite') writes.push(...voicing(member.tree, [...prefix, member.id]))
  }
  for (const port of tree.composite.ports) {
    if (port.defaultValue === null || port.defaultValue === undefined) continue
    for (const target of parameterTargets(tree, port.symbol)) {
      writes.push({ path: [...prefix, ...target.path], symbol: target.symbol, value: port.defaultValue })
    }
  }
  for (const member of tree.composite.members) {
    const inner = tree.members.find(m => m.id === member.id).tree
    for (const setting of member.settings) {
      if (setting.value === null || setting.value === undefined) continue
      if (inner.kind === 'plugin') writes.push({ path: [...prefix, member.id], symbol: setting.symbol, value: setting.value })
      else for (const target of parameterTargets(inner, setting.symbol)) writes.push({ path: [...prefix, member.id, ...target.path], symbol: target.symbol, value: setting.value })
    }
  }
  return writes
}
