# Testbed

This page lists what the repository implements and, for each component, which parts of the
specification it exercises. Use it to find a worked example of a clause before writing one,
and to see which clauses nothing yet exercises, listed at the end. Section numbers such as
"contract 3.2" refer to [host-plugin-contract.md](host-plugin-contract.md); the other
documents are named in full.

A component exercises a clause when it is the code that does what the clause says, or the
plugin whose behaviour depends on it. Being covered by a test is a separate question, and
the tests directory answers it.

## Hosts

Four programs load JigDAW plugins, and a fifth packages them for someone else's host.

| Host | What it is | Exercises |
|---|---|---|
| **Jiggy** ([web/app/](../web/app/), [src/](../src/)) | The browser host: tracks and a mixer, a plugin rack with generated panels, an arrangement of MIDI and audio clips against a looping transport, undo and redo, sessions saved as Turtle or zip, a catalogue search, an agent surface. | Most of the contract, sections 1 to 12. [messaging.md](messaging.md) in both directions. [latency.md](latency.md) sections 1, 3 and 4. [project-format.md](project-format.md). [webmcp.md](webmcp.md). [plugin-collections.md](plugin-collections.md) section 3. [wam.md](wam.md), loading a WAM as a foreign plugin. |
| **Reference host** ([bin/host.js](../bin/host.js), [src/host/ReferenceHost.js](../src/host/ReferenceHost.js)) | Loads a chain of plugins by IRI, or from a local directory, in Node, and renders it to a WAV file. No browser. | Contract 3.1 end to end, including integrity (3.2) and compiling inside the processor (3.3), through [src/testing/OfflineHost.js](../src/testing/OfflineHost.js), which runs the real processor code. |
| **JigDAW Adapter** ([native/jigdaw-adapter/](../native/jigdaw-adapter/README.md)) | A VST3, CLAP and LV2 plugin, built with DPF, with a second shell in JUCE. It loads a chain of JigDAW plugins by IRI and runs their WebAssembly directly, with no JavaScript. | [module-abi.md](module-abi.md) versions 1 and 2, including splitting a block larger than `jig_max_frames`. Contract 1.1 and 1.2 (fetch by IRI), 3.2 (integrity). It is an independent reading of the profile format, with its own Turtle parser. |
| **REAPER render script** ([reaper/jigdaw-render.lua](../reaper/README.md)) | A ReaScript that asks for plugin IRIs and notes, drives the reference host, and drops the rendered WAV onto a new track. Not yet run against a real REAPER. | Nothing beyond the reference host; it is a route into it. |
| **WAM export** ([bin/wam.js](../bin/wam.js), [src/wam/WamModule.js](../src/wam/WamModule.js)) | Packages a JigDAW plugin as a Web Audio Module 2.0, so a WAM host can load it. | [wam.md](wam.md), "The other direction". Contract 3.1, 3.2 and 9.1 as a WAM host sees them. |

## Plugins

There are 15 worked plugins in [plugins/](../plugins/), each a directory holding
`profile.json`, a build script, the processor and a generated `profile.ttl`. They were
written to cover different parts of the contract, and each one's row says which.

