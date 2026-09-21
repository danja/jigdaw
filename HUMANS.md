# What needs a person

Actions only you can take. Everything else is in [AGENTS.md](AGENTS.md) and
[TODO.md](TODO.md).

Ordered by what blocks most.

## 1. GitHub Pages. Done.

**Turned on 2026-09-19, by you.** Settings → Pages → Source: GitHub Actions, so the deploy
step `.github/workflows/docs.yml` was already running finally had somewhere to publish to.
Measured afterwards rather than assumed: `https://danja.github.io/jigdaw/` answers 200, its
title is "The JigDAW plugin system : JigDAW", and `host-plugin-contract.html` serves as
`text/html` alongside it.

## 2. Signing key. Done.

**Made and published 2026-09-19, by you**, at the IRI decided in advance:

```
https://strandz.it/jigdaw/keys/danja#ed25519
```

```sh
node bin/keys.js create https://strandz.it/jigdaw/keys/danja#ed25519
node bin/keys.js publish ~/.config/jigdaw/keys/ed25519.json > web/keys/danja.ttl
```

The private half is on your machine, in `~/.config/jigdaw/keys/`, where `bin/keys.js` refused
to let it land inside the git working tree. Only `web/keys/danja.ttl`, the public half, was
committed and pulled onto the server. Measured against the live server afterwards: the IRI
answers 200, `text/turtle`, and matches the committed file byte for byte, so
`node bin/verify.js <bundle> --online` has something real to check a signature against.

On `strandz.it` rather than the PURL, because a key's whole value is that a verifier can fetch
it from the origin doing the signing and compare; the namespace rule about minting under the
PURL is about vocabulary terms, whose identity has to outlive any one host, which is the
opposite property. No file extension, because `bin/serve.js`'s `/keys/<name>` route serves the
identity as `text/turtle` regardless of what the file on disk is called. A fragment, so
rotating the key later is adding `#ed25519-2027` rather than replacing an IRI everything
already signed with names.

Not done: no plugin has actually been bundled and signed with it yet. `node bin/bundle.js
plugins/pulse --by https://strandz.it/jigdaw/keys/danja#ed25519 --key
~/.config/jigdaw/keys/ed25519.json` is the next step, whenever a bundle is wanted; nothing
blocks it.

## 3. Confirm which repository owns `trn:`

**Answered by item 4, unless you say otherwise.** `transmission` owns it. Its `vocabs/` is
what `http://purl.org/stuff/transmissions/` will serve, and the format individuals including
`trn:WebAudio` have been moved up into it from plugin-universe's `trn-extensions.ttl`, which
is what that file's own header always said should happen.

plugin-universe keeps its copy, because its SHACL shapes validate against it there. That makes
the two a pair that can drift, so transmission's `tests/vocab/site.test.js` compares them when
the sibling checkout is present and says so when it is not.

**Blocks:** nothing. The next `trn:` term goes in `~/github/transmission/vocabs/`. Say if you
would rather it were somewhere else, because that is now written into a test.

## 4. `trn:` dereferencing. Done.

**Deployed 2026-09-18, by you.** `http://purl.org/stuff/transmissions/` resolves. It had always
returned 404, and `trn:` is the vocabulary that carries the meaning: four projects use it, and
so does every third party who followed the published guide at
plugin-universe.com/about/profiles.

Measured against the live server afterwards, not assumed: the PURL chain ends at 200,
`text/turtle` when asked for and `text/html` for a browser, 42048 bytes matching the committed
build byte for byte, parsing to 628 triples over the wire. Every term 303s to the namespace,
including the hyphenated and slashed IRIs saved projects mint. CORS on every response. `jig:`
still resolves, so the second `include` in that server block broke nothing.

The namespace now defines 208 terms across seven files in `~/github/transmission/vocabs/`,
including the plugin formats moved up from plugin-universe and the 50 project-format terms its
own code had been writing into every saved project while declaring none of them.

Two things remain, neither blocking:

- **plugin-universe's own terms still do not dereference.** Its namespace root answers 200, but
  `purl.org/stuff/plugin-universe/supportedPlatform` returns 404 with a JSON body. Same shape
  as this was, and the fix is now a worked example twice over.
