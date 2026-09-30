# TODO

What the project needs. Remove an item when its implementation and verification are
complete. Review periodically.

## From the inbox

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

- [ ] **Verify `reaper/jigdaw-render.lua` against a real REAPER install.** **Parked
      2026-09-24: the maintainer will do this when there is more time**, not blocked on
      anything else. From the inbox,
      2026-09-23, resolved 2026-09-24: "without the adapter" meant without the JigDAW Adapter
      VST specifically, and the wanted route takes advantage of REAPER's own scripting rather
      than a live, playable plugin. Built as an offline bounce: a ReaScript
      ([reaper/README.md](reaper/README.md)) that asks for plugin IRIs, a duration and MIDI
      notes, drives `bin/host.js` (the existing Node reference host, no browser), and drops the
      rendered WAV into the project as a new track. Reaches an instrument, or an instrument
      feeding effects placed after it, never a bare effect on REAPER's own audio, because
      `ReferenceHost.js` is a chain with no audio input. No REAPER install was available to
      actually run this against, so it is written against REAPER's documented ReaScript API
      (`ExecProcess`, `GetUserInputs`, `InsertMedia`) and unverified; see HUMANS.md. A live,
      playable Jig in REAPER (a JSFX in EEL2, which cannot call WebAssembly, or a
      persistent external process piped in real time) is a separate, larger piece of work and
      was not attempted here.

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

- [ ] **Whether to reduce the native build's dependency on a sibling `downspout` checkout.**
      **Decided 2026-09-24: leave as-is for now.** Revisit if the shared-DPF tradeoff in item 2
      below ever stops being worth it. From the inbox, 2026-09-24: "reduce cross-repo
      dependencies where it can be done without breakage." An audit found three actual
      couplings to a sibling repository, not counting
      the ones README.md/AGENTS.md already say are prior art only and depended on for
      nothing:
      1. `tests/rdf/vocabulary.test.js` hardcoded `/home/danny/github/...` where
         `tests/wam/WamModule.test.js`'s equivalent check already used `process.env.HOME`.
         Fixed 2026-09-24, no behaviour change on this machine, and portable elsewhere now.
      2. `native/CMakeLists.txt` defaults `JIGDAW_DPF_DIR` and `JIGDAW_HTTPLIB_DIR` to paths
         inside `~/github/downspout/third_party/`, by design: the comment there says a path
         rather than a fetch, because it is the same DPF downspout's own plugins build
         against, and two copies would be two answers. Reducing this would need either
         accepting that two copies could disagree, or teaching the build to fetch DPF itself
         (as `native/cmake/FindOrFetchWamr.cmake` now does for WAMR) while still checking it
         against whatever downspout has, which is more machinery than the coupling it
         replaces. Not changed: the stated reason is a real tradeoff, not an oversight, and
         needs a maintainer decision, not a silent reversal.
      3. `tests/rdf/vocabulary.test.js`'s upstream `trn:` check and
         `tests/wam/WamModule.test.js`'s WAM API check both already degrade gracefully when
         the sibling checkout is absent (skip loudly, or return early), which is the pattern
         AGENTS.md asks for; nothing to reduce there beyond the path fix above.

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

