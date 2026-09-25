# JigDAW

**A plugin format native to the web.**

A plugin is a dereferenceable IRI. Fetching it is installing it. What comes back says what the
plugin is, what signals it accepts and produces, what it needs from a host, and where its
WebAssembly module, its AudioWorklet processor and its user interface are, each with an
integrity digest. There is no registry, and no install step distinct from having fetched it.

The rest of this repository exists to support the specification: a host that runs the plugins in a
browser, a second host that runs them as a VST3, 14 worked plugins, and a validator that
enforces the specification on its own files.

The specification is published at [danja.github.io/jigdaw](https://danja.github.io/jigdaw/),
rendered from the markdown in [docs/](docs/), which is the authoritative copy.

## Do a GET

```sh
curl -H "Accept: text/turtle" https://strandz.it/jigdaw/plugins/pulse/
```

That is the whole install path. The profile is Turtle, its subject is its own IRI, and every
resource it names carries a `sha384` digest that a host MUST check before running anything.

```turtle
<>
    a jig:WebPlugin , trn:PluginProfile ;
    rdfs:label "Pulse" ;
    trn:role trn:Instrument , trn:AudioInstrument ;
    trn:accepts trn:Midi ;
    trn:produces trn:Audio ;
    trn:requires jig:MidiEvents ;
    jig:audioOutputs 1 ; jig:outputChannels 2 ; jig:latencyFrames 0 ;
    jig:module <#module> ;
    jig:processor <#processor> ;
    lv2:port <#waveform> , <#attack> , <#release> , <#cutoff> , <#gain> .

<#module>
    a jig:Module ;
    jig:location <pulse.wasm> ;
    jig:abi jig:Abi1 ;
    jig:integrity "sha384-g3DvRxgIQlAOtAs4igRA3txWG2twyHsPR5zgZxM2iods9jcnIcPebid0qCDgohrE" .
```

`trn:` says what it is musically, `lv2:` describes its parameters, and `jig:` says what it
takes to run it in a browser. Which vocabulary a statement belongs to is not a detail: the
first two are shared with other projects and only the third is ours.

And it plays. `bin/host.js` is a minimal reference host, in Node, no browser: it loads a
plugin by that same IRI and renders real audio to a WAV file.

```sh
node bin/host.js https://strandz.it/jigdaw/plugins/pulse/ --note 69@0:0.5 --out note.wav
```

The format is not new. It extends the profile vocabulary published at
[plugin-universe.com/about/profiles](https://plugin-universe.com/about/profiles) and already in
use across hundreds of plugins, adding the terms a browser needs to fetch and run one. A profile written
for that catalogue stays valid here.

## The specification

This is the deliverable, and it is normative. RFC 2119 throughout.

| Document | What it governs |
|---|---|
| [host-plugin-contract.md](docs/host-plugin-contract.md) | What a host guarantees and what a plugin must do. The others hang off this one |
| [plugin-profiles.md](docs/plugin-profiles.md) | How to describe a plugin, and how it extends the published format |
| [messaging.md](docs/messaging.md) | The wire format between host, processor and user interface |
| [latency.md](docs/latency.md) | Compensation, and what a graph with feedback does |
| [module-abi.md](docs/module-abi.md) | The optional WebAssembly ABI, for a host with no JavaScript |
| [plugin-bundles.md](docs/plugin-bundles.md) | Sending a plugin as a file, with provenance and signing |
| [plugin-collections.md](docs/plugin-collections.md) | A list of plugins as one Turtle file at one URL, and how a host opens it |
| [project-format.md](docs/project-format.md) | The session graph, which carries plugin IRIs and so stays portable |
| [webmcp.md](docs/webmcp.md) | The tool surface an agent drives a host through |
| [namespace.md](docs/namespace.md) | What `http://purl.org/stuff/jigdaw/` serves and how its terms resolve |

The vocabulary is `vocabs/jigdaw.ttl`, in the namespace `http://purl.org/stuff/jigdaw/`. Every
profile is validated against SHACL Core shapes in `vocabs/shapes.ttl`, which is a gate rather
than a diagnostic: JigDAW ingests profiles from origins it does not control.

```sh
npm run validate -- examples/reference-profile.ttl
```

[examples/](examples/) holds a reference profile, a reference session and a reference
provenance record, each of which validates, and a counterexample for each, each of which
violates every constraint once and must not.

## Writing a plugin

14 worked plugins are in [plugins/](plugins/): a subtractive synth,
a reverb, a compressor/expander/limiter/clipper with a side chain input, a transport-synced
bass line generator and a transport-synced drum pattern generator, all five written in Rust
and compiled to WebAssembly; the
[8-Bit 8asterd](plugins/8b8/README.md), which is the firmware of an
[Arduino driving three AY-3-8910 chips](https://github.com/danja/8bit8asterd) compiled
unedited from C++ and driving a model of those chips; three REAPER JSFX effects converted
by [bin/jsfx-import.js](bin/jsfx-import.js), which run under the shared bytecode interpreter in
[plugins/_jsfx-runtime/](plugins/_jsfx-runtime/) rather than each compiling their own DSP to
WebAssembly; [Tremolo](plugins/tremolo/), which declares no `jig:module` at all, its whole
signal path the AudioWorklet processor, plain JavaScript, which `jig:module` has always
permitted and which nothing exercised until this one; [Boost](plugins/boost/), a gain
stage in C++ meant to be copied rather than shipped: the minimal starting point for a new
WebAssembly plugin, everything in it beyond one line of DSP being ABI wiring;
[Ferrite](plugins/ferrite/), a neural amp model and a cabinet impulse response in series, the
first plugin here depending on a real external crate ([nam-rs](https://github.com/OpenSauce/nam-rs))
rather than hand-writing every line of DSP; [Squelch](plugins/squelch/), a resonant
lowpass that an envelope follower sweeps open on every note, plain JavaScript like Tremolo;
and [Quefrency](plugins/quefrency/), which splits its input through the cepstrum into formants
and harmonics and shifts each independently, the first plugin here with latency to
compensate ([its design](docs/plugins/quefrency-design.md)).
Each is a directory holding a `profile.json`, a build script, the `.wasm`, the processor and a
generated `profile.ttl`. The profile is generated because a digest written by hand goes stale
on the next build, silently.

A plugin that ships no user interface is not degraded. Its panel is generated from its
`lv2:port` declarations, which is why the accessibility rules in
[AGENTS.md](AGENTS.md) are load bearing: one accessible generator makes every plugin
accessible.

[docs/for-plugin-authors.md](docs/for-plugin-authors.md) is the guide, and
[docs/for-hosts.md](docs/for-hosts.md) is the same for anyone implementing the other side.

### Sending one as a file

```sh
node bin/bundle.js plugins/pulse --by https://you.example/#me --key ~/.config/jigdaw/keys/ed25519.json
node bin/verify.js plugins/pulse/pulse.jig --online
```

Two forms, both carrying the canonical IRI: a flattened profile whose locations are `data:`
URIs, which any host already reads, and a `.jig` archive that unpacks into a working plugin
origin. Both carry a provenance record and can carry an Ed25519 signature over a canonical
form of the graph. See [plugin-bundles.md](docs/plugin-bundles.md).

## The reference host

There is a working digital audio workstation in the browser, called **Jiggy**: a plugin rack,
an arbitrary directed graph with cycle refusal and latency compensation, a channel strip,
transport, a catalogue search, sessions that save and reopen as RDF, and a WebMCP surface an
agent can drive. `npm run serve`, then open the page.

**It is here to exercise the specification.** A normative document with no implementation is a
claim about behaviour nobody has, and most of what this project has learned came from the host
refusing to do what the specification said. It is a real DAW and it is not the point of the
repository; if it disappeared, the format would still be the thing.

[architecture.md](docs/architecture.md) covers the layers and why they are where they are. The
separation that matters is that RDF persistence, the project model, the compiled audio graph
and real-time processing never see each other's problems.

## Other hosts

A format with one host is a format with an implementation, not a specification. There are
three that run JigDAW plugins, and a fourth that can be packaged for.

### The native adapter

```sh
./install.sh          # VST3 into ~/.vst3; --all for the CLAP and LV2 too
```

In this repository, C++ over [DPF](https://github.com/DISTRHO/DPF), loading JigDAW plugins by
IRI so a desktop DAW can open them. It was built as a sanity check on the specification and
earned its keep before it made a sound: it could not load a JigDAW plugin at all, because the
only thing the contract guaranteed was a JavaScript `AudioWorklet`. The specification had
accidentally made itself browser-only. [module-abi.md](docs/module-abi.md) is the answer, and
every worked plugin whose module compiles per plugin now declares an ABI. The three converted
from JSFX are the exception: their module is the shared interpreter in
[plugins/_jsfx-runtime/](plugins/_jsfx-runtime/), and an ABI's fixed, no-payload calling
sequence has nowhere to carry the compiled script a native host would need to run one. See
[native/jigdaw-adapter/README.md](native/jigdaw-adapter/README.md).

### Transmission

[Transmission](https://danja.github.io/transmission/), a generative audio workstation for
Linux, hosts JigDAW plugins alongside VST3 ones:
[its JigDAW page](https://danja.github.io/transmission/jigdaw.html) is the documentation.
Adding one to a project is a node typed `trn:JigdawPlugin` carrying a `trn:pluginIri`, and
nothing else; both module ABIs are implemented, port counts are read from the profile rather
than from what the project guessed, and a plugin declaring no `jig:abi` is refused with a
message saying it is private to its JavaScript processor.

It is a different kind of evidence from the adapter. Rather than reimplementing the contract
it links `jigdaw_core`, the portable half of the adapter above, which is the first time
anything outside this repository has consumed it. So it does not independently confirm the
specification, and it does show that the code written to read a profile, verify a digest and
call a module travels, and that a JigDAW plugin runs in an application written for something
else.

It has already sent one defect back. `Profile.cpp` parsed numbers with `std::stof`, which
reads the decimal separator from the global C locale; GTK calls `setlocale(LC_ALL, "")`, so
under a comma-decimal locale every fractional `lv2:default`, `lv2:minimum` and `lv2:maximum`
in every profile parsed as zero. Fixed here and recorded in [MISTAKES.md](MISTAKES.md). A
host nobody here wrote is the only thing that was ever going to find that.

### A WAM host

```sh
node bin/wam.js plugins/pulse
```

[Web Audio Modules](https://www.webaudiomodules.com/) is the existing standard for web-native
plugins, and JigDAW was specified without reference to it. `bin/wam.js` packages a plugin as a
WAM: same profile, same WebAssembly, same processor, with the packaging a WAM 2.0 host expects
generated from the profile. 21 kB, standalone, and it carries the profile's digests, which the
WAM API has no way to express at all.

The other direction works too, under contract section 12, and costs something the contract
states rather than hides. A WAM's entry point is a module the host imports into its own
document, so it runs with the host's privileges and cannot be sandboxed. A foreign plugin is
therefore a separate class, outside sections 9.1 and 11: its container is verified as one
archive, consent is bound to that container's digest, and it is marked wherever it appears.
Supporting none of it still conforms.

`web/foreign/probe.html` is the check, since a service worker is not reachable from a test.
Measured in Chrome: a real Web Audio Module, loaded from a verified container and passing
audio. See [wam.md](docs/wam.md).

## Status

The specification is complete and normative. The browser host implements it and runs all 9
worked plugins; the native adapter fetches, verifies, instantiates and sounds the two that
produce audio, under its own tests; Transmission runs them in a workstation written for VST3. A session saves and reopens carrying the IRIs that make it
portable.
Phases and their state are in [plan.md](docs/plan.md); [TODO.md](TODO.md) is what is open and
[HUMANS.md](HUMANS.md) is the short list of things only a person can do.

```sh
npm install && npm test
```

[README.agents.md](README.agents.md) is the entry point for machine consumers.
[AGENTS.md](AGENTS.md) holds the conventions.
[docs/first-thoughts.md](docs/first-thoughts.md) is the original sketch, kept as written.

## Licence

Apache 2.0. See [LICENSE](LICENSE).
