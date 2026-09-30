# Canticle: a 12-voice polyphonic instrument as a Jig

Ports downspout's `canticle` (`/home/danny/github/downspout/plugins/canticle`,
notes at `docs/porting.md` there) to a Rust `no_std` Abi1 instrument, after
`plugins/pulse/` (mono subtractive) and `plugins/drumkit/` (polyphonic kit).
The downspout core is `src/canticle_engine.cpp` (765 lines) plus
`canticle_params.hpp` (87 lines): one engine with five model layers (Keys,
Reed, Pad, Pluck, Glass) over a shared 12-voice allocator with release tails
and stealing, stereo spread, bounded output through a final soft clip.

## What the port keeps

The five models as profile layers over one engine, not separate DSP graphs;
12-voice polyphony with per-voice ADSR (attack/decay/sustain/release),
note-on/note-off/all-sound-off/all-notes-off in the core; the 16 host
parameters at the downspout defaults (Model 0..4, Articulation/Register/
Ensemble 0..3 as enumerations, the rest 0..1: Tone 0.52, Body 0.58, Movement
0.20, Attack 0.10, Decay 0.34, Sustain 0.78, Release 0.42, Detune 0.18, Width
0.62, Drive 0.10, Output 0.68, Metal 0.0); Metal as the model-independent edge
control (inharmonic upper partials plus brightness and drive); the output
calibration (a velocity-100 single note reaches at least -10 dBFS at default,
dense chords bounded by the soft clip); envelope curves, model profiles,
register/detune ratios, voice cutoff, width and pan bases derived on note or
parameter change, never per voice per sample.

## Real-time shape

Fixed 12-voice array, no allocator, no locks: the same rules as every worked
Rust plugin. The render path needs no transcendental functions. Four sites in
the C++ use them, each with a worked precedent. Note frequency uses a 12-entry
table plus octave shift instead of `powf`, exactly the way Pulse does. The
one-pole filter coefficient is recalculated only when cutoff or rate changes,
so its `exp` lives on the parameter path, precomputed per block the way
existing ports precompute per-block constants. Equal-power pan gains use four
Newton iterations seeded with the argument, converging on the pan interval
without a table to keep in sync. `tanh` soft clipping (oscillator
shaping, voice saturation, final bus) evaluates `(e^2x - 1)/(e^2x + 1)` off
the same `exp`. No unit test binds the approximations against libm directly;
the host suite binds them behaviorally instead: the -10 dBFS calibration on
every model, finite output under a thirteen-note steal, release to exact
silence, and bit-identical renders twice. Built 2026-09-30 as `src/dsp.rs`:
`exp` by sixteenth-reduction plus a sixth-order Taylor, `sin` folded to
[-pi/2, pi/2] plus a ninth-order Taylor, both with exact rational
coefficients. `expMap` for envelope times is evaluated on parameter write
only.

## Parameters and profile

Model, Articulation, Register, Ensemble carry scale points from the
downspout name tables (Keys/Reed/Pad/Pluck/Glass; Natural/Short/Sustain/Bloom;
Natural/Low/High/Open; Solo/Pair/Chorus/Wide). Accepts `trn:Midi`,
`trn:MelodyMidi`, `trn:HarmonyMidi` (the downspout profile lists all three:
this is the instrument MelGen, Counterpointer and Cadence lines route into);
produces `trn:Audio`; stereo out; `jig:renderQuantum 128`; no transport
requirement (unlike the generators, an instrument needs no clock). The DPF
wrapper's silent stereo bus needs no equivalent: a Jig instrument declares its
outputs and the host connects them.

## Tests

`tests/host/canticle.test.js` against the real module: a velocity-100 note on
every model reaches at least -10 dBFS at default; note-off silences within the
release bound plus one block; a 13th note steals the oldest rather than going
silent or unbounded; all-sound-off and all-notes-off clear every voice;
output stays finite under a dense Cadence-style chord on all models; no NaN
or infinity in 10 seconds of Glass at 12 voices; parameter/port/module triple
agreement per the melgen test's binding check. The existing downspout
processing benchmark (`downspout_canticle_processing_benchmark`, 48 kHz blocks
at 1/6/12 voices) is the performance reference, not a gate: timing stays
diagnostic, per the porting notes. Profile validates and canonicalises;
bundle rebuilt.

## Out of scope

New models beyond the five, a panel beyond the generated one, preset storage
beyond host parameter persistence, resampling (the core runs at the host rate;
a rate change retunes coefficients, it does not convert audio), and any
loudness claim beyond the -10 dBFS calibration the downspout notes state.