- [ ] **Is the interface usable and intuitive now?** A question for the maintainer, not a
      task to guess at. From the inbox, 2026-09-24: "a change from a standard DAW visual
      interface is welcome, but only if it is usable and intuitive. This isn't right now."
      2026-09-24, the four items named under it are built and checked in a browser: tracks
      with a mixer of one fader each, a MIDI timeline with a piano roll, an audio timeline,
      and (at the maintainer's choice) a plugin's own editor in a sandboxed frame. The page now
      opens on the Arrangement tab, a track's name there leads to its plugins, and the rack's
      tab is called Plugins. No further layout change was guessed at, per this item's own
      instruction. **Ask the maintainer to use it and say what is still wrong.**

- [ ] **An agent cannot press Play.** Since 2026-09-25 an MCP client drives an open page
      through `npm run mcp-bridge` (docs/webmcp.md "The local bridge"), and can build a whole
      session but not hear it: `transport_play` and `transport_stop` are specified in
      docs/webmcp.md and not built. 2026-09-26: built. `createTools` takes `onPlay`
      and `onStop` the way `plugin_load` takes `loadPlugin`, and the page passes
      its transport's `play` and `stop` in `src/host/Runtime` wiring
      (`web/app/Runtime.js`). With no hooks the tools explain that this host
      cannot play instead of vanishing. A page with no audio started still needs
      a person's click first: a browser starts no AudioContext without one.

- [ ] **Move Hide Browser button functionality to a sidebar collapse/expand arrow.**
      **Done 2026-09-26, unreviewed in a real browser.** From the inbox,
      2026-09-25. The transport bar's Hide browser button is gone; a 44px arrow
      in the sidebar header carries the function (`web/app/Layout.js`,
      `tests/ui/Layout.test.js`). Collapsed, the sidebar is a 48px rail holding
      only the arrow, and the panel's contents leave the accessibility tree;
      the arrow keeps `aria-expanded`, `aria-controls` and a Hide/Show name,
      and the choice is still remembered per browser. UI-only: no model or
      contract change, bundle rebuilt. Not yet measured in a narrow iframe in a
      real browser, which AGENTS.md requires before the layout half of this is
      claimed; see HUMANS.md.

- [ ] **A facility for Sends and Receives between tracks.** From the inbox, 2026-09-25.
      Aux routing between tracks: a send taps a track's signal, a receive brings it back
      elsewhere. Needs vocabulary before code, the way the master strip does (loose ends,
      item 1 below): what a send/receive is in the project graph, and how the compiler
      turns it into Web Audio connections without introducing a cycle the latency rules
      refuse.

- [ ] **Group controls in the plugin view.** **Done 2026-09-26.** From the inbox,
      2026-09-25. LV2's port-groups extension was read first and not reused: `pg:Group`
      combines ports carrying one stream (stereo channels, surround layouts), verified
      against the extension's published page, and says nothing about control layout. So
      ports carry a plain `jig:controlGroup` label instead (`vocabs/jigdaw.ttl`,
      `src/rdf/Vocabulary.js`), declared in the profile by `bin/write-profile.js` and read
      by `src/rdf/ProfileReader.js`. The generated panel renders ungrouped controls first,
      exactly as before, then one `fieldset`/`legend` section per group in first-appearance
      order. The 8-Bit 8asterd groups by the hardware's own sections from `params.json`
      (12 groups over 42 controls, via `make.js`); DrumKit groups by voice (12 groups over
      74 controls, Bit Crush standing alone, which exercises the ungrouped path); DrumGen
      stays flat, having no natural grouping to declare. Tests bind 8b8's groups to its
      parameter definition and DrumKit's to its symbol prefixes, and the panel suite checks
      section order, ungrouped-first, and the no-groups backwards case. The
      document-order change required reworking the committed-panel selector test to match
      by label. Both profiles validate and canonicalise; vocab site, index, and bundle
      rebuilt.

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

- [ ] **A "Fugue" preset: a long-form orchestral fugue from the existing plugins.**
      **Done 2026-09-26.** From the inbox, 2026-09-26. `web/presets/fugue.ttl` ("Fugue",
      in the index): D minor at 66 BPM for four generative voices, no clips, everything
      off the transport. MelGen states the subject (D4, seed 7), a second MelGen answers
      a fifth below (A3, seed 21), Ground plans the 32-bar bass form (D2, seed 3), and
      Cadence (D natural minor) learns its cycle from the subject line and comps beneath;
      each voice has its own Pulse timbre and Cascade room. Scale choices verified against
      the DSP sources (melgen/ground index 2 minor, cadence index 3 natural minor, key 2
      D). Passes the standard preset bar (listed, no `@base`, conforms, opens for real
      with all 12 nodes and 9 connections), plus `tests/ui/Fugue.test.js`, which drives
      every voice with the preset's own settings read from the file: all three generators
      emit onsets at 66 BPM, Cadence passes what it hears, and all four Pulse voices
      render signal. A preset edit that silences a voice fails there.

- [ ] **Record each track to an audio clip while the transport plays.** **Done
      2026-09-27.** Rec plays (if stopped) and captures every track after its strip;
      Stop, or Rec again, keeps each sounding track as an audio clip where it was
      recorded, in one atomic changeset. Takes are WAV takes under the session's IRI by
      SHA-256, exactly like imported audio, so playback with the plugins removed, zip
      saving, and one-step undo all reuse proven paths. Capture is per-track
      AudioWorklet sinks on a lent-buffer pool (`src/engine/capture-processor.js`,
      `src/engine/TrackRecorder.js`), so the audio thread never allocates and starved
      quanta count as dropped rather than stalling; silent tracks keep no clip.
      `src/host/Wav.js` is ported to DataView so the one encoder runs in the page and
      in node. Verified headlessly throughout: real processor and strip in
      `tests/engine/TrackRecorder.test.js`, orchestration against the real dispatcher
      and model in `tests/ui/Record.test.js`. Not yet heard by a person in a browser;
      press Rec with the window in front, play, Stop, remove the plugins, and play the
      takes (HUMANS.md).

## Documentation

- [ ] **Whether `web/collections/jigdaw.ttl` should stop being the exception and hold absolute
      IRIs.** **Decided 2026-09-24: leave unchanged for now.** Revisit if the localhost/mirror
      case this design serves ever stops mattering. The inbox item this came from also asked
      for the general "refer to a plugin by
      its absolute IRI" recommendation, added 2026-09-24 to
      [for-plugin-authors.md](docs/for-plugin-authors.md) ("Refer to it by its absolute IRI"),
      cross-linked from [plugin-collections.md](docs/plugin-collections.md) section 1.1. This
      part is unresolved: making the shipped collection itself absolute conflicts with a
      deliberate, documented and tested design. Section 1.1 explains the file omits `@base` on
      purpose, so `<../plugins/pulse/>` resolves against whichever host serves it and the same
      file works on `localhost` and on strandz.it alike, and
      `tests/catalogue/CollectionLoader.test.js` checks it against `plugins/` on disk under
      that assumption. Switching it to absolute IRIs would pin the shipped collection to one
      origin and needs a maintainer decision, not a silent reversal of a choice that was made
      and tested for a reason.

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
- [ ] **Declare CC bindings in RDF instead of a caution.** **Done 2026-09-26.**
      LV2's MIDI extension (`midi:binding` to a skolemised `midi:Controller`
      carrying `midi:controllerNumber`, verified against the extension's own
      page) is reused, not invented. `bin/write-profile.js` emits bindings from
      a `controller` field per port, `src/rdf/ProfileReader.js` reads them onto
      `port.controller` (null where unbound), and the generated panel names the
      controller on each bound control. Quefrency binds 70 to 80 and the 8-Bit
      8asterd 70 upward in parameter order; both cautions now point at the
      bindings, keeping only the value-64 and last-wins semantics that are
      still prose. The Quefrency test checks each declared binding against the
      module instead of the caution's wording. Both profiles validate and
      canonicalise; bundle rebuilt.
