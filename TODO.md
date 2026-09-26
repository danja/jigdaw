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
      playable JigDAW plugin in REAPER (a JSFX in EEL2, which cannot call WebAssembly, or a
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

Read /home/danny/github/OpenStudio/docs/implemented_features.md for ideas.

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

- [ ] **A plugin that changes its latency, and a host that acts on it.** Covers
      latency.md section 2. Smallest plugin: a two-position latency, such as a
      switchable FFT size or lookahead amount, reporting the actual figure in
      `ready` and sending `latency` with `fromFrame` on change, with the worst
      case in the profile as module-abi.md requires. The host half is the larger
      one: Jiggy must observe the message, update the node, and recompile
      compensation scheduled against `fromFrame`, not against message arrival
      (only `src/wam/WamModule.js` reads the message today). Test: a parallel
      path re-aligned after the change takes effect.

- [ ] **Tails on Cascade, and tail-aware offline renders.** Covers latency.md
      section 5. Cascade declares `jig:tailFrames` and reports it in `ready`;
      the reference host extends the render past the last input event by the
      greatest tail in the graph. Test renders a note through Cascade and checks
      the tail is not cut. An unbounded tail (a freeze, which must declare
      nothing) is a second plugin, not this item.

- [ ] **A plugin that prefers shared memory, and an isolated host mode to run
      it in.** Covers contract section 2.3. Smallest plugin: declares
      `jig:prefers jig:SharedMemory` with the mandated fallback to port
      transfer. Host side: an opt-in isolated serve mode, since the baseline
      must not require isolation of itself. Test both paths: the capability
      offered in isolated mode, the fallback elsewhere.

- [ ] **Tremolo's own interface showing processor data through the opaque
      relay.** Covers messaging.md section 2.4. Tremolo is already the only
      custom `jig:ui`, so no new plugin is needed: its frame displays
      something only the processor knows (LFO phase or current gain) via
      `plugin` messages in both directions, exercising the host relay including
      its rate limiting.

- [ ] **One a-rate parameter, audio-modulated.** Covers contract section 5.2.
      Smallest: a single `jig:ARate` port on a plain-JavaScript plugin
      (Tremolo's rate or Squelch's cutoff), driven by an audio-to-parameter
      connection over the path phase 9 repaired, with the processor handling
      length-1 and length-128 arrays as the contract requires. Test asserts
      per-sample modulation lands.

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

