// src/host/CompositeState.js
//
// A composite has no processor to ask for state (contract section 8.2), so the host
// assembles it: `{ members: { <member IRI>: <that member's state> } }`, and a member
// that is itself a composite contributes its own such object.
// docs/nested-plugins.md section 6.
//
// Keyed by member IRI and never by position, so that a rack's author can add a member
// in a later version and a session saved before still opens (contract section 8.1).
// A key that names no member is ignored and a member with no key gets its defaults.
// A plugin declaring jig:stateless is not asked, as it is not in a session today.
// Parameter values are never in it: an exposed one is the node's own setting, and the
// rest are the author's, fixed on the member.
//
// The result is a structured-cloneable value, and the same encodeState turns it into
// the string jig:nodeState holds.

/**
 * @param tree     a resolved composite tree (CompositeResolver)
 * @param ask      (path) => Promise<state | undefined>, for a plugin; `path` is the member IRIs from the composite inward
 * @returns the state, or undefined when no member has any, so that a rack of stateless pedals saves nothing
 */
export async function collectState (tree, ask, path = []) {
  const members = {}
  for (const member of tree.members) {
    const here = [...path, member.id]
    const state = member.tree.kind === 'composite'
      ? await collectState(member.tree, ask, here)
      : member.tree.profile.stateless === true ? undefined : await ask(here)
    if (state !== undefined) members[member.id] = state
  }
  return Object.keys(members).length === 0 ? undefined : { members }
}

/**
 * Hands each plugin its saved state, in the order the tree gives them. `give(path, state)` is called only for
 * a plugin the saved state has something for. Anything in `saved` that fits no member is ignored.
 */
export function restoreState (tree, saved, give, path = []) {
  const members = saved !== null && typeof saved === 'object' && typeof saved.members === 'object' ? saved.members : {}
  for (const member of tree.members) {
    if (!Object.hasOwn(members, member.id)) continue
    const here = [...path, member.id]
    if (member.tree.kind === 'composite') restoreState(member.tree, members[member.id], give, here)
    else give(here, members[member.id])
  }
}
