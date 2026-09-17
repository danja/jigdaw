// src/catalogue/LocalCatalogue.js
//
// The plugins this host serves itself.
//
// A catalogue of 756 native plugins that none of them can run is not a plugin
// browser, it is a list. Until JigDAW's own plugins are harvested upstream, the
// host is the only thing that knows about them, so it indexes them and merges
// them into search.
//
// This is deliberately not a store. It reads the profiles that are already on
// disk, which are the same files the host serves and the same ones a browser
// validates, so there is no second copy to drift.
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'
import { parseText } from '../rdf/parse.js'
import { readProfile } from '../rdf/ProfileReader.js'
import { FACETS, expandTerm, compactTerm } from './facets.js'

// Facet name to the field that holds it. The two differ for role and format,
// which are singular as facets and plural as fields, and reading entry[name]
// directly meant those two silently matched nothing.
const FIELD_FOR = Object.freeze({
  role: 'roles',
  format: 'formats',
  accepts: 'accepts',
  produces: 'produces',
  requires: 'requires'
})

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** What search needs from a profile, in the same shape the upstream returns. */
function summarise (profile) {
  return {
    iri: profile.iri,
    label: profile.label,
    comment: profile.comment,
    vendor: profile.vendor,
    homepage: profile.homepage ?? profile.iri,
    // These are ours, so they run here by definition.
    web: true,
    local: true,
    roles: profile.roles.map(compactTerm),
    formats: profile.formats.map(compactTerm),
    accepts: profile.accepts.map(compactTerm),
    produces: profile.produces.map(compactTerm),
    requires: profile.requires.map(compactTerm)
  }
}

export class LocalCatalogue {
  #dir
  #entries = null
  #profiles = new Map()

  constructor ({ dir = join(root, 'plugins') } = {}) {
    this.#dir = dir
  }

  /**
   * Read every plugins/<name>/profile.ttl.
   *
   * A profile that does not parse is skipped and reported rather than throwing:
   * one broken plugin in a directory must not take the browser down with it.
   */
  async load () {
    if (this.#entries) return this.#entries

    const entries = []
    const problems = []
    let names = []
    try {
      names = (await readdir(this.#dir, { withFileTypes: true }))
        .filter(e => e.isDirectory()).map(e => e.name)
    } catch {
      this.#entries = []
      return this.#entries
    }

    for (const name of names) {
      const path = join(this.#dir, name, 'profile.ttl')
      try {
        const text = await readFile(path, 'utf8')
        const dataset = await parseText(text, `file://${path}`)
        const profile = readProfile(dataset)
        entries.push(summarise(profile))
        this.#profiles.set(profile.iri, profile)
      } catch (error) {
        problems.push(`${name}: ${error.message}`)
      }
    }

    if (problems.length > 0) console.warn('local catalogue skipped:', problems.join('; '))
    this.#entries = entries
    return entries
  }

  /** Forget what was read, so a rebuilt plugin is picked up. */
  invalidate () {
    this.#entries = null
    this.#profiles.clear()
  }

  async search ({ text = '', limit = 30, ...facets } = {}) {
    const entries = await this.load()
    const needle = text.trim().toLowerCase()

    return entries.filter(entry => {
      for (const name of Object.keys(FACETS)) {
        const wanted = facets[name]
        if (!wanted) continue
        const have = entry[FIELD_FOR[name]] ?? []
        const target = compactTerm(expandTerm(wanted))
        if (!have.includes(target)) return false
      }
      if (needle === '') return true
      return [entry.label, entry.comment, entry.vendor]
        .filter(Boolean)
        .some(field => field.toLowerCase().includes(needle))
    }).slice(0, limit)
  }

  async describe (iri) {
    await this.load()
    const profile = this.#profiles.get(iri)
    if (!profile) return null
    return {
      iri,
      properties: {
        label: [profile.label],
        comment: profile.comment ? [profile.comment] : [],
        vendor: profile.vendor ? [profile.vendor] : [],
        role: profile.roles.map(compactTerm),
        accepts: profile.accepts.map(compactTerm),
        produces: profile.produces.map(compactTerm),
        requires: profile.requires.map(compactTerm),
        caution: profile.cautions,
        parameter: profile.ports.map(p => p.symbol)
      }
    }
  }
}
