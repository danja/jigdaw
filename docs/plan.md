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

**Deployed 2026-09-17** to <https://strandz.it/jigdaw/>, under `/jigdaw/` on port 6011
behind the existing nginx. Verified live: every URL returns the right status and media type,
both profiles validate against the shapes, and the digests in the live profiles match the
bytes served. `deploy/` holds the nginx fragment, the systemd unit and `check.sh`.

**Verified in a real browser, 2026-09-17.** The synth loads, the on-screen keyboard plays it,
a reverb chains after it, and the reverb tail outlives the synth's release.

That first run found four defects the headless suite had passed, one of them a specification
error: contract section 3.3 required posting a compiled `WebAssembly.Module` into an
`AudioWorklet`, which browsers silently refuse to deliver. The offline harness had been more
permissive than a real `MessagePort`, which is what let a wrong contract pass. All four are
in `MISTAKES.md`.

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

## Phase 4. Events and transport. Core complete.

- `src/engine/Transport.js`, the musical clock. Beats to seconds and back across a tempo map,
  looping wrapped by modulo so an hour of playback costs what a second does, and the
  per-quantum message contract section 7 requires.
- `src/engine/EventRouter.js`. A MIDI connection is not an audio edge: it is the host
  carrying messages between two ports, so it never reaches `connect()`. Events are ordered by
  frame before sending, and overflow reports are accumulated per node.
- `src/engine/Engine.js` gained `onMessage`, which fans one port out to several listeners.
  A port has one `onmessage` and errors, outgoing events and dropped counts all arrive on it.
- `plugins/pulse`, an eight voice subtractive synthesiser in Rust: `no_std`, no allocator, no
  transcendental functions, pitch from a twelve entry table and an octave shift rather than
  `powf`. 3 KB of wasm.
- `plugins/pulse/pulse-processor.js`, with the bounded preallocated event queue. Events are
  applied in the quantum containing their frame, compared by range, and an event whose frame
  has passed is applied now rather than lost.

Verified end to end: a note sounds, a note off silences it, an event scheduled three quanta
ahead does not sound early and is not lost, a note on with velocity zero is treated as a note
off, overflow is reported rather than hidden, and a MIDI connection produces a host route and
no audio link. The MIDI capability shape was checked against the real plugin by removing
`trn:requires jig:MidiEvents` from it and watching validation fail.

Found this phase and recorded in `MISTAKES.md`: the router listened to a node only once it
had a route, so a node dropping events while unwired was invisible.

Remaining: a plugin that requires `trn:HostTransport`, to exercise the transport against real
DSP rather than only against its own tests.

## Phase 5. The catalogue and the namespace

The compose stack with the SPARQL store, per [deployment.md](deployment.md). Crawling
profiles, named graph per source. Federating with or mirroring plugin-universe rather than
starting empty.

Serving the vocabulary at its namespace IRI belongs here and is independent of everything
else in the phase. It is a deployment rather than a build, and `HUMANS.md` carries it
because it needs a person.

## Phase 5. The catalogue. Search complete.

Search works without a store of our own, because plugin-universe already runs a public
read-only SPARQL endpoint over 756 CC0 profiles and building a second catalogue of the same
things would be worse than querying that one.

- `src/catalogue/`: `QueryService` loading `.sparql` files by name, `terms.js` where a value
  becomes syntax and nowhere else, `facets.js` holding the one facet list, and `Catalogue`.
- `sparql/queries/catalogue/`. No SPARQL is inlined in JavaScript, and
  `tests/docs/conventions.test.js` fails if any appears.
- `/catalogue/search` and `/catalogue/describe` on the server, so no SPARQL reaches the
  browser bundle and there is one place to cache. It also means the page does not depend on
  an upstream endpoint's CORS headers being right.
- A search box with facets in the page.

- `src/catalogue/LocalCatalogue.js`, which indexes the plugins this host serves itself by
  reading the same `profile.ttl` files it serves. No store, and no second copy to drift.

Search returns this host's own plugins first and, by default, only those. A browser listing
756 plugins that none of them can run is a list rather than a browser. The rest of the
catalogue is one checkbox away, dimmed and labelled, because hiding it entirely would
misrepresent what exists: those are real plugins, and `jig:WebPlugin` being a subclass is
exactly what lets the catalogue hold both.

Remaining: crawling, and getting JigDAW's own plugins harvested upstream so other hosts can
find them. Neither is needed for search to work.

