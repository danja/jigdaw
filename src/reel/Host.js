// src/reel/Host.js
//
// The two places Reel meets the host. `createPluginValidator` is what the planner calls for every `load` in
// a script, before the script dispatches anything: the host's own steps, in the host's own order, with
// nothing relaxed because the address came from a script. Fetch and parse the profile, validate it against
// vocabs/shapes.ttl, check the host's capabilities, then fetch every resource the profile declares and
// verify each digest. A plugin that passes has been proved loadable as far as anything short of
// instantiating it can prove, and a plugin that does not is refused with the step it failed at.
//
// `existingPlugins` tells the planner which plugin names a script may already use.
import { LoadError } from '../host/LoadError.js'

/**
 * @param loader a PluginLoader, or anything with loadProfile(iri) and fetchVerified(resource, {kind})
 * @returns resolvePlugin(iri) => Promise<{ok, ports?, message?, step?}>
 *
 * A plugin that has passed is remembered by its declared digests, so a re-run does not fetch its code
 * again. The profile is fetched every time, because a profile can change, and a changed digest is a
 * different plugin.
 */
export function createPluginValidator (loader) {
  const verified = new Map()
  return async function resolvePlugin (iri) {
    try {
      const { profile } = await loader.loadProfile(iri)
      const resources = [
        ['processor', profile.processor],
        ['module', profile.module],
        ...(profile.assets ?? []).map(a => [`asset "${a.iri?.split('#').pop() ?? a.iri}"`, a])
      ].filter(([, resource]) => resource)
      const key = resources.map(([, r]) => `${r.location}@${r.integrity}`).join(' ')
      if (verified.get(iri) !== key) {
        for (const [kind, resource] of resources) await loader.fetchVerified(resource, { kind })
        verified.set(iri, key)
      }
      return {
        ok: true,
        ports: profile.ports.map(p => ({ symbol: p.symbol, name: p.name, unit: p.unit ?? null, minimum: p.minimum, maximum: p.maximum, defaultValue: p.defaultValue }))
      }
    } catch (error) {
      if (error instanceof LoadError) return { ok: false, message: error.message, step: error.step ?? null }
      return { ok: false, message: error?.message ?? String(error), step: null }
    }
  }
}

/** A label as a Reel name: lower case, anything else an underscore, never starting with a digit. */
export const slug = label => {
  const s = String(label ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return /^[a-z_]/.test(s) ? s : s ? `_${s}` : ''
}

/**
 * The plugins a script can already name: those it loaded in this session, by the name it gave them, and the
 * project's other plugins by the slug of their label when that is unambiguous.
 *
 * @returns {{existing: Map<string, {ports: object[]}>, ids: Map<string, string>}} `ids` is each name's node id. The
 * caller merges it into the session's names before a run, because the runner finds a plugin by that map.
 */
export function existingPlugins (dispatcher, session) {
  const existing = new Map()
  const ids = new Map()
  const portsOf = id => dispatcher.engineNode(id)?.profile?.ports ?? null

  for (const [name, id] of session.names) {
    const ports = portsOf(id)
    if (ports && dispatcher.project.nodes.some(n => n.id === id)) { existing.set(name, { ports }); ids.set(name, id) }
  }

  const bySlug = new Map()
  for (const node of dispatcher.project.nodes) {
    const name = slug(node.label ?? dispatcher.engineNode(node.id)?.profile?.label)
    if (!name) continue
    if (!bySlug.has(name)) bySlug.set(name, [])
    bySlug.get(name).push(node.id)
  }
  for (const [name, nodeIds] of bySlug) {
    // A name two plugins share is not a name: guessing which is how a script changes the wrong one.
    if (nodeIds.length !== 1 || existing.has(name)) continue
    const ports = portsOf(nodeIds[0])
    if (ports) { existing.set(name, { ports }); ids.set(name, nodeIds[0]) }
  }
  return { existing, ids }
}
