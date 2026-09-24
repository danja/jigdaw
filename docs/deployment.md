# Deployment

**Status:** deployed and running. `strandz.it/jigdaw/` is live, served by `bin/serve.js` under
systemd on port 6011, loopback only, behind nginx. This document was written before any of
that existed and said "planned, nothing is deployed yet" for some time after it was.

## Redeploying

Two commands, and which one you need depends on what changed.

```sh
cd /home/github/jigdaw && git pull
sudo systemctl restart jigdaw          # only when bin/serve.js changed
```

**A pull is not a deploy.** Static files are read from disk on every request, so a pull
changes the page, the browser bundle, the profiles and the WebAssembly the moment it lands.
`bin/serve.js` is loaded once when the process starts, so **anything inside it needs the
restart**: a new route, a changed header, a change to what is served.

The failure mode when the restart is forgotten is the worst kind. The new page talks to the
old server, so a feature looks broken rather than absent. It showed up once as
`search failed: Unexpected token 'o', "not found: "... is not valid JSON`, which is the page
parsing a plain-text 404 as JSON.

Restarting when nothing needed it costs a few milliseconds of downtime, so when in doubt,
restart.

### Confirm it took

Check the thing that changed, not that the site is up. A site that is up is what you had
before.

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://strandz.it/jigdaw/     # 200, the page
curl -sS -H 'Accept: text/turtle' https://strandz.it/jigdaw/plugins/pulse/ | head -1
systemctl status jigdaw --no-pager | head -3
```

After the 2026-09-18 change to what the server will serve:

```sh
curl -sS -o /dev/null -w '%{http_code}\n' https://strandz.it/jigdaw/.git/HEAD      # 404
curl -sS -o /dev/null -w '%{http_code}\n' https://strandz.it/jigdaw/package.json   # 404
curl -sS -o /dev/null -w '%{http_code}\n' https://strandz.it/jigdaw/app.bundle.js  # 200
```

### Regenerate before committing, never on the server

```sh
npm run build        # plugin index, vocabulary site, browser bundle
npm test
```

`web/app.bundle.js`, the generated `profile.ttl` files and the `.wasm` binaries are committed
on purpose, because the server has no build step and no toolchain. See
[the runbook](#the-runbook-for-strandzit) for why, which is not tidiness: a build on the
server is a second place for the bytes to differ from the digests that describe them.

### The vocabulary is a separate pull

`https://hyperdata.it/xmlns/jigdaw/` is served by nginx straight out of
`/home/github/jigdaw/deploy/vocab/`, so it updates on the pull and needs no restart. The
`trn:` vocabulary is the same arrangement in `/home/github/transmission`, and changing either
one's nginx fragment needs `sudo nginx -t && sudo systemctl reload nginx` instead.

## Shape

**Not yet built.** What runs today is one node process under systemd behind nginx, which is
the `app` row below and none of the others. The store, and therefore the compose arrangement,
arrives when there is something to put in it.

Compose, each service doing one thing:

| Service | Role | Published |
|---|---|---|
| `app` | the DAW page, the plugin origin, the WebMCP endpoint | no |
| `fuseki` | the SPARQL store, TDB2 | no |
| `nginx` | TLS termination and reverse proxy, behind a `proxy` profile | yes |

**Only nginx is published. Everything else binds to `127.0.0.1`.** Fuseki exposes an update
endpoint, and publishing that by accident is the worst mistake available here. It is also
the default in most stores, so preventing it has to be a deliberate act rather than
something to rely on.

A healthcheck gate makes the app wait for the store, so a restart does not produce a minute
of errors that look like a code fault.

`docs/first-thoughts.md` says Podman and plugin-universe runs Docker Compose. The compose
file is the same either way and `podman-compose` consumes it, so the file is the artefact
and the runtime is a local choice. Nothing in it should depend on which one is used.

## Hosting

`strandz.it`, alongside `hyperdata.it` and `plugin-universe.com`.

| Host | Serves |
|---|---|
| `strandz.it/jigdaw/` | the DAW page |
| `strandz.it/jigdaw/plugins/` | plugin profiles and their resources |
| `sparql.` | the public read-only endpoint |
| `mcp.` | the agent endpoint |

The subdomain split follows plugin-universe's, so a reader who knows one knows the other.

The vocabulary is **not** here. It is served at `hyperdata.it/xmlns/jigdaw/`, where the PURL
wildcard already points, because a vocabulary outlives the applications that use it. See
[namespace.md](namespace.md).

