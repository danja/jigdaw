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


## The track view

What Jiggy builds next, derived 2026-09-30 from a graph index of this repository and of
`~/github/openDAW` (30162 nodes, TypeScript plus a Rust/WASM engine), `~/github/webdaw`
(683 nodes, React) and `~/github/daw` (GridSound). Caveat on the last: its `daw-core` and
`gs-*` directories are empty submodule checkouts, so only its README and `src/` (3 files) were
readable, and its column below is from that plus general knowledge of the product, not from
its source.

### What the three have in common

Every one of them is built around one screen: a track-oriented arrange view.

| Element | openDAW | webdaw | GridSound | Jiggy today |
|---|---|---|---|---|
| Transport bar with tempo, time, loop, metronome | yes | yes | yes | partial |
| Track header column: name, mute, solo, arm, colour, level, pan | yes | yes | yes | no, split across three tabs |
| Ruler, zoom, scroll, snap on a shared time axis | yes | yes | yes | ruler and scroll only, no zoom or snap |
| Clips or regions as blocks on lanes, with content preview | yes | yes | yes | clips, waveform; no note preview |
| A bottom editor that follows the selection (notes, audio, devices) | yes | yes | yes | piano roll below timeline, no device row |
| Browser side panel for samples, plugins, presets | yes | yes | yes | plugin browser |
| Mixer of channel strips, sends, buses | yes | planned | yes | strips, no sends or buses |
| Automation drawn as lanes on the timeline | yes | yes | yes | none |
| Undo and redo | yes | yes | yes | yes |

Where they differ, and what Jiggy takes from each:

- **openDAW** (`packages/app/studio/src/ui/timeline`): an audio unit owns its instrument
  track, its automation tracks and its effect chain, with a fixed sort order and a
  de-duplicated header (`plans/timeline-layout.md`). Also markers, a signature track, tempo
  automation, groove, freeze, consolidate, effect composites (parallel FX stacks), aux sends,
  modulators, a spotlight search, per-context shortcuts, DAWproject import and export, and
  live collaboration.
- **webdaw** (`notes/milestones.md`): the plainest statement of the order to build in.
  Arrangement first, then project management, effects and automation, instruments, MIDI,
  recording, plugin modules, mixer view, clip launcher, DAWproject.
- **GridSound**: pattern-based composition (a pattern is reusable and placed many times),
  a sampler and drum grid, a per-channel mixer, and cloud save. The pattern idea is the one
  thing here Jiggy does not have an answer for yet.

### Where Jiggy should be better

The core does not change. Two things none of the three do, and both are Jiggy's already:

1. **Routing is the model, not a menu.** In the others a track is a fixed chain and routing
   is a send knob. In Jiggy a track holds nodes joined by named arcs, audio and MIDI both,
   with latency accounted through them. The track view should show that graph in place, on
   the track, rather than sending the person to a separate tab.
2. **A plugin is a dereferenceable IRI with a machine-readable profile.** Browsing, loading,
   parameter names, units and ports all come from the profile, so the view needs no
   per-plugin code and an agent can drive all of it through the same Ops.

The bar for "better": every feature below is one Op, undoable, keyboard reachable, named to
a screen reader, and usable at phone width, per CLAUDE.md. The three examples are pointer
first; that is the gap to keep.

The detailed arrangement, MIDI, mixing, plugin, render, project and workflow items already
sit under "The application" as Phases A to G. The phases here, T0 to T8, are the order to
build them in around the new view. Where a task is already an item there, it says so rather
than repeating it.

### Phase T0. Decisions and vocabulary

Goal: the questions that block the view are answered before any drawing code exists.

