# Related local repositories

Prior art and seed data. JigDAW depends on none of them, and none should become a
dependency.

## `~/github/transmission`

A VST3 host with an RDF plugin catalogue and an MCP face. The direct ancestor, and now also a
downstream consumer: it hosts JigDAW plugins alongside VST3 ones, documented at
[danja.github.io/transmission/jigdaw.html](https://danja.github.io/transmission/jigdaw.html).

Its `native/CMakeLists.txt` adds `native/jigdaw-adapter` from a JigDAW checkout and links
`jigdaw_core`, so it does not reimplement the contract; it is the first thing outside this
repository to use that code, and the reason the portable half was worth separating from the
DPF shell. The feature is off by default and needs `-DTRANSMISSION_WITH_JIGDAW=ON`, a
`JIGDAW_ROOT` and cpp-httplib, so nothing here is a dependency in either direction.

It mints `trn:JigdawPlugin` and `trn:pluginIri` for the node type and its one setting, which
is worth knowing before minting anything similar in `jig:`.

It found the locale defect in `Profile.cpp` recorded in `MISTAKES.md`, which nothing inside
this repository would have: no test here runs under a comma-decimal locale, and no host here
calls `setlocale`.

- `vocabs/profile.ttl` is the `trn:` vocabulary: `trn:PluginProfile`, the role taxonomy, the
  signal types, and the routing properties JigDAW reuses unchanged.
- `docs/plugin-profiles.md` is the profile specification, and the source of the discovered
  versus curated distinction.
- `vocabs/actions.ttl` makes RDF the wire format rather than only the file format: POST
  bodies are Turtle, errors are Turtle with typed classes, and every changeset carries
  `trn:expectedRevision` and `trn:dryRun` for optimistic concurrency. Worth revisiting when
  JigDAW has more than one agent editing a session.
- Note the pragmatic escape hatch there: deeply nested structures ride as JSON string
  literals inside RDF rather than being modelled as triples.
- No triplestore, no SPARQL, no WASM, no containers. Querying is in-memory `dataset.match()`.

## `~/github/downspout`

52 VST3 plugins, each with a hand-written `plugins/<name>/profile.ttl`. The profile format
in real use, at a scale where its gaps show.

- `plugins/magneto/magneto-profile.ttl` uses the homepage-as-subject form with a
  self-describing preamble aimed at third-party authors. The closest existing thing to a
  JigDAW profile.
- `README.agents.md` is a README written for machine consumers, as a linked-data discovery
  entry point.
- `docs/campione-profiles/01-descriptor-spec.md` is the register JigDAW's contract is
  written in: versioned, normative, RFC 2119, with a stated rationale wherever an
  implementer would be tempted to revert the decision. Its section 1.3 is the source of the
  no-blank-nodes rule and its three-part justification.
- The house rule worth copying: a structural change to a plugin updates that plugin's
  `profile.ttl` in the same commit.

## `~/github/valis`

Virtual analog circuits described in RDF. The instrument is the document.

- `vocabs/valis.ttl` is loaded at runtime, and a test asserts that the classes carrying
  `val:implementation` and the C++ factory keys are equal in both directions. Drift is a
  test failure rather than a surprise. This is the single highest-value idea available to a
  plugin system.
- The precedent for describing parameters with `lv2:port` and `units:`, and for deciding a
  widget from the shape of a port declaration rather than from a name.
- `src/ops/OpDispatcher.cpp` with the UI and the MCP server as thin adapters over it.
- `.claude/commands/new-element.md` scaffolds ontology, implementation, registry entry and
  test in one pass. The model for a future `/new-plugin`.
- `MISTAKES.md` carries the stream-position rule twice, from opposite directions.

## `~/github/plugin-universe`

Live at [plugin-universe.com](https://plugin-universe.com). An open database of DAW plugins,
RDF-backed, with semantic search.

- The published profile specification at `/about/profiles`, which JigDAW extends rather than
  replaces.
- Vocabularies at `/ns`, served as Turtle.
- A public read-only SPARQL endpoint at `sparql.plugin-universe.com/public/query` and a
  public MCP endpoint at `mcp.plugin-universe.com/mcp`. Both were used while writing the
  specification here, and both should be used rather than duplicated.
- `vocabs/shapes.ttl` is the model for JigDAW's, including the caveat that
  `rdf-validate-shacl` reports `conforms: false` for warning severity, contrary to SHACL
  section 3.6.
- Its `CLAUDE.md` carries a table of nineteen changes where a second file that had to change
  was left behind. That table is the best single piece of engineering writing in these four
  repositories and `AGENTS.md` here inherits its conclusion.
- `pu:PluginShape` has an `sh:in` list enumerating plugin formats. See `TODO.md`.
