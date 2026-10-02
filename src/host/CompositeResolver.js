// src/host/CompositeResolver.js
//
// Contract section 14, steps 1 to 3: the whole tree of a composite plugin is
// fetched, validated and checked before any code is fetched. docs/nested-plugins.md
// section 4.
//
// Profiles only. Nothing here touches a module, a processor, a user interface
// or an asset, for the reason plugin-collections.md gives for not fetching code
// to draw a list: the bytes checked now are not the bytes that will run, and a
// rack of forty members would download forty plugins to find out one is missing
// a capability. A failure anywhere refuses the whole composite and names the
// member, so the caller never holds half a rack.
//
// The loader is injected, as everywhere in src/host, so the ordering this file
// exists to enforce is exercised against fakes as well as real fetches.
import { readComposite, checkComposite, isComposite } from '../rdf/CompositeReader.js'
import rdf from '@zazuko/env'
import { pluginForm, inPluginTree } from '../rdf/Canonical.js'
import { digestOf } from './Integrity.js'
import { LoadError, STEPS } from './LoadError.js'

/** A host MUST support at least this many levels of composite inside composite. Contract section 14. */
export const MINIMUM_DEPTH = 4

const encoder = new TextEncoder()

/**
 * A `bundled` lookup over one graph that holds several plugins, as a flattened composite does:
 * the profile of an IRI is the triples whose subject is that IRI or a fragment of it
 * (plugin-bundles.md section 9). Null for an IRI the graph holds nothing about, so the loader
 * goes to the network for it.
 */
export function bundledFromGraph (graph) {
  return target => {
    const own = [...graph].filter(quad => inPluginTree(quad.subject.value, target))
    return own.length === 0 ? null : rdf.dataset(own)
  }
}

/**
 * @param iri     the composite's IRI
 * @param loader  a PluginLoader: fetchDataset, profileFrom, checkCapabilities
 * @param bundled iri => dataset | null, consulted before the network: a bundle already holds its members' profiles
 * @param maxDepth how many composites may be inside one another, at least MINIMUM_DEPTH
 * @param subtle  WebCrypto's SubtleCrypto, injected for the digest
 * @returns {Promise<Tree>} where a Tree is
 *   { kind: 'plugin', iri, profile, granted }
 *   or { kind: 'composite', iri, composite, granted, members: [{ id, plugin, tree }] }
 */
