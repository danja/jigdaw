# The portable module ABI

**Version:** 1 (`jig:Abi1`)
**Status:** normative for a module that declares it. Declaring it is optional.

A JigDAW plugin's processor is JavaScript. A browser can therefore always run one, and
nothing else can: a native host has no `AudioWorklet` and no JavaScript engine, and
[host-plugin-contract.md](host-plugin-contract.md) deliberately leaves what the processor and
the module say to each other as the plugin author's business.

That made a JigDAW plugin browser-only, which was never the intention. It was found by
writing a VST3 host and discovering there was no way in.

A module MAY therefore declare that it implements a published ABI:

```turtle
<#module> a jig:Module ;
    jig:location <pulse.wasm> ;
    jig:abi jig:Abi1 ;
    jig:integrity "sha384-…" .
```

A host with a WebAssembly runtime can then load the module directly and skip the processor.
The processor is still what a browser uses, so declaring an ABI costs a plugin nothing and
loses it nothing. A module without `jig:abi` is private to its processor, and a host with no
JavaScript engine MUST refuse it with a message saying so rather than guessing at its
exports.

## Exports

A module declaring `jig:Abi1` MUST export the following. Every pointer is a byte offset into
the module's own `memory`, and every buffer is one channel: nothing is interleaved.

| Export | Signature | Meaning |
|---|---|---|
| `memory` | | The module's linear memory |
| `jig_init` | `(f32) -> ()` | Prepare for a sample rate. Called once before anything else |
| `jig_max_frames` | `() -> u32` | The largest `frames` `jig_process` will accept |
| `jig_output_ptr` | `(u32) -> u32` | Pointer to the output buffer for a channel |
| `jig_process` | `(u32) -> ()` | Process that many frames |
| `jig_set_param` | `(u32, f32) -> ()` | Set a parameter by its `jig:paramIndex` |

Conditionally required:

| Export | Required when | Meaning |
|---|---|---|
| `jig_input_ptr` | `jig:audioInputs > 0` | Pointer to the input buffer for a channel |
| `jig_note_on` | the plugin accepts MIDI | `(u8 note, u8 velocity)` |
| `jig_note_off` | the plugin accepts MIDI | `(u8 note)` |
| `jig_all_notes_off` | SHOULD, if it accepts MIDI | Silence everything |

A module MAY export more. A host MUST ignore what it does not know.

## Parameters are addressed by index

`jig_set_param` takes an index, and every `lv2:port` on a plugin declaring an ABI MUST carry
a `jig:paramIndex`:

```turtle
<#gain> a lv2:InputPort , lv2:ControlPort ;
    lv2:symbol "gain" ; lv2:name "Gain" ;
    lv2:default 0.3 ; lv2:minimum 0.0 ; lv2:maximum 1.0 ;
    jig:paramIndex 4 .
```

The index is declared rather than inferred from the order ports appear in the profile,
because that order is a property of the document and not of the module. Serialising the same
graph differently would silently rebind every control. `vocabs/shapes.ttl` refuses a plugin
that declares an ABI and omits an index.

Indices SHOULD be contiguous from zero. A host MUST NOT assume they are.

## The calling sequence

1. Instantiate the module with no imports. A module declaring this ABI MUST NOT require any.
2. Call `jig_init(sampleRate)`.
3. Read `jig_max_frames()` and never pass more than that to `jig_process`.
4. Take the input and output pointers **once** and keep them.
5. Per block: write inputs, set any changed parameters, deliver any MIDI, call
   `jig_process(frames)`, read outputs.

**A module MUST NOT grow its memory after `jig_init`.** A host is entitled to hold the
pointers and the views it took at step 4, and growing invalidates every one of them. In a
browser the symptom is silence rather than an exception; in a native host it is a read into
a buffer that has moved.

A host SHOULD set a parameter only when its value has changed. Some plugins retune delay
lines on a parameter write, and doing that every block is wasteful at best.

## What this ABI does not carry

No state serialisation, no host transport, no outgoing MIDI, no latency reporting. Those are
`jig:` profile statements or processor messages, and a plugin needing them in a native host
is using more than version 1 offers. A later version may add them; this one is deliberately
the smallest thing that makes a plugin loadable outside a browser.

## An implementation

`native/jigdaw-adapter` is a VST3 that loads JigDAW plugins by IRI using this ABI, and it is
the reason the ABI exists. Both worked plugins declare it, and
[plugins.html](https://strandz.it/jigdaw/docs/plugins.html) recommends that yours does too.
