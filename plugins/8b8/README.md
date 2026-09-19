# 8-Bit 8asterd

A JigDAW plugin that is the [8b8](https://github.com/danja/8bit8asterd) firmware itself,
compiled to WebAssembly and driving three emulated AY-3-8910 chips.

The 8b8 is an Arduino Leonardo with three AY-3-8910As on it, made by Semiotic Sounds, with
firmware descended from
[dogemicrosystems' dual AY module](https://dogemicrosystems.ca/wiki/Dual_AY-3-8910_MIDI_module).
Nine voices across the three chips, hardware envelopes, a percussion set on MIDI channel 10,
and 42 controls covering vibrato, tremolo, an arpeggiator, buzzy bass, digital circuit
bending and ten tuning temperaments.

## What is ported and what is not

Nothing musical is reimplemented. [firmware/](firmware/) is an unedited snapshot of the
real firmware and of that repository's own model of the chip, and
[8b8.cpp](8b8.cpp) includes the firmware as one translation unit exactly as the Arduino IDE
builds it. The only accommodation the firmware needs is an `AY_EMULATOR` seam already in
its `writeReg()`, which hands register writes to the chip model, and which is in the
firmware rather than here so that hardware and emulation cannot drift apart.

What this directory adds is the module ABI, the AudioWorklet processor and the profile.

Three parts of the device do not come across:

- **The serial control protocol.** Parameters arrive through `jig_set_param` instead. The
  firmware's parser is still compiled in, and is unreachable because the shim's serial port
  always reports that nothing arrived.
- **EEPROM.** A plugin's state belongs in the project graph, so there is nowhere to persist
  to. The array reads 0xFF, the firmware's layout check fails, and it boots on the generated
  defaults, which is what a fresh board does.
- **DIN MIDI.** There is no five pin socket on a web page.

## Parameters

The 42 controls are one flat bank of bytes in the firmware, and
[generate.py](https://github.com/danja/8bit8asterd/blob/main/generate.py) in that repository
is the single source of truth for them: it generates the firmware's `parameters.h` and the
device's own web panel from one list. [sync.sh](sync.sh) reads that list into
[params.json](params.json), and [make.js](make.js) turns it into the ports in
`profile.json` and the scale table the module converts with.

The ports carry the **displayed** value rather than the firmware's byte, which is what the
device's own panel shows: transpose is minus 24 to plus 24 semitones rather than 0 to 48,
and vibrato rate is 0.1 to 20 Hz rather than 1 to 200. `jig_set_param` runs that backwards.

Two of them are nominal. Roll and Retrigger index an exponential curve running from about
1.5Hz to 45Hz, so the figure is a position on that curve rather than a rate, and the profile
says so in a `trn:caution`.

## Building

    ./build.sh

clang targeting wasm32 with `-nostdlib`, and `wasm-ld` for the link. Not Emscripten: a
module declaring an ABI must instantiate with no imports at all
([docs/module-abi.md](../../docs/module-abi.md)), and an emcc build brings a libc and its
imports with it. [shim/](shim/) supplies the Arduino and AVR surface the firmware compiles
against, and the handful of libc functions that `-nostdlib` leaves missing.

Ubuntu's clang package ships no `wasm-ld`, so the build falls back to the `rust-lld` that
rustup installs for the other plugins here. It is the same linker under another name.
[HUMANS.md](../../HUMANS.md) asks for lld to be installed properly.

To re-vendor the firmware after it changes upstream:

    ./sync.sh [path to the 8bit8asterd checkout]
    ./build.sh
    npm test

`tests/dsp/8b8.test.js` binds `params.json` to the vendored `parameters.h`, and the profile,
the scale table and the processor's descriptors to `params.json`, so a re-vendor that only
half happened fails rather than shipping.

## Two firmware bugs this works around

Both are in the firmware and both would happen on hardware. They are handled here rather
than patched into [firmware/](firmware/), which is a snapshot and is not edited, and the
fixes belong upstream.

**The register cache's flush window.** The firmware keeps a shadow of all sixteen registers
per chip and flushes the ones that changed on its 100Hz tick. It ends its startup, and every
parameter change, with `psg.invalidate()`, which sets the "what the chip has" copy to the
complement of the shadow so that the next flush rewrites everything. That only works if
nothing changes the shadow before the flush: a register whose new value happens to equal the
complement is taken for already sent and never goes out. Middle C is tone period 239, whose
high byte is 0 against a complement of 0, so the chip keeps the 0xFF that initialisation left
there and the note sounds at under a hertz. On hardware, USB enumeration takes far longer
than the ten milliseconds to the flush, so it is never reachable. A host that calls
`jig_init` and then `jig_process` with an event, or that sets a parameter and plays a note in
the same millisecond, reaches it immediately. The module renders the boot period in
`jig_init`, and invalidates and flushes together on a parameter change.

**The bang seventeen seconds after a panic.** `softReset()`, which All Sound Off, Reset All
Controllers and All Notes Off all call, silences the voices and then reinitialises the chips.
Boot does those two things the other way round and ends with the amplitude registers at zero;
the reset ends with them at 0xFF, which sets the chip's M bit and hands every channel's
volume to the envelope generator at a period of 0xFFFF. That is a sixteen second ramp from
nothing to full scale, measured at 0.93 RMS with nothing playing, arriving well after the
message a host sent to make everything stop. The module repeats the half of boot that the
reset undoes.

## Measured in Chrome

2026-09-19, loaded by IRI into the application at `http://127.0.0.1:8748/`, with an
`AnalyserNode` on the engine's master bus so the figures are what reaches the speakers
rather than what the module wrote. A real `AudioWorkletNode`, a running `AudioContext` at
48kHz, no console errors.

| | |
|---|---|
| idle | 0 RMS |
| note on, middle C | 0.058 RMS, fundamental in the 258Hz bin (bin width 23.4Hz) |
| the same note with Transpose at +12, through the AudioParam | 516Hz, an octave up |
| after note off | 6e-13 RMS |
| drum on channel 10, note 36 | 0.051 RMS |
| 22 seconds after All Notes Off | 2e-17 RMS, which is the bang not happening |
| the generated keyboard, C4 held | 0.060 RMS, silent on release |

The panel generates all 42 controls, with the display scaling and the units: Transpose
reads "0 st" and speaks "0 semitones" over a range of minus 24 to plus 24, Drums Tune reads
"100 %", Vibrato Rate reads "5.00 Hz" over 0.1 to 20, Vibrato Delay reads "0 ms" over 0 to
2000. `documentElement.scrollWidth` is 1264 against an `innerWidth` of 1279, so nothing
overflows sideways.

One thing that looks like a fault and is not: a scripted click on a key makes no sound. The
press and the release land in the same 128 frame quantum, so the note on and the note off
are applied in the same block. A hand cannot click that fast, and holding the key sounds it.

## Files

| | |
|---|---|
| [8b8.cpp](8b8.cpp) | the module: the firmware plus `jig:Abi2` |
| [8b8-processor.js](8b8-processor.js) | the AudioWorklet processor |
| [firmware/](firmware/) | unedited snapshot, see [firmware/PROVENANCE.md](firmware/PROVENANCE.md) |
| [shim/](shim/) | Arduino, AVR and libc stand-ins for a freestanding build |
| [params.json](params.json) | the parameter definition, generated by [sync.sh](sync.sh) |
| [plugin.json](plugin.json) | the hand-written head of the profile |
| [profile.json](profile.json) | generated by [make.js](make.js) |
| [profile.ttl](profile.ttl) | generated by [bin/write-profile.js](../../bin/write-profile.js) |
| `generated/param-map.h` | generated by [make.js](make.js) |

## Licence

Declared Apache-2.0, as the other plugins here are, and **provisionally**: the 8bit8asterd
repository carries no licence file, and its firmware header says the bulk of it comes from
[dogemicrosystems](https://dogemicrosystems.ca/wiki/Dual_AY-3-8910_MIDI_module). Danny owns
8bit8asterd and expects no problem, and is checking upstream.

If the answer comes back differently, the thing to change is `licenceId` in
[plugin.json](plugin.json) followed by `./build.sh`, which rewrites the `pu:licenceId` in
the profile. It is one line because a published profile is a claim about the terms someone
may install under, and a claim that is hard to correct is one that stays wrong. See
[HUMANS.md](../../HUMANS.md).
