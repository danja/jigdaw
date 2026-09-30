# TODO

What the project needs. Remove an item when its implementation and verification are
complete. Review periodically.

## From the inbox

- [ ] **Mop glitches in the JigDAW Adapter VST in Reaper.** From the inbox,
      2026-09-30: user report, no buffer size or version details yet.
      **Diagnosed 2026-09-30, headlessly: mop costs 1.70x realtime through the
      real native path and cannot keep up.** Measured with a scratch driver
      (`/tmp/opencode/mop_probe.cpp`, not committed) over `jigdaw_core` at
      Release: 8 s of A-minor line plus channel-10 drums with sustain held, in
      512-frame host buffers, took 13.6 s wall at 48 kHz and the same at
      44.1 kHz. Output is otherwise correct (peak 0.10, no dead windows,
      MIDI/channel/CC path intact, slicing intact), so this is throughput, not
      corruption: every realtime block overruns, which is continuous dropouts.
      Contrast: 8b8 through the same path costs 0.20x, and mop under node/JIT
      costs 0.06x, which is why no browser or offline test ever saw it. Root
      cause shape: the adapter runs WAMR as a pure interpreter (no executable
      pages, by decision in `native/cmake/FindOrFetchWamr.cmake`), and the OPL
      chip emulator steps all operators per sample; the voice cap changes
      nothing (8 vs 18 voices measured identical) and neither does buffer
      size. Fixes are a maintainer decision, not silent work: WAMR AOT/JIT
      needs wamrc and LLVM as build dependencies (the file says the gain was
      not needed; for mop 2x or more is needed), or mop-side surgery against
      the unmodified-Opal rule. Reporter-side confirmation in HUMANS.md
      (a frozen/bounced track plays clean).

- [x] **A "Chiptune" preset: generative chiptune across several tracks.** From
      the inbox, 2026-09-30. **Done 2026-09-30.** `web/presets/chiptune.ttl`
      ("Chiptune", in the index): A minor at 140 BPM, six tracks, ten nodes,
      eight connections, dry throughout. MelGen states the lead (A4, seed 11)
      into a square-lead Mop (program 80); that line fans out to
      Counterpointer (A, 2-bar cycle) and Cadence (A natural minor, 2-bar
      cycle), both feeding one shared 8b8 chip bus that also takes DrumGen's
      electro kit (GM map, channel 10); BassGen drives a square Pulse and
      Ground plans a 16-bar techno sub form into a triangle Pulse. Scale,
      program and genre choices verified against the DSP sources. Passes the
      standard preset bar plus `tests/ui/Chiptune.test.js`, 10 tests driving
      every voice with the preset's own settings.

- [ ] **A keyframe time-stretch plugin from the DAFx26 extrema-sampling paper.**
      From the inbox, 2026-09-26. The paper is at `/chalet/github/dafx26-paper`
      (Nielsen, DAFx26, CC BY 4.0, credit required): a content-adaptive
      overlap-add where the spacing between local extrema drives both when a
      splice happens and how long its crossfade lasts. Analysis is a 4-tap
      B-spline derivative with a deadband threshold and subsample refinement;
      reconstruction is smoothstep interpolation between timestamped extrema;
      stretching tracks reference, play and temporary playheads with a leash of
      K keyframes. Output is sample by sample with no block latency in
      principle; live block processing needs boundary keyframes (paper section
      2.7, e.g. a 512-sample delay, declared as `jig:latencyFrames`). Likely
      parameters: time rate, pitch rate, splice threshold K, maximum splice
      duration, analysis threshold epsilon. Rust, `no_std`, Abi1 audio effect.
      Design doc goes in `docs/plugins/` before code. Not started.

