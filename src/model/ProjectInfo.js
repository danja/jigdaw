// src/model/ProjectInfo.js
//
// The words a person keeps about a session: a title, who made it, and notes to themselves or to whoever
// opens it next. Held beside the project and outside the state a revision covers, as the layout and the
// scripts are, because typing a note is not an edit to the audio graph. Saved on the project node in
// session.ttl (rdfs:label, dcterms:creator, rdfs:comment), see docs/project-format.md.

export const INFO_LIMITS = Object.freeze({ title: 120, author: 120, notes: 4000 })

export const EMPTY_INFO = Object.freeze({ title: null, author: null, notes: null })

/**
 * The info after applying a patch. A field is a string within its limit, or null for none; an empty or
 * blank string means none. Anything else throws, and nothing is partly applied.
 */
export function patchInfo (current, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('project info is an object with title, author and notes')
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in INFO_LIMITS)) throw new Error(`unknown project info field: ${key}`)
    if (value === null || value === undefined) { next[key] = null; continue }
    if (typeof value !== 'string') throw new Error(`${key} is text, or null for none`)
    const text = key === 'notes' ? value.trim() : value.trim().replace(/\s+/g, ' ')
    if (text.length > INFO_LIMITS[key]) throw new Error(`${key} is at most ${INFO_LIMITS[key]} characters`)
    next[key] = text === '' ? null : text
  }
  return next
}
