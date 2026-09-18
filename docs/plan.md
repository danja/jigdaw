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
| `plugin-universe` | live at plugin-universe.com: 756 plugins, a published profile spec, a vocabulary at `/ns`, Fuseki, public SPARQL and MCP endpoints |

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

- `src/mcp/tools.js`, fourteen tools over the dispatcher: `status`, `project_get`,
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
- `src/Module.cpp`, `jig:Abi1` and `jig:Abi2` through wasm3, and the only file that knows which runtime.
- `src/Chain.cpp` and `src/dpf/`.

Verified: both worked plugins fetched over HTTP, verified against their declared digests,
instantiated and sounded. Pulse silent, then 0.133 on a note, then silent on release. Cascade
passing dry signal through bit-exactly at mix 0 and producing a tail over 189 of 200 blocks.
A chain of both: the synth through the reverb, with the tail outliving the note.

Four native tests run under ctest. The one that fetches over HTTP skips, loudly, when nothing
is serving, because a network test that fails a build is a test that gets disabled.

`install.sh`, at the repository root, builds, tests and installs into `~/.vst3`, with
`--all` for the CLAP and LV2 as well. It finishes by `dlopen`ing what it installed and calling `GetPluginFactory`,
because a copy that succeeded says nothing about whether a host can open the result. Verified
on the installed bundle: no unresolved libraries, the execute bit intact, and a factory
returned.

### A third host, written elsewhere

