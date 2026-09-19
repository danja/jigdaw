# JigDAW Agent Reference

JigDAW is a plugin format native to the web. A plugin is a dereferenceable IRI, fetching it is
installing it, and signal processing is WebAssembly. A digital audio workstation in the browser
is the reference host: it exists to hold the format up rather than the other way round.

This file is the entry point for documentation and linked data discovery. The specification is complete and
normative, and two independent hosts implement it, one in the browser and one as a native
VST3, CLAP and LV2. 9 worked plugins are in `plugins/`. The rendered specification is at
[danja.github.io/jigdaw](https://danja.github.io/jigdaw/); the markdown in `docs/` is
authoritative.

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
| Bundles | `docs/plugin-bundles.md` | A plugin as a file, its provenance record, and the signature over it |
| Module ABI | `docs/module-abi.md` | The optional WebAssembly ABI, for a host with no JavaScript |
| Web Audio Modules | `docs/wam.md` | Packaging a plugin for a WAM 2.0 host, and why the reverse does not work |
| Worked example | `examples/reference-profile.ttl` | A complete profile that validates |
| Worked project | `examples/session-project.ttl` | A complete session that validates |
| Worked provenance | `examples/reference-provenance.ttl` | A complete bundle provenance record that validates |
| Counterexamples | `examples/counterexample-*.ttl` | One per format. Each violates every constraint once, and none may validate |

## Vocabularies

JigDAW writes in three, and which statement belongs to which matters.

| Prefix | IRI | Used for |
|---|---|---|
| `trn:` | `http://purl.org/stuff/transmissions/` | what the plugin is musically: roles, signal types, routing |
| `jig:` | `http://purl.org/stuff/jigdaw/` | what it takes to run it in a browser |
| `lv2:` / `units:` | `http://lv2plug.in/ns/…` | parameters, ranges, units |
| `pu:` | `http://purl.org/stuff/plugin-universe/` | catalogue metadata: licence, category |
| `prov:` / `dcterms:` / `foaf:` | standard | provenance, metadata, homepages |
| `sec:` | `https://w3id.org/security#` | Data Integrity proofs and Multikey, for a signed bundle |

`trn:` is defined in `~/github/transmission/vocabs/profile.ttl` and published at
[plugin-universe.com/ns](https://plugin-universe.com/ns). A term general enough to belong to
it is proposed upstream rather than forked into `jig:`.

## A plugin in one request

```sh
curl -H "Accept: text/turtle" https://strandz.it/jigdaw/plugins/pulse/
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
rapper -i turtle -c examples/reference-profile.ttl   # syntax
npm run validate -- examples/reference-profile.ttl   # shapes, exits non-zero on violation
```

`vocabs/shapes.ttl` is SHACL Core and deliberately contains no `sh:sparql`, because
`rdf-validate-shacl` throws on such a constraint rather than skipping it.

## Related catalogues

[plugin-universe.com](https://plugin-universe.com) holds 756 plugins under CC0, counted over its public endpoint on 2026-09-18,, with a
public read-only SPARQL endpoint at `sparql.plugin-universe.com/public/query` and a public
MCP endpoint at `mcp.plugin-universe.com/mcp`, faceted on `accepts` and `produces`. JigDAW
extends its profile format rather than competing with it.