- **Instance data sits in the `trn:` namespace.** Transmission's saved projects bind the default
  prefix to it, so 160 patch node names are minted there, `trn:pulse` through
  `trn:plugins/downspout/ambo`. They 303 rather than 404, which is ordinary slash-namespace
  behaviour. Separating them means rewriting every committed project file. It is in
  transmission's `TODO.md`.

### Also worth knowing

`sparql.plugin-universe.com` returns **two** `Access-Control-Allow-Origin` headers, one from
Fuseki echoing the request origin and one added by nginx. Re-measured 2026-09-17 and still
true: a request with `Origin: https://strandz.it` comes back with both that origin and `*`. A browser rejects that outright, so
no browser application can query that endpoint, although `curl` works. It is the same
duplicate-header fault `deploy/nginx/jigdaw.conf` was built to avoid, and the same fix:
`proxy_hide_header Access-Control-Allow-Origin;` in that location, or drop the nginx
`add_header` and let Fuseki answer. Only that endpoint is affected; `/health`, `/search` and
`api.` each return exactly one.

JigDAW is not blocked by it, because its search proxies through its own origin.

## 5. Confirm platforms are meaningless here

`pu:supportedPlatform` has no web value, a query for the predicate over the public endpoint
returns nothing, and JigDAW's profiles declare none. They validate against plugin-universe's
shapes without it, so it is optional rather than missing.

My reading, now written into `trn-extensions.ttl` beside the new term: the platform of a web
plugin is the browser, which is not one of the operating systems that predicate enumerates,
and `trn:WebAudio` carries what the platform list was carrying. Say if you disagree, because
it is now recorded as a comment in a second repository.

**Blocks:** nothing.

## 6. Tools that would help

**lld, for the WebAssembly build of `plugins/8b8/`.** Ubuntu's `clang` package ships no
`wasm-ld`, so `plugins/8b8/build.sh` links through the `rust-lld` that rustup already
installed for the Rust plugins, found by searching `~/.rustup` and symlinked under the name
the clang driver looks for. It is the same linker and it produces a working module, but the
fallback depends on a rust toolchain being present for a build that otherwise has nothing to
do with rust, and on rustup's internal layout.

```sh
sudo apt install lld-18
```

`build.sh` uses `wasm-ld` directly when it is on the path and says nothing more about it.

The Claude in Chrome extension is connected and working, which is what made the four fixes
above possible, and what confirmed `plugins/8b8/` in a real browser on 2026-09-19.

**DPF. Found, 2026-09-19, by the user: `~/github/downspout/third_party/DPF`.** Not this
repository's own; downspout already vendors a checkout, and pointing at it was enough.

```sh
cmake -DJIGDAW_BUILD_PLUGIN=ON -DJIGDAW_DPF_DIR=~/github/downspout/third_party/DPF native/ -B native/build
```

Builds the real VST3, CLAP, LV2 and a standalone JACK executable, `src/dpf/JigdawPlugin.cpp`
and `JigdawUI.cpp` included, which `jigdaw_core`'s own tests alone do not touch. Used the same
day to build and actually watch the editor's scrolling fix render: the standalone app on a
separate `Xvfb` display, so nothing opened on the real desktop, driven with `xdotool` and
`import` screenshots. That verification path (build here, run on `:99`, screenshot, compare)
is now the one to reach for before claiming any change to `JigdawUI.cpp` works rather than
only compiles.

## Updating a deployment

**[docs/deployment.md](docs/deployment.md) opens with this**, including which changes need the
restart and what to curl afterwards. The short form:

```sh
npm run build && npm test          # on your machine, then commit and push
cd /home/github/jigdaw && git pull
sudo systemctl restart jigdaw      # only when bin/serve.js changed
```

A pull moves the page, the bundle, the profiles and the WebAssembly immediately, because they
are read from disk per request. `bin/serve.js` is loaded once at startup, so a change inside
it is invisible until the restart, and the symptom is a new page talking to an old server.

---

Measured 2026-09-19. Re-check before acting; all of it drifts.