| Plugin | What it is | Exercises |
|---|---|---|
| [Pulse](../plugins/pulse/) | An eight voice subtractive synthesiser, in Rust. MIDI in, audio out. | Module ABI version 1 with its note exports. Contract 4.2, an instrument with no audio input. Contract 6, incoming events located by stream position, with a bounded queue that reports `dropped` (6.3, messaging.md 1.4). |
| [Cascade](../plugins/cascade/) | A Schroeder plate reverb, in Rust, and the worked example the others are compared with. | Module ABI version 1. Contract 5.3, widgets following the declaration's shape: a scale point enumeration drawn as a selector and a toggled port drawn as a switch. The native adapter's chain tests load it. |
| [Dynamix](../plugins/dynamix/) | A compressor/expander, limiter and clipper in series, in Rust, with an external key input. | Contract 4.2, two audio inputs, the second a sidechain that is optional when unconnected. 14 parameters under module ABI version 1. |
| [BassGen](../plugins/bassgen/) | A bass line generator in time with the session, in Rust. MIDI in, MIDI out, no audio. | Module ABI version 2: MIDI out, the transport block and its `valid` bits, and zero audio outputs, which a browser host must keep rendered anyway. Contract 6 outgoing events (`jig:MidiOut`) and contract 7, transport. |
| [DrumGen](../plugins/drumgen/) | A drum pattern generator in time with the session, in Rust, ported from the downspout VST3 of the same name. Control MIDI in, drum MIDI out, no audio. | Module ABI version 2 with MIDI in carrying control changes only (`trn:ControlMidi`, the Conductor CC map), 21 parameters with trigger ports fired on the rising edge, and loop-boundary mutation under transport. |
| [DrumKit](../plugins/drumkit/) | A synthesised drum instrument in Rust, ported from the downspout VST3 of the same name. Drum MIDI in, stereo audio out. | Module ABI version 2 with MIDI in as whole frame-stamped event records interleaved per sample, 75 parameters, and the first instrument with per-voice mute switches drawn from `lv2:toggled`. |
| [8-Bit 8asterd](../plugins/8b8/README.md) | Unmodified firmware for three AY-3-8910 chips, compiled from C++. | Module ABI version 2 MIDI in, as whole event records. 42 parameters, generated from the firmware's own list, with scale points and values shown as the device's panel shows them. Parameters that also answer to MIDI CCs. |
| [Boost](../plugins/boost/) | A gain stage in C++, meant to be copied: everything beyond one line of DSP is ABI wiring. | Module ABI version 1 at its smallest. `trn:Utility`. |
| [Ferrite](../plugins/ferrite/) | A neural amp model in series with a convolution cabinet, in Rust, depending on nam-rs. | Two `jig:asset` resources marked `jig:userReplaceable`, verified like the module (contract 3.2) and replaced while running (messaging.md 1.2, `asset`). State (contract 8, messaging.md `stateRequest` and `state`): the only plugin that answers a state request. |
| [JigDAW Gain Trim](../plugins/jsfx-gain-trim/), [One-Pole Filter](../plugins/jsfx-one-pole-filter/), [Soft Clipper](../plugins/jsfx-soft-clipper/) | Three REAPER JSFX effects converted by `bin/jsfx-import.js`, run by the shared bytecode interpreter in [plugins/_jsfx-runtime/](../plugins/_jsfx-runtime/README.md). | A module with no `jig:abi`, private to its processor, which module-abi.md says a native host must refuse. The compiled script carried as a `jig:asset`. Converting from another plugin format. |
| [Tremolo](../plugins/tremolo/) | A sine tremolo in plain JavaScript, with no WebAssembly module. | `jig:module` being optional. The only plugin with its own `jig:ui`: a sandboxed frame on another origin (contract 9.1) speaking messaging.md section 2, with `ready`, `parameter`, `gesture` and `resize`. |
| [Squelch](../plugins/squelch/) | A resonant lowpass swept by an envelope follower, in plain JavaScript. | A second plugin with no module, and the one the "acid bass line" preset chains after BassGen and Pulse. |
| [Quefrency](../plugins/quefrency/) | A cepstral formant and pitch shifter, in Rust ([design](../docs/plugins/quefrency-design.md)). | [latency.md](latency.md) sections 1 and 3: the only plugin with latency, reported in `ready` for the actual sample rate. Module ABI version 2 MIDI in on an audio effect, taking `trn:ControlMidi`. The host's rule that a plugin taking only control changes gets no keyboard or clip. |

[plugins/_jsfx-runtime/](../plugins/_jsfx-runtime/README.md) is not a plugin itself: it is the
interpreter the three converted JSFX plugins copy.

## Host components, by layer

These are the modules the hosts are built from, in the layers
[architecture.md](architecture.md) describes. Each is named with the clauses it implements.

### Loading a plugin

- [PluginLoader.js](../src/host/PluginLoader.js): contract 3.1 in order, stopping at the first
  failure; dereferences the IRI (1.2).
- [Capabilities.js](../src/host/Capabilities.js): contract 2, every `trn:requires` answered
  before any code is fetched, including shared memory (2.3).
- [Integrity.js](../src/host/Integrity.js): contract 3.2, every fetched resource checked against
  its digest before use.
- [Instantiate.js](../src/host/Instantiate.js): contract 3.1 steps 4 to 8, from fetch to
  `ready` (messaging.md 1.3).
- [Parameters.js](../src/host/Parameters.js): contract 5.1, processor descriptors and panel
  controls derived from one `lv2:port` declaration.
- [LoadError.js](../src/host/LoadError.js) and [Inspections.js](../src/host/Inspections.js):
  contract 10.1, a failure names its step; 10.3, load outcomes recorded as `jig:Inspection`.
- [StateCodec.js](../src/host/StateCodec.js): contract 8.2, a plugin's state as the string
  literal `jig:nodeState`.
- [PluginCheck.js](../src/host/PluginCheck.js): a pre-publish check that a plugin's code produces
  bounded audio, beyond what validation and digests can say.

### Foreign plugins

- [ForeignLoader.js](../src/host/ForeignLoader.js), [ForeignOrigin.js](../src/host/ForeignOrigin.js)
  and [web/foreign/sw.js](../web/foreign/sw.js): contract 12.3, one verified container served
  from a virtual origin.
- [ForeignTrust.js](../src/host/ForeignTrust.js): contract 12.4, consent per plugin and per
  container.
