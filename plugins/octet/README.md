# Octet

Eight-band parametric equalizer, stereo, with MIDI controllers for Drift (below), no latency. Ported from the Downspout plugin of
the same name (`downspout/plugins/octet`, MIT), which is a redesign of the EQ Eight in oxide-studio's `oxide-fx`. The graphic
display is the plugin's own editor, `ui/index.html`.

| Control | Range | Default |
|---|---|---|
| Mode | Stereo / Left/Right / Mid/Side | Stereo |
| Output | -12 to +12 dB | 0 dB |
| Band on | Off / On | bands 2 to 7 on, 1 and 8 off |
| Band type | HP 12, HP 48, Low shelf, Bell, Notch, High shelf, LP 12, LP 48 | HP 48, low shelf, four bells, high shelf, LP 48 |
| Band frequency | 20 Hz to 20 kHz | 30, 100, 250, 600, 1.5 k, 4 k, 8 k, 18 k |
| Band gain | -18 to +18 dB (bell and shelves) | 0 dB |
| Band Q | 0.1 to 18 (bell, shelves, notch) | 1 (shelves 0.71) |
| Band channel | Both / A / B (left or mid, right or side) | Both |
| Spectrum | Off / Pre / Post | Post |
| CC channel, CC band | 0 to 16, 1 to 8 | 1, 4 |

Every band is at 0 dB and the two cuts are off, so a fresh instance passes the signal unchanged bit for bit. The 48 dB cuts are
8th-order Butterworth (-3 dB at the cutoff). Frequency, gain and Q glide to a new value over a few milliseconds, so fast sweeps do
not zipper. All 53 controls are ordinary automatable parameters, with the original's parameter indices; there is no plugin state.

## The graphic display

The editor draws what a graphic equalizer draws: every band's curve and the total, computed from the coefficients the audio uses; a
numbered node for each band; and the spectrum behind them. It is offered by a host beside the generated panel, in a sandboxed frame
([contract section 9.1](../../docs/host-plugin-contract.md)), whether the plugin comes from another origin or from the host's own.
Every control in it is also on the generated panel.

- **Drag a node:** across for frequency, up and down for gain. A band that is off is switched on when grabbed. Cuts and notches have
  no gain, so their nodes move across only.
- **Scroll over the plot** to change the chosen band's Q.
- **From the keyboard:** with the plot focused, 1 to 8 choose a band, Left and Right move its frequency by a semitone, Up and Down its
  gain by half a decibel, Page Up and Page Down its Q, and Enter switches it. Shift takes a bigger step and Alt a finer one.
- **The strip and the controls below** choose a band and reach everything the plot does, with sliders and boxes to type into. A
  control that does nothing for the chosen band's type is left out, not shown disabled.
- **Spectrum:** 64 log-spaced bands from 20 Hz to 20 kHz from a Hann-windowed 4096 point FFT of the mono sum, about 30 times a second,
  with a quick rise and a slow fall (40 dB a second). Pre reads the input, Post the output, Off stops the analysis. The module
  measures it and the processor sends it to the editor as `plugin` messages (messaging.md 2.4); a full-scale sine reads 0 dB.

## MIDI (the Drift convention)

CC 1 to 4 on the CC channel (1 by default; 0 ignores MIDI) drive the CC band: 1 its Frequency (logarithmic, 20 Hz to 20 kHz),
2 its Gain, 3 its Q (logarithmic) and 4 the Output. A controller holds its control until you move it, or the host automates it;
changing the CC band releases them all. The editor does not follow the controllers. The profile accepts controllers alone
(`trn:MidiCC`), as Quefrency does, so nothing offers it a keyboard or a clip to play into.

## What the port changed

The algorithm is the original's. `octet.cpp` was checked against the original core compiled natively, over five scripts of 256
blocks (the transparent defaults; a typical curve in stereo; Mid/Side with a band on each channel, all eight shapes and the spectrum
before the EQ; Left/Right with automation, a type change and a band switched off; Drift controllers released by the panel): the
largest difference was 1.2e-7 of full scale in the audio and 4e-6 dB in the spectrum, and the first three were bit for bit. One
sample in 64 of those renders is `tests/dsp/fixtures/octet-reference.json`.

What differs, for a module with no libc, libm, heap or threads:

- Every table is static and built in `jig_init`. `sin`, `cos`, `log2`, `2^x` and `10^x` are written in the file and checked against
  `Math.*` by `tests/dsp/octet.test.js`.
- The 64 spectrum levels were read-only output parameters in the original. A profile has no output ports, so they go to the editor
  through the relay instead (`jig_spectrum_ptr` and `jig_spectrum_serial`), and the generated panel has 53 controls, not 117.
- The response plot is JavaScript in the editor, from the same formulae. `tests/dsp/octet.test.js` takes that code out of the page
  and holds it to the module's own audio within 0.15 dB for every shape at 48 and 96 kHz.
- The generated panel's frequency knobs are linear, since a profile has no scale hint; the editor's are logarithmic.

Build with `plugins/octet/build.sh` (clang and wasm-ld, as for Monochord and Quartet), which regenerates `profile.ttl` with the
digests of what it built, the editor included.
