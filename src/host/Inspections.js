// src/host/Inspections.js
//
// The discovered half of the curated/discovered split (docs/plugin-profiles.md,
// docs/architecture.md): what a host actually observed loading a plugin.
// Contract section 10.3 says a host SHOULD record load outcomes as
// jig:Inspection records, including failures; this is that record, kept as
// plain objects shaped like the vocabulary's own predicates
// (jig:inspectionOf, jig:inspectedAt, jig:hostVersion, jig:loadOutcome)
// rather than as RDF, because nothing in a browser host writes triples of
// its own. The shape is what would serialise cleanly if something ever did.
const HOST_VERSION = 'jigdaw-host/0.1.0'
const STORAGE_KEY = 'jigdaw:inspections'

// Bounded like every other queue in this project: a session that loads and
// reloads plugins for hours must not grow this without limit.
const MAX_RECORDS = 200

function defaultStorage () {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null
  } catch {
    // Some browsers throw merely reading the getter under a locked-down
    // storage policy, rather than returning null.
    return null
  }
}

export class Inspections {
  #storage

  // Storage is injected, never read from globalThis inside a method, so a
  // host with none (private browsing, a test, a worker) gets a working
  // no-op instead of a throw the first time a plugin loads.
  constructor ({ storage = defaultStorage() } = {}) {
    this.#storage = storage ?? null
  }

  /** Record what happened loading `iri`. `outcome` is free text, per
   * jig:loadOutcome: "loaded", or "failed: <reason>". */
  record ({ iri, outcome }) {
    if (!this.#storage) return
    const records = this.#read()
    records.push({
      inspectionOf: iri,
      inspectedAt: new Date().toISOString(),
      hostVersion: HOST_VERSION,
      loadOutcome: outcome
    })
    while (records.length > MAX_RECORDS) records.shift()
    try {
      this.#storage.setItem(STORAGE_KEY, JSON.stringify(records))
    } catch {
      // Storage full or blocked after the read succeeded. A missed
      // inspection is not worth failing a plugin load over.
    }
  }

  /** Every inspection recorded of one plugin, oldest first. */
  forPlugin (iri) {
    return this.#read().filter(r => r.inspectionOf === iri)
  }

  /** Every inspection recorded, oldest first. */
  all () {
    return this.#read()
  }

  #read () {
    if (!this.#storage) return []
    try {
      const raw = this.#storage.getItem(STORAGE_KEY)
      const parsed = raw ? JSON.parse(raw) : []
      return Array.isArray(parsed) ? parsed : []
    } catch {
      // Corrupt or foreign data under this key. Discovered evidence that
      // cannot be read is the same as none; it does not block a load.
      return []
    }
  }
}
