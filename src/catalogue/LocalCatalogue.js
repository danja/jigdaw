// src/catalogue/LocalCatalogue.js
//
// The plugins this host serves itself.
//
// A catalogue of hundreds of native plugins that none of them can run is not a
// plugin browser, it is a list. Until JigDAW's own plugins are harvested
// upstream, the host is the only thing that knows about them.
//
// It reads plugins/index.json, generated from the profiles by
// `npm run build:index`, rather than parsing Turtle at runtime. That is not an
// optimisation: it keeps bin/serve.js to node builtins alone, so the server
// needs no npm install. Importing an RDF parser here once crashed a deployment
// that had none, and the site answered 502 until it was reverted.
//
// tests/catalogue/LocalCatalogue.test.js fails if the index has drifted from
// the profiles, so the generated copy cannot quietly go stale.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

const TRN = 'http://purl.org/stuff/transmissions/'
const compact = value => (String(value).startsWith(TRN) ? String(value).slice(TRN.length) : String(value))

// Facet name to the field that holds it. role and format are singular as
// facets and plural as fields, and reading the entry by the facet name meant
// those two silently matched nothing.
const FIELD_FOR = Object.freeze({
  role: 'roles',
  format: 'formats',
  accepts: 'accepts',
  produces: 'produces',
  requires: 'requires'
})

export class LocalCatalogue {
  #path
  #entries = null

  constructor ({ path = join(root, 'plugins/index.json') } = {}) {
    this.#path = path
  }

  /**
   * Read the index.
   *
   * A missing or unreadable index means no local plugins, never a crash: the
   * host still serves and still searches upstream. A browser that fails to
   * open because an index is absent is worse than one with nothing in it.
   */
  async load () {
    if (this.#entries) return this.#entries
    try {
      const body = JSON.parse(await readFile(this.#path, 'utf8'))
      this.#entries = Array.isArray(body.plugins) ? body.plugins : []
    } catch (error) {
      console.warn(`local catalogue unavailable: ${error.message}. Run npm run build:index.`)
      this.#entries = []
    }
    return this.#entries
  }

  /** Forget what was read, so a rebuilt index is picked up. */
  invalidate () { this.#entries = null }

  async search ({ text = '', limit = 30, ...facets } = {}) {
    const entries = await this.load()
    const needle = text.trim().toLowerCase()

    return entries.filter(entry => {
      for (const [name, field] of Object.entries(FIELD_FOR)) {
        const wanted = facets[name]
        if (!wanted) continue
        if (!(entry[field] ?? []).includes(compact(wanted))) return false
      }
      if (needle === '') return true
      return [entry.label, entry.comment, entry.vendor]
        .filter(Boolean)
        .some(field => field.toLowerCase().includes(needle))
    }).slice(0, limit)
  }

  /** Everything the index holds about one plugin, or null to fall through. */
  async describe (iri) {
    const entry = (await this.load()).find(e => e.iri === iri)
    if (!entry) return null
    return {
      iri,
      properties: {
        label: entry.label ? [entry.label] : [],
        comment: entry.comment ? [entry.comment] : [],
        vendor: entry.vendor ? [entry.vendor] : [],
        role: entry.roles ?? [],
        accepts: entry.accepts ?? [],
        produces: entry.produces ?? [],
        requires: entry.requires ?? [],
        caution: entry.cautions ?? [],
        parameter: entry.parameters ?? []
      }
    }
  }
}
