# Publishing a JUCE plugin's DSP as a JigDAW plugin

For someone who already has a working JUCE plugin and wants it loadable by IRI as well,
without starting from nothing. Read [for-plugin-authors.md](for-plugin-authors.md) first for
what a profile is; this page is about getting from an existing JUCE codebase to one, not a
replacement for it.

## Two different things share the word "JUCE" here

**Hosting** JigDAW plugins inside a JUCE-based application is the other direction, and a
different document: [native/jigdaw-adapter/src/juce/](https://github.com/danja/jigdaw/blob/main/native/jigdaw-adapter/src/juce/README.md)
is a JUCE `AudioProcessor` that loads JigDAW plugins by IRI and runs them, for a JUCE
developer building a DAW or a plugin host. This page is the reverse: publishing your own
plugin's DSP so a JigDAW host can load it.

## What is not possible, checked rather than assumed

JUCE's own build system has no WebAssembly export for a plugin's DSP. `juce_add_plugin`'s
`FORMATS` builds VST3, AU, CLAP, Standalone and so on; nothing in JUCE's CMake API or its
Projucer produces a portable module the way `jig:Abi1` needs. There is no flag to turn on
that makes your existing `AudioProcessor` also come out as a `.wasm` file. Anyone offering
that as a checkbox is describing a tool that does not exist yet.

## What is possible, and what it actually takes

A `jig:Abi1` module is `wasm32`, built with `-nostdlib`: no imports, because a host with no
JavaScript engine cannot supply any, and no allocator, because nothing on the audio thread
may allocate. Your `AudioProcessor::processBlock` almost certainly is not written this way.
It uses `juce::AudioBuffer`, probably some of `juce::dsp`, and whatever JUCE's own container
and smart pointer types you reached for, none of which compiles under `-nostdlib`.

So the actual job has two parts, and only one of them can be automated.

**The DSP itself has to be extracted into a portable core**: plain functions or a plain
struct, raw float pointers in and out, no JUCE type crossing the boundary. This is manual.
No tool here or anywhere else can safely decide which parts of your `processBlock` are really
your algorithm and which are JUCE plumbing around it; that judgement is yours, the same as it
would be porting to any other format with different constraints. Once it exists, the same
portable core is called from your existing `AudioProcessor` unchanged and from a small
`jig_init`/`jig_process` shim, which is exactly the split
`native/jigdaw-adapter/src/juce/PluginProcessor.cpp` demonstrates in the other direction: one
core, two shells.

**Everything about your parameters is mechanical, and is automated below.** JUCE already
knows every parameter's id, name, range, default and (for a choice) its labels. Re-typing
that into a `profile.json`'s `ports`, a `jig_set_param` dispatch and a processor's
`parameterDescriptors` by hand is pure transcription, the kind of task that silently drifts
the moment one of the three is updated and the other two are not.

## The starting point for the DSP

Copy [plugins/boost/](https://github.com/danja/jigdaw/blob/main/plugins/boost/): a gain
stage in C++, everything past `jig_process` being ABI wiring rather than DSP. `boost.cpp` is
the shape your portable core's `jig_process` takes; `boost-processor.js` is the shape your
AudioWorklet processor takes; `build.sh` is the `clang++ --target=wasm32 -nostdlib` command
that builds it, no Emscripten and no sysroot.

## The parameter layer, automated

[`native/jigdaw-adapter/src/juce/tools/DumpParameters.h`](https://github.com/danja/jigdaw/blob/main/native/jigdaw-adapter/src/juce/tools/DumpParameters.h)
is a single header, meant to be copied into your own JUCE project rather than built here: it
needs only `juce_audio_processors_headless`, nothing GUI-related. Call
`jigdaw::dumpParametersAsJson` from anywhere your `AudioProcessor` is already constructed
(a `Standalone`'s constructor, a menu item, a one-off `main()`), write what it returns to a
file, and remove the call. It reads your parameters' live objects, so it cannot misparse
anything the way a text scan of your source could: JUCE has already resolved every range,
default and choice list correctly, and this only reports what JUCE itself already knows.

```json
{
  "parameters": [
    { "id": "gain", "name": "Gain", "type": "float", "minimum": 0, "maximum": 2, "default": 1 },
    { "id": "mode", "name": "Mode", "type": "choice", "default": 1, "choices": ["Plate", "Hall", "Bloom"] }
  ]
}
```

[`bin/juce-params-to-profile.js`](https://github.com/danja/jigdaw/blob/main/bin/juce-params-to-profile.js)
turns that into the three things transcribed by hand otherwise:

```sh
node bin/juce-params-to-profile.js params.json plugins/yourplugin/profile.json
```

- `plugins/yourplugin/profile.json`'s `ports` array, written in place, everything else in the
  file left untouched.
- A `jig_set_param` switch statement, printed to the terminal, one `case` per parameter in
  the same order the ports were written in. The variable names are the parameter's own id;
  renaming a handful of case bodies to match your portable core's actual field names is still
  yours to do.
- The processor's `PARAM_INDEX` and `parameterDescriptors()`, in the shape
  `plugins/boost/boost-processor.js` already uses, so pasting them in is the only edit that
  file needs beyond your own DSP call.

A `bool` parameter becomes a toggled port; a `choice` parameter becomes an enumerated one
with a `lv2:scalePoint` per choice, named exactly as JUCE names them. Both are read from the
live parameter object, not guessed at from its type name.

## The rest of the workflow

1. Copy `plugins/boost/` to `plugins/yourplugin/`.
2. Extract your DSP into a portable `jig_process`, by hand.
3. Drop in `DumpParameters.h`, run your project once, save the JSON it prints.
4. `node bin/juce-params-to-profile.js params.json plugins/yourplugin/profile.json`, then
   paste the two printed snippets into `boost.cpp` and `boost-processor.js`'s copies.
5. `./build.sh`, `npm run validate -- plugins/yourplugin/profile.ttl`, then load it in a
   browser and listen.

The checklist in [for-plugin-authors.md](for-plugin-authors.md) is the same checklist here:
nothing about arriving from JUCE relaxes any of it.

## What this does not solve

A plugin's own `jig:ui` is not generated from a JUCE editor, the same way it is not
generated from a DPF one: a `juce::AudioProcessorEditor` is arbitrary drawn UI with no
declaration a browser could read, and the generated panel from `lv2:port` declarations is
what a plugin gets instead, the same as every other plugin here without a hand-written
`jig:ui`. `juce::dsp` modules that lean on allocation, exceptions, or anything else
`-nostdlib` refuses need reimplementing in your portable core, not merely relinking; nothing
here shrinks that work, only the transcription around it.

---

[Back to the documentation index](index.md) &middot;
[Building a plugin](for-plugin-authors.md) &middot;
[Writing a host instead](for-hosts.md)
