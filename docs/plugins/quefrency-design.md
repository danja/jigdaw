# Quefrency: design

Quefrency is a stereo audio effect that separates each frame of its input into a formant
envelope and a harmonic fine structure using the
[cepstrum](https://en.wikipedia.org/wiki/Cepstrum), transforms the two independently, and
multiplies them back together. It is WebAssembly written in Rust, declares `jig:Abi2` for its MIDI input, and
lives in [plugins/quefrency/](../../plugins/quefrency/). Its structure is copied from
Cascade.

It is the first worked plugin to declare a non-zero `jig:latencyFrames`, and so the first to
exercise the compensation described in [latency.md](../latency.md) with a real plugin.

## Signal path

Each channel is processed as a short-time Fourier transform (STFT): overlapping windowed
frames, each transformed, modified and overlap-added back.

```
x ─► window ─► FFT ─► X(k) ─────────────────────────────┐ phase kept
                       │                                 │
                  log|X(k)|                               │
                       │ IFFT                             │
                   cepstrum c(n)                          │
            ┌──────────┴───────────┐                      │
     n < Nc (low quefrency)   n ≥ Nc (high quefrency)     │
       formant cepstrum         harmonic cepstrum         │
            │ FFT                  │                      │
      log E(k) envelope     log S(k) = log|X(k)| − log E(k)
            │                      │ × harmonic depth     │
   warp by formant shift   move peaks by pitch ratio and Hz offset
   depth, tilt              (phase-locked vocoder)        │
            │                      │                      │
         E'(k)          ×          S'(k)        ← re-convolve = multiply
                       │
                     IFFT ─► synthesis window ─► overlap-add ─► y
```

**The split point is a quefrency, `Nc`, set in milliseconds.** Cepstral coefficients below
`Nc` describe the smooth envelope; those above describe the harmonic comb. `Nc` must sit
below the shortest pitch period present, so it is the `lifter` parameter, default 1.5 ms,
which suits voices up to about 600 Hz.

**The excitation keeps the input's phase.** In log magnitude, transforming the
high-quefrency cepstrum back gives exactly `log|X| − log E`, so the plugin computes that
difference directly and never discards the phase of `X`, which the pitch shifter needs.
Scaling the harmonic cepstrum by `g` is multiplying `log S` by `g`, which is how harmonic
depth is applied.

**Every change is a gain on `X`, so the neutral setting is exact.** With no shift, bin `k` of
the output is `X(k) · exp((g − 1)·log S(k) + log E'(k) − log E(k))`. At neutral settings the
exponent is exactly zero and the output is the input, delayed. This is what the
reconstruction test checks.

**Re-convolution is multiplication by a zero-phase envelope.** Multiplying spectra is
circular convolution, but the envelope's impulse response is about `Nc` samples long, well
inside the frame, so the time aliasing is negligible.

## Envelope estimators

Two, chosen by the `estimator` parameter:

- **Cepstral**: one low-pass lifter. It averages between harmonics, so the envelope sags
  below the harmonic peaks when the pitch is high.
- **True envelope**, after Röbel and Rodet (2005): repeat `A = max(A, V)`, `V = lifter(A)`,
  starting from `A = log|X|`. The envelope climbs to the harmonic peaks and formants survive
  shifting better. It costs two FFTs per iteration, and the iteration count is fixed at 4
  so each frame costs a known amount.

## What "polyphonic" can and cannot mean

The profile carries this as a `trn:caution`.

- **The formant envelope works on chords.** The lifter gives the envelope of the mixture,
  and warping it moves the combined resonances.
- **The harmonic cepstrum of a chord does not separate by note.** It is the sum of several
  combs. The pitch shift therefore acts on spectral peaks, using
  [Laroche and Dolson's](https://doi.org/10.1109/ASPAA.1999.810857) method: find each peak,
  move its region of influence by a whole number of bins, and rotate the region's phase by
  the accumulated difference between the target and the measured frequency. Every partial of
  every note moves, so chords stay chords. The shift can be a ratio, which keeps notes
  harmonic, or an offset in Hz, which makes them inharmonic.
- **Transients smear**, as in any phase vocoder.

## Parameters

Each is an `lv2:port` with a `jig:paramIndex`. There is no custom `jig:ui`; `Panel.js`
generates the controls.

| # | symbol | range | default | unit | acts on |
|---|---|---|---|---|---|
| 0 | `formant_shift` | −12 to +12 | 0 | `semitone12TET` | envelope frequency axis |
| 1 | `formant_depth` | 0 to 200 | 100 | `pc` | envelope contrast: 0 flattens, 200 exaggerates |
| 2 | `formant_tilt` | −6 to +6 | 0 | `db` per octave, pivot 1 kHz | envelope |
| 3 | `pitch_shift` | −24 to +24 | 0 | `semitone12TET` | excitation peaks, as a ratio |
| 4 | `pitch_fine` | −100 to +100 | 0 | `cent` | excitation peaks, as a ratio |
| 5 | `freq_shift` | −1000 to +1000 | 0 | `hz` | excitation peaks, as an offset |
| 6 | `harmonic_depth` | 0 to 200 | 100 | `pc` | high-quefrency cepstrum: 0 breathy, 200 buzzy |
| 7 | `lifter` | 0.5 to 5 | 1.5 | `ms` | the split point `Nc` |
| 8 | `estimator` | Cepstral, True envelope | Cepstral | scale points | envelope estimator |
| 9 | `mix` | 0 to 1 | 1 | | dry and wet, the dry delayed to match |
| 10 | `output` | −24 to +12 | 0 | `db` | output gain |

`cent` was not a unit `Panel.js` knew. It is added to both `UNIT_LABELS` and `SPOKEN_UNITS`,
which `tests/ui/Panel.test.js` requires of any unit a plugin uses.

## MIDI control

**Control changes 70 to 80 drive parameters 0 to 10**, on any MIDI channel. This is the
8-Bit 8asterd's convention, and 70 to 79 are the MIDI sound controllers. The plugin declares
`trn:accepts trn:ControlMidi` and `trn:requires jig:MidiEvents`, and takes the events
through ABI version 2's MIDI input, so the same module answers a controller in Jiggy and in
the native adapter, which hands version 2 modules raw event records.

**Value 64 is the port's default** wherever the default lies strictly inside the range: the
mapping runs linearly from the minimum at 0 to the default at 64, then to the maximum at 127.
A centred controller therefore changes nothing, which matters for the bipolar controls,
where a plain linear map would put 64 at +0.19 semitones. Where the default is an end of the
range (Mix, and the estimator), the map is linear, so the estimator switches to the true
envelope at 64.

**An event changes the signal from its own frame.** The block is processed in segments that
end where each event falls. Mix and Output act on every sample, so they change at that
frame; the spectral parameters are read once per analysis frame, so they take effect at the
next hop at or after it.

**The host's value and the controller's are the same parameter, and the last change wins.**
The processor writes a parameter only when the host's value changes, so a controller's value
holds until someone moves the knob, and within one quantum the controller is applied after
the host. The panel does not show a controller's value and the project does not save it:
the messaging protocol has no way for a processor to report a parameter it changed, so
the profile says so in a `trn:caution`.

**The mapping is stated in prose, in a `trn:caution`, and a test holds the prose to the
module**: it checks that the caution names the controller range and every port, in index
order. A machine-readable binding would be better; LV2's
[MIDI extension](https://lv2plug.in/ns/ext/midi) has `midi:binding` with
`midi:controllerNumber` for exactly this, and using it would let a host label each control
with its controller.

**Jiggy offers no keyboard or clip to it.** A plugin taking only control changes has nothing
to play, so the keyboard, the default clip target for a new track, and the "clips play into"
menu all ask `carriesNotes` from `src/engine/EventRouter.js`, which is false for
`trn:ControlMidi` and `trn:MidiCC`. The routing panel still offers its MIDI input, so a
plugin producing control changes can be wired to it.

## Frame size and latency

**Frame size `N` is fixed per session and chosen from the sample rate:** 2048 up to 50 kHz,
4096 above, so a frame covers roughly the same time at 44.1, 48, 88.2 and 96 kHz. The hop
`R` is `N/4`. Frame size is not a parameter, because changing it changes latency, and
[latency.md section 2](../latency.md) says a plugin should not do that during playback.

**Latency is `N − 1`:** 2047 frames at 50 kHz and below, 4095 above. A sample is finished
only when the last frame that overlaps it has been processed, and the first sample of that
frame is `N − 1` samples older than the newest one, so no output order does better with
this frame size. Each output sample is read immediately after any frame processed on that
sample, which is what makes it `N − 1` and not `N`. The profile declares 2047, and the
processor's `ready` message reports whichever value `jig_latency_frames` returns for the
actual rate. The host compensates from the `ready` value.

This section first said `N − R`, the figure a common phase vocoder implementation gives
for its input FIFO. The impulse test measured 2047, and the figure was corrected from the
measurement, not the reverse.

**The dry signal passes through its own delay line of `N − 1` samples**, so a mix below 1
does not comb filter.

**Windows** are a periodic square-root Hann for analysis and synthesis. Their product is a
Hann window, which sums to 2 at 75% overlap, so the output is scaled by one half.

## Real-time obligations

- `no_std`, no allocator, every buffer a static array sized for `N = 4096`. Nothing grows
  memory after `jig_init`.
- **The static state is all zeros at compile time**, and the real defaults are set by
  `jig_init`. One non-zero field moves the whole static from `.bss` into the module's data
  section: the first build was 380 KB of mostly zeros, and this one is 21 KB.
- FFT twiddles, bit-reversal indices and windows are computed in `jig_init`.
- **It depends on `libm`.** Cascade and Pulse avoid transcendental functions; this plugin
  needs `log`, `exp` and `atan2` on every bin of every frame. `libm` is pure Rust,
  allocation free and imports nothing, and `plugins/_jsfx-runtime` already depends on it.
- **Work arrives in bursts.** With `R = 512` and a 128 frame quantum, one quantum in four
  processes a frame for both channels: four FFTs per channel, plus eight with the true
  envelope. Measured in node at 48 kHz, stereo, neutral settings cost about 5% of real time
  and shift with the true envelope about 13%, so the busy quantum uses roughly half its
  2.7 ms budget at worst. If that proves too uneven, the two channels can be processed in
  different quanta.
- `log|X|` is floored at 1e-9 so silence does not produce infinities, and because every
  change is a gain on `X`, silence in stays silence out.

## Tests

`tests/dsp/quefrency.test.js` drives the wasm directly; `tests/host/quefrency.test.js` loads
it through `PluginLoader` and `Engine`. The formant preservation and latency tests were
mutation tested: removing the envelope correction from the shift path, and delaying the
output by one sample, each turn them red.

1. It exports the ABI and its processor's parameter descriptors match the profile.
2. Neutral settings reproduce the input delayed by exactly the reported latency: an impulse
   arrives at `jig_latency_frames()` and nowhere else, and the error on noise is below
   −90 dB (it measures about −130 dB). This binds the declared latency to the real one.
3. At 88.2 and 96 kHz the reported latency is 4095 and the impulse test measures the same.
4. Formant shift alone keeps the pitch; pitch shift alone moves every partial by the ratio.
5. Pitch shift alone keeps the envelope in place.
6. At `mix` 0.5 and neutral settings, the output equals the delayed input.
7. Silence in gives silence out, and every output sample is finite for every estimator.

## Later

- **A sidechain input for cross-synthesis**: envelope from input 2, excitation from input
  1, which makes it a cepstral vocoder. Needs `jig:audioInputs 2`.
- **A custom `jig:ui`** drawing both envelopes and the lifter point live, fed by rate-limited
  envelope snapshots from the processor ([messaging.md](../messaging.md)).
