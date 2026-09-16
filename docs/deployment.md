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

## What is not settled

- Whether the store federates with plugin-universe's public endpoint or mirrors it.
- Whether plugin resources are served by `app` or by nginx directly. Directly is faster and
  puts the CORS and media-type rules into nginx, where they are easier to get wrong and
  harder to test.
