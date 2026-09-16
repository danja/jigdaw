# What needs a person

Actions only you can take. Everything else is in [AGENTS.md](AGENTS.md) and
[TODO.md](TODO.md).

Ordered by what blocks most.

## 1. Serve the JigDAW vocabulary

`http://purl.org/stuff/jigdaw/` already resolves, through the existing wildcard, to
`https://hyperdata.it/xmlns/jigdaw/`, which returns 404. No PURL administration is needed:
putting the vocabulary there is the whole job.

It must serve `vocabs/jigdaw.ttl` content-negotiated, answer `303 See Other` from each term
to that document, and send `Access-Control-Allow-Origin`. Details in
[docs/namespace.md](docs/namespace.md).

**Blocks:** nothing in the build, but every IRI the project publishes is a dead link until
it is done.

## 2. Mint a web plugin format term

`trn:WebAudio` is used by `examples/reference-profile.ttl` and does not exist. The formats in
the shared vocabulary are VST2, VST3, CLAP, AudioUnit, LV2, AAX and Standalone.

Two files have to change together, or every JigDAW profile harvested by plugin-universe is a
SHACL violation:

- the vocabulary, in `transmission/vocabs/profile.ttl` or plugin-universe's
  `vocabs/trn-extensions.ttl`
- the `sh:in` list in plugin-universe's `vocabs/shapes.ttl`

**Blocks:** publishing any JigDAW plugin to the catalogue.

## 3. Decide which repository owns `trn:`

`trn:format`, `trn:MidiCC` and `trn:AudioSidechain` are declared in plugin-universe and
absent from transmission, which everything calls upstream. The rule says propose extensions
upstream; the practice has already gone the other way.

**Blocks:** item 2, which needs to know where to put the term.

## 4. Fix `trn:` dereferencing

`purl.org/stuff/transmissions/` redirects to `hyperdata.it/xmlns/transmissions/` and returns
404. It is the vocabulary all four projects share and that JigDAW's profile format is built
on, so every role and signal IRI in every published profile is a dead link.

Individual terms dereference for nobody. Even
`purl.org/stuff/plugin-universe/supportedPlatform`, whose namespace root resolves correctly,
lands on the site root and 404s.

**Blocks:** nothing here, but it undermines the published guide that invites third parties
to write profiles.

## 5. Confirm platforms are meaningless here

`pu:supportedPlatform` has no web value, and a query for the predicate over the public
endpoint returns nothing. My reading is that platform is meaningless for a plugin that runs
in a browser, and the format term from item 2 carries it instead. Say if not.

**Blocks:** nothing. It is a question about whether a field should exist.

## 6. Tools that would help

- **The Claude in Chrome extension.** `tabs_context_mcp` reports the extension is not
  connected, so the page at `npm run serve` cannot be driven or screenshotted from here.
  Meanwhile the whole load path is verified headlessly by `tests/host/integration.test.js`,
  which runs the real loader, validator, integrity check, wasm and processor against an
  offline Web Audio stand-in. That is better verification than a screenshot, so this is a
  convenience rather than a blocker: it would let the panel be checked visually and for
  keyboard and contrast behaviour, which the headless path cannot see.

**Blocks:** nothing. Visual and accessibility checking only.

---

Measured 2026-09-16. Re-check before acting; all of it drifts.
