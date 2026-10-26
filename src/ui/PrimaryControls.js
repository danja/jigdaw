// src/ui/PrimaryControls.js
//
// Which of a plugin's controls a panel shows first. A profile may give a port a pprops:displayPriority, a nonnegative integer where
// higher means the author thinks it matters more (docs/plugin-profiles.md, "Which controls come first"). The ports that have one are
// the primary controls, shown first and highest first; the rest wait under a disclosure.
//
// A profile that gives no priority to any port is shown whole, as it always was, and so is one that gives every port a priority:
// there is nothing to put away. Ports of equal priority keep the order the profile gave them.

/**
 * `ports` is a profile's ports, each with `displayPriority` (a number, or null for none). Returns `{ primary, rest }`: the ports
 * with a priority in order of it, and the others in their own order. `rest` is empty when there is no split to make.
 */
export function splitPrimary (ports) {
  const ranked = ports.filter(p => p.displayPriority !== null && p.displayPriority !== undefined)
  if (ranked.length === 0 || ranked.length === ports.length) return { primary: ports, rest: [] }
  const order = new Map(ports.map((p, i) => [p, i]))
  const primary = [...ranked].sort((a, b) => b.displayPriority - a.displayPriority || order.get(a) - order.get(b))
  return { primary, rest: ports.filter(p => !ranked.includes(p)) }
}