- [ ] **An additive resynthesis effect that builds harmonics from the input.**
      From the inbox, 2026-09-26 (r/synthesizers idea): pitch-shift the input
      to 2x, 3x and 5x, then use feedback to supply the intermediate non-prime
      harmonics (4x from 2x fed back, 6x from 2x and 3x combined, and so on).
      Needs design before code: what the pitch shifters are, what the feedback
      network is, and how gains stay bounded. Any cycle needs an explicit
      delay by the latency rules, and latency inside a cycle is never
      compensated. Probably Rust, Abi1. Not started.

- [ ] **A panning effect with non-linear motion.** From the inbox, 2026-09-26
      (a Reddit comment asking what potential the "panning fuckery" genre still
      has). Proposed answer: an auto-panner where the position follows
      non-linear trajectories rather than a single LFO, with modes for circular
      motion, random walk and envelope-follower-driven jumps, plus per-band
      panning so low and high content can move independently. Needs design
      before code: the trajectory set, the parameter list with units, and a
      mono-compatibility rule. Not started.

- [ ] **A static check that a `jig:Abi1`/`jig:Abi2` module never calls `memory.grow`.**
      2026-09-24: `npm run check-wasm-abi -- your.wasm` (`src/validate/WasmAbi.js`) now checks
      the easy half of module-abi.md's calling sequence step 1 statically, an exact and
      cheap read of the import section: a module declaring the ABI MUST have none. The harder
      half, whether the module ever executes `memory.grow` (forbidden after `jig_init`), was
      not attempted. It needs decoding every instruction in the code section correctly,
      including the newer 0xFC/0xFD-prefixed ones (bulk memory, saturating conversions, SIMD).
      `@webassemblyjs/wasm-parser`, a real and maintained parser, was tried against this
      project's own plugin `.wasm` files and failed to decode `ferrite.wasm`
      ("Unexpected instruction: 0xfc00"), so a hand-rolled decoder here would very likely be
      wrong in the same shape, which AGENTS.md already names as worse than no check at all.
      The other remaining candidate, a wall-clock render budget, is now built: `npm run
      check-plugin -- IRI --measure-budget` (`checkRenderBudget` in `PluginCheck.js`) times two
      renders of different lengths after a discarded warm-up and reports the slope as a
      multiple of real time. Deliberately coarse and said so in its own docstring: it runs in
      Node, offline, not on a real audio thread at a fixed priority, so it can only ever catch
      a plugin off by orders of magnitude (an unbounded loop, say), not one merely tight on a
      slow device. `memory.grow` is the one piece of this item still open.

## Namespaces

## Blocking, cross-repository


## The application

Behaving more like a real DAW, an open-ended direction rather than a phase with an end. Plugin-related parts should have most attention.

Derived 2026-09-30 from OpenStudio `docs/implemented_features.md` and
`docs/USER_MANUAL.md`, filtered for what fits a browser host. Native-only
items (ASIO/WASAPI device setup, JUCE/VST3/CLAP/LV2 hosting, NAM capture
hardware flows, ONNX runtimes, ACE-Step/Stable Audio local generation,
DDP, ARA, MCU/OSC/MTC, video post, surround/VBAP, 32-bit bridge) are
deliberately excluded: the browser has no device driver layer, no native
plugin ABI, and no bundled heavy model runtime. Where a heavy analysis
(YIN pitch, Basic Pitch, stem separation) could run in WASM or ONNX in
the page, it is marked as research, not committed.

### Phase A. Arrangement editing

Goal: clips on the timeline behave like clips in a real arrange view.

- [ ] **Clip split, trim, move, copy, duplicate, delete, nudge.** What Jiggy
      has today is move plus record/import. Add split at playhead and at
      click, trim by drag and by keys, fine nudge, duplicate. Each as one Op
      over the existing dispatcher, undoable, keyboard reachable.
- [ ] **Fades and auto-crossfade.** Per-clip fade in/out with a curve, plus
      a crossfade where two audio clips overlap. Needs vocabulary first:
      where fade state lives in the project graph.
