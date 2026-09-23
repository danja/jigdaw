# The JUCE-hosted adapter

A second shell over `jigdaw_core`, alongside `src/dpf/`: the same portable
core (`Chain`, `Profile`, `Integrity`, `Module`, `Params`) loading a JigDAW
plugin by IRI and running it, this time inside a JUCE `AudioProcessor` rather
than a DPF `Plugin`. Built to answer the question in `TODO.md`: whether a
JUCE-based adapter of the same shape is worth having beside the DPF one,
mainly for AU, which DPF does not target and JUCE does.

The other direction, publishing a JUCE plugin's own DSP as a JigDAW plugin rather than hosting
JigDAW plugins inside a JUCE application, is a different document:
[docs/for-juce-developers.md](../../../../docs/for-juce-developers.md). `tools/
DumpParameters.h` in this directory belongs to that side, not to the adapter below.

## This is not Apache-2.0

The rest of this repository is Apache 2.0. This directory is not, because it
links [JUCE](https://juce.com/), and JUCE's free tier is dual-licensed AGPLv3
or a paid commercial license, never Apache-2.0 or anything compatible with
it. Building `JIGDAW_BUILD_JUCE_PLUGIN` produces a binary under whichever of
those two licenses covers the JUCE checkout it was built against:

- Built against JUCE under its own AGPLv3 option, the resulting
  `jigdaw-juce-adapter` binary is AGPLv3, which requires that anyone who
  receives it (including over a network, per AGPL section 13) can also
  receive its complete corresponding source, this directory's included.
- Built against a commercial JUCE license, ordinary commercial terms apply
  instead, as agreed with JUCE separately from anything this repository says.

Nothing else this repository produces is affected. `JIGDAW_BUILD_JUCE_PLUGIN`
is `OFF` by default precisely so that building the rest of the project,
including the DPF-hosted VST3/CLAP/LV2, never depends on JUCE and never
produces an AGPL-encumbered binary by accident.

## What it is

`PluginProcessor.h`/`.cpp` is the DSP side, the JUCE equivalent of
`src/dpf/JigdawPlugin.cpp`: same atomic chain swap, same sub-block loop
against `Chain::maxFrames()`, same real-time rules. One difference worth
knowing: JUCE reports host transport position in quarter notes directly
(`AudioPlayHead::PositionInfo::getPpqPosition()`), so filling in
`jigdaw::Transport` needs no tick-per-beat conversion the way DPF's BBT block
does.

`PluginEditor.h`/`.cpp` is a JUCE-native editor rather than a port of
`src/dpf/JigdawUI.cpp`'s NanoVG one: a text box for the IRIs, a Load button,
and a read-only view of the load report. JUCE gives a plugin real widgets, so
the job the DPF UI's 728 lines does by hand (drawing a scrollable list of up
to 128 parameter slots) is a `TextEditor` here instead; the parameter-to-slot
mapping lives in the report text rather than a drawn list, which is what the
DPF UI's scrolling exists to make readable and this editor does not need.

## Building it

```sh
cmake -S native -B native/build \
  -DJIGDAW_BUILD_JUCE_PLUGIN=ON \
  -DJIGDAW_JUCE_DIR=/path/to/JUCE
cmake --build native/build --target jigdaw-juce-adapter_VST3 jigdaw-juce-adapter_Standalone
```

Not wired into `install.sh`, on purpose: that script installs the Apache-2.0
DPF adapter, and adding an AGPL-or-commercial target to the default install
path is exactly the kind of thing that should need a person to opt into
explicitly, every time, rather than a flag remembered once.