- [ ] **Reconcile `trn:MidiCC` with upstream.** **Decided 2026-09-26: keep both
      terms, comment corrected.** Both are upstream-defined, in different files:
      transmission's `vocabs/profile.ttl` defines `trn:ControlMidi` (CCs and
      scene notes that reshape other generators), and plugin-universe's
      `vocabs/trn-profile.ttl` defines both that term and the narrower
      `trn:MidiCC` (continuous controller messages alone, without note data).
      The `tests/rdf/vocabulary.test.js` upstream check already covers both
      files, so the suite passes either way. `src/rdf/Vocabulary.js` said
      MidiCC was listed before checking; that comment is now corrected to name
      both definitions. No profile declares `trn:MidiCC` yet; Quefrency takes
      CCs 70 to 80 with no notes, which matches the narrower term, but its
      profile declares `trn:ControlMidi` and both terms behave identically in
      `src/engine/EventRouter.js` (`isMidi` true, `carriesNotes` false), so no
      profile change was made here. A future plugin taking CCs alone may
      declare `trn:MidiCC`.

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

- [ ] **A plugin that changes its latency, and a host that acts on it.** **Done
      2026-09-29.** Covers latency.md section 2 ([design](docs/plugins/lookahead-design.md)).
      Plugin: Lookahead (`plugins/lookahead/`), a two-position lookahead delay in plain
      JavaScript, direct or held back by 512 frames. Worst case in the profile, actual
      figure in `ready`, `latency` with `fromFrame` on change
      (`tests/host/lookahead.test.js`). Host: `OpDispatcher` observes each natively
      loaded node's messages (foreign excluded: a WAM speaks its own latency protocol,
      already consumed by `WamModule`), updates the entry, recompiles the unchanged
      project, and retimes moved compensation delays via `Engine.retime` scheduled
      against `fromFrame`, never arrival. Not an edit: no revision, no history
      (`tests/ops/latency.test.js`, `tests/engine/Engine.test.js`). testbed.md updated.