- [ ] **Clip mute, lock, color, grouping.** Mute (plays silence, keeps data),
      lock (refuses edits), color (editor graph only), multi-clip group so
      moves apply together. Color and lock live in the editor graph per the
      architecture rules, never in the compiled graph.
- [ ] **Takes and comping.** Keep each recorded pass as a take under one clip
      (TrackRecorder already captures passes), with select-active-take and
      explode-to-tracks. Builds on the done record item above.
- [ ] **Slip edit, reverse, normalize.** Non-destructive offset of audio
      inside its clip bounds; reverse and normalize as offline render ops on
      the take bytes. Time stretch and pitch shift stay out: they need a
      DSP design first (see the DAFx26 item under From the inbox).
- [ ] **Razor areas, ripple modes, time selection ops.** Razor selection that
      cuts across tracks, ripple that closes or preserves the gap, time
      selection cut/copy/delete/insert-silence. One Op each, over the same
      changeset path as clip ops.
- [ ] **Markers, regions, region manager.** Named positions and ranges with a
      list view, jump by keys, loop a region. Needs vocabulary first, the
      way sends do (existing item below).
- [ ] **Tempo map, time signature, tap tempo.** Transport already maps beats
      to seconds; add signature changes and a tap-tempo Op that sets the map.
      Scheduler and piano roll read the same map.

### Phase B. MIDI editing

Goal: the piano roll covers routine note and controller work.

- [ ] **Velocity, CC and pitch-bend lanes.** Per-note velocity plus one lane
      per controller, drawn under the roll, keyboard editable. Builds on the
      existing roll (`src/ui/PianoRoll.js`).
- [ ] **Quantize and transforms.** Quantize selection, transpose/octave,
      velocity scale, reverse, invert, humanize, scale snap. Each a pure
      function over notes with a test, then one Op.
- [ ] **Step input and virtual keyboard.** Enter notes from keys one step at
      a time; keep the on-screen keyboard playable from touch. Keyboard
      before pointer per the interface rules.
- [ ] **MIDI import and export.** Read and write a Standard MIDI File for one
      track, plus project-wide export. No new timing model: reuse the
      transport map from Phase A.
- [ ] **Multi-clip editing and drum view.** Show two clips side by side for
      reference; a drum lane view where the track holds a kit. DrumKit is
      the worked instrument to verify against.
- [ ] **MIDI panic and input readiness.** One action that sends note-offs on
      every track, plus a visible state when Web MIDI is denied. Pairs with
      the existing "Web MIDI input" item under Before there is code.

### Phase C. Mixing, routing and automation

Goal: gain staging and motion without leaving the page.

- [ ] **Master strip and master automation.** Extends loose ends item 1 above:
      a `jig:master` term first, then level/pan/mono in the mixer view, then
      automation on the same lane machinery as tracks.
- [ ] **Sends and receives.** The existing inbox item stands; OpenStudio adds
      pre/post tap, send level/pan, and a routing matrix view. Same
      vocabulary-first rule, same cycle refusal as any other connection.
- [ ] **Buses, folder tracks, groups.** A bus as a track that mixes other
      tracks; a folder as an editor-only grouping; linked faders as a group
      param. Bus needs compiler work (latency through the sum); folder does not.
- [ ] **Automation lanes.** Read, write, touch and latch per track and per
      parameter, drawn lanes with range replace and clear, move-with-items
      option, envelope manager list. Needs vocabulary first: what an
      envelope is in the project graph and how the scheduler renders it.
- [ ] **Mixer snapshots.** Save and recall every strip and send as one named
      object, undoable recall. Reuses the snapshot path UndoHistory already
      takes for projects.
- [ ] **Metering and gain staging.** Peak/RMS per strip with clip reset,
      phase invert, stereo width, pan law. LUFS, phase correlation and
      spectrum stay meter-only displays if built at all, never claims about
      loudness compliance.
