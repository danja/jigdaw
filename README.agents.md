# JigDAW Agent Reference

JigDAW is a web-native digital audio workstation and plugin format. The host and the plugins
both run in the browser, plugins are identified by dereferenceable IRIs, and signal
processing is WebAssembly.

This file is the entry point for linked-data discovery. The project is in its specification
phase: the vocabulary, the shapes and the contract exist; there is no implementation.

## Resources

| Resource | Location | Purpose |
|---|---|---|
| Delivery vocabulary | `vocabs/jigdaw.ttl` | `jig:` terms: modules, processors, user interfaces, integrity, host capabilities, port shape. Namespace `http://purl.org/stuff/jigdaw/` |
| Shapes | `vocabs/shapes.ttl` | SHACL Core. Every profile is validated against these before it is stored |
| Normative contract | `docs/host-plugin-contract.md` | What a host guarantees and what a plugin must do. RFC 2119 |
| Message protocol | `docs/messaging.md` | The wire format between host, processor and user interface |
| Latency | `docs/latency.md` | Compensation, and what happens in a graph with feedback |
| Project format | `docs/project-format.md` | The session graph: nodes, connections, settings, transport |
| Agent surface | `docs/webmcp.md` | The WebMCP tool surface |
| Namespace | `docs/namespace.md` | What `http://purl.org/stuff/jigdaw/` serves, and how terms resolve |
| Profile format | `docs/plugin-profiles.md` | How to write a profile, and how it extends the published one |
| Architecture | `docs/architecture.md` | Layers, boundaries, and the decisions behind them |
| Worked example | `examples/cascade-profile.ttl` | A complete profile that validates |
| Worked project | `examples/session-project.ttl` | A complete session that validates |
| Counterexamples | `examples/counterexample-profile.ttl`, `examples/counterexample-project.ttl` | Each violates every constraint once. Neither may validate |

## Vocabularies

JigDAW writes in three, and which statement belongs to which matters.

| Prefix | IRI | Used for |
|---|---|---|
| `trn:` | `http://purl.org/stuff/transmissions/` | what the plugin is musically: roles, signal types, routing |
| `jig:` | `http://purl.org/stuff/jigdaw/` | what it takes to run it in a browser |
| `lv2:` / `units:` | `http://lv2plug.in/ns/…` | parameters, ranges, units |
| `pu:` | `http://purl.org/stuff/plugin-universe/` | catalogue metadata: licence, category |
| `prov:` / `dcterms:` / `foaf:` | standard | provenance, metadata, homepages |

`trn:` is defined in `~/github/transmission/vocabs/profile.ttl` and published at
[plugin-universe.com/ns](https://plugin-universe.com/ns). A term general enough to belong to
it is proposed upstream rather than forked into `jig:`.

## A plugin in one request

```sh
curl -H "Accept: text/turtle" https://example.org/plugins/cascade/
```

The response is the profile. It says what the plugin is, and links to its WebAssembly
module, its AudioWorklet processor and its user interface, each with a Subresource Integrity
digest. There is no registry and no install step distinct from having fetched it.

The profile and every resource it names must be served with `Access-Control-Allow-Origin`.
`AudioWorklet.addModule()` fetches cross-origin in CORS mode, so a response without the
header is unreadable rather than merely untrusted.

## Minimal profile

```turtle
@base <https://example.org/plugins/cascade/> .
@prefix jig:  <http://purl.org/stuff/jigdaw/> .
@prefix trn:  <http://purl.org/stuff/transmissions/> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<>  a jig:WebPlugin , trn:PluginProfile ;
    rdfs:label "Cascade" ;
    rdfs:comment "Multiband plate reverb." ;
    foaf:homepage <> ;
    trn:role trn:AudioEffect ;
    trn:accepts trn:Audio ;
    trn:produces trn:Audio ;
    jig:audioOutputs 1 ;
    jig:outputChannels 2 ;
    jig:processor <#processor> .

<#processor>
    a jig:Processor ;
    jig:location <cascade-processor.js> ;
    jig:registeredName "cascade" ;
    jig:integrity "sha384-…" .
```

`jig:WebPlugin` is a subclass of `trn:PluginProfile`, so an existing catalogue profile
becomes loadable by adding statements rather than by being rewritten, and a profile that
describes a native-only plugin stays valid.

## Validating

```sh
rapper -i turtle -c examples/cascade-profile.ttl
```

Shape validation needs a SHACL Core validator. `rdf-validate-shacl` works;
`vocabs/shapes.ttl` deliberately contains no `sh:sparql`, because that library throws rather
than skipping such a constraint.

## Related catalogues

[plugin-universe.com](https://plugin-universe.com) holds 758 plugins under CC0, with a
public read-only SPARQL endpoint at `sparql.plugin-universe.com/public/query` and a public
MCP endpoint at `mcp.plugin-universe.com/mcp`, faceted on `accepts` and `produces`. JigDAW
extends its profile format rather than competing with it.
