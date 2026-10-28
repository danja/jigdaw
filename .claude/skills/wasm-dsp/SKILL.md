---
name: wasm-dsp
description: Write or change the WebAssembly module that does a Jig plugin's signal processing, in Rust or C++. Use when starting a plugin that needs real DSP state or a tight loop, when /new-plugin has declined to scaffold one, when adding freestanding maths, or when a module is silent, slow or wrong. Covers the real-time rules, the module ABI, the build, the processor that wraps it, how to test the DSP deterministically, and the failures already paid for.
---

# Writing a plugin's WebAssembly module

A Jig's processor is JavaScript, and its DSP is usually a `wasm32` module. `/new-plugin` (`.claude/commands/new-plugin.md`) scaffolds a
plain-JavaScript plugin and says so when a plugin needs a module: then copy a working one. [CLAUDE.md](../../../CLAUDE.md) holds the
rules and the record; [docs/module-abi.md](../../../docs/module-abi.md) is the contract with the host. This is the order of work.

## 1. Start from a plugin that works

- **Rust:** `plugins/pulse/` (an instrument, about 3 KB) and `plugins/cascade/` (an effect). Most plugins here are Rust, `no_std`, with
  **no allocator at all**, so nothing can allocate on the audio thread even by accident.
- **C++:** `plugins/boost/`, a gain stage built to be copied: every line past `jig_process` is ABI wiring, not DSP. If your DSP needs a libc
  function the minimal build lacks (`memcpy`, `memset`), copy `plugins/8b8/shim/` and not boost.
- Not from scratch, and not Emscripten: a module that declares an ABI must instantiate with **no imports**, and Emscripten brings a libc
  and its imports.

## 2. The real-time rules

From CLAUDE.md, and each one has been broken here:

- No allocation, network, storage, unbounded logging or unpredictable lock in `process()`.
- **Never grow memory after `jig_init`.** It detaches every view the host holds, and the symptom is silence, not an exception.
  `node bin/check-wasm-abi.js plugins/<name>/<name>.wasm` decodes every instruction to check it, and that the module needs no imports.
- Preallocate every buffer before the processor reports ready. A processor that is not ready outputs silence.
- **Write every frame of every output you declared**, zeroes included. An untouched buffer is not specified to be silent.
- A disconnected input arrives as an empty array: silence, not an error.
- Anything at a point in time is located by **stream position**, never by an index within the current block, and never by equality with
  a block boundary. An event fires in the block that contains it.
- A parameter's array has length 1 when constant over the quantum and 128 when not. Handle both.
- Derive musical timing from the beat position the host sends, never by counting `process()` calls.

## 3. The ABI, and the build

Export `memory`, `jig_init(f32)`, `jig_max_frames()`, `jig_output_ptr(channel)`, `jig_process(frames)` and `jig_set_param(index, value)`, plus
`jig_input_ptr(channel)` if it has audio inputs and `jig_note_on` and `jig_note_off` if it takes MIDI (the full table, and version 2's
frame-stamped MIDI and transport, are in module-abi.md). A parameter is addressed by its `jig:paramIndex`, declared in `profile.json`
and never inferred from order. `jig_max_frames` is 128 in every worked plugin; a host splits larger blocks.

**Rust.** `plugins/pulse/src/lib.rs`: `#![no_std]`, a `#[panic_handler]` that calls `core::arch::wasm32::unreachable()`, state in a
`static` behind an `UnsafeCell` with `unsafe impl Sync`, and `#[no_mangle] pub extern "C" fn jig_*`. In `Cargo.toml` (see
`plugins/cascade/Cargo.toml`): `crate-type = ["cdylib"]` and a release profile of `opt-level = "z"`, `lto = true`, `panic = "abort"`,
`codegen-units = 1`, `strip = true`. Build with `cargo build --release --target wasm32-unknown-unknown`, copy the `.wasm` beside the
profile, then run `bin/write-profile.js` (`plugins/pulse/build.sh` does all of it).

**C++.** `plugins/boost/build.sh`: `clang++ --target=wasm32 -O2 -nostdlib -fno-exceptions -fno-rtti -fno-threadsafe-statics`,
`-Wl,--no-entry`, every export named with `-Wl,--export=`, and `-Wl,--export-memory`. **Do not pass `--allow-undefined`**: a missing symbol
becomes an import, and the module then fails to instantiate in a host that has none to give, at load rather than at build.

Run the plugin's `build.sh` after every change. It writes the digest of the module and the processor into `profile.ttl`, and a stale digest is a
plugin the host refuses (see the `finish-plugin` skill).

