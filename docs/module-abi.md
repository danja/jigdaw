# The portable module ABI

**Versions:** 1 (`jig:Abi1`) and 2 (`jig:Abi2`)
**Status:** normative for a module that declares one. Declaring one is optional.

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
   `npm run check-wasm-abi -- your.wasm` checks this statically, against the module's own
   compiled bytes, before any host tries to instantiate it
   ([src/validate/WasmAbi.js](https://github.com/danja/jigdaw/blob/main/src/validate/WasmAbi.js)).
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

### A host splits a block that is too large

Step 3 says a host never passes more than `jig_max_frames()`. That leaves what to do with a
larger block implied, and implied was not enough: `Chain::process` in this repository rendered
`min(frames, jig_max_frames())` and left the rest of the host's buffer as it found it. Every
worked plugin reports 128 and a DAW runs at 256 or more, so three quarters of every block at
512 was stale. So it is stated.

**A host given a block larger than `jig_max_frames()` MUST process it in sub-blocks of at most
that many frames, and MUST NOT render only part of it.** For each sub-block, in this order:

1. Fill in the transport for the position that sub-block starts at, not for the block. A host
   that writes the block's transport once has told the module the same wrong thing several
   times.
2. Deliver the events whose frames fall within that sub-block, **rebased onto it**. An event
   carries its offset within the block it is being given, and after splitting that is no
   longer its offset within the host's block.
3. Write the input slice, call `jig_process(n)`, read the output slice.
4. Read any outgoing events and rebase them **back** onto the host's block, by adding the
   sub-block's offset, before handing them on.

A host MUST advance only the transport fields it was given. Deriving a bar number from a beat
the host never supplied invents one, and `valid` exists to say which fields are real.

## What version 1 does not carry

No state serialisation, no host transport, no outgoing MIDI, no latency reporting. Those are
`jig:` profile statements or processor messages, and a plugin needing them in a native host
is using more than version 1 offers. Version 1 is deliberately the smallest thing that makes
a plugin loadable outside a browser.

Version 2 adds the transport and the MIDI, below. State serialisation and latency reporting
are still out.

# Version 2

`jig:Abi2` is everything version 1 requires, plus three facilities version 1 left out:

- MIDI arriving as whole frame stamped messages rather than note on and note off alone
- MIDI leaving the module the same way
- a host transport carrying tempo, meter, and bar, beat and tick

Each is optional and declared by the profile. **A module that declares `jig:Abi2` and uses
none of them is a version 1 module under another name**, and a host that implements version 2
implements version 1, so nothing already published is affected.

It exists because a MIDI generator could not be written at all under version 1. It had
nothing to emit through, and no transport to be in time with.

## Audio is optional in version 2

A plugin MAY declare `jig:audioOutputs 0`, and then `jig_output_ptr` is not required and MUST
NOT be called. A pure MIDI generator has no audio to produce, and version 1 had no way to say
so. A host MUST still call `jig_process` for such a plugin each block, because that is when
it generates its MIDI, and MUST leave the audio passing through it untouched.

**In a browser this takes work rather than nothing.** Web Audio pulls from the destination, so
an `AudioWorkletNode` with no outputs and no inputs is attached to nothing and its `process`
is never called: the plugin would load, report ready, and silently never run. A host MUST keep
such a node rendered. JigDAW gives it one input and feeds it silence, which the module neither
sees nor needs to know about. A native host has no such problem, which is exactly why this is
worth writing down: it works on the first host it is tried on.

## Events

Both MIDI directions use one fixed record of **8 bytes**, little endian, with no padding
between records:

| Offset | Type | Meaning |
|---|---|---|
| 0 | `u32` | `frame`, the offset within the block this event happens at |
| 4 | `u8` | `size`, 1 to 3 |
| 5 | `u8` | `data0`, the status byte |
| 6 | `u8` | `data1` |
| 7 | `u8` | `data2` |

Events with `size` outside 1 to 3 MUST be ignored. System exclusive is not carried: it does
not fit in three bytes and no JigDAW plugin has needed it. A later version may add it.

`frame` is an offset within the block being processed, and is meaningless once that block has
passed. It is not a stream position. A host MUST NOT hand over an event whose `frame` is
greater than or equal to the `frames` it is about to process.

## MIDI in

Required when the plugin declares `trn:accepts` a MIDI signal type and declares `jig:Abi2`:

| Export | Signature | Meaning |
|---|---|---|
| `jig_midi_in_ptr` | `() -> u32` | Where the host writes incoming events |
| `jig_midi_in_capacity` | `() -> u32` | How many events fit there |
| `jig_midi_in` | `(u32 count) -> ()` | That many events have been written |

The host writes at most `jig_midi_in_capacity()` events at `jig_midi_in_ptr()`, then calls
`jig_midi_in(count)`, then calls `jig_process`. Events MUST be in ascending `frame` order. A
host with more events than fit MUST deliver the earliest and drop the rest, because dropping
the earliest would turn a note on into an orphaned note off.

A module declaring `jig:Abi2` MAY also export the version 1 `jig_note_on`, `jig_note_off` and
`jig_all_notes_off`. A host that finds both MUST use the event buffer and MUST NOT also
deliver the same events as notes, or every note will sound twice.

## MIDI out

Required when the plugin declares `trn:produces` a MIDI signal type and declares `jig:Abi2`:

| Export | Signature | Meaning |
|---|---|---|
| `jig_midi_out_ptr` | `() -> u32` | Where the module writes outgoing events |
| `jig_midi_out_capacity` | `() -> u32` | How many events fit there |
| `jig_midi_out_count` | `() -> u32` | How many were written by the last `jig_process` |

The module writes events during `jig_process` and the host reads `jig_midi_out_count()`
immediately after it returns. **The count describes the block that just ran and nothing
else.** A module MUST reset it at the start of every `jig_process`, including a block in
which it emits nothing, or the host will replay the previous block's notes for ever.

Events SHOULD be in ascending `frame` order. A module MUST NOT write more than
`jig_midi_out_capacity()` of them.

A plugin that produces MIDI MUST declare `trn:requires jig:MidiOut`. Without it a host has
not agreed to collect anything and the output goes nowhere, which is the same bargain
`jig:MidiEvents` makes in the other direction.

## Transport

Required when the plugin declares `trn:requires trn:HostTransport` and declares `jig:Abi2`:

| Export | Signature | Meaning |
|---|---|---|
| `jig_transport_ptr` | `() -> u32` | A 64 byte block the host fills in before each `jig_process` |

A block rather than an argument list, because a transport grows new fields and a signature
cannot. The layout is little endian, and every `f64` is 8 byte aligned:

| Offset | Type | Field | Meaning |
|---|---|---|---|
| 0 | `u32` | `playing` | 1 while the transport is rolling, 0 otherwise |
| 4 | `u32` | `ticksPerBeat` | The host's tick resolution, 0 when it has none |
| 8 | `f64` | `bpm` | Beats per minute |
| 16 | `f64` | `beat` | Quarter notes since the start of the timeline, fractional |
| 24 | `f64` | `barStartBeat` | The `beat` at which the current bar began |
| 32 | `i32` | `bar` | Bar number, counting from 1 |
| 36 | `i32` | `beatInBar` | Beat within the bar, counting from 1 |
| 40 | `i32` | `tick` | Tick within the beat, from 0 to `ticksPerBeat` minus 1 |
| 44 | `i32` | `numerator` | Time signature numerator, the beats in a bar |
| 48 | `i32` | `denominator` | Time signature denominator, the note value of a beat |
| 52 | `u32` | `valid` | Which fields below are meaningful: see next |
| 56 | `f64` | `seconds` | Seconds since the start of the timeline |

`valid` is a bit field, because hosts differ in what they know and a zero is not
distinguishable from a genuine zero:

| Bit | Meaning |
|---|---|
| 1 | `bpm` is meaningful |
| 2 | `beat` and `barStartBeat` are meaningful |
| 4 | `bar`, `beatInBar` and `tick` are meaningful |
| 8 | `numerator` and `denominator` are meaningful |
| 16 | `seconds` is meaningful |

**A module MUST check `valid` before using a field.** A host that has tempo but no bar, beat
and tick is ordinary: a JACK client gets BBT only when something on the graph is a timebase
master, and a plugin that assumes bar 1 beat 1 in that case will restart its pattern on every
block. The host MUST set `valid` on every write, and MUST write the whole block before each
`jig_process`, whether or not anything changed.

Bar, beat and tick are the host's own counting. A module MUST NOT derive them from `beat` and
the time signature when bit 4 is clear, because a host that starts its timeline somewhere
other than bar 1 beat 1, or that has a tempo map, will disagree.

## The version 2 calling sequence

1. Instantiate, `jig_init(sampleRate)`, read `jig_max_frames()`, take the pointers, all as
   version 1.
2. Take `jig_transport_ptr`, `jig_midi_in_ptr` and `jig_midi_out_ptr` **once**, alongside the
   audio pointers, and for the same reason.
3. Per block: write inputs, set any changed parameters, fill in the transport block, write
   incoming events and call `jig_midi_in(count)`, call `jig_process(frames)`, read outputs,
   then read `jig_midi_out_count()` and take that many events.

The order matters in one place: `jig_midi_in` before `jig_process`, and `jig_midi_out_count`
after it.

## An implementation

`native/jigdaw-adapter` is a VST3 that loads JigDAW plugins by IRI using this ABI, and it is
the reason the ABI exists. Six of the worked plugins declare it (Cascade, Pulse and Dynamix
at version 1; BassGen and the 8-Bit 8asterd, which need the transport and MIDI version 2
adds; Quefrency at version 2 for MIDI in alone, an audio effect steered by control
changes), and [for-plugin-authors.md](for-plugin-authors.md) recommends that yours does too.
