# Revisions

A dated log of changes to the published vocabulary and specification: what changed, why, and
what it affects for somebody already relying on either. Not [MISTAKES.md](../MISTAKES.md),
which is a post-mortem of what went wrong internally, and not [TODO.md](../TODO.md), which is
what is still open. This is what has actually shipped, in the order it shipped, for anyone who
fetched a profile or read a document last week and wants to know what is different now.

Newest first.

## 2026-09-23. `doap:developer` added; provenance's scope stated explicitly

An independent implementation, `diddums`, built against the published specification, fetched
`provenance.ttl` beside each plugin served from its own canonical origin (`strandz.it`) and
got a 404. That was the correct answer under the model [plugin-bundles.md](plugin-bundles.md)
already describes: a `jig:Bundle` is a copy of a plugin, and a plugin served at the origin
that minted its IRI was never copied, so it has no `jig:Bundle` and no `provenance.ttl` to
serve. But the question underneath the 404 was real: nothing in a profile said, as an IRI a
tool could follow, who wrote the plugin. `trn:vendor` was already on every profile and answers
a different question, a display string for a catalogue rather than an identity.

**What changed.**

- `doap:developer`, reusing DOAP rather than minting a `jig:` term, the same way
  `doap:revision` already does. An IRI, never a name, for the same reason attribution in a
  provenance record already insists on one. Declared in `src/rdf/Vocabulary.js`, constrained
  in `vocabs/shapes.ttl` (optional, `sh:nodeKind sh:IRI`), and explained in a comment in
  `vocabs/jigdaw.ttl`.
- All 9 worked plugins' profiles now carry `doap:developer <http://danny.ayers.name>`, live
  at `strandz.it`. `bin/write-profile.js` and `bin/jsfx-import.js` both emit it, so it is not
  a one-off edit that a future plugin has to remember to repeat.
- [plugin-bundles.md](plugin-bundles.md) section 5 now says plainly that provenance describes
  a copy, not the plugin, and that a 404 for `provenance.ttl` at a plugin's own canonical
  origin is the specification working as intended rather than a gap.
- [plugin-profiles.md](plugin-profiles.md) gained a "Who wrote it" section distinguishing
  `trn:vendor` from `doap:developer`, and documents `doap:revision` in prose for the first
  time, which had the same gap (declared in the vocabulary and the shapes, never written down
  in a guide) since it was added.

**What it affects.** A tool reading a JigDAW profile now has an IRI for authorship where
before it had, at best, a display string. A tool that goes looking for `provenance.ttl`
beside a profile served from its own origin should stop: nothing is meant to be there, and
finding nothing is the specification agreeing with itself.
