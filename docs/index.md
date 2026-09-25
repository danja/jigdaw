# The JigDAW plugin system

A plugin is a URL. Dereference it and it runs, in a browser, with no installation step
distinct from having fetched it.

A native plugin has an identity, some metadata and a delivery mechanism, and they are three
separate things: a class ID, a catalogue entry, an installer. JigDAW collapses them into one
IRI. Ask that IRI for `text/turtle` and you get a description of what the plugin is, what
signals it takes and produces, what it needs from a host, and where its WebAssembly lives.
Fetch that, and it plays.

```sh
curl -H 'Accept: text/turtle' https://strandz.it/jigdaw/plugins/cascade/
```

## Where to go

- **[for-hosts.md](for-hosts.md)**: you are writing a host and want to load other people's
  plugins. What you must do, in what order, and what the browser will refuse.
- **[for-plugin-authors.md](for-plugin-authors.md)**: you have some DSP and want it loadable
  anywhere. Writing a profile, building the WebAssembly, and publishing it so it can be found.
- **[for-juce-developers.md](for-juce-developers.md)**: you already have a JUCE plugin and
  want it loadable by IRI too. What has to be ported by hand, and what is generated from your
  existing parameter layout instead.

## How a plugin is described

A profile is RDF, written in three vocabularies. Which one a statement belongs to is not a
detail: it is what lets the same description serve a browser, a native host and a catalogue
without any of them agreeing in advance.

| Vocabulary | Says | Example |
|---|---|---|
| `trn:` | What the plugin *is*, musically: its role, the signals it accepts and produces, what it pairs with | `trn:role trn:AudioEffect` |
| `jig:` | What it takes to *run* it in a browser: the module, the processor, integrity digests, host capabilities | `jig:module <cascade.wasm>` |
| `lv2:` | Its *parameters*: symbols, ranges, units, scale points | `lv2:minimum 0.0` |

