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

Parameters appear as a flat list of 32 generic slots, filled in load order: a plugin's
parameters follow the previous plugin's. A DAW asks for the parameter list before anything is
loaded, so the names cannot be the real ones, and there is no editor: the adapter is a way of
running JigDAW plugins in a native host, not a way of presenting them.

A plugin that declares no `jig:abi` is refused, with a message saying it is private to its
JavaScript processor.

## Installing

```sh
native/install.sh            # builds, tests, and puts the VST3 in ~/.vst3
native/install.sh --all      # the CLAP and LV2 too
native/install.sh --help     # the rest of the options
```

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