## 4. The processor that wraps it

`plugins/dynamix/dynamix-processor.js` is the model. It compiles the module **inside the worklet**, synchronously
(`new WebAssembly.Module(bytes)`): a compiled `Module` cannot be posted into a worklet, and it is silently never delivered.
It instantiates with `{}`, checks every export it needs and reports a clear error if one is missing rather than throwing, calls
`jig_init`, **takes the `Float32Array` views once** and keeps them, then replies `ready`. Per quantum it copies the inputs in, sets only the
parameters that changed, calls `jig_process`, copies the outputs out, and zeroes whatever the module did not fill. The processor's
`parameterDescriptors` are written by hand (a worklet cannot read its own profile) and must match the profile: that is the three places a
parameter is named.

## 5. Maths with no libm

There is no libm in a freestanding module. `plugins/dynamix/src/lib.rs` builds `fast_log2` and `fast_exp2` from the float's bit pattern;
`plugins/pulse/` avoids transcendental functions altogether, with a semitone table and an octave shift. **A freestanding function is wrong
until it has been set against the real one, over the range it is called in, on the day it is written.** Parameq had a sign error, a cosine too
coarse for poles near z = 1, and a Horner chain one power off.

The way it is done here: export a test hook from the module (`jig_math` in `plugins/monochord/`, `jig_exp2` in `plugins/sam/`) and compare it
with `Math` over a dense sweep in `tests/dsp/` (`tests/dsp/monochord.test.js`, "the maths written for a module with no libm", and
`tests/dsp/sam.test.js`, "freestanding maths"). Include the awkward ends: several turns for a sine, every quadrant for `atan2`, and what
happens far out of range (it must saturate, not produce garbage).

## 6. Test the DSP deterministically

`tests/dsp/<name>.test.js`, modelled on `tests/dsp/dynamix.test.js`: `WebAssembly.instantiate(bytes, {})` and drive `jig_process` directly with
seeded noise or fixed levels, so the render is reproducible where a live context is not. Wrap it in `describeBuilt` so an unbuilt module
**skips visibly** (it prints a warning) and never passes. Compare against reference figures computed independently in f64 (see
`tests/dsp/fixtures/` and `tests/dsp/parameq.test.js`), with tolerances at the dB-fraction level when the module uses approximations.
Also assert:

- **A fresh plugin is audible untouched.** The default settings must make sound; a plugin that is silent until a parameter is moved was
  broken once and no test saw it.
- **A removed plugin stops**, and a function that handles a case has a caller that can supply it (the `output` branch existed while nothing could express it).
- The module exports the ABI its processor expects, `jig_max_frames()` is what the processor assumes, and the profile's digest is of the
  `.wasm` actually on disk.
- Then the same through the real host path in `tests/host/<name>.test.js`, which binds the profile, the processor and the module.

## 7. Failures already paid for

- **Measure on the slowest host.** Mop ran at 0.06x of realtime under node's JIT and 1.70x under the native adapter's WAMR interpreter, so it
  dropped out in Reaper with every suite green. adding `--measure-budget` to the `check-plugin` command in the `finish-plugin` skill renders it again for timing (and give an instrument `--note 69@0:1`, or it is given nothing to play and reports no audio). Timing is diagnostic: record
  figures with the diagnosis and do not assert them, since machines differ.
- **Ask what the first call allocates.** wasm3 compiles on first call, so the audio thread was compiling. A state restore can grow memory, so
  take views after one and refresh them.
- **A capability negotiated with browsers proves nothing about a native runtime.** wasm3 has no SIMD and WAMR does. A module that needs a
  feature declares it with `jig:wasmFeature`.
- **A fake more permissive than the real thing hides the bug.** A test double handed a `WebAssembly.Module` straight to a callback while a
  real `MessagePort` cannot deliver one: 288 tests passed and the first page load failed. Check against the real API's refusals.
- **Wire formats parse in the classic locale.** A parser that stops at the decimal point under `it_IT` is a native-host bug no browser shows.
- Do not run any `git` operation. Before creating a file, list its directory.

## 8. Done when

The module builds from `build.sh` with no imports and no memory growth (`check-wasm-abi`); the three places agree; the DSP test, the host
test and the docs tests pass; maths with no libm has been set against `Math`; a fresh plugin is audible; `check-plugin` made sound in a
headless render (it cannot tell you it sounds good: say "not heard"); and the `finish-plugin` list is done.
