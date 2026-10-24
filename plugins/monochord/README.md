# Monochord

Eight-voice waveguide string: plucked, bowed or hammered. Ported from the Downspout plugin of the same name
(`downspout/plugins/monochord`, MIT), which is a redesign of the Tension device in oxide-studio's `oxide-dsp`.

Each voice is a delay line closed into a loop with a one-pole damping low-pass, a first-order all-pass for the fractional delay and a
cascade of four all-passes for stiffness. The loop is tuned from its own phase delay, so every note is in tune whatever the damping and
stiffness. A pickup comb, two body resonances and a damper on note-off complete it.

Instrument: MIDI in (notes with velocity, per-channel pitch bend over Bend range, sustain pedal CC 64, CC 120 and 123), mono voices to a
stereo output with both channels equal, no audio input, no transport and no saved state. The 14 controls are ordinary parameters.

| Control | Range | Default | Notes |
|---|---|---|---|
| Exciter | Pluck / Bow / Hammer | Pluck | Applies to the next note |
| Position | 0.05-0.5 | 0.2 | Where along the string it is plucked, struck or bowed |
| Hardness | 0-1 | 0.6 | A soft pluck or wide hammer at 0; no effect on the bow |
| Bow pressure | 0-1 | 0.5 | Bow only |
| Decay | 0.1-20 s | 3 s | Time for the fundamental to fall 60 dB (with Damping 0) |
| Damping | 0-1 | 0.3 | How much faster the high partials die |
| Stiffness | 0-1 | 0.5 | Sharpens the upper partials |
| Body size / level | 0.5-2 / 0-1 | 1 / 0.3 | Two resonances at 120 and 280 Hz times the size |
| Pickup | 0-0.5 | 0 (off) | Comb along the string: a pickup at 1/n removes every n-th harmonic |
| Release | 5-2000 ms | 250 ms | The damper after note-off |
| Master, Velocity, Bend range | | 0.6, 0.7, 2 st | |

## What the port changed

The algorithm is the original's. `monochord.cpp` was checked against the original C++ core compiled natively, rendering the same notes
with each exciter: the largest difference was 3e-11 of full scale. What differs is the engine around it, for a module with no libc, libm
or heap:

- No `std::complex`. The phase delay of the all-pass has a closed form, `2 atan(((1 - c) / (1 + c)) tan(w / 2)) / w`, so the tuning solves
  for the coefficient directly instead of bisecting 60 times, which keeps the four retunes per voice per block cheap on a slow host.
- No `std::vector`; the pluck shape is written into static scratch.
- `sin`, `cos`, `atan`, `tan` and `exp2` are written in the module and tested against `Math.*` (`tests/dsp/monochord.test.js`).
- Events are decoded from the ABI's 8-byte records and applied at their frame within the block.

## What the VST3 did that the generated panel cannot

The VST3 panel plotted the string's initial shape with the pluck and pickup positions, and the harmonics that follow. The generated panel
shows the 14 controls only. Decay, Release and Body size were logarithmic sliders in the VST3; the profile has no scale hint yet, so they
are linear here.

## Build

`./build.sh` compiles `monochord.cpp` with `clang --target=wasm32 -nostdlib` and links with `wasm-ld`, then regenerates `profile.ttl`
with the digests of the files produced. Run `npm run build:index` afterwards.
