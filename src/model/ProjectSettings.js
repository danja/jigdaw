// src/model/ProjectSettings.js
//
// How a session wants to be played, as opposed to what it contains. Today one setting: whether tracks are lined up with
// one another for latency (docs/latency.md, "Between tracks"). Held beside the project and outside the state a revision
// covers, as the title and the scripts are, because it changes how the same project is heard and not what it is.
// A setting is true, false, or null for "this session does not say", in which case the person's own preference applies.
// Saved on the project node in session.ttl (jig:alignTracks), see docs/project-format.md.

export const EMPTY_SETTINGS = Object.freeze({ alignTracks: null })

/**
 * The settings after applying a patch. Each field is a boolean, or null for not stated. Anything else throws, and
 * nothing is partly applied.
 */
export function patchSettings (current, patch) {
  if (patch === null || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('project settings are an object with alignTracks')
  const next = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (!(key in EMPTY_SETTINGS)) throw new Error(`unknown project setting: ${key}`)
    if (value !== null && typeof value !== 'boolean') throw new Error(`${key} is true or false, or null for not stated`)
    next[key] = value
  }
  return next
}
