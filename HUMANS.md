# What needs a person

Actions only you can take. Everything else is in [AGENTS.md](AGENTS.md) and
[TODO.md](TODO.md).

Ordered by what blocks most.

## 1. Deploy to strandz.it

Every command below says where it runs. Nothing is public until this is done.

The server needs **only node 20 or later**. `bin/serve.js` imports nothing but node
builtins, and the WebAssembly, the profiles and the browser bundle are all committed, so
there is no `npm install`, no Rust and no build step on the server.

### On your machine, in `/chalet/github/jigdaw`

```sh
npm test                        # 216 tests
deploy/nginx/check.sh           # validates nginx in a container, before the server sees it
git add -A && git commit && git push
```

Only rebuild if you changed the source. The artefacts are committed as they stand:

```sh
npm run build:web               # only if web/ or src/ changed
plugins/cascade/build.sh        # only if the Rust or profile.json changed
plugins/pulse/build.sh          # these two need the rust wasm32-unknown-unknown target
```

### On the server, in `/home/github/jigdaw`

```sh
git pull
node --version                  # must be v20.11 or later

# The service runs as www-data, so it has to be able to read the repository.
sudo -u www-data test -r bin/serve.js && echo "readable" || echo "PERMISSIONS PROBLEM"

sudo cp deploy/jigdaw.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jigdaw
sudo systemctl status jigdaw --no-pager

curl -sI http://127.0.0.1:6011/ | head -1       # expect: HTTP/1.1 200 OK
```

Do not touch nginx until that 200 appears.

### On the server, as root

Add one line inside the existing `server { server_name strandz.it; ... }` block of
`/etc/nginx/sites-available/strandz.it.conf`, anywhere among the `location` blocks:

```nginx
include /home/github/jigdaw/deploy/nginx/jigdaw.conf;
```

`location /jigdaw/` is more specific than your `location /`, so nginx matches it first
whatever the order. Including the file rather than pasting it means the configuration is
version controlled with the code it serves.

```sh
sudo nginx -t
sudo systemctl reload nginx
```

### On any machine, to confirm it is actually live

`nginx -t` passing says nothing about whether the file you edited is the file being served.

```sh
curl -sI https://strandz.it/jigdaw/ | head -1
curl -s -H 'Accept: text/turtle' https://strandz.it/jigdaw/plugins/cascade/ | head -8
curl -sI https://strandz.it/jigdaw/plugins/cascade/cascade.wasm | grep -i 'content-type\|allow-origin'
```

The last one must show `application/wasm` and exactly one `Access-Control-Allow-Origin`. Two
of that header and no plugin will load anywhere.

Then open `https://strandz.it/jigdaw/` and press Load.

### If something is wrong

```sh
sudo journalctl -u jigdaw -n 50 --no-pager      # on the server
sudo nginx -T | grep -A5 'location /jigdaw/'    # what nginx is really serving
```

### One thing about your existing config

`strandz.it.conf` currently sends no security headers at all, for either application. The
JigDAW block sets its own, so this blocks nothing, but the application on 6010 is serving
without `X-Content-Type-Options`, `Referrer-Policy` or HSTS. If you add them at server level
later, note that an `add_header` inside a `location` replaces the server block's headers
rather than adding to them, so the JigDAW block would need them repeated.

## 2. Serve the JigDAW vocabulary

`http://purl.org/stuff/jigdaw/` already resolves, through the existing wildcard, to
`https://hyperdata.it/xmlns/jigdaw/`, which returns 404. No PURL administration is needed:
putting the vocabulary there is the whole job.

It must serve `vocabs/jigdaw.ttl` content-negotiated, answer `303 See Other` from each term
to that document, and send `Access-Control-Allow-Origin`. Details in
[docs/namespace.md](docs/namespace.md).

**Blocks:** nothing in the build, but every IRI the project publishes is a dead link until
it is done.

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
