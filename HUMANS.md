# What needs a person

Actions only you can take. Everything else is in [AGENTS.md](AGENTS.md) and
[TODO.md](TODO.md).

Ordered by what blocks most.

## 1. Open it and confirm it makes a sound

Deployed and verified from here on 2026-09-17: every URL returns the right status and media
type, both profiles validate against the shapes, and the sha384 digests in the live profiles
match the bytes the site actually serves. The canonical IRI in each profile equals the URL it
is served from, so a plugin is being fetched from its own identity.

What no one has done is open it.

1. Go to <https://strandz.it/jigdaw/> and press **Load**. A repeating impulse plays through
   Cascade and you should hear a reverb tail. Move Mix and Size and the sound should follow.
2. Type `plugins/pulse/` into the box and press Load. That chains the synth in front of the
   reverb.
3. Press Load again with `plugins/cascade/` to confirm two plugins chain.

If anything is wrong, the page's own log pane names the step that failed, and the browser
console carries the same text.

This is the one thing the test suite cannot reach. 216 tests cover the whole load path
headlessly, including the audio, but nothing here has ever run in a real browser: no visual
check, no keyboard check, no confirmation that a real `AudioContext` behaves as the offline
one does.

**Blocks:** nothing, but until someone does it the browser half is unverified.

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

Now the conspicuous one. As of 2026-09-17 `jig:` resolves and `trn:` does not, and `trn:` is
the vocabulary that actually carries the meaning: it is used by four projects and by every
third party who followed the published guide at plugin-universe.com/about/profiles.

`purl.org/stuff/transmissions/` redirects to `hyperdata.it/xmlns/transmissions/` and returns
404, exactly as `jigdaw` did until today. The fix is the same shape and it is now a worked
example: `deploy/nginx/vocab.conf` plus a generated directory. Say which repository should
own the served copy and I will prepare it the same way.

Individual terms dereference for nobody. Even
`purl.org/stuff/plugin-universe/supportedPlatform`, whose namespace root resolves correctly,
lands on the site root and 404s.

### Also worth knowing

`sparql.plugin-universe.com` returns **two** `Access-Control-Allow-Origin` headers, one from
Fuseki echoing the request origin and one added by nginx. A browser rejects that outright, so
no browser application can query that endpoint, although `curl` works. It is the same
duplicate-header fault `deploy/nginx/jigdaw.conf` was built to avoid, and the same fix:
`proxy_hide_header Access-Control-Allow-Origin;` in that location, or drop the nginx
`add_header` and let Fuseki answer. Only that endpoint is affected; `/health`, `/search` and
`api.` each return exactly one.

JigDAW is not blocked by it, because its search proxies through its own origin.

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
