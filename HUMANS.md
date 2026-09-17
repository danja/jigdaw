# What needs a person

Actions only you can take. Everything else is in [AGENTS.md](AGENTS.md) and
[TODO.md](TODO.md).

Ordered by what blocks most.

## 1. Pull, so the browser fixes reach the server

Verified in Chrome on 2026-09-17, against a local server: the synth loads, the keyboard
plays it, a reverb chains after it, and the reverb tail outlives the synth's release. Peak
output measured 0 before a note, 0.228 while held, 0 after release, and the tail decayed
from 0.0075 at 600ms to 0.00013 at 1800ms.

That run found four defects that every headless test had passed, the largest being a
specification error: the contract required posting a compiled `WebAssembly.Module` into an
`AudioWorklet`, which browsers silently refuse. All four are fixed and recorded in
`MISTAKES.md`, but **the live site is still running the broken version**.

```sh
# On the server, in /home/github/jigdaw
git pull
sudo systemctl restart jigdaw
```

Then hard-reload `https://strandz.it/jigdaw/`, press Load, and play the keyboard.

## Updating a deployment

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

The Claude in Chrome extension is connected and working, which is what made the four fixes
above possible. Nothing else is needed.

---

Measured 2026-09-16. Re-check before acting; all of it drifts.