- [ ] **Tails on Pulse, and tail-aware offline renders.** **Done 2026-09-26.** Covers
      latency.md section 5. Implemented on Pulse rather than the Cascade first proposed:
      Cascade's freeze can ring for ever, and a plugin whose tail is unbounded must
      declare none, while Pulse's release is finite. The profile declares the worst case
      (192000 frames: the 4000 ms release maximum at 48 kHz, bound to the release port in
      `tests/host/pulse.test.js`), the processor reports the worst case for the actual
      rate in `ready`, and the reference host renders past the last input by the greatest
      tail in the chain. `tests/host/ReferenceHost.test.js` renders a note ending near
      the duration end and checks the decay is present past it and silent by the close;
      Cascade is the negative control (no tail declared, length unchanged). Two real
      catches on the way, both in MISTAKES.md pattern: the processor first read the bare
      `sampleRate` global, which is undefined outside a real worklet and produced a NaN
      tail that JSON printed as null and poisoned the frame count to zero (fixed to the
      init message's rate), and the edited processor tripped the integrity check until
      the profile was regenerated. testbed.md updated.

- [ ] **A plugin that prefers shared memory, and an isolated host mode to run
      it in.** Covers contract section 2.3. Smallest plugin: declares
      `jig:prefers jig:SharedMemory` with the mandated fallback to port
      transfer. Host side: an opt-in isolated serve mode, since the baseline
      must not require isolation of itself. Test both paths: the capability
      offered in isolated mode, the fallback elsewhere.

- [ ] **Tremolo's own interface showing processor data through the opaque
      relay.** **Done 2026-09-27 for the processor-to-interface direction.**
      Covers messaging.md section 2.4. The host relay and both dispatcher ends already
      existed and were fake-tested; no real plugin used either. Tremolo's processor now posts a gain snapshot every 32nd quantum (about 12 a
      second, far under the 60/s relay limit) from one object mutated in place, so the
      per-quantum path allocates nothing, and its editor draws the level as text plus
      an aria-hidden bar under a polite live region, never as markup. Tests drive the
      real processor: snapshot rate with LFO tracking, object identity across quanta,
      and silence before the handshake; the frame file is structure-checked as text (no
      script executes headlessly), including the no-innerHTML rule. The
      interface-to-processor direction still has no real user beyond the fakes.
      Profile regenerated
      for the new digests. testbed.md updated.

- [ ] **One a-rate parameter, audio-modulated.** **Done 2026-09-27.** Covers contract
      section 5.2. Tremolo's rate is declared `jig:ARate` (emitted by
      `bin/write-profile.js` from an `automationRate` field, read by the profile reader
      that already knew the term) and registered a-rate in its own descriptors, with the
      profile, the host derivation (`src/host/Parameters.js`) and the registration bound
      in one test per contract 5.1. The processor already read per-sample arrays; a new
      test drives `process()` directly with steady, constant-128 and ramped rate arrays
      and is mutation tested against a read-first-element-only variant (difference
      exactly 0 there). Depth stays k-rate. Per-sample signal flow itself is Web Audio's
      work in a real host; offline fakes hold scalars only, which is stated, not worked
      around. testbed.md updated.

- [ ] **A second plugin answering state requests.** Covers contract section 8.
      Ferrite is the only one, so token correlation and ordering with two
      stateful nodes is untested. Smallest: a plugin with genuine
      non-parameter state (parameters are not state by contract section 8.2,
      so this cannot be bolted onto Tremolo), plus a round-trip test with
      Ferrite loaded alongside proving two `state` replies route to the right
      nodes by token.

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

