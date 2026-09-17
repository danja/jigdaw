// src/host/Capabilities.js
//
// Contract section 2. A host evaluates every trn:requires BEFORE fetching any
// code. The alternative is to download and instantiate a plugin and then find
// it cannot work, which wastes the download, runs untrusted code for no reason,
// and produces a failure several steps removed from its cause.
import { vocabulary as v, JIG, TRN } from '../rdf/Vocabulary.js'

const { jig, trn } = v

// transmission compacts objects in its own namespace to readable values in MCP
// responses, so an agent sees "MidiEvents" rather than a 40 character IRI while
// the data stays fully qualified. Same idea, same reason.
const PREFIXES = Object.freeze([['jig:', JIG], ['trn:', TRN]])

export function compact (iri) {
  for (const [prefix, namespace] of PREFIXES) {
    if (iri.startsWith(namespace)) return prefix + iri.slice(namespace.length)
  }
  return iri
}

/**
 * What this environment can offer.
 *
 * `env` is injected rather than read from globals so that the negotiation is
 * testable without a browser, and so a host can deliberately withhold a
 * capability it technically has.
 */
export function detectCapabilities (env = globalThis) {
  const offered = new Set([
    // Always provided by the host itself rather than by the platform.
    trn.HostTransport,
    jig.MidiEvents,
    // Collecting what a plugin emits and routing it onward. Separate from
    // MidiEvents because they are separate services and a host may do one and
    // not the other: EventRouter.observe is what makes this one true here.
    jig.MidiOut,
    jig.Persistence,
    jig.OfflineRender
  ])

  if (env.crossOriginIsolated === true) {
    offered.add(jig.CrossOriginIsolation)
    // SharedArrayBuffer exists without isolation in some environments but is
    // not usable across threads, so isolation is the condition, not the
    // constructor being present.
    if (typeof env.SharedArrayBuffer === 'function') offered.add(jig.SharedMemory)
  }

  return offered
}

/**
 * Decide whether a profile can run here.
 *
 * Returns { satisfied, missing, granted }. `granted` is what is passed to the
 * processor in processorOptions, so a plugin that declared jig:prefers reads
 * its fallback decision rather than probing for features.
 */
export function negotiate (profile, offered) {
  const available = offered instanceof Set ? offered : new Set(offered)

  const missing = (profile.requires ?? []).filter(c => !available.has(c))
  const granted = [
    ...(profile.requires ?? []),
    ...(profile.prefers ?? []).filter(c => available.has(c))
  ]

  return {
    satisfied: missing.length === 0,
    missing,
    granted: [...new Set(granted)]
  }
}

/** A message naming what is missing, for contract section 10.1. */
export function explainMissing (profile, missing) {
  const names = missing.map(compact).join(', ')
  return `${profile.label ?? profile.iri} requires ${names}, which this host does not offer`
}