- [ ] **Sidechain routing in the UI.** Dynamix already takes a side chain
      input; expose it as a routable port in the connection list, not only
      as a profile fact.
- [ ] **Freeze, render in place, consolidate.** Freeze a track to its post-FX
      audio (reuse TrackRecorder takes), render in place to a new clip,
      consolidate a range to one file. All three reuse the Phase E bounce path.

### Phase D. Plugin and effect workflows

Goal: everyday FX handling around the plugins already hosted.

- [ ] **Bypass, reorder, safe mode.** Bypass per node (keep state, pass dry),
      drag and keyboard reorder of a track chain, open-with-FX-bypassed
      recovery path. Reorder recompiles the unchanged project the way the
      latency item under Before there is code already does.
- [ ] **Plugin presets and A/B compare.** Named parameter sets per plugin IRI,
      saved beside the session, with A/B slots that swap without a revision.
      Builds on the panel grouping and parameter paths already shipped.
- [ ] **FX-chain presets.** Save and load a whole track chain including order
      and settings. A collection of IRIs plus settings, not a new format.
- [ ] **MIDI learn and parameter mapping.** Bind a controller to a parameter
      explicitly (learn mode), on top of the declared CC bindings already
      done for Quefrency and 8-Bit 8asterd. Pairs with the open "show a
      controller value" item under Quefrency: learned values need the same
      processor-to-host message.
- [ ] **Input, master and monitoring FX chains.** Where a chain may sit
      besides a track: input monitoring chain, master chain (needs the
      `jig:master` term from Phase C), monitoring-only chain that never
      renders. Render path must exclude the monitoring chain by construction.
- [ ] **Channel strip EQ modal.** A small built-in EQ view per strip using
      existing plugins rather than a new DSP build, if strips need one at all.

### Phase E. Render, export and delivery

Goal: a mix leaves the page as files, reproducibly.

- [ ] **In-page offline bounce.** Render project, time selection, region, or
      razor range through the same graph the page plays, including latency
      compensation and tails. `bin/host.js` already renders in node; this is
      the page equivalent with the same frame counts.
- [ ] **Stems and add-back.** Render every track (or every sounding track) to
      takes, and offer rendered output back into the project as a clip. Reuses
      the WAV-take path the record item built.
- [ ] **Formats and options.** WAV always; AIFF, FLAC, MP3, OGG only if the
      encoder runs in the page (WebCodecs or a WASM encoder), with sample
      rate, mono/stereo, normalize, tail and dither options. No FFmpeg
      dependency: OpenStudio shells to system FFmpeg, which a page cannot do.
- [ ] **Render queue and filename wildcards.** Named jobs with bounds and
      source, run in order, named by pattern (track, region, date). Region
      render matrix only if regions ship in Phase A.
- [ ] **Session archive, compare, clean.** Zip save already exists; add
      project compare (diff of two Turtle sessions) and a clean-unused-media
      tool. Archive format stays the zip `src/host/Zip.js` writes.

### Phase F. Project and media management

Goal: sessions survive real use: crashes, missing files, clutter.

- [ ] **Recent projects and startup recovery.** List recent sessions, reopen
      the last one on choice, recover unsaved changes after a crash from
      local storage. Never overwrite the saved file with a recovery copy.
- [ ] **Opt-in snapshots and autosave.** Periodic local snapshots including
      untitled sessions, clearly marked as not the saved project. Same store
      rule as above.
- [ ] **Project settings, notes, metadata.** Title, author, revision note per
      session in the Turtle file, shown in one dialog. Editor-only fields
      stay out of the compiled graph.
- [ ] **Templates and project tabs.** Save a session as a template; open from
      template. Tabs only if sessions stay independent documents with no
      shared audio state.
- [ ] **Media explorer and missing media.** Browse and import audio by drag
      and drop (import path exists), resolve missing files on open with a
      replace dialog. Missing media must block render loudly, never silently.
