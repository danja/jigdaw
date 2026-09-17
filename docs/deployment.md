# Deployment

**Status:** planned. Nothing is deployed yet. This records the shape, so that when it is
built it follows a pattern that is already running rather than one invented fresh.

The approach is plugin-universe's, which runs on the same host. Copying a working
arrangement is worth more than a better one that has never been operated.

## Shape

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

**The step-by-step list, with every command labelled by where it runs, is
[HUMANS.md](../HUMANS.md) item 1.** This section is the reasoning behind it.

`/` on that host is already taken by another application on port 6010, so JigDAW is served
under `/jigdaw/` and listens on **6011**, loopback only.

**The server needs only node 20 or later.** `bin/serve.js` imports nothing but node
builtins, so there is no `npm install`. The WebAssembly modules, the generated profiles and
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

**A pull is not a deploy.** Static files are read from disk on every request, so pulling
changes the page, the bundle, the profiles and the WebAssembly at once. `bin/serve.js` is
loaded when the process starts, so a new route in it needs `systemctl restart jigdaw`. The
failure mode is the worst kind: a new interface talking to an old server, which looks like
the new feature is broken rather than absent.



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

- Whether the store federates with plugin-universe's public endpoint or mirrors it.
- Whether plugin resources are served by `app` or by nginx directly. Directly is faster and
  puts the CORS and media-type rules into nginx, where they are easier to get wrong and
  harder to test.