- [ForeignPlugin.js](../src/host/ForeignPlugin.js), [ForeignSupport.js](../src/host/ForeignSupport.js)
  and [WamAdapter.js](../src/wam/WamAdapter.js): contract 12 end to end, a WAM driven like a
  native plugin (12.6).

### The model and its operations

- [Project.js](../src/model/Project.js): the session as [project-format.md](project-format.md)
  describes it, with editor metadata kept apart from execution metadata.
- [Endpoints.js](../src/model/Endpoints.js): which ports a node has, so the interface and the
  dispatcher refuse the same impossible connections.
- [OpDispatcher.js](../src/ops/OpDispatcher.js): contract 9.3, every operation once, for the
  editor and the agent surface alike. Also the host end of messaging.md 2.3 and 2.4.
- [UndoHistory.js](../src/ops/UndoHistory.js) and [OpenProject.js](../src/ops/OpenProject.js):
  undo and redo; opening a saved session or a preset through one sequence.

### RDF

- [ProfileReader.js](../src/rdf/ProfileReader.js): a profile as a plain object, including the
  widget each port gets (contract 5.3) and foreign declarations (12.2).
- [ProjectReader.js](../src/rdf/ProjectReader.js) and
  [ProjectWriter.js](../src/rdf/ProjectWriter.js): [project-format.md](project-format.md) in
  both directions.
- [CollectionReader.js](../src/rdf/CollectionReader.js): [plugin-collections.md](plugin-collections.md)
  section 1.
- [Canonical.js](../src/rdf/Canonical.js) and [ProvenanceDocument.js](../src/rdf/ProvenanceDocument.js):
  [plugin-bundles.md](plugin-bundles.md) section 5, the canonical form a digest and a
  signature are taken over.
- [ProfileJsonLd.js](../src/rdf/ProfileJsonLd.js): the profile a plugin's own interface is sent
  in `init` (messaging.md 2.2).
- [Vocabulary.js](../src/rdf/Vocabulary.js): every IRI the code names.

### Compiling and playing

- [GraphCompiler.js](../src/compiler/GraphCompiler.js): [latency.md](latency.md) sections 3 and
  4, compensating delay on parallel paths and refusing a cycle with no delay in it.
- [Engine.js](../src/engine/Engine.js): one `AudioWorkletNode` per plugin; contract 10.2, a
  failed plugin muted while the rest keep playing.
- [EventRouter.js](../src/engine/EventRouter.js): contract 6.1, MIDI carried by the host
  between processors.
- [Scheduler.js](../src/engine/Scheduler.js): contract 6.2, clip notes sent ahead at absolute
  stream positions.
- [Transport.js](../src/engine/Transport.js): contract 7, frames, seconds and beats across a
  tempo map.
- [ClipPlayer.js](../src/engine/ClipPlayer.js): audio clips, on the message thread.

### Interface

- [Panel.js](../src/ui/Panel.js) and [Dial.js](../src/ui/Dial.js): contract 9.1, the generated
  panel every plugin without a `jig:ui` gets, and the project's accessibility rules.
- [PluginFrame.js](../src/ui/PluginFrame.js): contract 9 and messaging.md section 2, a plugin's
  own interface in a sandboxed cross-origin frame, with origin checking (2.1).
- [Routing.js](../src/ui/Routing.js), [Keyboard.js](../src/ui/Keyboard.js),
  [PianoRoll.js](../src/ui/PianoRoll.js), [Timeline.js](../src/ui/Timeline.js),
  [Mixer.js](../src/ui/Mixer.js) and [Strip.js](../src/ui/Strip.js): connections, the
  on-screen keyboard, clip editing, the arrangement and the channel strips.

### Catalogue and agents

- [Catalogue.js](../src/catalogue/Catalogue.js), [QueryService.js](../src/catalogue/QueryService.js)
  and [LocalCatalogue.js](../src/catalogue/LocalCatalogue.js): search across this host's own
  plugins and plugin-universe's public SPARQL endpoint, with every query in a file under
  [sparql/queries/](../sparql/queries/).
- [CollectionLoader.js](../src/catalogue/CollectionLoader.js): [plugin-collections.md](plugin-collections.md)
  section 3, a collection refused whole or checked member by member, with no code fetched.
- [tools.js](../src/mcp/tools.js) and [adapter.js](../src/mcp/adapter.js): [webmcp.md](webmcp.md),
  the agent tool surface over the dispatcher.
- [BridgeServer.js](../src/mcp/BridgeServer.js), [BridgeClient.js](../src/mcp/BridgeClient.js)
  and [LocalAgent.js](../src/mcp/LocalAgent.js): webmcp.md's local bridge, and a local model
  driving the same surface.

### Converting from other formats

- [src/jsfx/](../src/jsfx/): a JSFX header parser, an EEL2 parser and a compiler to the shared
  interpreter's bytecode, and the processor template for a converted plugin.