export async function resolveComposite (iri, { loader, bundled = () => null, maxDepth = 8, subtle = crypto.subtle } = {}) {
  if (!loader) throw new Error('resolveComposite needs a loader')
  if (!(maxDepth >= MINIMUM_DEPTH)) throw new Error(`a host must support at least ${MINIMUM_DEPTH} levels of nesting, not ${maxDepth}`)

  // One fetch per IRI however often a member is used. Keyed by IRI, holding the promise,
  // so two members that name one plugin do not race two requests for it.
  const fetched = new Map()
  const datasetOf = target => {
    if (!fetched.has(target)) fetched.set(target, bundled(target) ?? loader.fetchDataset(target))
    return fetched.get(target)
  }

  async function visit (target, chain) {
    const dataset = await datasetOf(target)
    if (!isComposite(dataset)) {
      return { kind: 'plugin', iri: target, ...loader.profileFrom(dataset, target) }
    }

    // The chain is composites only: a plugin cannot contain anything. A repeat is a loop, and a
    // loop has no end to expand to, so it is refused at the first repeat naming the whole way round.
    if (chain.includes(target)) {
      throw new LoadError(STEPS.composite, `${target} contains itself: ${[...chain, target].join(' > ')}`, { iri: target })
    }
    if (chain.length >= maxDepth) {
      throw new LoadError(STEPS.composite,
        `${target} is nested ${chain.length + 1} composites deep, and this host's limit is ${maxDepth}: ${[...chain, target].join(' > ')}`,
        { iri: target })
    }

    let composite
    try {
      composite = readComposite(dataset)
    } catch (cause) {
      throw new LoadError(STEPS.parseProfile, cause.message, { cause, iri: target })
    }
    const problems = checkComposite(composite)
    if (problems.length > 0) {
      throw new LoadError(STEPS.composite,
        `${target} is not a sound composite: ${problems.map(p => p.message).join('; ')}`, { iri: target })
    }

    const granted = new Set(loader.checkCapabilities({ iri: target, label: composite.label, requires: composite.requires }, target))
    const members = []
    for (const member of composite.members) {
      if (!member.plugin) {
        throw new LoadError(STEPS.composite, `${target} has a member, ${member.id}, that names no plugin`, { iri: target })
      }
      let tree
      try {
        tree = await visit(member.plugin, [...chain, target])
      } catch (cause) {
        // The step is kept, so what failed is still what is reported, and the member is added, so that
        // a person reading it knows which part of the rack to look at. Anything that is not a LoadError is a bug.
        if (!(cause instanceof LoadError)) throw cause
        throw new LoadError(cause.step, `${target}, member ${member.id}: ${cause.message}`, { cause, iri: cause.iri ?? member.plugin })
      }

      if (member.pinnedDigest !== null) {
        const memberDataset = await datasetOf(member.plugin)
        // Over the identity the profile states, which is not the URL it was fetched from when the member is a mirror
        // or a local copy (plugin-profiles.md, the @base rule). A composite is pinned to a plugin, not to a place.
        const identity = tree.kind === 'plugin' ? tree.profile.iri : tree.composite.iri
        const actual = await digestOf(encoder.encode(pluginForm(memberDataset, identity)), 'sha384', { subtle })
        if (actual !== member.pinnedDigest) {
          throw new LoadError(STEPS.composite,
            `${target} pins ${member.plugin} as ${member.pinnedDigest}, and the profile fetched for it is ${actual}. ` +
            'The member has changed since the composite was made, and a pin offers no way past that.',
            { iri: member.plugin })
        }
      }
      for (const capability of tree.granted) granted.add(capability)
      members.push({ id: member.id, plugin: member.plugin, tree })
    }
    checkDrives(target, composite, members)
    return { kind: 'composite', iri: target, composite, granted: [...granted], members }
  }

  return visit(iri, [])
}

/**
 * The check docs/nested-plugins.md section 2.2 gives to the loader because it needs the members' profiles: every
 * parameter an exposed port drives exists on its member, and the port's range lies within that parameter's,
 * so the composite never asks a member for a value it declares it cannot take.
 */
function checkDrives (iri, composite, members) {
  for (const port of composite.ports) {
    for (const drive of port.drives) {
      const member = members.find(m => m.id === drive.node)
      if (!member) continue
      const available = member.tree.kind === 'plugin' ? member.tree.profile.ports : member.tree.composite.ports
      const target = available.find(p => p.symbol === drive.portSymbol)
      const where = `${iri}: port "${port.symbol}" drives "${drive.portSymbol}" of ${member.id}`
      if (!target) {
        throw new LoadError(STEPS.composite, `${where}, which has no such parameter. It has: ${available.map(p => p.symbol).join(', ') || 'none'}.`, { iri })
      }
      if ((port.minimum ?? -Infinity) < (target.minimum ?? -Infinity) || (port.maximum ?? Infinity) > (target.maximum ?? Infinity)) {
        throw new LoadError(STEPS.composite,
          `${where}, whose range is ${target.minimum} to ${target.maximum}, and the port declares ${port.minimum} to ${port.maximum}. ` +
          'A port must lie within the range of what it drives.', { iri })
      }
    }
  }
}

/** Every distinct plugin in a resolved tree, which is what step 5 loads: one instantiation per use, one fetch per IRI. */
export function pluginsOf (tree) {
  const found = new Map()
  const walk = node => {
    if (node.kind === 'plugin') found.set(node.iri, node)
    else node.members.forEach(m => walk(m.tree))
  }
  walk(tree)
  return [...found.values()]
}
