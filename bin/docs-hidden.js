// bin/docs-hidden.js
//
// Documents that stay in the repository and are not published on the site:
// working notes, an agent's style guide, files that name paths on one
// person's machine, and a build log that is a record for the maintainers
// rather than something a reader deciding what to do needs. A link to one from
// a published page goes to the file on GitHub instead of to a page that does
// not exist. One list, read by bin/build-docs-site.js and by the tests that
// check its output.
export const HIDDEN_DOCS = Object.freeze([
  'first-thoughts', 'overview-danny', 'danify', 'local-references', 'plan', 'track-view-terms'
])
