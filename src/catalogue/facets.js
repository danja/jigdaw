// src/catalogue/facets.js
//
// The facet list, in one place.
//
// Separate from Catalogue.js because the agent surface and the page need to
// know the facet names, and Catalogue.js reads queries off disk. A browser
// bundle that imports it drags node:fs in with it and the build fails. This is
// the same split as src/validate/files.js: the part with a filesystem stays
// apart from the part that does not need one.
//
// AGENTS.md: where a list must exist, make it one list and export it. Copying
// these names into the server, the page and the tool schema is how a facet
// comes to be silently ignored on one of them.

const TRN = 'http://purl.org/stuff/transmissions/'

export const FACETS = Object.freeze({
  role: `${TRN}role`,
  accepts: `${TRN}accepts`,
  produces: `${TRN}produces`,
  requires: `${TRN}requires`,
  format: `${TRN}format`
})

export const FACET_NAMES = Object.freeze(Object.keys(FACETS))

/** A bare local name means the transmissions namespace. */
export const expandTerm = value =>
  String(value).startsWith('http') ? String(value) : `${TRN}${value}`

/** The reverse, so an agent sees a readable value. */
export const compactTerm = value =>
  value?.startsWith(TRN) ? value.slice(TRN.length) : value

export { TRN }