[Transmission](https://danja.github.io/transmission/jigdaw.html) now hosts JigDAW plugins
alongside VST3 ones. It does not reimplement the contract: its `native/CMakeLists.txt` adds
`native/jigdaw-adapter` from a JigDAW checkout and links `jigdaw_core`, which is the first use
of that library outside this repository and the vindication of separating it from the DPF
shell. Both ABIs, port counts read from the profile rather than from the project, a panel
generated from the same `lv2:port` declarations the browser host generates one from, and
`file://` plugin IRIs for development.

It is weaker evidence than an independent implementation would be, and it is a different kind
of evidence from any test here: a JigDAW plugin runs in an application written for something
else. It has already returned one defect, the locale-dependent number parsing in
`Profile.cpp` in `MISTAKES.md`. Nothing in this repository would have found it, because no
test here runs under a comma-decimal locale and no host here calls `setlocale`.

## Phase 8. Sessions. Complete.

The project format has been normative since phase 0 and nothing wrote it, which made every
claim in `docs/project-format.md` a claim about a file no code produced, and meant a session
could not survive closing the tab.

- `src/rdf/ProjectWriter.js` and `src/rdf/ProjectReader.js`. Skolemised fragments, no blank
  nodes, deterministic output, and editor positions in their own document because dragging a
  node must not invalidate a compiled graph.
- The reader returns a changeset rather than a Project. The model has one way in, and a reader
  that built state directly would be a second implementation of every rule that lives there,
  enforced on a project a person built and not on one they opened.
- `OpDispatcher.addPlugin` takes an explicit node id, because the connections in a saved file
  name the nodes they join.
- Save and Open in the transport bar.

`tests/rdf/ProjectRoundTrip.test.js` round trips a project with one of everything the format
can express, checks the written Turtle against `vocabs/shapes.ttl`, and reads the worked
example the documentation points people at.

Verified in a browser: a chain of BassGen into Pulse with two parameters set, saved, cleared,
and reopened from the saved bytes. Ids, plugin IRIs, settings and the MIDI connection all
came back, exactly two engine nodes existed afterwards, and it played at peak 0.373.

It found that removing a node never removed the AudioWorkletNode behind it. See MISTAKES.md.

## Phase 9a. Bundles. Complete.

"Install is a HTTP GET" works for as long as somebody is serving the plugin, which is not the
same as for ever and not the same as on a machine with no network. There was no way to hand a
plugin to a person as a file.

[plugin-bundles.md](plugin-bundles.md) defines two forms, and the first turned out to exist
already without anybody noticing: **a profile whose `jig:location` values are `data:` URIs is
a legal profile**, and the loader reads it unchanged. `resolveLocation` leaves a `data:` URI
alone, `fetch` reads it, and the integrity digest verifies over the decoded bytes exactly as
over bytes from a server. The second is a `.jig` zip with `profile.ttl` at the root, which
unpacks into a working plugin origin.

Neither changes what a plugin is. Both carry the canonical IRI, and a bundle is a retrieval
origin rather than an identity, which is the rule `rebaseLocation` already implemented for
mirrors.

- `bin/bundle.js`, no dependency: the zip container is written over `node:zlib`. Deterministic,
  with a fixed date, for the same reason the profile writer is.
- It verifies before it packs. A profile whose declared digest does not match the file beside
  it is refused, because that failure is local until the bundle reaches somebody else.
- `tests/host/bundle.test.js` loads a flattened profile through the real `PluginLoader` and
  unpacks an archive into a directory the loader treats as an origin. Mutation tested.

Measured on the worked plugins: cascade is 227 kB of wasm, 314 kB flattened and 5 kB archived.
The two forms are for two jobs and the numbers say why.

That left one thing open, recorded in the document rather than invented: every file in a
bundle is tamper evident because the profile digests it, and the profile itself was not.
Phase 9b closed it.

## Phase 9b. Provenance and signing. Complete.

A bundle arrives by hand, from somebody, and nothing in it said from whom. Every bundle now
carries a `provenance.ttl`: what it is a copy of, who made it, when, with what, and a
`jig:canonicalDigest` of the profile itself. Given a key, `bin/bundle.js` also signs.

**The digest is over the graph, not the bytes,** which is the decision the rest follows from.
The same plugin is legitimately three different byte sequences, flattened, archived and
served, so a digest that changes between them tells a recipient nothing. The canonical form is
RDFC-1.0 restricted to graphs with no blank nodes, which is sorted N-Triples, with every
`jig:location` omitted. Omitting location is what makes one value hold across all three, and
it is safe only because `jig:integrity` is not omitted: a rewritten location can point only at
bytes the signature already covers.

**Signing reuses `sec:` rather than inventing a parallel.** Data Integrity proofs and Multikey
are what a signature over RDF is already written in. The suite is named `jigdaw-eddsa-2026`
rather than `eddsa-rdfc-2022`, because ours omits `jig:location` and a proof that differs
needs a name that differs. Ed25519 over WebCrypto, so the page and the command line verify
with the same code. The signature is over two digests, the proof's own configuration and the
document, which is how the proof's time and key are covered without a signature containing
itself, and is what lets a second person countersign without breaking the first signature.

**The report is three answers, never one tick.** Are these the files the profile names, is
this the profile that was bundled, and who says so. A valid signature by an unknown key proves
that one holder of that key made this and nothing about who they are, and `bin/verify.js`
says that in those words. There is no trusted key list and there will not be one.

**What it found.** `bin/write-profile.js` had been emitting `lv2:scalePoint` as blank nodes
since phase 2, in a repository whose conventions have forbidden a blank node for anything
addressable since phase 0. Nothing noticed until a signature needed a canonical form and the
first real plugin refused to canonicalise. Both are now guarded: every Turtle file in the
repository is canonicalised by `tests/rdf/Canonical.test.js`, and the panel each committed
profile generates is checked against the scale points it declares, which nothing had ever
read end to end. See MISTAKES.md.

`bin/keys.js` refuses to write a private key inside a git working tree. No key material is
committed and the tests generate theirs in memory.

## Phase 10. Web Audio Modules. Complete one way.

JigDAW was specified without a single mention of
[Web Audio Modules](https://www.webaudiomodules.com/), the existing standard for exactly this.
That was an omission, not a decision, and it was found by being asked to look at the API rather
than by anything here noticing.

`bin/wam.js` packages a plugin as a WAM: same profile, same WebAssembly, same processor, with
`descriptor.json` and an `index.js` generated from the profile. 21 kB and standalone, because
the profile is resolved at build time rather than parsed at load; a Turtle parser in a browser
costs 1.7 MB and two shims. See [wam.md](wam.md).

**It carries integrity into a format that has no concept of it.** No digest, no hash, nothing,
across the whole of `@webaudiomodules/api`. The digests come from the profile and are checked
before anything is registered.

**It runs one way.** A WAM's file set is not knowable before running it, because its audio
thread dependencies arrive through `addFunctionModule` rather than through anything a manifest
lists, so it cannot be declared, digested or verified. JigDAW's format is a description and
WAM's is a program, and one converts to the other only in that direction.

**What it needed.** `doap:revision`, because `WamDescriptor.version` is required and no profile
carried a version. Reused rather than minted as `jig:version`: DOAP is what LV2 uses to
describe a plugin project, and this vocabulary already follows LV2.

**What it found.** `PluginLoader` cannot be bundled for a browser at all: it reaches
`ProfileReader` and therefore `@zazuko/env`, which reaches node's `stream` and `util`. Steps 4
to 8 of contract section 3.1 are now `src/host/Instantiate.js`, which knows nothing about RDF,
with `PluginLoader` still the front door. No caller changed and its 111 tests passed unedited,
which is what says the split was a move rather than a rewrite.

Three defects in the adapter were found by the offline test rather than by review: it assumed
the node was an `EventTarget`, then that the port was, and the parameter typing inferred `int`
from bounds that happened to be whole numbers, which would have quantised every cutoff in
every WAM host to 1 Hz steps.

Open: audio-thread `connectEvents`, which needs the shell to drive the module through
[module-abi.md](module-abi.md) rather than wrapping the processor, the way
`native/jigdaw-adapter` already does for VST3.

## Phase 10b. Foreign plugins. Specified and gated; the adapter is not built.

Loading a WAM into a JigDAW host turned out to be blocked by something other than what
[wam.md](wam.md) first said. `addFunctionModule` takes a function reference, so it stringifies
code already loaded rather than fetching, and the enumeration problem is narrower than claimed
and is solved by verifying a container instead of enumerating contents.

The real obstacle is that a WAM's entry point is a module the host imports into its own
document and calls, with the host's origin and privileges. Contract section 9.1 forbids that
and gives the reasons. It is not a packaging problem and cannot be packaged away.

**Contract section 12 defines a separate class rather than relaxing section 9.1.** A foreign
plugin is `jig:ForeignPlugin`, disjoint from `jig:WebPlugin`, and a host that supports one must
verify its container, take consent bound to that container's digest, and mark it wherever it
appears. Support is optional; refusing everything still conforms. Sections 1 to 11 are
untouched, which was the point: the alternative was quietly weakening two of them.

Built and tested: the reader, the consent gate, the container loader with its traversal rules,
the shapes, a worked example and a counterexample that fires eleven constraints. The
disjointness is a SHACL constraint and not only an `owl:disjointWith`, because nothing
validating a profile loads the vocabulary.

**The virtual origin is built and has run.** `web/foreign/sw.js` and
`src/host/ForeignOrigin.js`, checked by `web/foreign/probe.html` because no test here can
reach a service worker. Measured in Chrome, 2026-09-18, against `pingpongdelay` from
`webaudiomodules/wam-examples` in a 351 kB container: 14 of 14, ending in a real Web Audio
Module passing audio at peak 1.0000 out of bytes that were verified before anything ran.

The browser found two things review had not. A host must inject `WamEnv` and a `WamGroup` into
its own worklet before any WAM instantiates; that code is shared, is in no container, and is
the host's rather than a plugin's, which is now contract section 12.3a. And section 12.3
contained a MUST no host can satisfy: a `..` path is normalised by the browser before a
service worker sees it, so it leaves the scope and is never offered for refusal. The wording
now says what is enforceable and states the limit.

**The adapter is written too.** `src/wam/WamAdapter.js` gives a `WamNode` the shape the engine
expects: a parameter map over `setParameterValues`, and a port translating JigDAW's messages
into WAM's methods and its events back. The panel comes from `getParameterInfo()` rather than
from the declared ports, because the plugin is the authority on its own parameters, and
widgets follow the same rule section 5.3 gives a native plugin.

18 of 18 in the probe, ending with a real Web Audio Module adopted as an engine node, a
parameter moved through the engine's own path and read back from the plugin, and audio still
passing. What cannot be translated is a test rather than a comment: WAM takes no time with a
parameter, so a ramp lands immediately.

Two guards came out of doing it. The probe's inline module is now syntax checked, because an
edit that shadowed a name made the page render, the button do nothing and `window.probe` stay
undefined, with no error anywhere. And the run needs a real click: a scripted one is not user
activation, so the `AudioContext` stays suspended and every audio check reads zero.

**Measured against the real plugins**, once `~/wam-examples` existed, which turned three
guesses into findings. `addFunctionModule` stringifies an already-loaded function and fetches
nothing, as the SDK source shows, so the correction to the original blocker holds. 15 of the
23 example plugins fetch at run time, for their own descriptor, GUI templates and preset
banks, which is why a container is verified rather than a file list enumerated. And 22 of the
23 locate themselves with `import.meta.url`, which rules out serving the container as blob
URLs and makes the Service Worker required rather than preferred. All three are asserted in
`tests/host/ForeignLoader.test.js` against the checkout when it is present, and skip loudly
when it is not.

One case the boundary correctly breaks: `PedalBoard-WAC2022` is a plugin that is itself a
plugin host, fetching a repository list and importing whatever it names. Its reachable code is
not a knowable set, every one of its fetches resolves outside the container, and it does not
work. That is the right answer rather than a gap.

**Two defects found by checking rather than by reading.** The `jig:entryPoint` pattern allowed
`..`, because `..` matches `[A-Za-z0-9._-]+`; the counterexample still produced the expected
number of violations by way of a different constraint, and it was caught by asking which rule
fired rather than how many did. And the panel's mark was nearly a CSS class alone, which
section 12.5 forbids and which no test that only counted elements would have noticed.

## Phase 9. The graph the model already had. Complete.

The model has been an arbitrary directed multigraph since phase 3, with Tarjan SCC, cycle
refusal and latency compensation over the condensation. Only the interface insisted on a chain,
and five things underneath it were wrong in ways that had never been looked for.

**The five.** Nothing in the compiled graph reached the speakers: `Engine` could resolve a
destination of `output` and the dispatcher never passed it, so the page connected each plugin
itself and an effect in the middle of a chain was heard twice. A connection to a parameter was
wired to audio input zero, so modulation was expressible, validated, exposed by a tool, and
delivered nowhere. `connectionKey` left out the signal kind, so an audio edge and a MIDI edge
between the same two ports collided. Removing a node severed the path. And `setParameter` wrote
the asked-for value and then the clamped one, which is two revisions for one movement of one
slider.

**The channel strip.** `jig:gain`, `jig:pan`, `jig:muted`, `jig:soloed` on `jig:Node`: host
services rather than plugin parameters, because no `lv2:port` declares them and solo is a
property of the whole graph. The dispatcher resolves solo and the engine never sees it.

**Routing.** Ports on each slot and a connection list derived from `project.connections`,
rather than a node canvas. A canvas loses on both of this project's stated constraints: a drag
between two points is hard to operate from a keyboard, and hit testing a graph at phone width
is a fight the layout loses. Choosing an output and then an input is two ordinary buttons. The
wire between two slots is now drawn only where a connection runs, so a branch is no longer
drawn as a chain.

**Also.** Three of the tools `webmcp.md` specified and nothing had built, and a guard binding
the tool list to that document in both directions. `tests/engine/Engine.test.js`, which did not
exist: the engine had only indirect coverage through a fake that connects nothing, which is
exactly where the parameter endpoint was being lost.

Verified in a browser at each step, which found three defects no test had: a saved mix written
and read correctly and dropped by `addPlugin` on the way back in, two instances of one plugin
sharing one name, and the connection list never being appended at all. All three are in
MISTAKES.md.

## What it found

`native/jigdaw-adapter` is a VST3, built with DPF in the shape downspout uses, that loads
JigDAW plugins by IRI.

It was proposed as a sanity check on the specification and it worked as one immediately: a
native host could not load a JigDAW plugin at all. The only thing the contract guarantees is
a JavaScript `AudioWorklet` module, and the WebAssembly ABI is explicitly private to the
plugin. The specification had accidentally made itself browser-only.

[module-abi.md](module-abi.md) is the answer: a module may declare `jig:abi jig:Abi1` or
`jig:Abi2`, and a
host with a WebAssembly runtime loads it directly. Both worked plugins declare it, every port
now carries a `jig:paramIndex`, and the shapes refuse a plugin that declares an ABI without
one.

## Blocked on a person

In `HUMANS.md`, and unchanged by any amount of building: serving the vocabulary, minting a
web plugin format term, deciding which repository owns `trn:`, and fixing `trn:`
dereferencing. The format term blocks publishing a JigDAW plugin to the catalogue; the rest
block nothing here but leave published IRIs dead.
