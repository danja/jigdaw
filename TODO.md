# TODO

What the project needs. Remove an item when its implementation and verification are
complete. Review periodically.

## Namespaces

- [ ] **Serve the JigDAW vocabulary.** `http://purl.org/stuff/jigdaw/` already resolves,
      via the existing wildcard, to `https://hyperdata.it/xmlns/jigdaw/`, which returns 404.
      No PURL administration is needed: putting the vocabulary there is the whole job.

      What it has to do is in `docs/namespace.md`: content negotiation on the namespace IRI,
      `303 See Other` from each term to the vocabulary document, and
      `Access-Control-Allow-Origin`.

      Needs the user: it is a deployment to a server.

- [ ] **`trn:` does not dereference.** `purl.org/stuff/transmissions/` redirects to
      `hyperdata.it/xmlns/transmissions/` and returns 404, measured 2026-09-16. It is the
      vocabulary all four projects share and that JigDAW's profile format is built on, and
      every IRI in it is a dead link, including in profiles that third parties have been
      invited to publish.

      Related: individual terms dereference for nobody. Even
      `purl.org/stuff/plugin-universe/supportedPlatform`, whose namespace root resolves
      correctly, lands on `plugin-universe.com/supportedPlatform` and 404s, because the
      override is a prefix replacement that does not account for sub-paths.

      Needs the user: it spans the PURL configuration and at least one other repository.

## Blocking, cross-repository

- [ ] **A web plugin format term.** `trn:WebAudio` is used by
      `examples/cascade-profile.ttl` and does not exist upstream. The formats currently in
      the shared vocabulary are VST2, VST3, CLAP, AudioUnit, LV2, AAX and Standalone,
      confirmed by querying `https://sparql.plugin-universe.com/public/query`.

      Three files have to change together, and nothing connects them:
      1. `~/github/transmission/vocabs/profile.ttl`, or plugin-universe's
         `vocabs/trn-extensions.ttl`, which is where `trn:PluginFormat` individuals live
      2. plugin-universe's `vocabs/shapes.ttl`, whose `pu:PluginShape` has an `sh:in` list
         enumerating the permitted formats
      3. `examples/cascade-profile.ttl` here, and the note in it

      Until 1 and 2 are done, a JigDAW profile harvested by plugin-universe is a SHACL
      violation. This is exactly the first row of that project's own recurring-failure
      table, which was adding a value to a list without adding it to the `sh:in` that
      constrains the list.

      Needs the user: it is a change to two repositories and a deployed service.

- [ ] **Decide whether platforms apply.** `pu:supportedPlatform` was assumed to have a
      `pu:Web` value. It does not, and a query for the predicate over the public endpoint
      returns nothing. Either a web platform term is added alongside the format term, or
      JigDAW says platform is meaningless for a plugin that runs in a browser and relies on
      the format term alone. The second is probably right.

- [ ] **The `trn:` vocabulary has diverged from its own upstream.** `trn:format`,
      `trn:MidiCC` and `trn:AudioSidechain` are declared in plugin-universe's
      `vocabs/trn-profile.ttl` and `vocabs/trn-extensions.ttl`, and are absent from
      `~/github/transmission/vocabs/profile.ttl`, which is the repository everything else
      calls upstream. So "propose extensions upstream to transmission" is a rule that the
      project stating it has already stepped around.

      This matters to JigDAW because it decides where a web format term is proposed, and
      because `examples/cascade-profile.ttl` uses `trn:format`, which resolves in one of the
      two places a reader might look. Worth settling before adding a third term to the pile.

      Needs the user: it is a question about which repository owns the vocabulary.

- [ ] **The inspection vocabulary still has no consumer.** `jig:Inspection`,
      `jig:inspectionOf`, `jig:inspectedAt`, `jig:hostVersion` and `jig:loadOutcome` are
      declared in `vocabs/jigdaw.ttl`, constrained by nothing in `vocabs/shapes.ttl`, written
      by nothing and read by nothing. `jig:Threads` and `jig:ExceptionHandling` are in the
      same position. That is the state plugin-universe describes as invisible: terms
      written into the data and selected by no query, which is not a condition anything
      reports. Either Phase 5 uses them or they come out.

## Before there is code

- [ ] `src/rdf/Vocabulary.js` as frozen constants, once there is code that names a term.
      Nothing does yet, so it would be a constants file constraining nothing.
      `tests/rdf/vocabulary.test.js` already binds the vocabulary to the shapes and examples
      in both directions, which is the useful half of valis's ontology-to-registry symmetry
      test. The other half arrives with the code.
- [ ] A `/new-plugin` command scaffolding profile, processor, registry entry and test in one
      pass, modelled on `~/github/valis/.claude/commands/new-element.md`.

## Recurring, check periodically

- [ ] Read `MISTAKES.md` for anything systematic and promote it into `AGENTS.md`.
- [ ] Re-measure every figure quoted in a document. The plugin count, the profile count and
      the format list all drift.
- [ ] `wc -l src/**/*.js | sort -n | tail`, once there is a `src/`.
