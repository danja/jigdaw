# JigDAW

Web-based music plugin system.

A digital audio workstation and a plugin format, both native to the web. The host runs in a
browser, plugins are identified by dereferenceable IRIs, and signal processing is
WebAssembly. Finding a plugin and installing it are the same action: dereference the IRI and
it is there.

The project is in its specification phase. The vocabulary, the validation shapes and the
normative host and plugin contract exist, along with a validator that enforces them
(`npm run validate`). None of the DAW exists yet.

## Start here

- [docs/host-plugin-contract.md](docs/host-plugin-contract.md) states what a host guarantees and
  what a plugin must do. Normative.
- [docs/plugin-profiles.md](docs/plugin-profiles.md) is how to describe a plugin,
  [docs/plugin-bundles.md](docs/plugin-bundles.md) how to send one to somebody as a file, and
  [docs/project-format.md](docs/project-format.md) how to describe a session. A session saves
  and reopens as RDF in that format, carrying the plugin IRIs that make it portable.
- [docs/messaging.md](docs/messaging.md), [docs/latency.md](docs/latency.md) and
  [docs/webmcp.md](docs/webmcp.md) specify the message protocol, latency compensation and
  the agent tool surface.
- [docs/namespace.md](docs/namespace.md) says what the vocabulary IRIs serve.
- [docs/architecture.md](docs/architecture.md) covers the layers, and why they are where they are.
- [README.agents.md](README.agents.md) is the same, for machine consumers.
- [docs/plan.md](docs/plan.md) has the phases and their status.
- [docs/first-thoughts.md](docs/first-thoughts.md) is the original sketch the project was
  built from, kept as written.

## The idea

```sh
curl -H "Accept: text/turtle" https://example.org/plugins/cascade/
```

That returns the plugin's profile: what it is, what signals it accepts and produces, what it
needs from a host, and where its WebAssembly module, its AudioWorklet processor and its user
interface are, each with an integrity digest. There is no registry and no install step
distinct from having fetched it.

The profile format is not new. It extends the one published at
[plugin-universe.com/about/profiles](https://plugin-universe.com/about/profiles) and already
in use over 758 plugins, adding what a browser needs. A profile written for that catalogue
stays valid here.

## The native adapter

`./install.sh` builds a VST3 that loads JigDAW plugins by IRI and installs it into `~/.vst3`.
It exists as a sanity check on the specification, and found that the specification had made
itself browser-only. See [native/jigdaw-adapter/README.md](native/jigdaw-adapter/README.md)
and [docs/module-abi.md](docs/module-abi.md).

## Licence

Apache 2.0. See [LICENSE](LICENSE).
