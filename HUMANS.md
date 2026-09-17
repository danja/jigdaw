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

## 3. Decide which repository owns `trn:`

Unchanged, and now with a concrete instance. `trn:WebAudio` has been added to
plugin-universe's `trn-extensions.ttl`, which is where `trn:format` and every other format
individual already live, under a comment saying they should be proposed upstream to
`transmission` rather than maintained there. The practice has gone one way and the stated rule
the other, for long enough that the practice is the de facto answer.

**Blocks:** nothing now. It is a question about where the next term goes.

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