- [ ] **Undo history panel.** Visible list of undo steps from the existing
      `OpDispatcher.undo()`/`redo()` path, click to jump. No second undo
      implementation.
- [ ] **MIDI export.** One track and whole-project export; pairs with Phase B
      MIDI import/export.

### Phase G. Workflow and customization

Goal: the page adapts to hands and screens without a second implementation.

- [ ] **Command palette.** Every Op reachable by name search, over the one
      dispatcher, the way WebMCP tools already are. No palette-only commands.
- [ ] **Keyboard shortcuts and profiles.** Searchable shortcut list, scoped
      rebinding with conflict checks, import/export of named profiles.
      OpenStudio ships 19 DAW maps; Jiggy needs one good default plus the
      machinery, not 19 ports.
- [ ] **Screensets, toolbar editor, big clock.** Saved panel layouts, an
      editable transport toolbar, a large timecode display. Layout state is
      editor metadata, stored apart like node positions.
- [ ] **Themes and high contrast.** A theme editor over CSS variables plus one
      tested high-contrast theme. One accessible generator rule applies: the
      generated panel must pass in every theme.
- [ ] **Help overlay and getting started.** A first-run guide over the real
      page, plus a help overlay naming the current keys. Both must stay true:
      generate key names from the binding store, never hardcode them.
- [ ] **Detached mixer and piano roll.** Pop a panel into a second window
      that follows the same model. Only if window sync stays exact; a
      detached view that disagrees with the page is worse than none.
- [ ] **Narrow-layout pass.** One measured check per new view in a real
      browser at phone width per the interface rules: no horizontal scroll,
      44px targets, 16px inputs. The existing Hide-browser arrow item shows
      the bar to clear.

- [ ] **A facility for Sends and Receives between tracks.** From the inbox, 2026-09-25.
      Aux routing between tracks: a send taps a track's signal, a receive brings it back
      elsewhere. Needs vocabulary before code, the way the master strip does (loose ends,
      item 1 below): what a send/receive is in the project graph, and how the compiler
      turns it into Web Audio connections without introducing a cycle the latency rules
      refuse.

- [ ] **A desktop Jiggy built on Electron.** From the inbox, 2026-09-25. A large direction,
      not a task: packaging, auto-update, native audio device handling, and what happens
      to the dereferenceable-IRI premise when the host is an installed application. Kept
      here so the option is visible, not started.

- [ ] **Loose ends from tracks, clips and plugin editors, 2026-09-24.** Each is known and none
      is built:
      1. **No master strip.** The mixer has a strip per track and none for the master, because
         the model has nowhere to keep a master level. It needs a term before code. From
         the inbox, 2026-09-25: this is also wanted as a master bus with controls in the
         mixer view, not just a level - the same term-first rule applies to whatever
         controls the bus carries.
      2. **Track order is the order tracks were made.** There is no reorder, because the place
         for it is the editor graph (`jig:lane` was drafted and withdrawn) and a session is a
         single Turtle file, which cannot hold a second graph. Needs a decision about how a
         session carries its editor graph: TriG, a file beside it in the zip, or `jig:lane`
         accepted into the project graph as a documented exception.
      3. **A note or audio clip that starts before the loop start is not heard on a later
         pass,** even when it is still sounding across the loop start. The scheduler plays
         what starts inside each pass (`src/engine/Scheduler.js`). A DAW usually retriggers
         it; deciding whether to is a musical choice, not a fix.
      4. **A plugin editor's `jig:integrity` is not checked.** A browser cannot verify a
         frame's document against a digest the way it can a script, and fetching it first to
         check and then framing it is two fetches that can differ. The frame is sandboxed on
         the plugin's own origin either way; the digest is a claim nothing tests.
      5. **Real key presses into the piano roll were not driven in a browser.** The browser
         window was in the background for the whole check, so the automation's key presses
         never arrived; every keyboard path was exercised with dispatched KeyboardEvents
         against real focus in a real renderer instead. Pointer paths were driven for real.
         One pass with real keys, window in front, would close it.
      6. **Clicks from the automation reach a cross-origin plugin frame only sometimes.** One
         did, which proved the frame to host path; the undo check then drove the same
         `setParameter` the frame's handler calls. Not a defect found in the code, but the
         path from a real pointer through the frame was only seen once.