## Phase 6. WebMCP. Complete.

- `src/mcp/tools.js`, eleven tools over the dispatcher: `status`, `project_get`,
  `plugins_search`, `plugin_describe`, `plugin_validate_chain`, `plugin_load`,
  `graph_apply_changes`, `connection_add`, `parameter_set`, `transport_configure`,
  `diagnostics`. Not one of them implements an operation of its own.
- `src/mcp/adapter.js`, the only file that knows how a user agent learns of a tool. WebMCP is
  still moving, so the surface is specified and the binding is isolated: it binds to
  `navigator.modelContext` where that exists and to the page otherwise, and says which.

Search is demand driven, as [webmcp.md](webmcp.md) requires: `plugins_search` returns enough
to choose between candidates and `plugin_describe` is called only for the few that matter.

Every failure is a result rather than a rejection, including a tool that throws, because an
agent cannot read a stack trace and the message is the entire interface to a failure.
A missing catalogue makes the discovery tools explain themselves rather than vanish.

## Documentation for people outside the project

`web/docs/` is served at `/jigdaw/docs/` and linked from the front page alongside the
repository:

- an overview and index, explaining the one idea and the three vocabularies, with an honest
  account of what works and what does not;
- a guide for host authors: the load sequence, capability negotiation, and the traps that
  cost real time here;
- a guide for plugin authors: writing a profile, the processor, the WebAssembly, digests,
  and what a server must send.

These are guides. The normative specifications stay in `docs/` and are linked from the index,
which says plainly that they are the authority where the two disagree.

`tests/docs/conventions.test.js` fails on a broken link, a link to the wrong repository, a
missing viewport or a missing title. The repository check exists because `github.com/jigdaw`
is somebody's account and returns 200, so that typo would not even have looked broken.

## Phase 7. A native host. Complete.

`native/jigdaw-adapter` is a VST3, CLAP and LV2 built with DPF, in the shape downspout uses:
a portable core with the plugin format as a thin shell over it. Two channels of audio in and
out, MIDI in and out, and a chain of JigDAW plugins loaded by IRI.

- `src/Turtle.cpp`, the subset of Turtle a profile uses, about 300 lines and no dependency.
- `src/Profile.cpp`, including the rebasing that keeps identity canonical while retrieval
  follows the mirror.
- `src/Integrity.cpp`, sha384 through OpenSSL, agreeing with the browser host's digests.
- `src/Module.cpp`, `jig:Abi1` through wasm3, and the only file that knows which runtime.
- `src/Chain.cpp` and `src/dpf/`.

Verified: both worked plugins fetched over HTTP, verified against their declared digests,
instantiated and sounded. Pulse silent, then 0.133 on a note, then silent on release. Cascade
passing dry signal through bit-exactly at mix 0 and producing a tail over 189 of 200 blocks.
A chain of both: the synth through the reverb, with the tail outliving the note.

Four native tests run under ctest. The one that fetches over HTTP skips, loudly, when nothing
is serving, because a network test that fails a build is a test that gets disabled.

`native/install.sh` builds, tests and installs into `~/.vst3`, with `--all` for the CLAP and
LV2 as well. It finishes by `dlopen`ing what it installed and calling `GetPluginFactory`,
because a copy that succeeded says nothing about whether a host can open the result. Verified
on the installed bundle: no unresolved libraries, the execute bit intact, and a factory
returned.

## What it found

`native/jigdaw-adapter` is a VST3, built with DPF in the shape downspout uses, that loads
JigDAW plugins by IRI.

It was proposed as a sanity check on the specification and it worked as one immediately: a
native host could not load a JigDAW plugin at all. The only thing the contract guarantees is
a JavaScript `AudioWorklet` module, and the WebAssembly ABI is explicitly private to the
plugin. The specification had accidentally made itself browser-only.

[module-abi.md](module-abi.md) is the answer: a module may declare `jig:abi jig:Abi1`, and a
host with a WebAssembly runtime loads it directly. Both worked plugins declare it, every port
now carries a `jig:paramIndex`, and the shapes refuse a plugin that declares an ABI without
one.

## Blocked on a person

In `HUMANS.md`, and unchanged by any amount of building: serving the vocabulary, minting a
web plugin format term, deciding which repository owns `trn:`, and fixing `trn:`
dereferencing. The format term blocks publishing a JigDAW plugin to the catalogue; the rest
block nothing here but leave published IRIs dead.
