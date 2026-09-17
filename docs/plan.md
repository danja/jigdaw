# Plan

Phased. Status is updated as a phase completes, and a phase is not complete until its
verification has actually been run.

## Context

`docs/first-thoughts.md` sketches JigDAW as a web-native DAW plus web-native plugins: the
functionality a native DAW and its VST plugins carry today, with everything online,
WebAssembly throughout, and WebMCP built in.

The defining idea is that **a plugin's identity, its metadata and its delivery collapse into
one URI**. Search, get a URL, HTTP GET, installed. That only works if the profile format and
the host and plugin capability contract are right, so those are the foundation rather than
the interface.

This is not greenfield. Four sibling repositories already run the pattern, described in
[local-references.md](local-references.md):

| Repository | What it contributes |
|---|---|
| `transmission` | the `trn:` vocabulary, the discovered and curated split, an RDF plugin catalogue with an MCP face |
| `downspout` | 52 hand-written `profile.ttl` files, the format in real use |
| `valis` | instruments as RDF documents, the ontology to registry symmetry test, one dispatcher with thin adapters |
| `plugin-universe` | live at plugin-universe.com: 758 plugins, a published profile spec, a vocabulary at `/ns`, Fuseki, public SPARQL and MCP endpoints |

So the profile format is settled and already deployed. **JigDAW's job is to extend it for the
web**: what a plugin's IRI serves, how WebAssembly and user interfaces are declared and
fetched, and what the host guarantees in return.

## The decisive constraint

`first-thoughts.md` says "do a HTTP GET and the plugin is installed". Three browser rules
stand between that sentence and working code, and the specification answers them explicitly
rather than discovering them later.

1. **`AudioWorklet.addModule()` cross-origin requires CORS.** A plugin served without
   `Access-Control-Allow-Origin` cannot be loaded, however good its profile. The response is
   unreadable rather than merely untrusted. Plugin hosting has a minimum bar.
2. **`SharedArrayBuffer` requires cross-origin isolation**, which forces every cross-origin
   subresource anywhere to opt in with `Cross-Origin-Resource-Policy`. Requiring it would
   mean an author publishes by publishing and then finds that publishing was not enough.
3. **Executing fetched code is the whole threat model.** A plugin is arbitrary WebAssembly
   plus arbitrary main-thread JavaScript from an arbitrary origin.

Resolved as: require CORS, negotiate shared memory rather than assume it, verify every
resource against a declared digest, and sandbox plugin user interfaces cross-origin.

## Decisions taken

| Question | Decision | Where |
|---|---|---|
| Plugin delivery | Profile first, then module. The IRI content-negotiates to RDF; the profile links to the code | [plugin-profiles.md](plugin-profiles.md) |
| Audio engine | One `AudioWorkletProcessor` per plugin; Web Audio owns the graph | [architecture.md](architecture.md) |
| Ordering in a project | No `rdf:List` anywhere. Processing order is derived; everything else is keyed | [project-format.md](project-format.md) |
| Feedback | A cycle must contain an explicit delay; latency inside a cycle is never compensated | [latency.md](latency.md) |
| Identity and retrieval | Identity stays canonical, retrieval follows where the profile was fetched from | [plugin-profiles.md](plugin-profiles.md) |
| Vocabulary hosting | `hyperdata.it/xmlns/jigdaw/`, via the existing PURL wildcard | [namespace.md](namespace.md) |
| Application hosting | `strandz.it`, following plugin-universe's arrangement | [deployment.md](deployment.md) |

## Phase 0. Specification. Complete.

The vocabulary, the shapes, the normative contract and the supporting documents. No
implementation.

Delivered: `vocabs/jigdaw.ttl`; `vocabs/shapes.ttl`; the normative
[host-plugin-contract.md](host-plugin-contract.md), [messaging.md](messaging.md),
[latency.md](latency.md), [project-format.md](project-format.md); plus
[plugin-profiles.md](plugin-profiles.md), [webmcp.md](webmcp.md),
[namespace.md](namespace.md), [architecture.md](architecture.md),
[deployment.md](deployment.md); four worked examples, two valid and two counterexamples;
`AGENTS.md` with `CLAUDE.md` a symlink to it, and `HUMANS.md` listing the blockers.

Verified: every example parses; both valid ones conform; the profile counterexample produces
eight violations and the project counterexample ten, one per constraint; a profile fetched
live from plugin-universe.com conforms untouched.

## Phase 1. The vocabulary in code. Complete.

- `src/rdf/Vocabulary.js`, frozen constants, the single source of IRI truth.
- `src/rdf/parse.js` and `src/rdf/ProfileReader.js`, which turn a profile into the object
  the host acts on, including the widget each port implies.
