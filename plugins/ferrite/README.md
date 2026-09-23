# Ferrite

A cabinet impulse response and a neural amp model in series: input trim, a WaveNet forward
pass standing in for the amp and preamp, a direct time-domain convolution against a cabinet
impulse response, output level. From the inbox: an impulse response and neural amp modeler
runner, referencing [NeuralAmpModelerPlugin](https://github.com/sdatkinson/NeuralAmpModelerPlugin)
as the shape of thing to build.

## What is ported and what is not

The neural network inference is [nam-rs](https://github.com/OpenSauce/nam-rs), depended on
rather than reimplemented. Reimplementing WaveNet inference from the `.nam` format's own
documentation, with no reference output to check the result against, is exactly the kind of
confident-but-unverified work `AGENTS.md` warns about: the format has grown FiLM
conditioning, a slimmable-width architecture and a packed layer variant since it was first
published, and getting the numeric details of any of that wrong produces audio that sounds
plausible and is not what the model actually does. `nam-rs` is a from-scratch Rust port
validated numerically against the reference Python and C++ implementations within `1e-5` per
sample (its own test suite carries the parity fixtures), MIT-licensed, and real-time-safe by
its own design (no heap allocation once a model is loaded). Attribution, following its own:

| Project | Role | License |
| --- | --- | --- |
| [neural-amp-modeler](https://github.com/sdatkinson/neural-amp-modeler) | Reference trainer and `.nam` exporter | MIT |
| [NeuralAmpModelerCore](https://github.com/sdatkinson/NeuralAmpModelerCore) | Canonical C++ inference library | MIT |
| [nam-rs](https://github.com/OpenSauce/nam-rs) | The Rust port this plugin depends on | MIT |

The cabinet impulse response convolution is hand-written: an ordinary direct time-domain FIR,
`O(IR_LEN)` per output sample, through a fixed-size shift buffer capped at 8192 samples (170
ms at 48 kHz). Longer is refused at load rather than truncated silently.

## What is shipped, and what it is not

`wavenet.nam` is `NeuralAmpModelerCore`'s own `example_models/wavenet.nam` (MIT, Steven
Atkinson), a small test fixture, not a captured amp: 131 weights, a two-layer WaveNet with a
receptive field of 23 samples. It exists so this plugin does something real out of the box;
replace it with a model you have trained or downloaded.

`cab.wav` is synthetic, generated for this example: a sharp transient and a short cluster of
decaying resonances, shaped like a cabinet impulse response rather than captured from one.
Nobody's real cabinet sounds like it. Replace it with a real capture.

## Loading your own model or impulse response

Both are `jig:asset` resources, fetched, verified and delivered to the module exactly like
the WebAssembly module itself (`docs/messaging.md` section 1.2), so replacing either is
`bin/write-profile.js` regenerating the digests: replace `wavenet.nam` or `cab.wav` in this
directory and rerun `build.sh`. `wavenet.nam` must be a `.nam` file `nam-rs` supports; see its
[architecture support notes](https://docs.rs/nam-rs). `cab.wav` must be PCM16, PCM32 or
IEEE-float32 WAV, mono or multi-channel (averaged to mono on load), at 8192 samples or fewer.

## Sample rate is not negotiable

Neither the neural model nor the impulse response is resampled. `nam-rs`'s own documentation
states why for the model: "dilations and recurrence are defined in samples, not seconds", and
a convolution's taps are timed the same way. `jig_load_nam` and `jig_load_ir` (the module's
own loaders, a convention with this plugin's processor rather than part of the host contract)
each return 1 rather than 0 when the file's own declared sample rate does not match the
session's, so a mismatch is a reported condition rather than silently wrong audio. Recapture
or retrain at the session's rate, or run the session at the file's.

## Parameters

Two, both plain gain stages: **Input** (0 to 4×, default 1×) before the model, **Output** (0
to 2×, default 1×) after the cabinet convolution. The model itself is not runtime-adjustable:
it is a fixed captured snapshot of one amp at one set of settings, the same way a real
cabinet impulse response is a fixed capture of one cabinet and one microphone position.
Different settings are a different `.nam` file.
