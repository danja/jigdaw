# TODO

What the project needs, and only that. Remove an item when its implementation and verification are complete, and keep
whatever it left undone as an item of its own. Review periodically. What is built is in
[docs/jiggy-features.md](docs/jiggy-features.md); what a finished item did and how it was checked is in
`git log`, and mistakes are in [MISTAKES.md](MISTAKES.md). Actions only a person can take are in [HUMANS.md](HUMANS.md).

Sections: [Next](#next), [Decisions](#decisions-for-the-maintainer), [Checks in a real browser](#checks-in-a-real-browser-or-by-a-person),
[Plugins](#plugins), [Livecoding](#livecoding-reel), [The main view](#the-main-view-track-oriented-arrange),
[DAW features by phase](#daw-features-by-phase), [Web-native and PWA](#web-native-jiggy-and-a-mobile-pwa),
[Docs and cross-links](#docs-and-cross-links), [Larger directions](#larger-directions-not-started),
[Before there is code](#before-there-is-code), [Loose ends](#loose-ends), [Recurring](#recurring-check-periodically).

## Next

Where to start, in order. Everything else is below and is not ordered.

1. The Mop glitch in Reaper (first item under Decisions): confirmation from a person, then WAMR AOT or JIT.
2. The `trn:WebAudio` profile term, in both generators (`bin/write-profile.js`, `bin/jsfx-import.js`).
3. The browser checks that need only a window in front (Checks in a real browser).
4. The rest of the Tracks section: a drop target on another folder's bar, and the screen reader and touch passes it lists.
5. Decide the docked mixer against the tab, which unblocks the Mixer section.

## Decisions for the maintainer

Each of these is blocked on a choice, not on work.

- [ ] **Mop glitches in the JigDAW Adapter VST in Reaper.** 2026-09-30, user report, no buffer size or version yet. Mop costs
      1.70x realtime through the adapter's pure-interpreter WAMR, so every realtime block overruns. Output is otherwise correct,
      so it is throughput. 8b8 costs 0.20x through the same path and Mop under node's JIT 0.06x, which is why no browser or
      offline test saw it. The voice cap and the buffer size change nothing. Fixes: WAMR AOT or JIT (needs wamrc and LLVM as
      build dependencies; the interpreter was chosen in `native/cmake/FindOrFetchWamr.cmake` because the gain was not
      needed, and for Mop 2x or more is), or Mop-side surgery against the unmodified-Opal rule. Confirmation from a person is
      in HUMANS.md.
- [ ] **Generated profiles still declare the deprecated `trn:WebAudio`.** Found 2026-10-02. plugin-universe has deprecated it
      for `trn:Jig` (its harvester maps the old term on ingest) and its raw shape rejects it, so every profile
      `bin/write-profile.js` emits fails that shape with one violation. `bin/jsfx-import.js` (line 83) is a second generator
      with the same term. Fixing the generators changes every plugin's canonical digest, and so every pin on it and every
      signed bundle. A composite declares only `trn:Jig` and conforms.
- [ ] **MIDI loops are refused** (error kind `midi-cycle`, `docs/latency.md`). This was an agent decision, not the
      maintainer's; say if they should be allowed with some limit instead.
- [ ] **Keyframe: should `quality` default to Balanced?** Measured 2026-10-01 under WAMR: Economy is about 15 percent cheaper
      than Full and every setting is 0.1 to 0.2 of realtime, so Economy stands as the cheapest. Figures and driver are in
      [docs/plugins/keyframe-design.md](docs/plugins/keyframe-design.md).
- [ ] **Which docs to hide.** `bin/docs-hidden.js` keeps six documents off the site. Open: whether `revisions`, `testbed`
      and `pwa` (published today, the first in a "Background" group) are essential. `docs/index.md` links each.
      `tests/bin/docs-site.test.js` catches a build that leaks, not a wrong decision.
- [ ] **Conductor and MelGen density mapping.** Left as it is by decision on 2026-10-13: MelGen takes CC 21 (Conductor's
      density) as its scale and CC 22 (energy) as its density, so editing a section's density changes the key. Revisit only if
      it bites.
- [ ] **Reel: a swap that adds a plugin can stall the bar.** A new plugin named by a script is validated before the swap but
      instantiated at it. Preloading is the fix.
- [ ] **Reel: a failure after the swap begins has already stopped the old script.** Decide whether that is acceptable.
- [ ] **Reel: timed parameter sets are accurate to the tick.** Sample accuracy means giving `parameter_set` an `atFrame`.
- [ ] **Reel: parse errors are reported before planning,** so a typo shows before a bad range. Decide whether the order matters.
- [ ] **Layout of the main view: docked mixer or tab.** [docs/main-view.md](docs/main-view.md) names the open question, a
      docked mixer in the Reaper manner against the tab. Decide, and revise the document with the answer.

## Checks in a real browser or by a person

Built and tested offline, not yet seen. Use Chrome with the window in front (a hidden tab grants no activation).

- [ ] **Timeline after the split, what Chrome did not cover.** Seen working on 2026-10-21 in real Chrome with real pointer and
      keys: drawing a loop, dragging an edge past the row, arrow keys on a handle, Zoom in, Go to bar, Tab through the
      tools, Follow and Routing. Left: Ctrl with the wheel (a dispatched event only, since the tool cannot hold Ctrl while
      scrolling), Fit, the zoom read-out at phone width, and a screen reader pass over the tools.
- [ ] **Downspout ports (Moka, Sprout, Markov, Retune):** load each; play Moka from the keyboard; run Sprout and Markov against
      the transport; chain Retune into Moka with a `.scl` loaded from the panel.
- [ ] **Transport click and count-in:** that it clicks in time, accents the bar, keeps time through a loop, and that a count-in
      leaves the playhead at the top and then starts everything together (a script's clock starts in the future during one).
- [ ] **Studio layout on a phone:** a person should look at it. The master row and the editor dock below the arrangement are
      untouched by the layout work, and an automation lane's buttons stay at the left edge while scrolling.
- [ ] **Master chain controls:** a screen reader pass.
- [ ] **Conductor's `jig:ui`:** the selects and the reset checkboxes (only the number field was driven), then hear and see it in
      a browser.
- [ ] **Script tab:** the one hop not yet seen, a session carrying a script back into the studio's Script tab (covered by
      `tests/web/Script.test.js`); the saved-session round trip on the simple page; a screen reader pass over the tab.
- [ ] **Keyframe:** sound through it in the live page, since no source was connected; where Time rate sits now that the panel
      follows `paramIndex`.
- [ ] **Quefrency:** listen to it, and check compensation against a graph where a parallel path has to be delayed to line up
      with it. The meter dropped from 8 to 4 segments under shift (partials past Nyquist are dropped); not fully explained.
- [ ] **Skins:** a real screen reader and a real finger are still not tried.
- [ ] **A composite on a phone.** Every other part of the composite page was checked in Chrome.
- [ ] **Failed load stays isolated:** drive a plugin that really fails to load in a live page (the chain strip is tested at
      model and strip only).
- [ ] **Mute, lock and fades** by ear.
- [ ] **A real MIDI controller** against hardware, and **real key presses** into the piano roll, the clip keys and the lane
      points (dispatched events were driven, and a few real keys).
- [ ] **A real pointer through a cross-origin plugin frame** was seen once; repeat it.
- [ ] **Microphone** with a real one (verified only with a stand-in stream, `window.__jigdawMicrophone`).
- [ ] **Built 2026-10-24 and seen only by eye and by recorded events:** the clip launcher (hear a launched slot, and the arrangement going quiet
      under it), `clip_euclidean`, context menus and double clicks (a real screen reader and a real long press), the mixer FX list, the compact
      button sizes on every tab, and a recovery copy of a session that holds audio (quota). Chrome showed each working; none was heard or touched.
- [ ] **Play every preset** after any change to a plugin processor or the engine (see Recurring).

## Plugins

### Downspout ports (Moka, Sprout, Markov, Retune)

- [ ] The VST3 panels did more than the generated panel can: Moka's presets and partial ladder, Markov's clickable 12 by 12
      matrix, Sprout's and Retune's status read-outs. Presets and the matrix editor want a `jig:ui` or a preset mechanism for
      plugins.
- [ ] Sprout and Markov draw with the VST3's 64-bit mix (`tests/host/mix64.test.js` checks it against BigInt); whether a seed
      now gives the VST3's exact line is unchecked, since the rest of the port may differ. Conductor uses the same draw.
- [ ] The catalogue's `search` defaults to `limit = 30` (`src/catalogue/Catalogue.js`) and there are 33 plugins, so an empty
      search hides 2 unless the caller passes a limit. Check what the browser search bar passes.

### Conductor

- [ ] A section count that is not fixed at five, a transition CC ramping across the bar before a boundary, a lead-in before
      the boundary, and a time signature override.
- [ ] Downstream: Ground and DrumGen have no way to say which section they are in beyond CC values; Sprout takes CC 23
      (mutation) as its seed; Markov ignores CC 20 (scene).
- [ ] A current-section read-out needs the processor-to-panel message (see Quefrency below).

### Quefrency and controller values

- [ ] **Show a controller's value on the panel, and save it.** Quefrency takes MIDI control changes 70 to 80 and 8-Bit 8asterd
      has the same gap: the panel's knob does not move and the project does not save the value, because `docs/messaging.md`
      has no processor-to-host message saying a parameter changed. Needs that message, the host updating its AudioParam and
      the model from it, and a guard so the update is not written straight back to the processor.

### SVG skins

- [ ] `npm run check:skins` and `npm run check:layout` run in real Chrome and are not part of `npm test`.
- [ ] A flattened bundle's skin fetches its artwork from the canonical IRI.
- [ ] Meters in a skin wait for a named meter feed.

### Keyframe

- [ ] Reduce the 10 dB the forced keyframes cost at Balanced and Full. Listen to it, including Linked stereo on a wide clip
      (HUMANS.md).

### Designed, to build

- [ ] **Additive resynthesis effect that builds harmonics from the input** (r/synthesizers idea, 2026-09-26). Designed in
      [docs/plugins/harmonics-design.md](docs/plugins/harmonics-design.md): delay-line shifters, a loop gain bounded at 90
      percent, plain JavaScript. Settle its three open decisions, then build it. Any cycle needs an explicit delay by the
      latency rules, and latency inside a cycle is never compensated.
- [ ] **Panning effect with non-linear motion** (2026-09-26). Designed in
      [docs/plugins/trajectory-pan-design.md](docs/plugins/trajectory-pan-design.md): level-only panning so the mono sum
      cannot cancel, Linkwitz-Riley bands, plain JavaScript. Settle its three open decisions, then build it.

## Livecoding (Reel)

Designed in [docs/livecoding.md](docs/livecoding.md); built and working in the studio and on the simple page. What is left is
the checks above and the decisions above. Not yet built: a way to supply bytes to `loadAsset` for an agent (see WebMCP
parity).

## The main view (track-oriented arrange)

Derived 2026-09-30 from a graph index of this repository and of `~/github/openDAW`, `~/github/webdaw` and `~/github/daw`
(GridSound; its source was empty submodules, so what is said of it is from its README). All three are built around one
screen, a track-oriented arrange view. What Jiggy takes from each: **openDAW** markers, signature and tempo tracks,
consolidate, effect composites, modulators, a spotlight search, per-context shortcuts, DAWproject and live collaboration;
**webdaw** the order to build in (`notes/milestones.md`); **GridSound** pattern-based composition, a sampler and drum grid.
Where Jiggy should be better: routing is the model, not a menu, and a plugin is a dereferenceable IRI with a
machine-readable profile, so the view needs no per-plugin code and an agent drives all of it through the same Ops. The bar:
every feature is one Op, undoable, keyboard reachable, named to a screen reader and usable at phone width.
[docs/usp.md](docs/usp.md) says where Jiggy is ahead and behind.

Suggested order: Decisions, then Shell and Tracks with the rest of Clips, Routing next, Automation before Mixer, Session and
Workflow alongside from Routing, and the launcher last.

### Decisions and conventions

- [ ] **Arrangement and mixer UIs follow Reaper where possible** (inbox, 2026-10-01). Write a note of what Reaper's track
      control panel, mixer strip and arrange conventions are, and what to keep from Jiggy's routing-first model, before
      changes. The shell and mixer items below are where it lands. The tab row (seven tabs now) has no horizontal overflow from 320px up (`npm run check:layout`); its wrapped height is not measured.
- [ ] **Editor-graph shape.** Marker and region colour, and folders (`jig:parent`), have no model or writer yet, so their
      shapes come with them.
- [ ] **From the Oxide Studio review: what is left** ([docs/oxide-studio-review.md](docs/oxide-studio-review.md), 2026-10-23; read, not run). Built from it: the
      keys overlay, `npm run check:layout`, the dock height limit, Replace a plugin, the Legato and Strum transforms. Left, by item:
      - **Keys overlay** (`src/ui/KeyTable.js`): the piano roll's and the timeline's keys are not listed, and a screen reader pass on the dialog.
      - **Layout check** (`bin/check-layout.js`, 66 views at 320 to 1280px on 2026-10-24, not part of `npm test`): touch-target sizes are not measured by it.
      - **Dock limit** (`DOCK_SHARE` in `src/ui/Dock.js`): seen only as the splitter's maximum at one window height, not dragged on a short window.
      - **Replace** (`src/ops/SwapPlugin.js`, `node_swap`): automation moves with the plugin instead of refusing, a composite as the old plugin, keyboard
        reach on a small lane where the chain strip is hidden, a screen reader pass, touch.
      - **Transforms:** Legato not pressed in Chrome; the roll's Strum amount and direction are fixed at an upward sixteenth; `clip_euclidean`
        (`src/model/Euclidean.js`) and its control in the roll (`src/ui/RollEuclid.js`) are seen in Chrome laying 5 in 8 over a clip; not heard, and the control
        is not checked at phone width or by screen reader.
      - **Later:** audio to MIDI as an offline Op, find-similar over catalogue facets, and a load readout,
        which needs a design note first because `process()` has no clock. Mixer sections were checked and dropped (a strip has nothing to hide).
- [ ] **WebMCP tools for what has none:** freeze. Trim, and copy, cut and paste, are `clip_trim` and `clip_copy_to` (built 2026-10-24;
      one call places a group, with `cut` for a move, since the clipboard is the page's and an agent has none).
- [ ] **WebMCP parity gaps, each a decision:** the track-alignment preference and per-track latencies, `audibility`, a
      stateful plugin's live state, and `loadAsset` (how an agent would supply bytes). Closing one means removing it from the
      gap list in `tests/mcp/parity.test.js`.

### Shell

- [ ] **Transport.** The studio bar shows the time in minutes, seconds and tenths beside the bar and beat (`src/ui/TimeText.js`, seen in Chrome: 0:04.1 at bar 3 beat 1 after four seconds at 120 bpm). Left: SMPTE or samples as a choice, a click-to-set position, the readout on the simple page, a compact phone transport bar, and a screen reader pass. The click accent assumes one signature, like `barBeat`.
- [ ] **Gestures: what is left.** Context menus (`src/ui/ContextMenu.js`) and double clicks are on clips, track headers, empty lanes, chain plugins and mixer channels (see docs/jiggy-features.md). Left: hover previews or revealed controls, menus on piano roll notes and automation points, a menu on the Plugins tab slots, and a screen reader and touch (long press) pass on the menu.
- [ ] **Compact icon controls: what is left.** Mute and Solo (`src/ui/ChannelToggle.js`) and the toolbar are icons, seen in Chrome 2026-10-23, and the links
      are in a footer. Buttons are 30px for a mouse on a wide window and 44px on touch or a narrow one (`web/index.html`, 2026-10-24). Left: whether
      the ring for Rec MIDI and the list for Import MIDI read clearly (a person's call); the bulk panel's "Mute all" and "Solo all" stay words unless
      a better mark is found; the compact sizes were seen on the Plugins tab, the Browser, the Mixer and the lane editor only, not on every tab; a
      measured check at phone width; a screen reader pass on the pressed state.
- [ ] **Playhead and loop.** Drag the whole loop, a loop range from a selection or region, and follow for the piano roll.
- [ ] **Zoom and snap.** Pinch on touch, zoom to selection, seconds as an alternative ruler, the piano roll reading the shared
      `TimeView` (it has its own scale), snapping to other clips' edges, and the grid following signature changes.
- [ ] **Dock.** A dock view for an envelope; keyboard selection of a track other than by its name; move a selected group of clips as one.
- [ ] **First run and narrow layout.** A guided tour and a hint for the second step; collapse the header to icons at phone
      width; "Load onto" following the selected track.
- [ ] **Retire the three tabs** once the main view covers each of them and the measured checks pass, keeping the plugin rack as
      the dock's chain view.

### Tracks

- [ ] **Duplicate a track: what Chrome did not cover.** Duplicate (`src/ops/DuplicateTrack.js`, the `track_duplicate` tool, the
      header's Duplicate button and the D key on a track name) and the toolbar's Add track are built. Seen in Chrome on
      2026-10-21: Add track from an empty page (twice, then undo), and a one-plugin copy that loads, undoes whole and redoes.
      Left undone: a copy of a track with several plugins, wiring and automation in a real page; hearing the copy; the node
      positions in the editor graph are not copied; a plugin's live state beyond what a saved session carries is not copied
      (the same gap as the parity item); a foreign (WAM) plugin was not tried; focus stays on the original's name while the
      selection moves to the copy, which a screen reader pass should judge; the Duplicate button shows only on a medium or
      large lane, because a small one hides every button but the name; Add track's place at phone width is unmeasured.
- [ ] **Track types: what Chrome did not cover.** Built: `src/model/TrackKind.js` reads instrument, MIDI, audio or bus from
      node ports and from which tracks send to it; the header says it in words and in its group label. Seen in Chrome: a
      Pulse track reads "Instrument" on a medium lane. Not seen: MIDI, audio and bus in a real page; a small lane hides the
      word (the group label still says it); a track with only MIDI or audio clips and no plugin says nothing.
- [ ] **Folders: what is left.** A drop target on another folder's bar (a collapsed folder's rows cannot be a drop target either), a screen reader pass, and a save and reopen of a hidden folder in a real page (the written graph was seen, the reopen was not).
- [ ] **Bus: what is left.** Built: `src/model/TrackBus.js`, the `track_bus` tool and "Send to a new bus" in the bulk panel,
      one undo step; seen in Chrome with two empty tracks. Not seen: audible summing of tracks with plugins; the bus is
      not placed after its members in the order; no way to name it on creation from the page.
- [ ] **Linked faders as a group parameter: what is left.** A fader in the track's header rather than the panel (judged a poor fit: a relative control that springs back to zero sits awkwardly beside the steppers and typed amounts), and the folder case of Members by was not seen in Chrome.
- [ ] **Collapsed lane and reorder: what is left.** Not seen: reorder by touch, on a medium or large lane, onto a folder's collapsed rows; and no spoken announcement of a track's new place.
- [ ] **Bulk selection: what is left.** A range select by Shift with the keyboard.
- [ ] **Track input and monitoring.** Choosing among several MIDI and audio inputs, MIDI panic, input monitoring, the
      microphone as a choice on any studio track (the studio page has no record-voice button), a visible state when Web MIDI
      is denied. MIDI learn is under Phase D.
- [ ] **Track alignment.** Clips and live MIDI are not offset; the setting is not in the saved session, so two people can hear
      differently; a limit warning is in the console, not on the page; no render comparison has measured that audio really
      arrives aligned.
- [ ] **Master and offline render.** The offline render does not include the clips' audio and applies no fader, so what it
      checks is that sound reaches each place, not how it sounds.

### Routing and plugin chains

- [ ] **Chain strip.** Reorder by drag, draw a sidechain key connection as its own thing, measure the strip at phone width, and
      count a bypassed plugin out of latency compensation (it still counts its declared latency). MIDI chains are not
      reordered.
- [ ] **Connections.** A drawn line as an extra to the text cables; port names from the profile beyond "Audio out 1" and "MIDI
      out" (Dynamix's key is the only named one); a "why not" for a missing matrix cell; matrix column headers are wide at
      phone width.
- [ ] **Sends and buses.** A return-track marker beyond the header text, the alignment delay counting a bus's latency, a send's
      own alignment, send pan, and a level meter per send.
- [ ] **MIDI routing.** A note-range split as a connection property rather than only a plugin, and the MIDI monitor on the
      routing matrix and the chain strip (it is in the plugin view only).
- [ ] **Parallel chains and layers.** Two chains from one input mixed back, openDAW's "effect composite". Only after the nested
      plugins design (see Before there is code).

### Clips and editors in the dock

- [ ] **Selection.** Rubber band and lasso on lanes, by pointer and by keys.
- [ ] **Clip operations.** Takes and comping (TrackRecorder already captures passes; select the active take, explode to tracks),
      slip edit, a fade curve choice and auto-crossfade where two audio clips overlap, grouping so moves apply together, split
      at a click, trim by drag, and a fine nudge.
- [ ] **Loop a clip: what is left.** Not heard (the scheduler's frames are unit-tested, no audio was played to hear the repeats). Not built: the loop end draggable on the clip in the arrangement, the repeats drawn on the clip, and audio clips looping.
- [ ] **Overlap behaviour: what is left.** The rule is written down and pinned (docs/project-format.md, `tests/engine/ClipOverlap.test.js`): clips overlap freely and all play. Left: whether a person wants a way to clip the older clip or move one to a new lane when they overlap, which is a preference to add with the edit that needs it, and drawing an overlap so it can be seen on a lane.
- [ ] **Piano roll in the dock** with zoom and scroll bound to the shared time model.
- [ ] **Drum grid.** Step editor for a track whose target is a kit, using DrumKit.
- [ ] **Audio editor.** Waveform view with start, end, gain and fade handles for one clip.
- [ ] **Pattern clips** (GridSound's model): a reusable MIDI pattern placed on several tracks or times, edit once and all
      instances follow. Needs a design note first; build only if it earns its cost over copy and paste.

### Automation

- [ ] **Signature changes** are in the model and the file and are not played; the lane and the ruler do not show them.
- [ ] **Lanes.** A signature lane; a range select and scale; a point's exact value typed in; checking the lanes at phone width;
      lanes for a plugin with no loaded profile are left out.
- [ ] **Write, touch, latch and read modes.** openDAW records any write while the transport runs and latches until stop; copy
      that, because a gate on one control type left every other control unrecordable.
- [ ] **A manual change while automated.** A "restore" that resumes the lane without stopping, and showing on the control that
      it is paused.
- [ ] **Modulation sources** (LFO, step, random, macro) as a Jig with a control output port, so it stays a plugin and not a
      host feature (openDAW sums depth times source onto a parameter).

### Mixer

- [ ] **Mixer as a dock or a page** built from the same track list and selection.
- [ ] **Master strip.** A mono switch, and controls beyond level, pan and mute (the term-first rule applies to whatever
      controls it carries).
- [ ] **Insert slots on the strip: what is left.** Each channel's FX button lists the track's plugins with Add and Remove (`src/ui/FxList.js`, seen in Chrome 2026-10-24). Left: bypass, replace and reorder there, as the chain strip has them; a plugin's own controls from the list; touch.
- [ ] **Strip snapshots, metering, render in place and consolidate** are under Phase C and Phase E, not repeated here.

### Session, clip launcher and interchange

- [ ] **Clip launcher (session grid): what is left.** Designed in [docs/clip-launcher.md](docs/clip-launcher.md) and built 2026-10-24 apart from the
      list here: the model, `LauncherState`, playback in the scheduler, the `launcher_*` tools and the Launcher tab (seen in Chrome with real clicks; the
      audio was not listened to). Reel has `launch` and `stop` statements (tested, and seen in Chrome 2026-10-24: `launch pulse 1` run through `script_run` started the transport and the slot's note came every two seconds; not typed into the Script tab by hand). Left: scene names; the transport loop applied to a launched slot, which it ignores; follow actions;
      recording a performance as arrangement clips; a touch and screen reader pass on the grid; sharing one clip between slots, which waits for pattern
      clips. Last on purpose: webdaw leaves it to milestone 9.
- [ ] **DAWproject import and export.** Bitwig's open format gives sessions an escape route to and from other DAWs. Track,
      clip, note, level, pan and tempo map first; plugin state only for a Jig with an equivalent on the other side.
- [ ] **Sample and preset libraries.** A browser tab for audio files with preview, folder tree and drag onto a lane.

### Workflow and access

- [ ] **Screen reader pass over the whole view.** Test with a real screen reader and record what was and was not tested.
- [ ] **Touch.** Long press for the context menu, two-finger pinch zoom, measured at a real phone width.
- [ ] **Agent-driven arrangement.** An agent builds a track from profiles: chooses plugins by role, connects them, writes a
      clip. Regress with a scripted session against the real dispatcher.
- [ ] **Live collaboration, considered.** openDAW runs Yjs sync and a peer-to-peer room. Jiggy has revisions and
      `expectedRevision` changesets, a better base for merge. Design note only.

## DAW features by phase

An open-ended direction rather than a phase with an end, behaving more like a real DAW. Plugin-related parts should have most
attention. Derived 2026-09-30 from OpenStudio `docs/implemented_features.md`, filtered for what fits a browser host.
Native-only items (device drivers, native plugin hosting, ONNX runtimes, local generation models, DDP, ARA, surround, a
32-bit bridge) are excluded. Where a heavy analysis (YIN pitch, Basic Pitch, stem separation) could run in WASM or ONNX in
the page, it is research, not committed.

### Phase A. Arrangement editing

- [ ] **Razor areas, ripple modes, time selection ops.** Razor selection that cuts across tracks, ripple that closes or
      preserves the gap, time selection cut, copy, delete and insert-silence. One Op each, over the same changeset path as clip
      ops.
- [ ] **Markers, regions, region manager.** Named positions and ranges with a list view, jump by keys, loop a region, drawn
      on the ruler beside a signature lane. The terms and the file format exist; the view does not.
- [ ] **The scheduler and piano roll reading signature changes.**
- [ ] **Reverse and normalize** as offline render ops on take bytes. Time stretch and pitch shift stay out until a DSP design
      exists (see Keyframe).

### Phase B. MIDI editing

- [ ] **Velocity, CC and pitch-bend lanes: what is left.** Not heard: no plugin was listened to under a bend or a controller, including a controller set where a loop comes round or playing starts part way in (HUMANS.md). Not built: curves and ramps (events step), the lane under a clip in the arrangement, a lane for channel pressure, and `clip_transform_notes` leaving events alone.
- [ ] **Record MIDI into a clip: what is left.** Not tried with a real MIDI keyboard (HUMANS.md). Not built: overdub into an existing clip, quantize on record, a visible "armed" state beside the selected-track fallback, and recording while looping into takes.
- [ ] **Chance on a note: what is left.** Built 2026-10-24 (`jig:chance`, `src/engine/Chance.js`, `setChance`, the roll's Chance and Set chance, `chance` on a note for the tools; seen in Chrome: all 8 notes of a looped clip set to 50% sounded 27 times in 56 over seven passes, a different count each pass). Left: hearing it; a lane under the notes to see and draw chances, as velocity has; chance on a controller event; a note's chance carried by Reel; MIDI export writes every note whatever its chance (said in the format document, not asked of a person); a screen reader pass on the half-filled mark.
- [ ] **Quantize and transforms: what is left.** Not seen in Chrome: Down, Softer and Louder, touch, Quantize Strength below 100%, and Move: Starts and ends (unit-tested). A screen reader pass over the roll's grid, which now declares its extent (128 rows, row header as column 1): the long help text read on entering it may want shortening. Not built: snapping the keyboard cursor itself, more scales, and keeping the scale choice with the session.
- [ ] **Step input and virtual keyboard: what is left.** Real touch on the on-screen keyboard (the browser tool has no touch input; a touch pointer is captured implicitly, which the release is there for, and a unit test covers it).
- [ ] **MIDI import and export: what is left.** The exported file has not been opened in a real DAW (HUMANS.md). Not built: import into an existing track at the playhead, a choice of which parts to take, export of the loop only, and a tool for agents for either (WAV export has none either, and a file in a tool call is a poor fit). The first `ensureRunning()` before the page has had any user activation never settles; the Import button's own click is the activation, so this only shows when a script delivers a file first.
- [ ] **Multi-clip editing and drum view.** Two clips side by side for reference; a drum lane view where the track holds a kit.
- [ ] **MIDI panic: what is left.** Not tried with a stuck note; the `transport_panic` tool and releasing notes held on the on-screen keyboards are unit-tested and not seen in Chrome.

### Phase C. Mixing, routing and automation

- [ ] **Mixer snapshots.** Save and recall every strip and send as one named, undoable object, reusing the snapshot path
      `UndoHistory` takes.
- [ ] **Metering and gain staging.** Phase invert, stereo width, pan law, RMS. LUFS, phase correlation and spectrum stay
      meter-only displays if built, never claims about loudness compliance.
- [ ] **Freeze.** Freeing the original's CPU (it is muted, not unloaded), unfreeze as one action, render in place onto the same
      track, and consolidate a range. Render in place and consolidate share the bounce path that Freeze already uses.

### Phase D. Plugin and effect workflows

- [ ] **Safe mode.** An open-with-FX-bypassed recovery path.
- [ ] **Plugin presets and A/B compare.** Named parameter sets per plugin IRI, saved beside the session, with A/B slots that
      swap without a revision.
- [ ] **FX-chain presets.** Save and load a whole track chain including order and settings: a collection of IRIs plus
      settings, not a new format.
- [ ] **MIDI learn and parameter mapping.** Bind a controller to a parameter explicitly, on top of the declared CC bindings
      Quefrency and 8-Bit 8asterd have. A learned binding can also write into the automation lanes.
- [ ] **Input and monitoring FX chains.** Where a chain may sit besides a track and the master: an input monitoring chain, a
      monitoring-only chain that never renders. The render path must exclude the monitoring chain by construction.
- [ ] **Channel strip EQ modal.** A small built-in EQ view per strip using existing plugins, if strips need one at all.

### Phase E. Render, export and delivery

- [ ] **Bounce.** A time selection, region or razor range (the loop is the only range so far); a chain that starts with an
      effect (the live page feeds it an impulse and the bounce does not); foreign (WAM) plugins, which are not loaded
      offline; live plugin state (the bounce uses the snapshot's); cancelling a render; and timing it against a real-time
      capture.
- [ ] **Stems.** Stems back into the project as clips, choosing which tracks, and including sends' returns.
- [ ] **Formats and options.** AIFF, FLAC, MP3 and OGG only if the encoder runs in the page (WebCodecs does not encode MP3 in
      every browser, so a WASM encoder may be needed), with sample rate, mono or stereo, normalize, tail and dither. No FFmpeg
      dependency: a page cannot shell out.
- [ ] **Render queue and filename wildcards.** Named jobs with bounds and source, run in order, named by pattern (track,
      region, date).
- [ ] **Session archive, compare, clean.** A diff of two Turtle sessions and a clean-unused-media tool. The archive stays the
      zip `src/host/Zip.js` writes.

### Phase F. Project and media management

- [ ] **Recent projects, recovery and autosave: what is left.** Recovery copies are built (`src/host/Recovery.js`, `web/app/Recovery.js`, `recoverySeconds` in
      `web/host.json`): the studio page keeps one copy of a changed session in IndexedDB without an undo step, a save removes it, and the next visit
      offers Recover it or Discard it (seen in Chrome 2026-10-24: a copy was kept after 30 seconds, the undo history stayed at the two real edits, and
      Recover it brought back the plugin and the tempo). Left: the same on the simple page; one copy only, so no list of recent sessions and no
      "reopen the last" choice; a recovery copy of a session with audio files holds them in the browser's quota, which was not tried at size; a
      copy is not taken while a plugin is being loaded, which was not looked at; the origin private file system as a store, and offline use, shared
      with the PWA. Whatever local file storage is chosen must be the layout in [docs/project-folder.md](docs/project-folder.md): the same files a web
      server would serve, relative links, and a Turtle manifest `media.ttl` for the audio files (maintainer's decision 2026-10-24).
- [ ] **Project settings, notes, metadata: what is left.** A save and reopen of a typed title was unit-tested and not clicked through. Not built: a revision note per save, and the title in the page's heading.
- [ ] **Templates: what is left; project tabs.** Not built: templates shipped with the host (presets cover that for now), rename, export and import of a template as a file, and an agent tool for them. Project tabs stay out until sessions are independent documents with no shared audio state.
- [ ] **Media explorer and missing media.** Browse and import audio by drag and drop (import exists), resolve missing files on
      open with a replace dialog. Missing media must block render loudly.
- [ ] **Undo history panel: what is left.** A few labels are generic (a changeset of several kinds says its first and counts the rest), and the list is not kept across a reload, since history is not saved.

### Phase G. Workflow and customization

- [ ] **Command palette.** Every Op reachable by name search over the one dispatcher, as WebMCP tools are. No palette-only
      commands.
- [ ] **Keyboard shortcuts and profiles.** A searchable shortcut list, scoped rebinding with conflict checks, import and export
      of named profiles, all from one binding store. The keys are hardcoded in the files that handle them today and only listed, not read, by `src/ui/KeyTable.js`. One good default plus
      the machinery.
- [ ] **Screensets, toolbar editor, big clock.** Saved panel layouts, an editable transport toolbar, a large timecode display.
      Layout is editor metadata, stored apart like node positions.
- [ ] **Themes and high contrast.** A theme editor over CSS variables plus one tested high-contrast theme; the generated panel
      must pass in every theme, and reduced motion is checked against the new view.
- [ ] **Help overlay and getting started.** A first-run guide over the real page and a help overlay naming the current keys,
      generated from the binding store, never hardcoded.
- [ ] **Detached mixer and piano roll.** Pop a panel into a second window that follows the same model; only if window sync
      stays exact.
- [ ] **Narrow-layout pass.** One measured check per new view in a real browser at phone width.

## Web-native Jiggy, and a mobile PWA

From the inbox, 2026-09-30. Both directions need a design note in `docs/` before code, since both touch the "host is a page,
plugins are IRIs" premise.

- [ ] **Investigate what would make Jiggy more Web-native.** Questions for a design note, each with what the answer would cost,
      ranked by cost and by fit with the premise:
      1. *Discovery.* Can the browser search plugin-universe.com's public SPARQL and MCP endpoints directly and offer Jigs the
         catalogue marks as compatible? Needs CORS on those endpoints (check, do not assume) and a rule for trusting what it
         returns: a catalogue entry is a claim, and the profile at the plugin's own IRI is the authority.
      2. *Sync between instances.* Two or more pages sharing one session live. Peer to peer first (WebRTC data channels; a
         signalling step needs a minimal server or a copy-and-paste offer; failing that a small relay). The wire could be
         changesets over a channel with the revision as the conflict check. Decide what does not sync (the transport clock,
         the audio, editor state) before any code.
      3. *Others to weigh:* Web Bluetooth MIDI for controllers; Web Locks and BroadcastChannel for two tabs of one session;
         installable plugin collections by URL.
- [ ] **The PWA.**
      - Web Share Target and File Handling: a shared or opened `.ttl`, `.zip` or plugin bundle opens as a session or bundle
        through the same path as Open.
      - Offline use and recovery depend on Phase F's store (the origin private file system is the candidate): one store, two
        front ends. A real offline network and a real phone are unchecked.
      - The simple page: one click on "Change the sound" once left its card closed and did not reproduce; reduced motion and a
        screen reader pass; a real phone.
      - `web/foreign/probe.html` (manual, absolute paths, needs the WAM example built) and a real WAM plugin have not been
        re-run since the container paths were derived from the scope.
      - A constraint to keep: an app-wide service worker must never answer a plugin resource in a way that skips the digest
        check; a cached response is still verified when instantiated.

## Docs and cross-links

- [ ] **Cross-link the JigDAW pages, Jiggy and `~/github/plugin-universe`.** Plugin-universe's own pages should link back to
      the spec and to Jiggy at strandz.it/jigdaw (a change in that repository, made and checked there). Nothing checks that an
      external link resolves, so a moved page still passes. A check needs network access, which the offline-first test rule
      argues against, so a scheduled check is the likelier shape.

## Larger directions, not started

- [ ] **A desktop Jiggy built on Electron** (inbox, 2026-09-25): packaging, auto-update, native audio device handling, and what
      happens to the dereferenceable-IRI premise when the host is an installed application.

## Before there is code

Determined 2026-09-26 from `docs/testbed.md`'s "What nothing exercises yet". Each item is the smallest plugin or host behaviour
covering one unused clause.

- [ ] **Nested plugins, what is left.** Specified in [docs/nested-plugins.md](docs/nested-plugins.md) and built (a composite
      loads whole or not at all, saves, undoes as one edit, plays like its members wired by hand). Still to do: packing from
      the page (the Op and the agent tool `composite_pack` exist; the page has no way to select several plugins and ask for
      it), putting a packed composite in the selection's place once it is somewhere a host can fetch it, and the MIDI monitor
      across a composite's boundary (`midiActivity` shows nothing for it). The native adapter says a composite is one and
      that it cannot run it; running a linear composite there, which is already a chain, is the next step for it.
- [ ] **A plugin that prefers shared memory, and an isolated host mode to run it in.** Covers contract section 2.3. Smallest
      plugin: declares `jig:prefers jig:SharedMemory` with the mandated fallback to port transfer. Host side: an opt-in isolated
      serve mode, since the baseline must not require isolation of itself. Test both paths.
- [ ] **Tremolo's interface-to-processor direction through the opaque relay.** Covers `docs/messaging.md` section 2.4. The
      processor-to-interface direction is done; the reverse direction has no real user beyond the fakes.

## Loose ends

0. **Files past 500 lines that are not split.** Split on 2026-10-24, each keeping its front door: `src/mcp/tools.js` (now `src/mcp/tools/`),
   `src/ops/OpDispatcher.js`, `src/model/Project.js`, `src/engine/Engine.js`, `src/ui/PianoRoll.js`, `web/app/Rack.js`, `src/rdf/ProjectReader.js`; all
   are about 520 lines or fewer now. Left, and each is a decision: the Rust plugin sources (about 20 files, 500 to 1300 lines; a rebuild changes a module's
   digest, which every pin and signature on it names, so a source-only move is a change the maintainer should choose), `plugins/mop/opal/opal.c`
   (third-party, left unmodified by rule), the native adapter's C++ (`JigdawUI.cpp`, `Module.cpp`), `plugins/*/*-processor.js` ports of VST3 code, and
   the test files past 500 lines (`tests/ops/OpDispatcher.test.js` 1636, `tests/mcp/tools.test.js` 1239, `tests/ui/PianoRoll.test.js` 905, and others),
   which mirror `src/` and would follow the splits.

1. **A note or audio clip that starts before the loop start is not heard on a later pass**, even when it is still sounding
   across the loop start. The scheduler plays what starts inside each pass (`src/engine/Scheduler.js`). A DAW usually
   retriggers it; deciding whether to is a musical choice, not a fix.
2. **A plugin editor's `jig:integrity` is not checked.** A browser cannot verify a frame's document against a digest the way it
   can a script, and fetching it first to check and then framing it is two fetches that can differ. The frame is sandboxed on
   the plugin's own origin either way; the digest is a claim nothing tests.

3. **Two audio-render tests time out in a full parallel run.** `tests/host/presetRender.test.js` (glass-hours, and the Conductor driving Generative Gamelan) take 27 to 52 s alone and have the
   120 s and 30 s caps, so they fail now and then when the other suites compete for the machine (seen 2026-10-22 and 2026-10-23, with the Conductor test too once, green on rerun and alone; the load average on the machine was 17 to 32 from other programs at the time). Not a regression in any case; the
   fix is a longer cap or running that file apart from the rest, which is the maintainer's call on how long the suite should be allowed to take.

## Recurring, check periodically

- [ ] **Check builds for warning messages, and fix what is fixable locally.** The Rust plugins build with only the
      `private_interfaces` notice on the ABI pointer exports, shared with every worked sibling; resolving it in one plugin
      would diverge that plugin from the rest, so it stands until it is resolved everywhere at once. Anything beyond that is a
      defect to fix where it appears.
- [ ] **Play every preset in a real browser after a change to a plugin processor or the engine**, measuring each track and not
      only the master. The offline check (`tests/host/presetRender.test.js`) covers what the offline host models; Dice was
      silent in Chrome for weeks while it passed (MISTAKES.md).
