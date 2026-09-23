# /new-plugin: scaffold a new JigDAW plugin

Creates a new JigDAW plugin end to end: profile, processor, generated `profile.ttl`, and a
test that loads it through the real host path. Provide a name and a role, e.g.:

```
/new-plugin Chorus effect
```

## Arguments

`$ARGUMENTS` is `<PluginName> <role>`, where role is one of `effect`, `instrument`,
`generator`.

- `effect`: audio in, audio out. `trn:AudioEffect`.
- `instrument`: MIDI in, audio out. `trn:Instrument`, `trn:AudioInstrument`.
- `generator`: MIDI in, MIDI out, no audio. `trn:MidiGenerator`, the shape BassGen uses.

## Before starting

List `plugins/` and confirm the directory name this would create does not already exist. The
directory name is `PluginName` lowercased with spaces turned to hyphens (`Bit Crusher` becomes
`bit-crusher`).

There is no registry file to edit. Unlike valis, JigDAW discovers plugins by walking
`plugins/`: `src/catalogue/PluginDirectories.js` finds any directory holding a `profile.ttl`,
and `npm run build:index` regenerates `plugins/index.json` from whatever it finds. A plugin
that validates and sits in `plugins/` is registered by existing there.

## What to do

Given `PluginName` and `role`, with directory name `name`:

### 1. Decide: WebAssembly or plain JavaScript

Default to plain JavaScript. `jig:module` is optional
([docs/for-plugin-authors.md](../../docs/for-plugin-authors.md) section 3), and a scaffold
that compiles and validates immediately, with no toolchain, is more useful than one that
needs Rust or clang installed before it can be tried. `plugins/tremolo/` is the model: copy
its shape rather than inventing a new one.

If the plugin genuinely needs WebAssembly (real DSP state, a tight inner loop), say so rather
than scaffolding it, and point at a worked example to copy from instead, and stop here.
Templating a build toolchain is a different, larger job than this command does. Two starting
points, by language: `plugins/boost/` (C++, `clang++ --target=wasm32 -nostdlib`) is the
minimal one, built to be copied, everything past `jig_process` being ABI wiring rather than
DSP; `plugins/cascade/` (Rust, `cargo build --release --target wasm32-unknown-unknown`) is a
real reverb and shows the same ABI in a plugin that actually does something. Prefer
`plugins/boost/` unless Rust is specifically wanted.

### 2. `plugins/<name>/profile.json`

Copy `plugins/tremolo/profile.json` and adjust the `shape`, `roles`, `accepts` and `produces`
for the role:

**effect**

```json
"roles": ["trn:AudioEffect"],
"accepts": ["trn:Audio"],
"produces": ["trn:Audio"],
"requires": [],
"shape": {
  "audioInputs": 1, "inputChannels": 2,
  "audioOutputs": 1, "outputChannels": 2,
  "renderQuantum": 128, "latencyFrames": 0
}
```

**instrument**

```json
"roles": ["trn:Instrument", "trn:AudioInstrument"],
"accepts": ["trn:Midi"],
"produces": ["trn:Audio"],
"requires": ["jig:MidiEvents"],
"shape": {
  "audioInputs": 0,
  "audioOutputs": 1, "outputChannels": 2,
  "renderQuantum": 128, "latencyFrames": 0
}
```

**generator** (BassGen's shape: no audio at all, still rendered every block so it can emit
MIDI, see contract section 3.1's note on a driven node)

```json
"roles": ["trn:MidiGenerator"],
"accepts": ["trn:Midi"],
"produces": ["trn:Midi"],
"requires": ["jig:MidiEvents", "jig:MidiOut"],
"shape": {
  "audioInputs": 0, "audioOutputs": 0,
  "renderQuantum": 128, "latencyFrames": 0
}
```

`resources` names only the processor, no `module`:

```json
"resources": { "processor": "<name>-processor.js" }
```

Write `rdfs:comment` as one honest sentence about what the plugin actually does. Leave
`ports` as a minimal placeholder (one or two parameters): the point of the scaffold is a
plugin that loads and validates, not a finished instrument.

### 3. `plugins/<name>/<name>-processor.js`

Copy `plugins/tremolo/tremolo-processor.js`'s shape exactly: the `parameterDescriptors`
matching the ports in step 2, the `init`/`ready` handshake in `handle()`, and a `process()`
that:

- allocates nothing;
- writes every output channel every frame, silence where there is nothing to say
  (contract section 4.2);
- for an `effect`, reads `inputs[0]` and treats a disconnected input as silence rather than
  reading index 0 of nothing;
- for an `instrument` or `generator`, ignores audio input entirely and drives its own state
  from the `events` messages it queues from `handle()` (see `plugins/pulse/pulse-processor.js`
  or `plugins/bassgen/bassgen-processor.js` for the MIDI queue shape, which is written in Rust
  there, but the queue discipline, bounded, preallocated, drop and report on overflow per
  contract section 6.3, is the same regardless of language).

Change `registerProcessor('tremolo', ...)` to `registerProcessor('<name>', ...)`, matching
`registeredName` in the profile.

### 4. `plugins/<name>/build.sh`

Copy `plugins/tremolo/build.sh` verbatim except the path comment. No compile step: it only
regenerates `profile.ttl` from `profile.json` and the processor as they stand on disk.

```sh
chmod +x plugins/<name>/build.sh
./plugins/<name>/build.sh
```

### 5. Validate

```sh
npm run validate -- plugins/<name>/profile.ttl
```

Fix whatever it reports before going further. A profile that does not validate is not a
plugin yet.

### 6. Register in the index

```sh
npm run build:index
```

Confirms the new plugin was found: the summary line names every plugin, including this one.

### 7. Test

Create `tests/host/<name>.test.js`, modelled on `tests/host/tremolo.test.js`: load the
plugin through the real `PluginLoader`/`Engine` path (`OfflineContext`, `OfflineWorkletNode`,
`directoryFetch`), not a hand-built stub. At minimum:

- it loads and reports ready;
- for an effect, a neutral parameter setting passes the signal through unchanged, which
  proves the audio path is really connected rather than faked;
- output is finite (`Number.isFinite`) on every sample, for silence and for real input;
- it never throws.

### 8. Verify

```sh
npx vitest run tests/host/<name>.test.js
npm test
```

`npm test` must move the test count by however many were added. If it does not, the suite did
not run (`AGENTS.md`, working rules).

### 9. Update TODO.md

If this plugin was tracked as an inbox item or a TODO entry, mark it done there with what was
built and how it was verified, in the style the rest of that file already uses. Nothing here
is committed unless asked.