- [bin/juce-params-to-profile.js](../bin/juce-params-to-profile.js): a JUCE plugin's parameter
  dump turned into profile ports ([for-juce-developers.md](for-juce-developers.md)).

## Tools

| Tool | What it does | Exercises |
|---|---|---|
| `npm run validate` ([bin/validate.js](../bin/validate.js)) | Validates RDF against [vocabs/shapes.ttl](../vocabs/shapes.ttl). | [plugin-profiles.md](plugin-profiles.md), "Validating". |
| [bin/write-profile.js](../bin/write-profile.js) | Generates `profile.ttl` from `profile.json`, with digests of the files on disk and every resource and scale point named. | Contract 3.2; plugin-profiles.md, "Resources are named, never blank". |
| `npm run check-wasm-abi` ([bin/check-wasm-abi.js](../bin/check-wasm-abi.js)) | Reads a compiled module's import section. | module-abi.md calling sequence step 1: no imports. |
| `npm run check-plugin` ([bin/check-plugin.js](../bin/check-plugin.js)) | Renders a plugin and reports whether it produced bounded audio. | What validation cannot: that the code does something. |
| [bin/bundle.js](../bin/bundle.js), [bin/verify.js](../bin/verify.js), [bin/keys.js](../bin/keys.js) | Make a flattened profile and a `.jig` archive, open one and say what is known about it, and manage a signing key. | [plugin-bundles.md](plugin-bundles.md) sections 2, 4, 5 and 6. |
| `npm run build:index` ([bin/build-plugin-index.js](../bin/build-plugin-index.js)) | Generates `plugins/index.json` and the collection [web/collections/jigdaw.ttl](../web/collections/jigdaw.ttl) from the profiles on disk. | [plugin-collections.md](plugin-collections.md) section 2. |
| `npm run serve` ([bin/serve.js](../bin/serve.js)) | A development server that serves what a host and a plugin origin must, including CORS. | Contract 1.3. |
| [bin/build-vocab-site.js](../bin/build-vocab-site.js), [deploy/](../deploy/) | The vocabulary's human-readable page, and the nginx configuration that serves the namespace. | [namespace.md](namespace.md). |
| `npm run mcp-bridge` ([bin/mcp-bridge.js](../bin/mcp-bridge.js)) | An MCP endpoint on loopback whose tools run in an open Jiggy page. | [webmcp.md](webmcp.md), "The local bridge". |
| [bin/jsfx-import.js](../bin/jsfx-import.js) | Converts a JSFX effect into a JigDAW plugin. | Contract 3.1 for a generated processor. |
| [bin/wam-fixtures.js](../bin/wam-fixtures.js) | Builds what the foreign plugin probe page needs. | Contract 12, in a real browser. |
| [bin/check-suites.js](../bin/check-suites.js) | Fails when a test directory is missing from the vitest include list. | A guard on the tests themselves. |

## Reference documents

- [examples/](../examples/): a reference document and a counterexample for each kind the
  shapes check: a profile, a foreign plugin, a collection, a provenance record and a project.
  A reference must validate and a counterexample must violate every constraint once, which
  is how a constraint that never fires is found.
- [examples/session-project.ttl](../examples/session-project.ttl) and
  [web/presets/](../web/presets/): sessions in [project-format.md](project-format.md), opened
  through the same code as a saved file.
- [vocabs/jigdaw.ttl](../vocabs/jigdaw.ttl) and [vocabs/shapes.ttl](../vocabs/shapes.ttl): the
  vocabulary and the SHACL shapes. Where they and the contract disagree, the contract governs.

## What nothing exercises yet

These clauses are specified and, as of 2026-09-25, either no plugin depends on them or no host
acts on them. Each is a place where the specification is untested by use.

- **A latency change** ([latency.md](latency.md) section 2). No plugin changes its latency, and
  Jiggy does not act on a `latency` message: it compensates from `ready` alone. Only
  [WamModule.js](../src/wam/WamModule.js) reads one.
- **Tails** ([latency.md](latency.md) section 5). Every processor reports `tailFrames: null`, and
  no profile declares `jig:tailFrames`.
- **Latency outside a browser.** The module ABI carries no latency, so the native adapter
  cannot tell its host about Quefrency's 2047 frames.
- **Shared memory** (contract 2.3). The host offers `jig:SharedMemory`; no plugin requires it.
- **The opaque relay** (messaging.md 2.4). The host side exists; no plugin's interface uses it.
- **Audio-rate parameters** (contract 5.2). No plugin declares a port `a-rate`.
- **State from more than one plugin** (contract 8). Ferrite is the only plugin that answers a
  state request.
- **MIDI from outside the page.** Jiggy has no Web MIDI input, so notes come from the on-screen
  keyboard and clips, and control changes only from another plugin's MIDI output.
