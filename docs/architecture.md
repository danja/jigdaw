# JigDAW architecture

The specification is complete and normative, and a browser host implements it. This document
says what the pieces are and where the boundaries fall, so that the normative
[host-plugin-contract.md](host-plugin-contract.md) has something to be normative about. Where
a section below describes something not yet built, it says so; everything else describes what
runs today.

The premise comes from [first-thoughts.md](first-thoughts.md), which is kept as written.

## Layers

```
 browser
 ┌──────────────────────────────────────────────────────────┐
 │  ui/                        webmcp/                      │
 │   the editor                 the agent surface           │
 │        \                    /                            │
 │         \                  /                             │
 │            ops/   one dispatcher, every operation once   │
 │  ========== | ========================================   │
 │      rdf/ . model/ . compiler/      message thread       │
 │  ========== | ======================================== real-time boundary
 │      engine/                                             │
 │        AudioContext, one AudioWorkletNode per plugin     │
 │        each wrapping its own WebAssembly instance        │
 └──────────────────────────────────────────────────────────┘
          │                              │
     plugin IRIs                    catalogue
     anywhere on the web            local today, a SPARQL store planned
```

Two boundaries matter and they are not the same boundary.

The **real-time boundary** separates `process()` from everything else. Below it there is no
allocation, no network, no storage, no unbounded lock. Above it there is no timing
guarantee.

The **operation boundary** separates the control surfaces from the model. The editor and
the WebMCP face are both thin adapters over one dispatcher. Neither implements an operation
of its own. This comes from valis, where the GTK UI and the MCP server sit on one
`OpDispatcher`, and it is what stops the two drifting into disagreeing about what an edit
means.

## Why one worklet per plugin

Each plugin is its own `AudioWorkletProcessor`, and the Web Audio API owns the graph, the
routing and the scheduling.

The alternative, a single worklet running a WebAssembly engine that hosts every plugin
internally, gives tighter control over processing order and latency and is closer to how a
native DAW works. It was not chosen because it makes dynamic loading hard, and dynamic
loading is the entire premise: a user finds a plugin, the host fetches it, and it is
running. Adding a node to a live `AudioContext` is ordinary; adding a plugin to a running
monolithic engine is not.

The cost is that Web Audio decides processing order, and that a graph with feedback needs
explicit handling. That is a known trade and it is written down here so it is not
rediscovered as a surprise.

## Why a plugin is a URL

A plugin is identified by a dereferenceable `https:` IRI. Dereference it and you get its
profile. The profile says what the plugin is and links to the code. Identity, metadata and
delivery are one thing.

The reflex alternative is a registry, and it will be proposed again. A registry makes its
operator the arbiter of what exists. Dereferenceable IRIs mean an author publishes by
publishing, and a catalogue becomes one opinion about what is worth finding rather than the
precondition for being found.

What this costs is spelled out in section 1.3 of the contract: CORS becomes a hard hosting
requirement, and cross-origin isolation cannot be assumed. Those are not incidental. They
are the price of the design and they shape the capability negotiation.

## The catalogue

**What runs today has no store.** `src/catalogue/LocalCatalogue.js` indexes the plugins this
host serves by reading the same `profile.ttl` files it serves them from, in process, with no
database and nothing to crawl. It searches its own plugins first and, by default, only those:
a browser listing 756 plugins that none of them can run is a list rather than a browser.

The rest of the catalogue is one checkbox away, dimmed and labelled, because hiding it
entirely would misrepresent what exists. `plugin-universe.com` runs a public read-only SPARQL
endpoint at `sparql.plugin-universe.com/public/query` and a public MCP endpoint at
`mcp.plugin-universe.com/mcp`, over 756 plugins with `accepts` and `produces` facets, under
CC0, and JigDAW's search reaches it through the same query service rather than through a
second implementation. Those figures were taken from `/health` and should be re-measured
rather than trusted.

Most of those plugins are native and not loadable here. That is fine and is the point of
`jig:WebPlugin` being a subclass: the catalogue knows about every plugin, and the host can
ask which of them it can actually run.

**Not yet built: a local SPARQL store, crawling profiles into it, named graph per source.**
The reasoning for the shape, when it is built, still holds: every triple in a graph saying
where it came from, with `prov:` metadata, never a shared catch-all graph, so that
re-crawling a source is a DROP and reload of that graph alone. This is plugin-universe's rule
and the reason is that a licence and a provenance are properties of a source, so one graph
per source means one answer per question. Neither a store nor crawling is needed for search
to work, which is why search shipped without them.

## Discovered and curated

Two kinds of knowledge, inherited from transmission.

The **profile** is curated: what a plugin is for, what its signals mean, what it pairs with.
An **inspection** is discovered: what a host observed when it actually loaded the module.

Discovery wins on technical facts. Curation wins on meaning. Neither is derivable from the
other, which is why both exist.

Load failures are recorded rather than only reported. Which plugins work in which browsers
is a fact about the ecosystem and is discoverable only if unsuccessful loads are written
down.

## WebMCP

The agent surface is a WebMCP server in the page, exposing the same operations as the editor
through the same dispatcher.

Search is demand-driven, following transmission: an agent finds candidates by role and
signal semantics, then asks for a full description only for the ones that matter. Chain
validation checks that adjacent nodes agree, which is a type check on `trn:produces` against
`trn:accepts`, and reports the curated pairings and cautions.

The tool surface is specified in [webmcp.md](webmcp.md). The browser API it binds to is
not settled, and that document says where the boundary between the two falls.

## The vocabulary is a component too

JigDAW tells plugin authors to publish dereferenceable IRIs, so its own vocabulary
dereferences. `http://purl.org/stuff/jigdaw/` already resolves, through an existing wildcard,
to `https://hyperdata.it/xmlns/jigdaw/`, and serving the vocabulary there is the whole job.
What it must serve, and why each term answers `303` rather than `200`, is in
[namespace.md](namespace.md).

IRIs are minted under the PURL and never under the host that serves them, so a change of
hosting does not break IRIs already written into other people's project files.

## Deployment

**What runs today is one node process under systemd behind nginx**, matching the catalogue
above having no store yet: there is nothing to put in one. Planned, when there is: a compose
stack adding a Fuseki store, with only nginx published and everything else bound to loopback.
Hosting is `strandz.it`, alongside `hyperdata.it` and `plugin-universe.com`, and the
arrangement follows plugin-universe's because copying one that is already running beats
inventing a better one that has never been operated.

The detail, including the headers a plugin origin must send and why an nginx `add_header`
inside a `location` is a trap, is in [deployment.md](deployment.md).

## Since settled

- The project file format is [project-format.md](project-format.md). The `rdf:List` conflict
  between transmission's precedent and valis's rule went valis's way, and further: there is
  no `rdf:List` anywhere in a project. Processing order is derived from the connections
  because Web Audio derives it too, and everything else that looks ordered is really keyed.
- Latency and feedback are [latency.md](latency.md). A cycle must contain an explicit delay
  of at least one render quantum, and latency inside a cycle is never compensated, because
  the delay in a feedback loop is the thing the user asked for.

## What is not decided

- Whether a future local store, once built, caches plugin-universe's data or continues
  federating with live queries the way search already does without one.
- Clips, regions and an arrangement. The project format describes a patch, not a timeline.