The musical half is the [transmissions vocabulary](https://plugin-universe.com/ns), shared
with several native projects, so a JigDAW plugin is a valid entry in an existing catalogue
rather than a new kind of thing. The parameters are plain
[LV2](https://lv2plug.in/ns/lv2core), which is why an LV2 plugin's port descriptions map in
without translation. Only the middle row is ours, and it is published at
[http://purl.org/stuff/jigdaw/](http://purl.org/stuff/jigdaw/).

`jig:WebPlugin` is a subclass of `trn:PluginProfile`, not a replacement for it. An existing
catalogue entry becomes loadable by adding statements, never by being rewritten, and a
profile describing a native-only plugin stays valid. It is simply not installable in a
browser.

## What a plugin is made of

| Part | Role |
|---|---|
| **A profile** | RDF served at the plugin's own IRI. Identity, meaning and the links to everything else. |
| **A processor** | A JavaScript module registering an `AudioWorkletProcessor`. The only plugin code on the audio thread. |
| **A module** | WebAssembly doing the signal processing. Optional, but the point. |
| **A user interface** | Optional. Without one, a host generates a panel from the declared parameters, which is the expected case rather than a degraded one. |

A module need not be built freshly for every plugin. `plugins/_jsfx-runtime/` is one module,
a small interpreter, that every REAPER JSFX effect `bin/jsfx-import.js` converts runs under;
the plugin-specific part is a compiled script delivered as a `jig:asset`, not a second
WebAssembly build. See [for-plugin-authors.md](for-plugin-authors.md).

## The specifications

These are normative and use RFC 2119 keywords. They live in this directory and are the
authority where any other page, including this one, disagrees with them.

| Document | Covers |
|---|---|
| [host-plugin-contract.md](host-plugin-contract.md) | What a host guarantees and what a plugin must do. Everything else hangs off it. |
| [plugin-profiles.md](plugin-profiles.md) | The profile format, as an extension of the one already published. |
| [messaging.md](messaging.md) | The messages between host, processor and user interface. |
| [latency.md](latency.md) | Latency compensation, and what happens in a graph with feedback. |
| [project-format.md](project-format.md) | The session graph: nodes, connections, settings, transport. |
| [webmcp.md](webmcp.md) | The agent tool surface. |
| [namespace.md](namespace.md) | What the vocabulary IRIs serve, and why a term answers 303. |
| [architecture.md](architecture.md) | The layers, and the reasoning behind each decision. |
| [module-abi.md](module-abi.md) | The optional portable ABI a native host can load without a JavaScript engine. |
| [plugin-bundles.md](plugin-bundles.md) | Packaging a plugin as one signed archive. |
| [plugin-collections.md](plugin-collections.md) | Publishing a list of plugins at one URL, and what a host checks when opening it. |

Background rather than normative: [plan.md](plan.md) is the phased build log,
[first-thoughts.md](first-thoughts.md) and [local-references.md](local-references.md) are
where the design came from, [deployment.md](deployment.md) and [wam.md](wam.md) cover
running and interoperating with it, and [revisions.md](revisions.md) is a dated log of what
has changed in the vocabulary and the specification since they were first published.

## Where this has got to

Honestly, because a specification that overstates itself is worse than none.

**Works.** Loading a plugin from its IRI, profile validation, integrity verification,
WebAssembly instantiation, generated panels, parameter automation, MIDI routed by the host,
transport, latency compensation, cycle refusal, undo and redo, a catalogue search, and an
agent tool surface. 14 worked plugins: a subtractive synth, a bass line generator, a
reverb, a compressor/expander/limiter/clipper with a side chain input, the firmware of a
three-chip AY-3-8910 synthesiser compiled unedited from C++, three REAPER JSFX effects
converted by `bin/jsfx-import.js`, a tremolo with no WebAssembly module, its signal path
plain JavaScript, a minimal gain stage in C++ meant to be copied as a starting point for a
new one, a neural amp model in series with a cabinet impulse response, the first plugin
here depending on a real external crate, and a resonant lowpass swept by an envelope
follower, also plain JavaScript, a cepstral formant and pitch shifter, the first with
latency, and a transport-synced drum pattern generator. Foreign plugins (Web Audio Modules) load and play, marked
and consented to, per contract section 12.

**Exists but is thin.** Jiggy, the reference host: tracks, each a chain of plugins ending in
a fader, with a mixer of one strip per track; an arrangement of MIDI clips edited in a piano
roll and audio clips imported from disk, played against a looping transport; a plugin's own
editor in a sandboxed frame on its own origin, beside the panel generated from its parameters;
sessions saved as Turtle, or as a zip with their audio beside them. There is no recording and
no automation yet.

## Worked examples

Built from this repository and served by this host. **[strandz.it/jigdaw](https://strandz.it/jigdaw/)**
runs Jiggy live, the same code as in this repository. A second, independent host
loads the same plugins as a VST3, CLAP or LV2; see
[the JigDAW Adapter](../native/jigdaw-adapter/README.md) for what it is and how to build it.

| Plugin | What it is |
|---|---|
| [Cascade](../plugins/cascade/) | A Schroeder plate reverb. Audio in, audio out, five parameters including a freeze. |
| [Pulse](../plugins/pulse/) | An eight voice subtractive synthesiser. MIDI in, audio out. |
| [Quefrency](../plugins/quefrency/) | Formants and harmonics separated through the cepstrum and shifted independently. [Design](../docs/plugins/quefrency-design.md). |
| [Dynamix](../plugins/dynamix/) | A compressor/expander, limiter and clipper in series, with a side chain input. |
| [JigDAW Gain Trim](../plugins/jsfx-gain-trim/) | A one-slider gain stage converted from a REAPER JSFX effect. |

---

JigDAW is Apache 2.0. The source and the specifications are at
[github.com/danja/jigdaw](https://github.com/danja/jigdaw).
