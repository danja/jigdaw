// src/catalogue/QueryService.js
//
// Loads SPARQL from files under sparql/queries/<category>/<name>.sparql.
//
// AGENTS.md forbids inline SPARQL as a template literal in JavaScript, for the
// same reasons markup does not belong in code: a query is a document with its
// own syntax that an editor can check and a person can read, and one buried in
// a template literal is neither.
//
// Every placeholder must be supplied. An unfilled one is an error rather than
// an empty string, because a query with a silently empty graph name still runs
// and returns the wrong thing.
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export class QueryService {
  #dir
  #cache = new Map()

  constructor ({ dir = join(root, 'sparql/queries'), cache = true } = {}) {
    this.#dir = dir
    this.cacheEnabled = cache
  }

  async load (name) {
    if (this.cacheEnabled && this.#cache.has(name)) return this.#cache.get(name)
    if (!/^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/.test(name)) {
      throw new Error(`not a query name: ${name}. Expected <category>/<name>.`)
    }
    const text = await readFile(join(this.#dir, `${name}.sparql`), 'utf8')
    if (this.cacheEnabled) this.#cache.set(name, text)
    return text
  }

  /** Load and fill. Throws if a placeholder is unsupplied or unused. */
  async build (name, values = {}) {
    const template = await this.load(name)
    const wanted = new Set([...template.matchAll(/\$\{(\w+)\}/g)].map(m => m[1]))

    const missing = [...wanted].filter(k => values[k] === undefined)
    if (missing.length > 0) {
      throw new Error(`${name}: no value for ${missing.join(', ')}`)
    }
    const surplus = Object.keys(values).filter(k => !wanted.has(k))
    if (surplus.length > 0) {
      // Both directions. A surplus value means the query and its caller have
      // drifted, which is worth knowing before the result is wrong.
      throw new Error(`${name}: ${surplus.join(', ')} supplied but not used`)
    }

    return template.replace(/\$\{(\w+)\}/g, (_, key) => values[key])
  }
}
