# Revisions

## 2026-09-24. Plugin collections

There was no way to hand a host a set of plugins. A plugin is one IRI and a session is a
whole configuration, and nothing sat between the two: sharing "these reverbs" or "the plugins
this tutorial uses" meant sending a list of URLs for someone to paste in one at a time.

**What changed.**

- [plugin-collections.md](plugin-collections.md), normative: a collection is one Turtle file
  at one URL giving its name, a description, and the IRI and name of each plugin it includes.
  It carries no code and no digests, and each plugin's own profile governs where the two
  disagree.
- `jig:PluginCollection` is the one new term. Membership is `dcterms:hasPart` and names are
  `rdfs:label`, both reused unchanged. Declared in `vocabs/jigdaw.ttl` and
  `src/rdf/Vocabulary.js`, constrained by `jig:PluginCollectionShape` in `vocabs/shapes.ttl`,
  with `examples/reference-collection.ttl` and `examples/counterexample-collection.ttl`
  beside the other examples. Proposed upstream and, since 2026-09-24, a subclass of
  `trn:PluginCollection` (`~/github/transmission/vocabs/profile.ttl`) rather than of
  `dcmitype:Collection` directly, kept as a subclass so a collection already published under
  `jig:PluginCollection` still validates against it.
- Opening a collection runs contract section 3.1 steps 1 and 2 for each member: fetch the
  profile, parse and validate it, and check its required capabilities. It fetches no module,
  processor, user interface or asset. Those are fetched and checked against their digests
  when a person loads the plugin, which the host has to do at that point anyway.
- The browser host opens collections from an "Open a collection" form and from
  `?collection=<url>`. `web/collections/jigdaw.ttl` lists every plugin in this repository,
  and `tests/catalogue/CollectionLoader.test.js` fails if it and `plugins/` disagree.

**What it affects.** Nothing that already exists: no profile, project or bundle changes, and
a host that never opens a collection still conforms. A host that does must refuse an invalid
collection whole, report a failed member with the step and the reason rather than offer to
load it, and still perform the whole of contract section 3.1 when a member is loaded.

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
