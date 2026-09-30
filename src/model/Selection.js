// src/model/Selection.js
//
// What is selected, in one place, for the timeline, the dock and the WebMCP
// surface to share. Held beside the project and outside the state a revision
// covers: selecting a clip is not an edit, does not undo, and never
// invalidates anything compiled.
//
// One kind at a time. Selecting tracks and then clicking a clip replaces the
// track selection, because an operation that acts on "the selection" has to
// know what sort of thing it holds.

export const KINDS = Object.freeze(['track', 'clip', 'note', 'node', 'lane'])

export class Selection {
  #kind = null
  #ids = new Set()
  #listeners = new Set()

  get kind () { return this.#kind }
  get ids () { return [...this.#ids] }
  get size () { return this.#ids.size }
  has (kind, id) { return this.#kind === kind && this.#ids.has(id) }

  /** Notified with the selection after every change. Returns an unsubscribe. */
  subscribe (fn) {
    this.#listeners.add(fn)
    return () => this.#listeners.delete(fn)
  }

  /** Replace the selection. An empty list clears it. */
  set (kind, ids) {
    this.#check(kind)
    this.#replace(ids.length === 0 ? null : kind, ids)
  }

  /** Add to the selection; a different kind replaces it. */
  add (kind, ids) {
    this.#check(kind)
    if (kind !== this.#kind) return this.set(kind, ids)
    this.#replace(kind, [...this.#ids, ...ids])
  }

  /** Add the id if absent, remove it if present; a different kind replaces. */
  toggle (kind, id) {
    this.#check(kind)
    if (kind !== this.#kind) return this.set(kind, [id])
    const next = new Set(this.#ids)
    if (!next.delete(id)) next.add(id)
    this.#replace(next.size === 0 ? null : kind, [...next])
  }

  clear () { this.#replace(null, []) }

  /** Drop ids that no longer exist. `exists(kind, id)` answers for the project. */
  prune (exists) {
    if (this.#kind === null) return
    const kept = [...this.#ids].filter(id => exists(this.#kind, id))
    if (kept.length !== this.#ids.size) this.#replace(kept.length === 0 ? null : this.#kind, kept)
  }

  #check (kind) {
    if (!KINDS.includes(kind)) throw new Error(`cannot select a ${kind}; one of ${KINDS.join(', ')}`)
  }

  #replace (kind, ids) {
    const next = new Set(ids)
    const same = kind === this.#kind && next.size === this.#ids.size && [...next].every(id => this.#ids.has(id))
    if (same) return
    this.#kind = next.size === 0 ? null : kind
    this.#ids = next
    for (const fn of [...this.#listeners]) fn(this)
  }
}
