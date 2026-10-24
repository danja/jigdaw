# JigDAW Agent Reference

JigDAW is a plugin format native to the web. A plugin is a dereferenceable IRI, fetching it is
installing it, and signal processing is usually WebAssembly: `jig:module` is optional, for a
plugin simple enough that its AudioWorklet processor is plain JavaScript. A digital audio
workstation in the browser is the reference host: it exists to hold the format up rather than
the other way round.

This file is the entry point for an agent writing a plugin or a host, and for linked data discovery. The specification is complete and
normative, and two independent hosts implement it, one in the browser and one as a native
VST3, CLAP and LV2. 33 worked plugins are in `plugins/`. The rendered specification is at
[danja.github.io/jigdaw](https://danja.github.io/jigdaw/); the markdown in `docs/` is
authoritative.

## Which task are you doing

| You are | Read, in this order | Check your work with |
|---|---|---|
| Writing a plugin | `docs/for-plugin-authors.md`, then `docs/plugin-profiles.md` and `docs/host-plugin-contract.md` section 3. Copy a plugin from `plugins/` that is close to yours; `plugins/boost/` is the smallest in C++ and `plugins/tremolo/` has no WebAssembly. For your own look without code, add a skin (`docs/svg-skins.md`) | `npm run validate -- <profile.ttl>`, then `npm run check-plugin -- <IRI>` |
| Writing a host, or adding DAW support | `docs/for-hosts.md`, then `docs/host-plugin-contract.md`, `docs/messaging.md` and `docs/latency.md`. `src/` is the reference host | `examples/reference-profile.ttl` must load and `examples/counterexample-*.ttl` must each be refused |
| Making a native host | the above, then `docs/module-abi.md` and `native/jigdaw-adapter/README.md` | the plugins in `plugins/` that declare a portable ABI |

Where a guide and the contract disagree, the contract governs. Where the contract and
`vocabs/jigdaw.ttl` disagree, the vocabulary is the defect.

Three rules cause most of the failures:

- **Never write a `jig:integrity` digest by hand.** Generate the profile from the built files
  (`bin/write-profile.js`), or every rebuild silently breaks the plugin.
- **Nothing in `process()` allocates, touches the network or storage, or grows WebAssembly
  memory.** A processor that is not ready outputs silence rather than throwing.
- **Plugin code is untrusted.** A host loads a plugin's interface in a sandboxed frame on another
  origin, never into its own document, and a failed load leaves the previous graph playing.

Working in this repository itself, `AGENTS.md` holds the conventions and `/new-plugin`
(`.claude/commands/new-plugin.md`) scaffolds a plugin. `npm test` runs everything.

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
| Plugin author guide | `docs/for-plugin-authors.md` | Profile, processor, WebAssembly, digests, publishing, and a checklist |
| Host guide | `docs/for-hosts.md` | The load sequence, capability negotiation, and what will bite you |
| Skins | `docs/svg-skins.md` | A plugin interface as SVG artwork and RDF bindings, with no code. The host builds it from an allowlist of nodes and never inserts the file |
| Collections | `docs/plugin-collections.md` | Publishing a list of plugins at one URL |
| Nested plugins | `docs/nested-plugins.md` | A plugin made of other plugins. Optional for a host |
| Worked plugins | `plugins/<name>/profile.ttl`, `plugins/index.json` | The real profiles, generated from their builds, and a generated index of them |
| Architecture | `docs/architecture.md` | Layers, boundaries, and the decisions behind them |
| Bundles | `docs/plugin-bundles.md` | A plugin as a file, its provenance record, and the signature over it |
| Module ABI | `docs/module-abi.md` | The optional WebAssembly ABI, for a host with no JavaScript |
| Web Audio Modules | `docs/wam.md` | Packaging a plugin for a WAM 2.0 host, and why the reverse does not work |
| Worked example | `examples/reference-profile.ttl` | A complete profile that validates |
| Worked project | `examples/session-project.ttl` | A complete session that validates |
| Worked provenance | `examples/reference-provenance.ttl` | A complete bundle provenance record that validates |
| Counterexamples | `examples/counterexample-*.ttl` | One per format. Each violates every constraint once, and none may validate |

## Vocabularies

JigDAW writes mainly in `trn:`, `jig:` and `lv2:`, and which statement belongs to which matters. The rest are supporting.

| Prefix | IRI | Used for |
|---|---|---|
| `trn:` | `http://purl.org/stuff/transmissions/` | what the plugin is musically: roles, signal types, routing |
| `jig:` | `http://purl.org/stuff/jigdaw/` | what it takes to run it in a browser |
| `lv2:` / `units:` | `http://lv2plug.in/ns/…` | parameters, ranges, units |
| `pu:` | `http://purl.org/stuff/plugin-universe/` | catalogue metadata: licence, category |
| `prov:` / `dcterms:` / `foaf:` | standard | provenance, metadata, homepages |
| `sec:` | `https://w3id.org/security#` | Data Integrity proofs and Multikey, for a signed bundle |

`trn:` is defined in the transmission repository's `vocabs/profile.ttl` and published at
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
    rdfs:comment "A Schroeder plate reverb." ;
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
    jig:integrity "sha384-REPLACE" .
```

`sha384-REPLACE` is a placeholder and fails validation. A real digest is
`printf 'sha384-%s\n' "$(openssl dgst -sha384 -binary cascade-processor.js | openssl base64 -A)"`,
and it is generated by the build, never typed. A profile with no `jig:module` validates with a
warning, which is correct for a plugin whose processing is plain JavaScript. A plugin with
parameters declares each as an `lv2:port`; see `examples/reference-profile.ttl`.

`jig:WebPlugin` is a subclass of `trn:PluginProfile`, so an existing catalogue profile
becomes loadable by adding statements rather than by being rewritten, and a profile that
describes a native-only plugin stays valid.

## Validating

```sh
rapper -i turtle -c examples/reference-profile.ttl   # syntax, needs raptor
npm run validate -- examples/reference-profile.ttl   # shapes, exits non-zero on violation
npm run check-plugin -- <IRI>                        # renders it headless: does it make sound
```

`vocabs/shapes.ttl` is SHACL Core and deliberately contains no `sh:sparql`, because
`rdf-validate-shacl` throws on such a constraint rather than skipping it.

## Related catalogues

[plugin-universe.com](https://plugin-universe.com) holds a large, growing catalogue of plugins
under CC0, with a public read-only SPARQL endpoint at
`sparql.plugin-universe.com/public/query` and a public MCP endpoint at
`mcp.plugin-universe.com/mcp`, faceted on `accepts` and `produces`. JigDAW extends its profile
format rather than competing with it.
