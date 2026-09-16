# JigDAW architecture

The specification phase. Nothing here is implemented. This document says what the pieces
are and where the boundaries fall, so that the normative
[host-plugin-contract.md](host-plugin-contract.md) has something to be normative about.

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
     anywhere on the web            SPARQL store
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

A local SPARQL store holds profiles, alongside the DAW, in a Podman container.

**It should not start empty.** `plugin-universe.com` already runs a public read-only SPARQL
endpoint at `sparql.plugin-universe.com/public/query` and a public MCP endpoint at
`mcp.plugin-universe.com/mcp`, over 758 plugins with `accepts` and `produces` facets, under
CC0. Federating with it, or mirroring it, is strictly better than building a second
catalogue of the same things. The figures here were taken from `/health` and should be
re-measured rather than trusted.

Most of those plugins are native and not loadable here. That is fine and is the point of
`jig:WebPlugin` being a subclass: the catalogue knows about every plugin, and the host can
ask which of them it can actually run.

**Named graph per source.** Every triple lives in a graph saying where it came from, with
`prov:` metadata. Never a shared catch-all graph. Re-crawling a source is a DROP and reload
of that graph alone. This is plugin-universe's rule and the reason is that a licence and a
provenance are properties of a source, so one graph per source means one answer per
question.

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

A Podman container with the DAW and the SPARQL store. Only the web surface is published;
the store binds to loopback. A SPARQL update endpoint reachable from outside would be the
worst mistake available here, and it is the default configuration of most stores.

## Since settled

- The project file format is [project-format.md](project-format.md). The `rdf:List` conflict
  between transmission's precedent and valis's rule went valis's way, and further: there is
  no `rdf:List` anywhere in a project. Processing order is derived from the connections
  because Web Audio derives it too, and everything else that looks ordered is really keyed.
- Latency and feedback are [latency.md](latency.md). A cycle must contain an explicit delay
  of at least one render quantum, and latency inside a cycle is never compensated, because
  the delay in a feedback loop is the thing the user asked for.

## What is not decided

- Whether the local store federates with plugin-universe or mirrors it.
- Clips, regions and an arrangement. The project format describes a patch, not a timeline.
