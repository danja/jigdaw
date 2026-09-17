# JigDAW Adapter

A VST3, CLAP and LV2 plugin that loads JigDAW plugins by their IRI and runs them in a chain.
Two channels of audio in and out, MIDI in and out.

Built with [DPF](https://github.com/DISTRHO/DPF), in the shape
[downspout](https://github.com/danja/downspout) uses: a portable core with the plugin format
as a thin shell over it.

## What it is for

It was written as a sanity check on the JigDAW specification, and it earned its keep before
it played a note.

**A native host could not load a JigDAW plugin at all.** The only thing
[the contract](../../docs/host-plugin-contract.md) guarantees is a JavaScript
`AudioWorkletProcessor`, and the WebAssembly ABI is explicitly private to the plugin. The
specification had made itself browser-only without anyone noticing, because everything that
read it was a browser.

[docs/module-abi.md](../../docs/module-abi.md) is the answer: a module may declare
`jig:abi jig:Abi1`, and a host with a WebAssembly runtime loads it directly and ignores the
processor. This adapter is the implementation that ABI exists for.

## Using it

The plugin has one state, `iris`, holding one plugin IRI per line. They load in order and the
audio passes through each in turn.

```
https://strandz.it/jigdaw/plugins/pulse/
https://strandz.it/jigdaw/plugins/cascade/
```

That chain is a synthesiser into a reverb: MIDI reaches every plugin that accepts it, and
each plugin's audio output feeds the next.

Parameters appear as a flat list of 16 generic slots, filled in load order: a plugin's
parameters follow the previous plugin's. A DAW asks for the parameter list before anything is
loaded, so the names cannot be the real ones. The editor says which slot is which.

A plugin that declares no `jig:abi` is refused, with a message saying it is private to its
JavaScript processor. Both `jig:Abi1` and `jig:Abi2` are implemented.

### The editor

Paste IRIs, press Load, and the list says what loaded, what did not and why, and which
parameter slots belong to which plugin. That last part is the reason it exists: the host shows
"Param 7" and has no way to say what that is.

Click a loaded plugin and it opens that plugin's panel.

### A plugin's panel

The panel is generated from the `lv2:port` statements in the plugin's profile: the declared
name, range, default and unit for each parameter, and the named values where the profile names
them, so Pulse's waveform reads "Saw" rather than "0.00". The slot number is shown beside each
control, which is what connects it to the host's "Param 4". This is the same rule the browser
panel follows, from the same statements.

It is generated rather than fetched because there is nothing to fetch. A `jig:ui` is a web page
and this host has no JavaScript engine, so a panel built from what the profile declares is the
only one a native host can honestly draw. Neither worked plugin declares a `jig:ui` at all.

Controls write through the host, never straight into the chain, so automation and undo keep
working and the host's own generic sliders stay in agreement. Arrow keys move and adjust,
shift is a fine adjustment, and escape goes back to the list.

The editor resolves the IRIs itself, in parallel with the plugin doing the real load, rather
than being told the answer. DPF delivers a plugin-to-editor state push under CLAP only, and
the callback is a null pointer in the VST3, VST2 and JACK wrappers. Both sides call the same
`jigdaw::buildChain`, so they cannot disagree about what happened. See MISTAKES.md.

### MIDI

MIDI in reaches every plugin in the chain that accepts it. Note on, note off, note on with
velocity zero, and controllers 120 and 123 are understood; anything else is passed over rather
than guessed at. Events are applied at the frame they were written at, not at the start of the
block that contains them.

MIDI out carries the incoming MIDI through, and whatever the plugins in the chain generate.
A plugin declaring `jig:Abi2` can emit, and what it emits also reaches every plugin after it
in the chain, so a generator drives an instrument with no host in the middle.

### The transport

The adapter fills in the `jig:Abi2` transport block from the DAW: tempo, meter, and bar, beat
and tick, each flagged so a plugin can tell a real zero from a host that does not know. It is
advanced per slice rather than per block, so a note lands where it was written rather than at
the start of whatever buffer the host happened to use. At a 1024 frame buffer that difference
is 21 milliseconds, which is audible.

A host with no bar, beat and tick is ordinary rather than broken. Under JACK it means nothing
on the graph is a timebase master, and a plugin that assumes bar 1 beat 1 in that case will
restart its pattern on every block. `docs/module-abi.md` says what a module must check.

### BassGen

`plugins/bassgen` is a port of the downspout VST3 of the same name, and the worked example of
a plugin that could not have been written under version 1 of the ABI: it emits MIDI, which
version 1 could not carry, and it plays in time with the session, which version 1 could not
tell it about. It declares no audio at all.

Loading `bassgen` and then `pulse` gives a generated bass line played by a synthesiser, with
the adapter routing MIDI between them.

### What a DAW shows alongside it

In VST3 the adapter reports about 2098 parameters. 2080 of those are the MIDI CC controls DPF
synthesises for any plugin that takes MIDI input, 130 per channel across 16 channels. DPF
marks them hidden; REAPER shows hidden parameters anyway, as a long list beside the real 16.
This is not particular to the adapter. Every DPF plugin with MIDI input does it, and it cannot
be switched off without giving up MIDI input.

If a DAW shows the generic slider panel rather than the editor, it is using a cached scan from
an earlier build. Force a plugin rescan, or clear that DAW's VST3 cache, and reopen it.

## Installing

```sh
./install.sh            # builds, tests, and puts the VST3 in ~/.vst3
./install.sh --all      # the CLAP and LV2 too
./install.sh --help     # the rest of the options
```

From the repository root: the adapter is one of the things this repository holds, and the
installer is what a person arriving here runs.

It ends by loading what it installed, because a copy that succeeded says nothing about
whether a host can open the result.

## Building by hand

```sh
cmake -S native -B build -DCMAKE_BUILD_TYPE=Release
cmake --build build -j
ctest --test-dir build --output-on-failure
```

Artefacts land in `build/bin/`. Needs OpenSSL, CMake 3.20, and a compiler with C++20. wasm3
is fetched. DPF is taken from a downspout checkout by default; point
`-DJIGDAW_DPF_DIR=/path/to/DPF` elsewhere, or `-DJIGDAW_BUILD_PLUGIN=OFF` to build only the
core and its tests.

The `chain` test fetches over HTTP and skips when nothing is serving. To run it:

```sh
PORT=6026 node bin/serve.js &
ctest --test-dir build
# or against anywhere else
cmake -S native -B build -DJIGDAW_TEST_BASE=https://strandz.it/jigdaw
```

## How it is put together

| | |
|---|---|
| `src/Turtle.cpp` | The subset of Turtle a profile uses. About 300 lines, no dependency |
| `src/Profile.cpp` | Turtle to the things a native host needs, including rebasing |
| `src/Integrity.cpp` | sha384 verification, refusing anything that does not match |
| `src/Module.cpp` | `jig:Abi1` through wasm3. The only file that knows which runtime |
| `src/Fetch.cpp` | HTTPS, via cpp-httplib |
| `src/Chain.cpp` | Several plugins in order, and a flat parameter list |
| `src/dpf/` | The DPF wrapper. A shell, not the architecture |

Loading reaches the network, so it happens on the message thread and the finished chain is
published by an atomic swap; the retired one is freed on the message thread too. `run()`
allocates nothing, and blocks the host's buffers into pieces no larger than the module's own
`jig_max_frames`.

## What it does not do

No plugin user interfaces: a native host has no way to show a sandboxed web frame, and the
generated panel belongs to the browser host. No transport, no outgoing MIDI from a plugin, no
state saving inside a loaded plugin, and no latency reporting. Those are either profile
statements or processor messages, and `jig:Abi1` version 1 deliberately carries none of them.
A JigDAW plugin needing them is a plugin for a browser.

## A Turtle parser, written rather than vendored

`src/Turtle.cpp` handles what a profile uses: prefixes, a base, IRIs, literals, numbers,
booleans, the `;` and `,` shorthands, and blank nodes for things that are not addressable,
such as scale points. It refuses anything else and names the line.

Written rather than pulling in serd because it is three hundred readable lines against a
dependency with its own build, and because it has a useful property as it stands: if a
profile ever needs more Turtle than this, that is a signal the format has grown something it
should not have.
