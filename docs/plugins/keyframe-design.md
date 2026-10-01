# Keyframe: time and pitch stretching from the extrema of the signal

**Status:** built, in `plugins/keyframe/`. It turns one paper into a Jig and records the decisions the paper leaves
open, because it describes an offline or embedded engine and Jiggy runs a live graph. "Measured" below means
measured on the built plugin by `tests/dsp/keyframe.test.js` or by the runs recorded under "What was measured".

**Source and credit.** The algorithm is from Matthew Nielsen, "Keyframe Time Stretching via Extrema Sampling",
DAFx26 (Cambridge, MA, 1 to 4 September 2026), licensed
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), which requires the credit below to stay in the
profile and the plugin's documentation. The author's reference code is
[heavylight-industries/capicola](https://github.com/heavylight-industries/capicola). A copy of the paper is at
`/chalet/github/dafx26-paper`. This design cites the paper's sections as "paper 2.3" and so on, and the
implementation is written from the paper, not copied from that code.

## What it does, and why it earns a place

It stretches or compresses audio in time and shifts its pitch, independently, at a cost the paper puts at about 34
to 61 cycles per output sample against about 690 to 850 for a phase vocoder or an FFT-assisted WSOLA (paper
table 1). Next to [Quefrency](quefrency-design.md), which is a heavy, high-quality frequency-domain effect, this is a
cheap, time-domain one whose artefacts are audible and creative: added saturation and some blurring of spectral
detail. The paper rates it "fair" overall, strongest on dense layered material and percussion, weakest on solo
voice and glockenspiel (paper 3.4 and 3.6). The profile says so in a `trn:caution`, because a person choosing an
effect for a live rig should know it colours the sound.

## The algorithm in the order it runs

**Analysis** reduces the input to *keyframes*, the local extrema, each with a position and a value (paper 2.1 to 2.3).

1. Differentiate the input with the derivative of a cubic B-spline, a 4-tap FIR whose coefficients are constants
   (paper equation 3). This suppresses the Nyquist-region noise a plain difference amplifies.
2. An extremum is a sign change of that derivative. Keep it only if its value differs from the last kept
   extremum's by more than a threshold epsilon (paper 2.2). The reference for the next candidate is the last
   saved extremum, which is a hysteresis, so noise below the threshold adds no keyframes. The paper uses 0.001, or
   -60 dB.
3. Place the kept extremum at a subsample position by reverse linear interpolation of the derivative (equations 4
   and 5), and take its value from the B-spline at that position (equation 6).

**Reconstruction** is playback through the sparse buffer (paper 2.4 and 2.5). Between keyframes `m` and `m+1`
the value is a cubic Hermite blend with both tangents set to zero, because every keyframe is an extremum (equation
11). That makes it a smoothstep: `y = v_m * h00(t) + v_(m+1) * h10(t)`, with no division and about half the
multiplications of a general spline.

**Stretching** adds three playheads over the keyframe buffer (paper 2.6, algorithm 3):

- a *reference* playhead moving at the time rate `tau`, which is where playback should be;
- a *play* playhead moving at the pitch rate `sigma`, which is where audio is read from;
- a *temporary* playhead, live only during a splice.

When the play playhead falls more than `K` keyframes from the reference, a splice starts. Its length `L` is the
number of samples spanned by the next `K` keyframes at the reference, so a sparse passage splices slowly and a
transient splices quickly. The output is a crossfade from the current playhead to one restarted at the reference
position, over `L / sigma` output samples. This is the adaptive crossfade, and it is what the paper contributes:
the density of the signal chooses the crossfade, with no analysis window.

## Latency, and the live case the paper does not cover

**The paper's offline mode analyses the whole signal first. Jiggy is live, so two things must be decided.**

*Block boundaries.* Analysis cannot know when the next extremum is. The paper's answer (2.7) is to save a keyframe
at each block boundary, which gives a baseline minimum rate, and to run reconstruction one block behind analysis,
for example 512 frames. The design adopts that, and the plugin declares `jig:latencyFrames 512`. The figure is
constant, unlike Lookahead's, so it needs no `latency` message ([latency.md](../latency.md) section 2), and a host
compensates it like any fixed delay. At a time rate of 1 and a pitch rate of 1 the output is the input delayed by 512
frames. A forced boundary keyframe is not a true extremum, so its zero tangent puts a brief flat spot into the
reconstruction. How audible that is at 128-frame spacing is to be measured before the hop is fixed; a hop of 512
may turn out wrong.

*The reference playhead and the live input.* In a live graph the input arrives at one second per second. A
reference playhead at `tau` below 1 falls further behind the write position every second, and above 1 it overtakes
it. Offline this does not arise. The plugin bounds the reference at both ends. When it reaches the newest keyframe,
or falls more than eight seconds behind, or comes within a leash and a margin of the oldest keyframe still held, it is
moved to 512 frames behind the input, which is where a fresh start would put it. Two consequences, both measured:

- **A time rate above 100 percent cannot run ahead of a live input.** With the pitch unchanged, the reference is
  brought back onto the play playhead each time, so the output plays at the input's own rate with nothing to splice.
  With the pitch also moved, the play playhead drifts from the reference and splices back repeatedly.
- **A time rate below 100 percent falls behind and then skips forward.** The skip is a splice.

The **play playhead has a bound of its own.** With a fast time rate and a raised pitch the reference is held back and
stays within a leash of the play playhead in keyframes, while the play playhead runs past the newest keyframe and
reads a constant. The first build did exactly that and froze its output. A play playhead past either end of what is
known now starts a splice whatever its distance from the reference, and `tests/dsp/keyframe.test.js` fails without it.

The panel and the profile's `trn:caution` say all of this. A *freeze* parameter is what a loop would later be.

## Parameters

Each is an `lv2:port` with a `jig:paramIndex`, generated into a panel by `Panel.js`, with no custom `jig:ui`. Ranges
follow the paper's examples (paper figure 4 used a pitch rate of 1.65 and a time rate of 0.84).

| # | symbol | range | default | unit | acts on |
|---|---|---|---|---|---|
| 0 | `time_rate` | 25 to 400 | 100 | `pc` | `tau`, the reference playhead's speed |
| 1 | `pitch_shift` | -24 to +24 | 0 | `semitone12TET` | `sigma`, the play playhead's speed, as 2^(n/12) |
| 2 | `splice_keyframes` | 4 to 256 | 16 | none | `K`, the leash, and so the length of a splice |
| 3 | `max_splice` | 5 to 500 | 200 | `ms` | the cap on `L`, which the paper's limitation 3 needs |
| 4 | `threshold` | -90 to -30 | -60 | `db` | epsilon, the analysis deadband |
| 5 | `mix` | 0 to 1 | 1 | none | wet and dry, the dry delayed by the latency |
| 6 | `output` | -24 to +12 | 0 | `db` | output gain |
| 7 | `quality` | Economy, Balanced, Full | Economy | scale points | analysis and reconstruction method, below |
| 8 | `stereo` | Linked, Independent | Linked | scale points | whether the channels share one keyframe schedule, below |

## Switchable cost, defaulting to the cheapest

**Two parameters trade quality for cost, and each defaults to its cheapest setting.** A person who wants a cheap
effect gets one without finding a switch, and a person who hears the artefacts turns the quality up. The cost of a
setting is the reason for the default, so each is stated.

`quality` is an enumeration with three scale points, taken from the paper's appendix (section 7):

| Setting | Analysis | Reconstruction | Cost and artefact |
|---|---|---|---|
| **Economy** (default) | Finite-difference derivative, extremum placed on the sample where the sign changes, stored as an integer | Linear interpolation between keyframes | Cheapest, and the most aliasing |
| **Balanced** | As Economy | Cubic smoothstep (equation 11) | Keeps integer positions, so no analysis interpolation, and removes the corners linear interpolation adds |
| **Full** | B-spline derivative (equation 3), subsample position (equations 4 and 5), B-spline value (equation 6) | Cubic smoothstep | The paper's measured method, and the dearest |

The paper publishes cycle counts only for the full method (about 34 to 61 per output sample), and says the time-
stretching behaviour is unchanged by the reduced variants and that aliasing is the cost (section 7). It does not
measure the other two, so no figure for Economy or Balanced is claimed here. They are to be measured on the built
plugin with `check-plugin --measure-budget` and recorded in the profile's comment, and a default chosen on an
unmeasured assumption is the failure CLAUDE.md warns about.

`stereo` has two scale points. **Linked** analyses one mono sum, finds one keyframe schedule and one set of splices, and
applies both to the two channels, which costs one analysis instead of two and keeps the splices of the two channels
together. **Independent** analyses each channel, the paper's own model, at twice the analysis cost, and its splices may
fall at different times. Linked is the default because it is cheaper. It is also less exact, because the sum's extrema
are not the channels' extrema, so the zero-tangent assumption fails slightly. That is another reason Economy
reconstruction is linear, which assumes no tangent.

**Changing either setting empties the keyframe ring and restarts the playheads**, because the buffer holds keyframes
made by one method and the other cannot read them. The change is applied at a quantum boundary and is audible as a
short gap. The panel's comment says so, and the plugin never switches on its own.

`splice_keyframes` has no unit in LV2, so its readout is a number, and the panel must still name it for a screen
reader: its name is "Splice leash" and its comment says keyframes. `time_rate` and `pitch_shift` are
independent, per the paper, so a stretch with unchanged pitch is `time_rate` alone. Pitch and time modulate
freely, and the paper says so (section 4).

## Memory, with nothing allocated in `process()`

The keyframe buffer is the largest allocation, and it is made in `jig_init` before the processor is ready. The paper
bounds the keyframe count at about half the sample count as a conservative worst case (2.8). The ring holds 131072
keyframes, a power of two so an index wraps with a mask, which is under three seconds of the densest material and
far longer of anything sparse, because the depth in time follows the density. A position needs more than an `f32`
over a long ring, so a keyframe is an `f64` position and two `f32` values (one per channel when linked), 16 bytes, and
the two rings are 4 MB together. They are a separate all-zero static, so they sit in the zero-initialised part of
memory and the module file is 19 KB, where a first build that kept them in the initialised state was 4.2 MB. This is
the whole of the allocation, and `WebAssembly.Memory.grow()` is never called afterwards, as
[module-abi.md](../module-abi.md) requires. When the ring is full the oldest keyframes are overwritten, and a reference
that comes within a leash of them is moved, as above.

## Stereo

**Extrema belong to one channel, so the `stereo` parameter chooses a trade-off and does not hide one.** Analysing the
channels separately finds different extrema and so splices at different times, which can wander the stereo image.
Analysing a mono sum shares the timing, but the sum's extrema are not the channels' extrema. The default is Linked,
for its cost, and it is to be measured against Independent for image drift on a panned source and on a wide stereo
clip before the default is final. If Linked drifts audibly on ordinary material the default changes, and the profile's
caution states whichever is chosen.

## Language and ABI

**Rust, `no_std`, a `jig:Abi1` audio effect**, as Quefrency is, built with the same `build.sh`, and a profile
generated by `bin/write-profile.js` from `profile.json`. Every `process()` call touches only the preallocated buffers.
The exact export names (`jig_init`, `jig_process`, `jig_set_param`, `jig_input_ptr` and the others) are in
[module-abi.md](../module-abi.md) and are not repeated here.

## Tests

- **Neutral setting.** With `time_rate` 100, `pitch_shift` 0 and `mix` 1, the output is the input delayed by 512
  frames within a stated error. The paper measures THD of -38 dB for odd and -86 dB for even harmonics on a 1 kHz sine
  (paper 3.2), so the test tolerance is set from a measurement of the built plugin and checked against those figures,
  not chosen to pass.
- **Stretch.** A 1 kHz sine at a time rate of 50 or 200 still measures 1 kHz. A pitch shift of 12 semitones measures
  2 kHz. A half-second burst at a time rate of 50 lasts about a second, and at 200 about half a second, because a
  live input cannot be played faster than it arrives.
- **Silence.** Input below the threshold produces no keyframes, and silence comes out, because the deadband is the
  thing that stops a noise floor being reconstructed.
- **Splices.** A bass note followed by a snare hit produces a long splice, then a short one (paper figure 3), checked
  by the splice lengths the processor reports.
- **Bounds.** Extreme rates, a full keyframe ring and denormals never give NaN, an infinity or a held note, and a
  hostile input (a full-scale square wave, white noise at full scale) keeps the keyframe count inside the allocation.
- **Every setting.** The neutral, stretch, silence and bounds tests run for each `quality` and `stereo` value, so no
  switch position is untested, and a test binds the profile's scale points to the processor's list of settings
  (a list in one file and a list in another is the recurring failure).
- **Defaults.** A test asserts the default of `quality` is Economy and of `stereo` is Linked, and that no other setting
  costs less in the measured render, so the stated default is the cheapest in fact.
- **Switching.** Changing a setting mid-render empties the ring, produces no NaN, and the output recovers in the
  stated time.
- **Real time.** `npm run check-plugin -- IRI --measure-budget` stays inside its render-time budget, and the module
  has no imported memory (`npm run check-wasm-abi`).
- **State.** The playheads are not parameters and are not saved. A restored session starts with an empty ring, which
  is stated rather than left to surprise.

## What was measured

All of this is on the built plugin, in node, at 48 kHz.

| Measurement | Result |
|---|---|
| Neutral reproduction of a 1 kHz sine, error against the input delayed by 512 | Economy -13.4 dB, Balanced -24.0 dB, Full -23.9 dB |
| The same without forced keyframes (hop raised for the run) | Economy -13.4 dB, Balanced -34.4 dB, Full -33.5 dB |
| Pitch error, 1 kHz sine shifted by 12, -12 and 7 semitones | within 4 percent at Economy, 2 percent at the others |
| Cost, 20 seconds of dense stereo, as a share of realtime | Linked 0.43 to 0.46 percent at every quality; Independent 0.63 to 0.68 percent |
| Cost through the native adapter's WAMR interpreter, 7 seconds of dense stereo at 512-frame blocks, median of five runs | Linked Economy 0.109, Full 0.128; Independent Economy 0.186, Full 0.213, as a multiple of realtime |

The paper's -38 dB on odd harmonics (3.2) is the neighbourhood of the -34 dB with no forced keyframes. **The forced
keyframes cost about 10 dB at Balanced and Full**, as the design feared: each is not a true extremum, so its zero
tangent leaves a flat spot. Economy's -13 dB is the straight lines between extrema, which turn a sine into a
triangle-like wave.

## Open decisions

1. **The default for `quality`.** Economy is the cheapest by the paper's operation count, and the request was to default to
   the cheapest. Under node's JIT the three settings cost the same within noise. **Under the native adapter's WAMR
   interpreter Economy is about 15 percent cheaper than Full** (Linked 0.109 against 0.128 of realtime, Independent 0.186
   against 0.213), and Balanced sits with Economy in the one run taken. That is a real saving where it matters and a small
   one, and every setting is far inside realtime, against Mop's 1.70. Economy is also the roughest by 10 dB. The default
   stays Economy as asked; a person who wants the smoother curve at almost no cost has Balanced. Linked stereo is a larger
   saving, about 70 percent under WAMR, so its default stands. The driver is `native/jigdaw-adapter/tools/wamr_time.cpp`.
2. **Reducing the forced-keyframe error.** A longer hop means fewer flat spots and more latency. Candidates are placing the forced
   keyframe where the signal is flattest within the hop, or giving it the signal's own tangent, which departs from the
   zero-tangent form. Neither is built.
3. **Whether Linked stereo drifts the image.** The test holds the level balance of a panned sine through a pitch shift
   within 1 dB. A wide stereo clip has not been listened to, which only a person can do.
4. The later directions in paper 3.8 (storing the second derivative to reduce contrast loss, a Teager-Kaiser transient
   detector) are not part of version one.
