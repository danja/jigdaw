# What needs a person

Actions only you can take. Everything else is in [AGENTS.md](AGENTS.md) and
[TODO.md](TODO.md).

Ordered by what blocks most.

## 2. Make your signing key

**The IRI is decided, and everything but the key itself is built.**

```
https://strandz.it/jigdaw/keys/danja#ed25519
```

Three choices in that, each with a reason:

**On `strandz.it`, not the PURL.** The namespace rule says mint under the PURL, and that rule
is about vocabulary terms, whose identity must outlive any host. A key is the opposite: its
whole value is that a verifier can fetch it from an origin and compare. `Signature.js` reports
a signature as the origin signing its own work when the key's origin matches the plugin's, and
the plugins are at `https://strandz.it/jigdaw/plugins/...`, so a key anywhere else makes every
one of your own signatures read as a third party vouching. A PURL cannot serve content, only
redirect, so it could not do this job.

**No file extension.** The IRI is the identity and `.ttl` is a fact about a file.
`bin/serve.js` now has a `/keys/<name>` route that serves `web/keys/<name>.ttl` as
`text/turtle` with CORS, so the identity never carries the storage detail.

**A fragment.** One document can then describe several keys, and rotating means adding
`#ed25519-2027` rather than replacing an IRI that everything already signed with names.

**Needs you**, because a signing identity should be created by the person who owns it and I
should not generate yours:

```sh
node bin/keys.js create https://strandz.it/jigdaw/keys/danja#ed25519
node bin/keys.js publish ~/.config/jigdaw/keys/ed25519.json > web/keys/danja.ttl
```

The first refuses to write anywhere inside a git working tree and lands in
`~/.config/jigdaw/keys/`. The second writes only the public half. Commit `web/keys/danja.ttl`,
pull on the server, and `node bin/verify.js <bundle> --online` has something to check against.

Verified end to end already, against a throwaway key served from this route: a signed bundle
reports *checked against the key published at that IRI* rather than against its own copy.

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



## 8. Tools that would help

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

Measured 2026-09-16. Re-check before acting; all of it drifts.
