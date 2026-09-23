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

// The smallest module using each WebAssembly feature the vocabulary defines,
// the probes wasm-feature-detect uses: each is valid only where its feature is.
// Every feature in vocabs/shapes.ttl's sh:in list for jig:wasmFeature needs
// one, or a host refuses every module declaring it; tests/host/Capabilities
// binds the two lists.
export const WASM_FEATURE_PROBES = Object.freeze({
  // A v128 from i8x16.splat, then i8x16.popcnt.
  [jig.Simd128]: Uint8Array.of(
    0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0,
    65, 0, 253, 15, 253, 98, 11),
  // memory.copy over a one page memory.
  [jig.BulkMemory]: Uint8Array.of(
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 3, 1, 0, 1, 10, 14, 1, 12,
    0, 65, 0, 65, 0, 65, 0, 252, 10, 0, 0, 11),
  // An atomic load from a shared memory.
  [jig.Threads]: Uint8Array.of(
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 5, 4, 1, 3, 1, 1, 10, 11, 1, 9,
    0, 65, 0, 254, 16, 2, 0, 26, 11),
  // try with catch_all.
  [jig.ExceptionHandling]: Uint8Array.of(
    0, 97, 115, 109, 1, 0, 0, 0, 1, 4, 1, 96, 0, 0, 3, 2, 1, 0, 10, 8, 1, 6, 0, 6, 64, 25, 11, 11)
})

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

  // Contract section 2.1: a WebAssembly feature is asked of the engine, by
  // validating the smallest module that uses it, not inferred from a browser.
  if (typeof env.WebAssembly?.validate === 'function') {
    for (const [feature, probe] of Object.entries(WASM_FEATURE_PROBES)) {
      if (env.WebAssembly.validate(probe)) offered.add(feature)
    }
  }

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

  const needed = [...(profile.requires ?? []), ...(profile.module?.wasmFeatures ?? [])]
  const missing = needed.filter(c => !available.has(c))
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