- `src/validate/ShapeValidator.js` and `bin/validate.js`, so `npm run validate` exists. It
  holds the SHACL section 3.6 severity correction that `rdf-validate-shacl` gets wrong.
- `tests/rdf/vocabulary.test.js`, valis's ontology to registry symmetry test applied to the
  vocabulary: every term named in code is declared in the ontology and the reverse.

Verified by mutation: removing a constraint from the shapes, and adding an undeclared term
to an example, each turn a test red.

## Phase 2. One plugin, loaded. Complete headlessly.

The vertical slice, and the point where the contract stopped being prose.

- `plugins/cascade`, a real Schroeder plate reverb in Rust, `no_std` with no allocator at
  all, compiled to WebAssembly. Its `build.sh` regenerates `profile.ttl` with the digests of
  the artefacts that were actually produced.
- `plugins/cascade/cascade-processor.js`, the AudioWorklet processor.
- `src/host/`: `PluginLoader` performing contract section 3 in order, `Integrity`,
  `Capabilities`, `Parameters`, `LoadError` carrying the step that failed.
- `src/engine/Engine.js`, `src/ui/Panel.js`, `web/`, and `bin/serve.js`, a development
  server that implements the contract's serving rules rather than convenient ones.
- `tests/host/integration.test.js`, which runs the whole path for real against
  `src/testing/OfflineHost.js`: fetch, parse, validate, negotiate, verify digests, compile
  wasm, register, instantiate, render, and assert audio comes out.

**Remaining: verification in a real browser.** The Claude in Chrome extension is not
connected, so the page has not been driven or screenshotted. See `HUMANS.md` item 6. The
headless path covers more of the contract than clicking would, so this is a gap in visual
and accessibility checking rather than in the audio path.

Changes the phase forced on the specification, which is what a vertical slice is for:

- Contract section 3.1 step 7 said post the module bytes while 3.3 said post the compiled
  `WebAssembly.Module`. The contract is normative and cannot say both.
- Resource locations had to be rebased onto the retrieval URL, or only the origin named in a
  profile could ever serve that plugin.

## Phase 3. A graph. Core complete.

- `src/model/Project.js`, the session as [project-format.md](project-format.md) describes
  it. Changesets are atomic, carry `expectedRevision`, and support `dryRun`. Editor
  metadata is held apart and does not bump the revision, so dragging a node cannot
  invalidate a compiled graph.
- `src/compiler/GraphCompiler.js`. Iterative Tarjan for strongly connected components,
  refusal of a cycle carrying less than one render quantum of delay, and latency
  compensation computed over the condensation.
- `src/ops/OpDispatcher.js`, the single operation layer. A changeset is compiled before it
  is committed, so a graph the compiler refuses never reaches the model or the audio, and
  what is playing always matches what the model says.
- `src/engine/Engine.js` gained `link` and `clearLinks`, which insert and own the delay
  nodes compensation asks for.

Verified end to end against real plugins in `tests/host/integration.test.js`: two plugins
load and link, a feedback loop between them is refused, and a graph needing compensation
produces a real delay node set to 512 frames at 48 kHz.

Two bugs this phase found, both recorded in `MISTAKES.md`:

- Latency stopped at the edge of a feedback loop, because dropping cycle edges before
  accumulating is not the same rule as not compensating across them. A dry signal beside a
  delay line would have arrived early with nothing to explain it.
- The id counter did not account for ids it had not minted, so replaying a saved project and
  then adding a node collided.

Remaining: wiring the dispatcher into the page, so the demo is a graph rather than one
plugin.

## Phase 4. Events and transport

MIDI over message ports, located by stream position and never by block index. Host transport.
The first plugins that require `trn:HostTransport`.

## Phase 5. The catalogue and the namespace

The compose stack with the SPARQL store, per [deployment.md](deployment.md). Crawling
profiles, named graph per source. Federating with or mirroring plugin-universe rather than
starting empty.

Serving the vocabulary at its namespace IRI belongs here and is independent of everything
else in the phase. It is a deployment rather than a build, and `HUMANS.md` carries it
because it needs a person.

## Phase 6. WebMCP

The agent surface, as a thin adapter over the same dispatcher the editor uses. Demand-driven
search and chain validation, per [webmcp.md](webmcp.md).

## Blocked on a person

In `HUMANS.md`, and unchanged by any amount of building: serving the vocabulary, minting a
web plugin format term, deciding which repository owns `trn:`, and fixing `trn:`
dereferencing. The format term blocks publishing a JigDAW plugin to the catalogue; the rest
block nothing here but leave published IRIs dead.
