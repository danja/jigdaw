// src/catalogue/Catalogue.js
//
// Finding a plugin.
//
// docs/architecture.md: the catalogue should not start empty. plugin-universe
// already runs a public read-only SPARQL endpoint over 756 profiles under CC0,
// so this queries that rather than building a second catalogue of the same
// things.
//
// Search is demand driven, following transmission: this returns enough to
// choose between candidates, and `describe` is called only for the few that
// matter. An agent picking a reverb does not need the parameter list of every
// delay, and returning it anyway spends the context it needs for the task.
import { QueryService } from './QueryService.js'
import { iri, literal, integer } from './terms.js'
import { FACETS, FACET_NAMES, expandTerm, compactTerm as compact, TRN } from './facets.js'

const DEFAULT_ENDPOINT = 'https://sparql.plugin-universe.com/public/query'

export { FACET_NAMES }

export class Catalogue {
  #endpoint
  #queries
  #fetch

  constructor ({
    endpoint = DEFAULT_ENDPOINT,
    queries = new QueryService(),
    fetch = (...args) => globalThis.fetch(...args)
  } = {}) {
    this.#endpoint = endpoint
    this.#queries = queries
    this.#fetch = fetch
  }

  get endpoint () { return this.#endpoint }

  async #select (sparql) {
    const response = await this.#fetch(this.#endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/sparql-query',
        accept: 'application/sparql-results+json'
      },
      body: sparql
    })
    if (!response.ok) {
      throw new Error(`the catalogue at ${this.#endpoint} returned ${response.status}`)
    }
    const body = await response.json()
    return body.results?.bindings ?? []
  }

  /**
   * Find candidates.
   *
   * A facet whose value is not an IRI is taken as a local name in the
   * transmissions namespace, so a caller can ask for `accepts=Midi` rather than
   * spelling out a forty character IRI. That is the same compaction the results
   * use, applied in reverse.
   */
  async search ({ text = '', limit = 30, ...facets } = {}) {
    const clauses = []

    for (const [name, value] of Object.entries(facets)) {
      if (value === undefined || value === null || value === '') continue
      if (!(name in FACETS)) throw new Error(`no such facet: ${name}. Known: ${FACET_NAMES.join(', ')}`)
      clauses.push(`?plugin ${iri(FACETS[name])} ${iri(expandTerm(value))} .`)
    }

    if (text.trim() !== '') {
      const needle = literal(text.trim().toLowerCase())
      clauses.push(
        `FILTER (CONTAINS(LCASE(?label), ${needle})` +
        ` || CONTAINS(LCASE(COALESCE(?comment, "")), ${needle})` +
        ` || CONTAINS(LCASE(COALESCE(?vendor, "")), ${needle}))`
      )
    }

    const sparql = await this.#queries.build('catalogue/search', {
      filters: clauses.join('\n    '),
      limit: integer(Math.min(limit, 200))
    })

    return (await this.#select(sparql)).map(row => ({
      iri: row.plugin.value,
      label: row.label?.value ?? null,
      comment: row.comment?.value ?? null,
      vendor: row.vendor?.value ?? null,
      homepage: row.homepage?.value ?? null,
      // Loadable here, as opposed to merely known about.
      web: row.web?.value === 'true',
      roles: (row.roles?.value ?? '').split('|').filter(Boolean).map(compact),
      formats: (row.formats?.value ?? '').split('|').filter(Boolean).map(compact)
    }))
  }

  /** Everything the catalogue holds about one plugin. */
  async describe (pluginIri) {
    const sparql = await this.#queries.build('catalogue/describe', { plugin: iri(pluginIri) })
    const properties = {}
    for (const row of await this.#select(sparql)) {
      const key = compact(row.p.value)
      ;(properties[key] ??= []).push(compact(row.o.value))
    }
    return { iri: pluginIri, properties }
  }
}
