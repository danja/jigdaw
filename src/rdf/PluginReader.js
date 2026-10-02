// src/rdf/PluginReader.js
//
// Read a plugin's profile whichever kind of plugin it is: a Jig with code of its own, or a composite
// plugin made of other plugins (docs/nested-plugins.md). Both come back in the shape readProfile
// returns, so a consumer that lists, searches or draws plugins (the catalogue index, the gallery, the
// `jig` tool) treats them alike and does not branch on kind. A composite's `composite: true`, and
// its null `module` and `processor`, are what say it has no code of its own.
//
// Not a replacement for readProfile, which a loader still uses for a plugin it is about to
// instantiate: a loader must handle a composite as a tree, not as one profile.
import { readProfile } from './ProfileReader.js'
import { readComposite, compositeProfile, isComposite } from './CompositeReader.js'

export function readPlugin (dataset, options = {}) {
  return isComposite(dataset) ? compositeProfile(readComposite(dataset)) : readProfile(dataset, options)
}
