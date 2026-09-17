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

## 2. Serve the JigDAW vocabulary

`http://purl.org/stuff/jigdaw/` already redirects, through the existing wildcard, to
`https://hyperdata.it/xmlns/jigdaw/`, which returns 404. No PURL administration is needed.
Serving the files is the whole job, and they are prepared and validated.

`hyperdata.it/xmlns/` is already a static page on the same nginx, so this is the same shape
of job as item 1 was.

### On your machine, in `/chalet/github/jigdaw`

```sh
npm run build:vocab             # regenerates deploy/vocab/ from vocabs/jigdaw.ttl
npm test                        # a test fails if deploy/vocab has gone stale
deploy/nginx/check.sh
git add -A && git commit && git push
```

### On the server, as root

Add one line inside the existing `server { server_name hyperdata.it; ... }` block:

```nginx
include /home/github/jigdaw/deploy/nginx/vocab.conf;
```

nginx must be able to read `/home/github/jigdaw/deploy/vocab/`.

```sh
sudo nginx -t
sudo systemctl reload nginx
```

### From anywhere, to confirm

```sh
# The namespace: a page for a person, Turtle for a machine.
curl -sI https://hyperdata.it/xmlns/jigdaw/ | head -1
curl -s -H 'Accept: text/turtle' https://hyperdata.it/xmlns/jigdaw/ | head -3

# A term must answer 303, not 200.
curl -sI https://hyperdata.it/xmlns/jigdaw/module | head -2

# And the PURL, which is the IRI that actually appears in profiles.
curl -sIL http://purl.org/stuff/jigdaw/ | grep -iE '^HTTP|^location'
```

The 303 matters: a term denotes a property, not a document, and a 200 would assert that the
property *is* the page returned. It is the one place where that distinction has a practical
consequence, because a reasoner that conflates them starts inferring that a property is a
document.

Verified here against real nginx: negotiation both ways, every term 303ing to the document,
one CORS header, and the served Turtle validating.

**Blocks:** nothing in the build, but every `jig:` IRI in the profiles now published at
strandz.it is a dead link until this is done.

## 3. Mint a web plugin format term

`trn:WebAudio` is used by `examples/reference-profile.ttl` and does not exist. The formats in
the shared vocabulary are VST2, VST3, CLAP, AudioUnit, LV2, AAX and Standalone.

Two files have to change together, or every JigDAW profile harvested by plugin-universe is a
SHACL violation:

- the vocabulary, in `transmission/vocabs/profile.ttl` or plugin-universe's
  `vocabs/trn-extensions.ttl`
- the `sh:in` list in plugin-universe's `vocabs/shapes.ttl`

**Blocks:** publishing any JigDAW plugin to the catalogue.

## 4. Decide which repository owns `trn:`

`trn:format`, `trn:MidiCC` and `trn:AudioSidechain` are declared in plugin-universe and
absent from transmission, which everything calls upstream. The rule says propose extensions
upstream; the practice has already gone the other way.

**Blocks:** item 3, which needs to know where to put the term.

## 5. Fix `trn:` dereferencing

`purl.org/stuff/transmissions/` redirects to `hyperdata.it/xmlns/transmissions/` and returns
404. It is the vocabulary all four projects share and that JigDAW's profile format is built
on, so every role and signal IRI in every published profile is a dead link.

Individual terms dereference for nobody. Even
`purl.org/stuff/plugin-universe/supportedPlatform`, whose namespace root resolves correctly,
lands on the site root and 404s.

**Blocks:** nothing here, but it undermines the published guide that invites third parties
to write profiles.

## 6. Confirm platforms are meaningless here

`pu:supportedPlatform` has no web value, and a query for the predicate over the public
endpoint returns nothing. My reading is that platform is meaningless for a plugin that runs
in a browser, and the format term from item 3 carries it instead. Say if not.

**Blocks:** nothing. It is a question about whether a field should exist.

## 7. Tools that would help

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
