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

## 2. Review and commit the plugin-universe change

**Done, in `~/github/plugin-universe`, and uncommitted.** It needs your eye because it is a
second repository and because one part of it is a judgement rather than an addition.

What changed, and why:

- `vocabs/trn-extensions.ttl`: `trn:WebAudio a trn:PluginFormat`. The addition the format
  list was missing, in the file that already holds every other format individual and already
  says such things should be proposed upstream to `transmission`.
- `vocabs/shapes.ttl`: `trn:WebAudio` added to the `sh:in` list on `trn:format`.
- `src/contrib/Submissions.js`: `'WebAudio'` added to `PLUGIN_FORMATS`. This third file was
  not expected. Its own test binds the submission form's list to the shapes and failed the
  moment the other two changed, which is that repository's paired-file rule working.
- `vocabs/shapes.ttl` again, and **this one is a judgement call**: `trn:requires` no longer
  requires the `trn:` namespace. JigDAW declares `trn:requires jig:MidiEvents` and
  `jig:MidiOut`, which are real terms in a published dereferenceable vocabulary and exactly
  what `trn:requires` is for. The constraint refused them while reporting only that the
  namespace was wrong. It still requires an IRI, which is the check that catches the actual
  mistake. Say if you would rather JigDAW expressed capabilities some other way.

Measured after the change: all three JigDAW profiles conform to plugin-universe's shapes,
where all three failed before. Its own suite is 1351 tests passing, and both changes were
mutation tested.

**Still needs you:** committing it, and deploying it, before anything is harvested.

## 3. Decide where your signing key is published

Bundles now carry provenance and can be signed, and `bin/keys.js create <iri>` prints the
Turtle to serve at the verification method IRI. Two things only you can do:

- **Choose the IRI and serve the file.** Something like
  `https://strandz.it/jigdaw/keys/danja#ed25519`, served as `text/turtle` with
  `Access-Control-Allow-Origin: *`. Until it exists, `bin/verify.js --online` has nothing to
  dereference and every signature is checked only against the copy inside the bundle, which
  proves the bundle is self consistent and nothing about who made it.
- **Make the key and keep it.** `bin/keys.js` refuses to write one anywhere inside a git
  working tree, so it will land in `~/.config/jigdaw/keys/` unless you say otherwise. Nothing
  in this repository can back it up for you, and a lost key cannot sign as the same author
  again.

Nothing in the repository is blocked by this. Published bundles are weaker without it.

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

## 5. Deploy `trn:` dereferencing

`trn:` is the vocabulary that carries the meaning: four projects use it, and so does every
third party who followed the published guide at plugin-universe.com/about/profiles. Every one
of those IRIs has always resolved to a 404.

**Prepared, in `~/github/transmission`, and uncommitted.** Same shape as the JigDAW one,
because the PURL side was already correct: `purl.org/stuff/<name>` maps to
`hyperdata.it/xmlns/<name>` through the wildcard both share, so only the far end was missing.

- `vocabs/ontology.ttl`, `project.ttl`, `parameters.ttl` and `formats.ttl`,
  `scripts/build-vocab-site.js` and the generated `deploy/vocab/`: 208 terms from seven files
  under `vocabs/`, merged into one document, plus a page.
- `deploy/nginx/vocab.conf` and `deploy/nginx/check.sh`, adapted from this repository's.
- `tests/vocab/site.test.js`, nine tests: `deploy/vocab/` drifting from `vocabs/`, the code
  vocabulary drifting from the declarations, and the moved terms drifting from
  plugin-universe's copy. All mutation tested. Its suite is 22 files and 93 tests passing.

Verified with real requests against a container serving the real files, not just `nginx -t`:
content negotiation both ways, 301 for the bare form, 303 for a term, CORS on every response,
and the served Turtle parsed back to 321 triples over the wire.

**Still needs you:** one `include` line in the `hyperdata.it` server block, beside the JigDAW
one already there, then `git pull` on the server and `nginx -t && systemctl reload nginx`. The
exact lines are at the top of `~/github/transmission/TODO.md` and in its `docs/namespace.md`.

**The namespace is now complete**, since you said the `trn:` terms were yours to add. 208 terms
across seven files in `vocabs/`, up from 115: the project format, downspout's parameter terms,
and the plugin formats moved up from plugin-universe's `trn-extensions.ttl`, whose own header
had been asking for that. Every `trn:` IRI named in transmission's `src/rdf/Vocabulary.js` is
declared, which 50 of its 81 were not; a test binds the two now, and its suite is 93 tests.

Worth knowing rather than doing: saved projects bind the **default** prefix to the vocabulary
namespace, so 160 patch node names are minted in it too, `trn:pulse` through
`trn:plugins/downspout/ambo`. They are data rather than terms, they 303 to the namespace rather
than 404ing, and separating them means rewriting every committed project file. It is in
transmission's `TODO.md`.

Individual terms dereference for nobody. Even
`purl.org/stuff/plugin-universe/supportedPlatform`, whose namespace root resolves correctly,
lands on the site root and 404s.

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