- [x] **Where editor state lives.** Decided 2026-09-30: `editor.ttl` beside
      `session.ttl` in the session's zip, a bare `.ttl` when the editor state is all
      defaults. Built: `src/model/EditorState.js` (positions, track `jig:order`,
      `jig:color`, `jig:laneSize`), `writeEditor`/`readEditor`, `src/host/SessionArchive.js`,
      Save and Open in `web/app/Sessions.js`, `docs/project-format.md` ("The editor graph in
      a saved session"), `vocabs/jigdaw.ttl`. Unit and round-trip tests pass. Not yet done:
      an editor-graph shape in `vocabs/shapes.ttl` (the editor document types no subject,
      so the existing target-class shapes do not reach it). Checked in Chrome on
      2026-09-30 with the window in front: a preset opened, a track's layout set, Save
      produced a zip holding `session.ttl` and `editor.ttl`, and opening that zip restored
      the order, colour and lane size; opening a preset afterwards showed default layout
      (that check found the previous session's layout leaking onto reused track ids, since
      fixed). Also seen: the first Save after opening a preset took about ten seconds
      to produce its file (a slow `getNodeState` round, not lost); not investigated. Nothing
      yet sets order, colour or size: that is T2.
- [x] **Vocabulary for the terms the view needs.** Accepted 2026-09-30 as recommended in
      [docs/track-view-terms.md](docs/track-view-terms.md) (with three small corrections,
      listed there). Built: master, sends, bus outputs, markers, regions, signature points
      and envelopes in `vocabs/jigdaw.ttl`, `Vocabulary.js`, `vocabs/shapes.ttl` (13 new
      violations in `counterexample-project.ttl`), `src/model/ArrangementOps.js`, writer and
      reader, undo and redo through `UndoHistory`, and `openProject`; documented in
      `docs/project-format.md`. Tested at the model, round trip, shapes, dispatcher undo and
      opening levels, driven in Chrome on the Acid preset (apply, a refused loop of sends, undo and redo all correct, no console errors), and the `setTrack` guard in `openProject` was mutation checked. Not
      done, each its own item below: the compiler and engine acting on sends, bus outputs and
      the master (T3, T6); the scheduler rendering envelopes and signature changes (T5, and
      `barBeat` in `Timeline.js` still assumes one signature); dedicated WebMCP tools (the
      generic changeset tool accepts the new Ops today); marker and region colour in the
      editor graph; folders (`jig:parent`, editor graph, T2).
- [x] **Selection model.** `src/model/Selection.js`: one kind at a time (track, clip, note,
      node, lane), subscribe, prune against the project, outside the revision. 6 tests. Not
      yet used by any view or by WebMCP.
- [x] **Time and zoom model.** `src/ui/TimeView.js`: pixels per beat, scroll, zoom about a
      pointer, fit, and a snap grid (bar, beat, 1/2, 1/4, 1/8, off) with a bypass. 8 tests.
      Not yet replacing `PIXELS_PER_BEAT` in `src/ui/Timeline.js`: that is T1.
- [ ] **Layout decision for the main view**, recorded with its rejected alternatives:
      header column, lane area, bottom dock, side browser, top transport. Measured at
      phone width before it is accepted (see T8).

### Phase T1. The main view shell

Goal: one page that is the project, replacing the Plugins, Arrangement and Mixer tabs as
the place work happens. The tabs stay as focused views until T8.

- [ ] **A view module of its own.** `src/ui/Arrange.js` with a header column and a lane
      area sharing one vertical scroll, built from the existing `Timeline.js`, `Strip.js`
      and `Panel.js` rather than a rewrite. Split along those seams if it passes 400 lines.
- [x] **Sticky transport bar.** Was already fixed at the top with Play, Stop, Rec, tempo and
      position. Added: a time signature field ("3/4", parsed, refused with the reason and
      reset when malformed) and a Loop toggle, both showing whatever changed them (undo,
      opening a session, an agent) through `showTransport`. Driven in Chrome: typing 3/4
      set the model and the position readout then counted three beats to a bar; Loop
      toggled and said so in text. Not done: the metronome (needs the scheduler to unroll a
      click source through the loop the way it does notes, and a count-in with it), a
      tap-tempo button, seconds or SMPTE readout, and the transport buttons are 40px tall
      where the interface rules ask for 44.
- [x] **Playhead, follow and loop brace.** In `src/ui/Timeline.js`: a loop row under the
      ruler with a brace and two handles that move by pointer (snapped, Alt bypasses) or by
      arrow keys (a grid step; Shift a bar), a drag on the empty row that draws a new loop
      and turns it on, and the state said in text ("Loop on", "Loop off", "Loop, not set");
      handles are left out until a loop exists. Follow, on by default, brings the playhead
      back into view a little in from the left, and turns itself off when the person
      scrolls. 20 new tests. Driven in Chrome with real input and the window in front: a
      drag drew 2 to 10, an end-handle drag made it 2 to 12, two Left presses moved the
      start to 0 with the handle keeping focus; playing at 3/4 with the loop on, the
      position wrapped 4 . 3 to 1 . 1, the playhead wrapped with it, and Follow scrolled to
      keep it visible then back after the wrap; a real wheel scroll turned Follow off and
      the lanes stayed where the person put them. Found on the way: the loop row had no
      style and was 0px tall until the browser showed it. Not done: seeking by clicking the
      ruler, dragging the whole loop, loop range from a selection or a region, and follow
      for the piano roll.
- [x] **Track header column.** `src/ui/TrackHeader.js`, drawn at the left of each lane in
      the timeline: name (opens the track's plugins), mute, solo, level, pan, add clip and
      add audio. Built once per track and updated in place, because every edit redraws the
      arrangement and a slider taken out of the document loses the drag; `Timeline.js` now
      keeps its rows and ruler and redraws only lanes. Level, pan, mute and solo are left
      out (not disabled) for a track with nothing to hear, using the Mixer's own `mixable`
      test, and a track silenced by solo says "silent" in text and in its group name.
      Sliders speak dB and pan position as text. 12 new tests. Driven in Chrome with a real
      pointer: a drag on Level moved the model to 0.05 (-26.0 dB) with the slider still in
      the document and focused; Solo on one track set it, marked the other silent and kept
      focus; at a 375px iframe there is no horizontal scroll and every header control is
      44px. Not done: editable name and colour (T2), the row is still tall at 249px per
      track until the lane sizes of T2 exist, and one thing not re-seen: the compact layout
      was measured but not looked at, because Chrome's window went to the background
      (`visibilityState` hidden) and a click that needs audio stopped working, as CLAUDE.md
      warns.
- [x] **Shared ruler with zoom.** Built in `src/ui/Timeline.js` over `TimeView`: Zoom out,
      Zoom in and Fit buttons, plus and minus on the focused lanes, Ctrl with the wheel about
      the pointer, a status line ("Zoom 225%"), bar numbers that thin out when zoomed out and
      beat ticks when zoomed in. 9 new tests. Driven in Chrome: two real clicks on Zoom in
      scaled the clip to 432px and kept focus on the button; no horizontal scroll at 1280
      or at a 375px iframe; every control 44px, the select 16px. Not done: pinch on touch,
      zoom to selection, seconds as an alternative ruler, and the piano roll reading the same
      `TimeView` (it has its own scale still).
- [x] **Snap.** Grid select (bar, beat, 1/2, 1/4, 1/8, off) drives move and resize by pointer
      and the arrow keys (one grid step, a beat when off); Alt bypasses during a drag. Driven
      in Chrome with a real drag: 2.4 beats snapped to 2 on Beat and to 2.5 on 1/4, and the
      select changed by keyboard kept its focus. Fixed on the way: a click with a pixel of
      jitter must still open the clip, so "dragged" now means the clip actually moved. Not
      done: snapping to other clips' edges, and the grid following signature changes.
- [ ] **Playhead, follow and loop brace.** Follow-playhead scrolling that stops when the
      person scrolls, and a draggable loop range on the ruler that writes the transport.
- [x] **Bottom dock.** `src/ui/Dock.js` (frame and a WAI-ARIA window splitter: Up, Down,
      Home, End and a pointer drag followed on the document, height remembered in this
      browser), `AudioClipPanel.js` (start, length and offset as typed numbers, one edit and
      one undo each, refused with a reason when not a number), `ChainSummary.js` (a track's
      plugins in signal order, and Show plugins), and `web/app/Dock.js`, which shows what
      `ctx.selection` calls for: a MIDI clip opens the piano roll, an audio clip its panel, a
      track its chain, several clips a count. The timeline writes the selection (click,
      Shift or Ctrl click to add, a track's name), marks selected clips and tracks with
      `aria-current` and `aria-pressed` and an outline without rebuilding them, and the
      dock reads it. A track's name now selects it rather than jumping to the Plugins tab;
      that jump is Show plugins in the dock. 35 new tests. Driven in Chrome with the window
      in front and real input: a click on a MIDI clip opened the roll, on an audio clip the
      panel (a typed 6 moved the clip to beat 6 and kept the field's focus), on a track's
      name its chain (Beats, Kit, Formants), Shift-click gave "2 clips selected", Show
      plugins switched tab and focused the track, Close cleared the selection and returned
      focus to the clip, a splitter drag of 72px and two Down presses moved the height
      320, 392, 344 and were saved. That run found the dock was not following selection
      changes the timeline made (unit tests could not see it), now subscribed. Splitter
      raised to 44px after the 375px check. Not done: Escape does not close the piano roll
      (it never did; Close does); a dock view for a selected node or an envelope (T3, T5);
      keyboard selection of a track other than by its name; and a selected clip is not yet
      moved, copied or deleted as a group.
- [x] **Empty-state and first-run.** With no tracks the timeline says what to do and offers
      two buttons that make the page's own requests: Open the Chiptune preset
      (`ctx.sessions.openPreset`) and Load the Pulse synth. Driven in Chrome with a real
      click: the Chiptune button opened six tracks, ten nodes and 140 BPM; in a 375px frame
      the Pulse button loaded one track. Not done: a guided tour, and a hint for the second
      step (add a clip).
- [x] **Measured narrow layout.** At a 375px frame with a preset loaded: no horizontal scroll
      (360 of 375), every header, tool and transport control 44px (the transport buttons
      were 40 and are now 44), header 168px so about 177px of lane is visible and scrolls.
      The empty state was crammed into 92px by the header's margin until measured; it now
      uses the width. Not done: focus order was not read from `activeElement` this time, the
      header does not collapse to icons, and the lane is narrow enough at this width that a
      per-track collapse (T2) would help.

- [x] **The Browser starts closed.** From the user, 2026-09-30. The plugin browser is now a
      panel opened by a Browser button in the transport bar (with aria-expanded and
      aria-controls), closed on load, hidden from layout and from the accessibility tree
      when closed, with no rail. Opening puts the focus on the search box; Close, the same
      button, and Escape from inside it close it and return the focus. The empty
      arrangement offers Browse plugins. The remembered state is a new key, so an old
      "hidden" choice does not carry over. On a phone the transport bar (about 233px when
      wrapped) is no longer sticky, and an idle dock is a line of text with no splitter.
      Driven in Chrome: closed on load with the stage at full width (1265px), a real click
      opened it (stage at x 240) with focus on the search box, Escape closed it and
      returned focus to the button, Browse plugins opened it; at 375px no horizontal
      scroll, Close 44px, the open panel stacked above the stage. Not done: a compact
      phone transport bar (Play, Stop, Loop, then a menu), and Load onto following the
      selected track.

### Phase T2. Tracks as first-class objects

Goal: everything a person does to a track is available in the header and the menu, undoable.

- [x] **Rename, colour and delete a track.** Built in the dock's track panel
      (`src/ui/TrackPanel.js`), shown when a track is selected: name (an emptied name
      restores the default), eight named colours plus none, lane size, Move up and Move
      down (left out at the ends), and Delete track and its plugins in one changeset so one
      undo brings all of it back. Rename is the existing `setTrack` Op; colour and size are
      editor metadata. Also a `track_layout` WebMCP tool (28 tools now, `docs/usp.md`
      updated and its count test still binds it). Driven in Chrome with real input:
      typed a new name, chose Blue, set the lane small, deleted a track with two plugins,
      and Ctrl+Z brought it back under its own id with its name, its two plugins, its place,
      colour and size. That run found layout being discarded with the track (undo lost the
      colour and put the track last), so editor metadata for a removed track is now kept and
      simply not written while the track is gone. Not done: **duplicate** (needs one
      composite Op that loads each plugin, copies settings and state, and remaps the
      connections and track inputs, or undo would take one step per plugin), and adding an
      empty track from the header.
- [x] **Reorder tracks** by keyboard (Alt with Up or Down on a track's name) and by the
      panel's Move buttons, stored in the editor graph as `jig:order`, so the timeline,
      mixer, rack and Load onto menu all follow. Default names are numbered by creation
      order so moving a track never renames another. Driven in Chrome: Alt+Up moved a track
      to the top, focus stayed on it, the mixer followed. Not done: drag to reorder, and
      order is not part of undo (layout is not an edit and raises no revision).
- [ ] **Track types visible in the header.** Instrument (MIDI in, audio out), audio, MIDI
      only, bus. Drawn from the node ports, not a flag the person sets.
- [x] **Lane size.** Small (name, mute and solo only, 105px against 249), medium and large
      (320px of lane), from the track panel, saved in `editor.ttl`. Checked in Chrome. Not
      done: collapse to a thin bar, show and hide by folder, and keyboard resizing from the
      header itself.
- [ ] **Folders and groups.** Editor-only folder first (no compiler change), then bus
      tracks that sum other tracks (compiler work, latency through the sum). Same
      distinction as Phase C "Buses, folder tracks, groups".
- [ ] **Multi-select and bulk edit.** Select several tracks; mute, solo, colour, level
      apply to all through one changeset.
- [ ] **Track input and monitoring.** Choose the MIDI input and the audio input per track,
      arm, and monitor. Web MIDI permission and refusal shown as state (see Web MIDI item
      under "Before there is code").
- [x] **Latency shown per track.** `OpDispatcher.trackLatencies()` (the longest declared
      latency along each track's chain, counting what the compiler found ahead of each
      node) and a line in the header, "Latency 2047 frames, 42.6 ms", left out when zero.
      Tested against the fake engine. Not seen in a live page. **Finding while building it:**
      tracks are not aligned to one another. Compensation is only between connected nodes,
      and each track goes to its own fader and then the master, so a track with 2047 frames
      of latency sounds that much later than one with none. Now stated in `docs/latency.md`
      ("Between tracks"). Decision needed, see the item below.
- [ ] **Align tracks at the master.** Delay the faster tracks by the difference to the
      slowest, at the track's output, so parallel tracks line up as parallel paths in one
      graph do. Needs a decision first because it changes what is heard and adds a rule to
      `docs/latency.md`. Engine work: a delay in each strip and its retiming when a plugin's
      latency changes (the dispatcher already retimes connection delays this way). Clips
      and live MIDI input are scheduled ahead of the clock and would need the same offset.

### Phase T3. Routing in the track view (the differentiator)

Goal: signal and MIDI routing is visible and editable on the track, in the timeline page.

- [ ] **Chain strip on each track.** A row under the header showing the track's nodes in
      order, each with its name, bypass, and a state marker (loading, failed, foreign
      code). Click or Enter opens the panel in the dock. Reorder by drag and keys
      (Phase D "Bypass, reorder, safe mode").
- [ ] **Signal and MIDI cables in place.** For a node with a MIDI output or a side chain,
      show where it goes, as text and as a drawn line, with the port names from the
      profile. Never only colour: audio and MIDI differ by label and pattern as well.
- [ ] **Routing matrix.** One table of every source port against every destination port,
      across tracks, driven by the same connection Op and refusing the same cycles.
      Screen reader friendly by construction; the drawn graph is the extra.
- [ ] **Cross-track connections.** Send audio or MIDI from a node on one track to a node on
      another (a MIDI track driving another track's synth; a side chain from a kick track).
      Depends on the sends vocabulary in T0.
- [ ] **Sends, returns and buses in the header.** Aux level per send, pre and post tap,
      return tracks. Same item as Phase C "Sends and receives".
- [ ] **Sidechain as a routable port.** Phase C item, surfaced on the chain strip.
- [ ] **MIDI routing tools.** Channel filter and map, transpose, split by range, merge
      several sources into one input, all as nodes or as connection properties, chosen in
      T0. A MIDI monitor per connection showing recent events (bounded, message thread only).
- [ ] **Parallel chains and layers.** Two chains from one input mixed back, openDAW's
      "effect composite". Do only after nested plugins design (see "Before there is code").
- [ ] **Failed load stays isolated.** A node that fails to load draws as failed and the rest
      of the track keeps playing, verified through the real page, per the real-time rules.

### Phase T4. Clips, regions and the editors in the dock

Goal: content editing at the level of the reference DAWs, in the order webdaw's milestones
give. The detail is in Phases A and B; these are the view-side tasks.

- [ ] **Clip preview on the lane.** Note clips draw their notes as a miniature roll; audio
      clips draw the waveform (exists). Both are labelled for a screen reader as now.
- [ ] **Selection, multi-select, rubber band, lasso.** On lanes, by pointer and by keys.
- [ ] **Clip operations from Phase A**: split, trim, duplicate, copy and paste, delete,
      nudge, fades, mute, lock, colour, takes, slip edit. Build in that order, each one Op.
- [ ] **Loop a clip.** Content repeats inside the clip bounds, with the loop end draggable
      (openDAW's `loopDuration`). Decide whether it needs vocabulary; it probably does.
- [ ] **Overlap behaviour.** A stated rule for clips that overlap on a lane: clip the
      older, push to a new lane, or refuse. openDAW made this a preference
      (`docs/overlapping-regions-behaviour.md`) after getting it wrong twice; state the rule
      and test it before shipping move.
- [ ] **Piano roll in the dock** with zoom and scroll bound to the shared time model, plus
      velocity and controller lanes (Phase B).
- [ ] **Drum grid.** Step editor for a track whose target is a kit, using DrumKit.
- [ ] **Audio editor.** Waveform view with start, end, gain and fade handles for one clip.
- [ ] **Markers and a tempo and signature lane** on the ruler (Phase A items).
- [ ] **Pattern clips** (GridSound's model): a reusable MIDI pattern placed on several
      tracks or times, edit once, all instances follow. Needs a design note first; only
      build if the note shows it earns its cost over copy and paste.

### Phase T5. Automation

Goal: parameters move over time, drawn on the timeline, for any plugin.

- [ ] **Vocabulary and scheduler design** for an envelope in the project graph, the same
      item as Phase C "Automation lanes". Points, curve shape, target as a plugin IRI plus
      parameter path (the paths already exist for presets).
- [ ] **Scheduler renders automation by stream position**, never by block index, and never
      by equality with a block boundary (CLAUDE.md real-time rules). Offline test that an
      envelope point between two blocks still fires once.
- [ ] **Lanes under each track.** One lane per automated parameter, added from any
      control in the panel, named from the profile with its unit.
- [ ] **Draw, edit, move, delete points** by pointer and by keys; range select; scale.
- [ ] **Write, touch, latch, read modes.** openDAW records any write while the transport
      runs and latches until stop; that is the model to copy, because a gate on one control
      type left every other control unrecordable (`docs/automation.md`).
- [ ] **A manual change while automated** suspends the lane until the next stop or restore,
      rather than fighting it.
- [ ] **Tempo and master automation** on the same lane machinery.
- [ ] **MIDI learn** writes into the same lanes (Phase D).
- [ ] **Modulation sources** (LFO, step, random, macro) as nodes with routable outputs,
      the way openDAW sums depth times source onto a parameter. Jiggy's answer is a Jig
      with a control output port, which keeps it a plugin and not a host feature.

### Phase T6. Mixer, aligned with the track view

Goal: the mixer is the same tracks seen as strips, not a second model.

- [ ] **Mixer as a dock or a page** built from the same track list and selection.
- [ ] **Master strip and bus**, sends section, output selector, meters with clip hold
      (Phase C).
- [ ] **Insert slots on the strip** mirroring the chain strip from T3, so both views edit
      one list.
- [ ] **Snapshots, freeze, render in place, consolidate** (Phase C, and share the bounce
      path in Phase E).
- [ ] **Metering and correlation as displays**, with no loudness-compliance claims.

### Phase T7. Session, clip launcher and interchange

- [ ] **Recent projects, autosave, recovery, templates** (Phase F).
- [ ] **Undo history panel** (Phase F), listing the existing `OpDispatcher` steps.
- [ ] **Clip launcher (session grid).** Scenes and slots that trigger clips on the same
      tracks, quantised launch, follow actions later. Last on this list on purpose: webdaw
      leaves it to milestone 9 and it needs the arrangement solid first.
- [ ] **Standard MIDI file import and export** (Phase B).
- [ ] **DAWproject import and export.** Bitwig's open format is in openDAW
      (`packages/studio/core/src/dawproject`) and on webdaw's list. It gives Jiggy sessions
      an escape route to and from other DAWs. Track, clip, note, level, pan and tempo map
      first; plugin state only for a Jig with an equivalent on the other side.
- [ ] **Stems and bounce in the page** (Phase E).
- [ ] **Sample and preset libraries.** A browser tab for audio files with preview, folder
      tree and drag onto a lane (openDAW's `browse/`), next to the plugin browser.

### Phase T8. Workflow, access and the surfaces around it

- [ ] **Command palette** over the dispatcher (Phase G). openDAW's spotlight is the model.
- [ ] **Shortcuts scoped by context** (global, lanes, dock, piano roll), from one binding
      store, with a searchable list and conflict checks (Phase G). openDAW splits its keys
      by context in exactly this way.
- [ ] **Screen reader pass over the whole view.** A lane is a labelled region, a clip a
      button with its position and length, a header a group with named controls. Announce
      selection and playhead position on request, not continuously. Test with a real
      screen reader and record what was and was not tested.
- [ ] **High-contrast theme and reduced motion** checked against the new view.
- [ ] **Touch.** Long press for the context menu, two-finger pinch zoom, drag handles of at
      least 44px. Measured on a real phone width (interface rules).
- [ ] **WebMCP parity.** Every T-phase Op appears in the tool surface with no second
      implementation, and a test walks the dispatcher's Op list against the tool list so a
      new Op that is not exposed fails a check.
- [ ] **Agent-driven arrangement.** With profiles available, an agent can build a track:
      choose plugins by role, connect them, write a clip. Regress with a scripted session
      against the real dispatcher.
- [ ] **Live collaboration, considered.** openDAW runs Yjs sync and a peer-to-peer room
      (`packages/studio/p2p`, `ysync`). Jiggy already has revisions and `expectedRevision`
      changesets, which is a better base for merge. Design note only; not started.
- [ ] **PWA install and offline.** Cache the host and plugins already opened, with the
      integrity checks intact.
- [ ] **Retire the three tabs** once the main view covers each of them and the measured
      checks pass, keeping the plugin rack as the dock's chain view.

### Suggested order

T0 first and in full, since T1 and T2 both wait on the editor-graph decision. Then T1, T2,
and the first half of T4 (clip operations) together. T3 next, because it is what makes the
view Jiggy's own. T5 before T6, since master and send automation depend on it. T7 and T8
run alongside from T3 onward, and the launcher waits for the rest.

## Web-native Jiggy, and a mobile PWA

From the inbox, 2026-09-30. Two directions, neither started. Each needs a design note in
`docs/` before code, since both touch the "host is a page, plugins are IRIs" premise.

- [ ] **Investigate what would make Jiggy more Web-native.** Questions to answer in a
      design note, each with what the answer would cost:
      1. *Discovery.* Can the browser search plugin-universe.com's public SPARQL and MCP
         endpoints directly and offer Jigs the catalogue marks as compatible? Needs CORS on
         those endpoints (check, do not assume) and a rule for trusting what it returns:
         a catalogue entry is a claim, and the profile at the plugin's own IRI is the
         authority. The existing Browser search already takes a catalogue; this widens it.
      2. *Sync between instances.* Two or more Jiggy pages sharing one session live.
         Peer to peer first (WebRTC data channels), with a signalling step that needs a
         minimal server or a copy-and-paste offer; then failing that a small relay. Jiggy
         already has revisions and `expectedRevision` changesets, so the wire could be
         changesets over a channel, with the revision as the conflict check. Decide what
         does not sync (the transport clock, the audio itself, editor state) before any code.
      3. *Other ideas to weigh:* Web Share Target and File Handling so a session or a
         plugin bundle opens straight from the system; the origin private file system for
         media and recovery; Web MIDI and Web Bluetooth MIDI for controllers; Web Locks and
         BroadcastChannel for two tabs of one session; installable plugin collections by URL.
      Output is a document ranking these by cost and by how well each fits the premise.
- [ ] **A Jiggy PWA for phones, built around generative plugins.** Installable, offline
      once loaded (service worker caching the host and every plugin already opened, with
      the integrity checks intact), and a separate front page on the same model and Ops,
      not a second implementation. Requirements as given:
      - simple enough for an eight year old, with the advanced controls one step away;
      - primary surface is the generative plugins (MelGen, DrumGen, Cadence, Ground and the
        rest), started from presets, the first being the Chiptune preset;
      - each plugin's own parameters reachable while a piece plays, by the generated panel;
      - recording from the microphone, and export to MP3, both easy.
      Open points to settle in the design note: MP3 needs an encoder in the page (WebCodecs
      does not encode MP3 in every browser, so a WASM encoder may be required; see Phase E
      "Formats and options"); microphone recording exists (`TrackRecorder`) and needs a
      one-button front; the interface rules already require touch targets of 44px and a
      single column below 720px, so this is a different front page and not a different
      layout system. Depends on the Web-native item above only for sharing, not for
      playing.

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

