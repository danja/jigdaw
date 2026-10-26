# Quartet

Eight-voice, four-operator FM synthesiser. Ported from the Downspout plugin of the same name (`downspout/plugins/quartet`, MIT),
which is a redesign of the Operator device in oxide-studio's `oxide-dsp`.

Four operators A to D, each a sine, saw or square (the last two band-limited by mip-mapped wavetables) with its own envelope and a
frequency that is a ratio of the note or a fixed value. Eleven algorithms decide which operators modulate which and which are heard.
Operator D can feed back into itself. FM Depth sets how far a full-level modulator moves its target, in cycles. A pitch envelope,
one multimode filter and optional 2x oversampling with a half-band decimator complete it.

Instrument: MIDI in (notes with velocity, per-channel pitch bend over Bend range, sustain pedal CC 64, CC 120 and 123), mono voices
summed to a stereo output with both channels equal, no audio input, no transport and no saved state. The 59 controls are ordinary
parameters, in the original's order.

## It opens as a bass

The original opens as an organ-like patch. This one opens as a mono bass, so a new Quartet plays something useful at once and the
Deep house bass loop has a voice to suit it:

| | |
|---|---|
| Algorithm | 1, D > C > B > A |
| A | sine carrier at the note, level 0.9, sustain 0.8 |
| B | sine modulator at the note, level 0.42, decays in 220 ms to 0.18: the bite at the start of each note |
| C | sine modulator an octave up, level 0.14, decays to nothing in 120 ms: a little edge on the attack |
| D | silent |
| Filter | 24 dB low-pass at 2400 Hz, resonance 0.2, key track 0.3 |
| Play mode | Mono |

Set Play Mode to Poly for chords. Every other control has the original's range and meaning.

## What the port changed

The algorithm is the original's. `quartet.cpp` was checked against the original C++ core compiled natively, rendering four scripts
of notes (the original's defaults; saw and square operators with feedback, 2x oversampling and a pitch envelope; mono with glide and
a band-pass; legato with a fixed operator and a notch): the largest difference was 6e-8 of full scale. One frame in 32 of those
renders is `tests/dsp/fixtures/quartet-reference.json`, which holds the module to the original.

What differs is the engine around it, for a module with no libc, libm, heap or threads:

- No `std::vector`, `std::array` or `std::complex`. Every table is static, and the wavetable bank (about 270 KB) is built in
  `jig_init`, before the module reports ready.
- `sin`, `cos`, `tan` and `exp2` are written in the file and checked against `Math.*` by `tests/dsp/quartet.test.js`.
- The VST3's routing drawing and filter-response plot are not reproduced, since a profile has no way to carry a picture. The
  algorithm choice names each routing instead (`3: (B + (D > C)) > A`).
- The defaults, above.

Build with `plugins/quartet/build.sh` (clang and wasm-ld, as for Monochord), which regenerates `profile.ttl` with the digests of
what it built.
