// src/model/ScriptState.js
//
// The scripts saved with a session: what a person typed to drive the plugins. Held beside the project and
// outside the state a revision covers, the way EditorState is, because typing a script is not an edit to
// the audio graph and saving one must not bump the revision or invalidate anything compiled. It is
// written to its own document (`scripts.ttl`), see docs/project-format.md, "Scripts in a saved session".
//
// Only text lives here. Nothing in this class runs a script, and nothing that opens a session may.

import { vocabulary } from '../rdf/Vocabulary.js'

/** The language of docs/livecoding.md, as the vocabulary names it. */
export const REEL = vocabulary.jig.Reel

export class ScriptState {
  #scripts = new Map()
  #listeners = new Set()

  /** Told after any change, so a view can know there is something to save. */
  subscribe (fn) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  #changed () { for (const fn of [...this.#listeners]) fn(this) }

  get size () { return this.#scripts.size }

  /** Every script, by id, as plain objects: {id, label, language, source, savedAt}. */
  get all () { return [...this.#scripts.values()].map(s => ({ ...s })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) }

  get (id) {
    const s = this.#scripts.get(id)
    return s ? { ...s } : null
  }

  /** The first script in a language, or null: what the Script tab shows. */
  firstIn (language) {
    return this.all.find(s => s.language === language) ?? null
  }

  /**
   * Save a script under an id, replacing any with that id. The source must be a non-empty string,
   * because an empty script is nothing to save and the format refuses one.
   */
  set (id, { source, label = null, language = REEL, savedAt = null }) {
    if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error('a script id is letters, digits, hyphens and underscores')
    if (typeof source !== 'string' || source.length === 0) throw new Error('a script needs source text that is not empty')
    if (typeof language !== 'string' || !language) throw new Error('a script needs a language')
    this.#scripts.set(id, { id, label, language, source, savedAt })
    this.#changed()
  }

  remove (id) {
    if (this.#scripts.delete(id)) this.#changed()
  }

  clear () {
    if (this.#scripts.size === 0) return
    this.#scripts.clear()
    this.#changed()
  }

  /** Replace everything with what `readScripts` returned. A bad entry throws and changes nothing. */
  load (list) {
    const next = new ScriptState()
    for (const s of list) next.set(s.id, s)
    this.#scripts = next.#scripts
    this.#changed()
  }
}