## Headers

Not optional garnish. A plugin origin that gets these wrong serves plugins no host can load,
and the failure is a generic network error that names nothing.

- `Access-Control-Allow-Origin` on every profile, module, processor, user interface and
  asset. Contract section 1.3.
- `Cross-Origin-Resource-Policy: cross-origin` on the same, so a host that opts into
  cross-origin isolation can still load them.
- `application/wasm` for modules, `text/javascript` for processors.
- Content negotiation on a plugin IRI: Turtle, JSON-LD, or HTML by default.

`bin/serve.js` implements all of this for development and is the reference for what the
production configuration has to reproduce.

**An `add_header` inside an nginx `location` replaces the server block's headers rather than
adding to them.** A static-file location must therefore repeat every security header or it
silently serves without them: valid configuration, wrong behaviour. Likewise a `types` block
replaces the mime map for that location. Both are plugin-universe's notes and both cost real
diagnosis time there.

## Checking a configuration before handing it over

plugin-universe learned this expensively: six nginx configurations failed `nginx -t` on the
server, every one findable locally in a second. Its `deploy/nginx/check.sh` validates the
real files in a throwaway container with generated certificates. Do the same here.

**Finish an install with a question asked of the consumer, not of the artefact.** `nginx -t`
passing says nothing about whether the file you edited is the file being served. Finish with
`nginx -T | grep -c` for something the new configuration contains, or a `curl` that would
only pass if it were live.

## The runbook for strandz.it

The commands are under [Redeploying](#redeploying) at the top. This section is the reasoning
behind them, and [HUMANS.md](../HUMANS.md) carries whatever is outstanding right now.

`/` on that host is already taken by another application on port 6010, so Jiggy, the browser
host, is served under `/jigdaw/` and listens on **6011**, loopback only.

**The server needs only node 20 or later.** `bin/serve.js` imports nothing but node
builtins, so there is no `npm install`. `tests/docs/conventions.test.js` fails if anything
reachable from it ever imports a package again: that happened once, the service would not
start, and the site answered 502 until it was reverted. The WebAssembly modules, the generated profiles and
the browser bundle are committed, so there is no build step and no Rust toolchain either.
The repository is the delivery mechanism.

That is a deliberate choice rather than an oversight. A build on the server is a second
place for the artefacts to differ from the profiles that declare their digests, and a
mismatch there is a plugin the host refuses with an integrity error. Building in one place
and shipping the result means the digests in `profile.ttl` always describe the bytes that
are actually served.

The consequence, which has to be honoured: **`web/app.bundle.js` and the `.wasm` files are
committed and must be regenerated and committed whenever their sources change.**
`tests/dsp/cascade.test.js` binds each profile to the artefact on disk, so a stale wasm is a
failing test rather than a broken deployment.

Everything in the runbook has been validated locally against real nginx in a container
proxying to the real server. `deploy/nginx/check.sh` runs that validation, and it fails on
things `nginx -t` cannot see.

## Three traps this configuration is built around

**A pull is not a deploy.** At the top of this document, because it is the thing most often
needed and was for a while the thing hardest to find in it.

**The trailing slash on `proxy_pass`.** `proxy_pass http://127.0.0.1:6011/;` strips the
`/jigdaw/` prefix, so the application serves at its own root and is identical in development
and production. Without it every path 404s, and nothing says why.

**Duplicate headers.** The application sets the CORS and security headers itself, because it
is the reference for what a plugin origin must send and has to be right when run with no
proxy in front of it. nginx adding them again sends each twice, and a browser rejects
`Access-Control-Allow-Origin` with multiple values outright: every cross-origin plugin load
fails with a message about the header containing multiple values. So the location hides the
upstream copies with `proxy_hide_header` and nginx owns them at the edge, which also puts
them on responses nginx generates itself, such as a 404 for a profile that is not there.

Both are checked by `deploy/nginx/check.sh`, which fails on either. The second was found by
curling through a real nginx rather than by reading the configuration.

## What is not settled

- Whether a future store federates with plugin-universe's public endpoint or mirrors it, once
  there is a store to build. Search already reaches it with live queries and needs neither.
- Whether plugin resources are served by `app` or by nginx directly. Directly is faster and
  puts the CORS and media-type rules into nginx, where they are easier to get wrong and
  harder to test.