## Quefrency

- [ ] **Listen to Quefrency, and check compensation against a parallel path.** 2026-09-25:
      built to [docs/plugins/quefrency-design.md](docs/plugins/quefrency-design.md), with 23
      tests. In Chrome's real AudioWorklet (`OfflineAudioContext`), `ready` reported 2047 at
      48 kHz and 4095 at 96 kHz and an impulse arrived at exactly those offsets. In Jiggy,
      live at 48 kHz, after Pulse on one track: the panel draws all 11 controls with units,
      the engine holds latency 2047, the master meter reached 8 of 12 segments, dropped to
      none at Output −24 dB, and reached 4 with pitch +7, formant −4 and the true envelope,
      with no console errors. Not yet done: listening to it, and a graph where a parallel
      path has to be delayed to line up with it. That drop from 8 to 4 segments under
      shift has not been explained; partials shifted past Nyquist are dropped, which
      accounts for some of it.
- [ ] **Show a controller's value on the panel, and save it.** 2026-09-25: Quefrency takes
      MIDI control changes 70 to 80 (design doc, "MIDI control"), verified live in Jiggy by
      the master meter following CC 80. The panel's knob does not move, and the project does
      not save the value, because messaging.md has no processor-to-host message saying a
      parameter changed. The 8-Bit 8asterd has the same gap. Needs a message in
      messaging.md, the host updating its AudioParam and the model from it, and a guard so
      that update is not written straight back to the processor.
## JSFX plugins

## The reference host

## A pure-JavaScript plugin

## The native adapter

## Before there is code

Determined 2026-09-26 from testbed.md's "What nothing exercises yet". Each item
below is the smallest plugin or host behaviour covering one unused clause.
Build items, not builds: none is started.

- [ ] **Nested plugins: meta-plugins built from simpler components.** From the
      inbox, 2026-09-26 (e.g. a guitar effects rack assembled from existing
      effects). Needs design before code: what nesting is in the project graph
      (a node holding a subgraph, or a profile listing member plugins), how the
      compiler flattens it and accounts latency through it, how state and
      presets address the inside, and whether a nested graph can itself nest.
      Not started.

- [ ] **A plugin that prefers shared memory, and an isolated host mode to run
      it in.** Covers contract section 2.3. Smallest plugin: declares
      `jig:prefers jig:SharedMemory` with the mandated fallback to port
      transfer. Host side: an opt-in isolated serve mode, since the baseline
      must not require isolation of itself. Test both paths: the capability
      offered in isolated mode, the fallback elsewhere.

- [ ] **Tremolo's interface-to-processor direction through the opaque relay.**
      Covers messaging.md section 2.4. The processor-to-interface direction is
      done (2026-09-27, real snapshots at 12/s, `tests/host/tremolo.test.js`);
      the reverse direction still has no real user beyond the fakes.

- [ ] **Web MIDI input into the selected track.** Covers testbed.md "MIDI from
      outside the page". Host behaviour only, no plugin needed:
      permission-gated device input with notes delivered to the track's MIDI
      input, behind the same user-activation story as audio start.

## Recurring, check periodically

- [ ] **Check builds for warning messages, and fix what is fixable locally.** From the
      inbox, 2026-09-25. The Rust plugins currently build with only the `private_interfaces`
      notice on the ABI pointer exports, shared with every worked sibling; resolving it in
      one plugin would diverge that plugin from the rest, so it stands until it is resolved
      everywhere at once. Anything beyond that is a defect to fix where it appears.

