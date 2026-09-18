# What needs a person

Actions only you can take. Everything else is in [AGENTS.md](AGENTS.md) and
[TODO.md](TODO.md).

Ordered by what blocks most.

## 1. Commit and deploy

Since the last deployment: sessions save and reopen as RDF, in the project format that has
been normative since phase 0 and that nothing had ever written. Verified in a browser, a chain
of BassGen into Pulse with two parameters set, saved, cleared and reopened from the saved
bytes: ids, plugin IRIs, settings and the MIDI connection all came back and it played.

It found that removing a plugin never stopped it: the model forgot the node and the
AudioWorkletNode kept running. Fixed and guarded, recorded in `MISTAKES.md`.

```sh
# On your machine, in the repository
npm run build
npm test
git add -A && git commit && git push
```

```sh
# On the server, in /home/github/jigdaw
git pull
sudo systemctl restart jigdaw
```

## 2. Redeploy, for the exposure fix

**Committed by you, deployed, and then found wanting.** The live site was serving the whole
working tree: `/jigdaw/package.json`, `/jigdaw/AGENTS.md`, `/jigdaw/.gitignore`, and
`/jigdaw/.git/HEAD` and `/jigdaw/.git/index`, which together are enough to reconstruct the
repository. Measured on strandz.it, 2026-09-18.

Nothing in the repository is secret, so nothing leaked. The defect is that the server's rule
was "serve whatever is on disk", and gitignore is exactly where a key would be. It is in
`MISTAKES.md`.

Fixed here: `bin/serve.js` now serves `web/` plus an allowlist of `src`, `plugins`, `examples`,
`vocabs` and `docs`, and refuses any path segment beginning with a dot.

**Needs you:** the usual pull and restart. The restart is not optional, because this is a
change inside `bin/serve.js` rather than a static file.

```sh
cd /home/github/jigdaw && git pull && sudo systemctl restart jigdaw
curl -sS -o /dev/null -w '%{http_code}\n' https://strandz.it/jigdaw/.git/HEAD   # expect 404
curl -sS -o /dev/null -w '%{http_code}\n' https://strandz.it/jigdaw/            # expect 200
```

The plugin-universe change you were reviewing here is committed.

## 3. Make your signing key

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

## 4. Confirm which repository owns `trn:`

**Answered by item 5, unless you say otherwise.** `transmission` owns it. Its `vocabs/` is
what `http://purl.org/stuff/transmissions/` will serve, and the format individuals including
`trn:WebAudio` have been moved up into it from plugin-universe's `trn-extensions.ttl`, which
is what that file's own header always said should happen.

plugin-universe keeps its copy, because its SHACL shapes validate against it there. That makes
the two a pair that can drift, so transmission's `tests/vocab/site.test.js` compares them when
the sibling checkout is present and says so when it is not.

**Blocks:** nothing. The next `trn:` term goes in `~/github/transmission/vocabs/`. Say if you
would rather it were somewhere else, because that is now written into a test.

## 5. `trn:` dereferencing. Done.

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

## 6. Confirm platforms are meaningless here

`pu:supportedPlatform` has no web value, a query for the predicate over the public endpoint
returns nothing, and JigDAW's profiles declare none. They validate against plugin-universe's
shapes without it, so it is optional rather than missing.

My reading, now written into `trn-extensions.ttl` beside the new term: the platform of a web
plugin is the browser, which is not one of the operating systems that predicate enumerates,
and `trn:WebAudio` carries what the platform list was carrying. Say if you disagree, because
it is now recorded as a comment in a second repository.

**Blocks:** nothing.

## 7. Tools that would help

The Claude in Chrome extension is connected and working, which is what made the four fixes
above possible. Nothing else is needed.

## Updating a deployment

**This one needs the restart:** `bin/serve.js` gained directory-index handling, without which
`/jigdaw/docs/` answers 404 even though the files are there.


Regenerate artefacts on your machine, never on the server:

```sh
npm run build        # index, vocabulary and browser bundle
npm test
git add -A && git commit && git push
```


```sh
# On the server, in /home/github/jigdaw
git pull
sudo systemctl restart jigdaw
```

**The restart is not optional, and forgetting it fails in a confusing way.** Static files are
read from disk on every request, so a pull changes the page, the bundle, the profiles and the
WebAssembly immediately. `bin/serve.js` is loaded once when the process starts, so any new
route in it does not exist until the service is restarted.

The symptom is a new interface calling an endpoint the old server has never heard of. It
showed up as `search failed: Unexpected token 'o', "not found: "... is not valid JSON`, which
is the page trying to parse a plain-text 404 as JSON.

If nginx configuration changed as well, reload nginx too. `nginx -t` first.

---

Measured 2026-09-16. Re-check before acting; all of it drifts.
