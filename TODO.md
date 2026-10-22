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
4. The rest of the Tracks section: a fader on a bus or folder, then the reorder and collapse item, and a look in Chrome at the bulk level and pan buttons.
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
- [ ] **Play every preset** after any change to a plugin processor or the engine (see Recurring).

## Plugins

### Downspout ports (Moka, Sprout, Markov, Retune)

- [ ] The VST3 panels did more than the generated panel can: Moka's presets and partial ladder, Markov's clickable 12 by 12
      matrix, Sprout's and Retune's status read-outs. Presets and the matrix editor want a `jig:ui` or a preset mechanism for
      plugins.
- [ ] Sprout and Markov draw with the VST3's 64-bit mix (`tests/host/mix64.test.js` checks it against BigInt); whether a seed
      now gives the VST3's exact line is unchecked, since the rest of the port may differ. Conductor uses the same draw.
- [ ] The catalogue's `search` defaults to `limit = 30` (`src/catalogue/Catalogue.js`) and there are 32 plugins, so an empty
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

- [ ] `npm run check:skins` runs in real Chrome and is not part of `npm test`.
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
      changes. The shell and mixer items below are where it lands. Also unmeasured: the tab row at phone width with five tabs.
- [ ] **Editor-graph shape.** Marker and region colour, and folders (`jig:parent`), have no model or writer yet, so their
      shapes come with them.
- [ ] **WebMCP tools for what has none:** trim, copy, cut and paste of clips, and freeze.
- [ ] **WebMCP parity gaps, each a decision:** the track-alignment preference and per-track latencies, `audibility`, a
      stateful plugin's live state, and `loadAsset` (how an agent would supply bytes). Closing one means removing it from the
      gap list in `tests/mcp/parity.test.js`.

### Shell

- [ ] **Transport.** Tap tempo, a seconds or SMPTE readout, a compact phone transport bar. The click accent assumes one
      signature, like `barBeat`.
- [ ] **Playhead and loop.** Drag the whole loop, a loop range from a selection or region, and follow for the piano roll.
- [ ] **Zoom and snap.** Pinch on touch, zoom to selection, seconds as an alternative ruler, the piano roll reading the shared
      `TimeView` (it has its own scale), snapping to other clips' edges, and the grid following signature changes.
- [ ] **Dock.** Escape in the piano roll's grid now closes it (not seen in Chrome); a dock view for an envelope; keyboard selection of a track
      other than by its name; move a selected group of clips as one.
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
- [ ] **Folders: what is left.** Built: `jig:folder` in the editor graph (vocab, shape, reader, writer, round trip, counter
      example), the Folder field in the track panel, `track_layout` `folder`, and a bar above each run of neighbouring tracks
      with a hide and show button (view only, not saved; focus stays on it). Seen in Chrome: two tracks in a folder collapse
      to the bar and come back. Not built: moving a whole folder, collapse saved with the session, Folder in the bulk panel,
      and a screen reader pass.
- [ ] **Bus: what is left.** Built: `src/model/TrackBus.js`, the `track_bus` tool and "Send to a new bus" in the bulk panel,
      one undo step; seen in Chrome with two empty tracks. Not seen: audible summing of tracks with plugins; the bus is
      not placed after its members in the order; no way to name it on creation from the page.
- [ ] **Linked faders as a group parameter: what is left.** Built over `src/model/GroupChannel.js` (a decibel step keeps the
      tracks' balance, a pan shift stops when the track nearest the edge arrives): "Members down and up 1 dB" in the panel of
      a bus or of a track in a folder, moving the tracks that send to it and those sharing its folder, one undo step. Seen in
      Chrome on 2026-10-22 with a bus of two tracks: both moved to -1.0 dB, the bus stayed at 0. Not built: a fader in the
      track's header rather than the panel, a pan step for members, typing an amount, and the folder case was not seen.
- [ ] **Reorder by drag; collapse a lane to a thin bar;** show and hide by folder; resize from the header by keyboard. Order is
      layout and is not part of undo.
- [ ] **Bulk level and pan: what is left.** Built: four buttons in the bulk panel (level down and up 1 dB, pan left and
      right 0.1) over `src/model/GroupChannel.js`, one undo step. Not seen in Chrome; no way to type an amount; a range select
      by Shift with the keyboard.
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
- [ ] **Loop a clip.** Content repeats inside the clip bounds, with the loop end draggable (openDAW's `loopDuration`). Probably
      needs vocabulary.
- [ ] **Overlap behaviour.** State the rule for clips that overlap on a lane (clip the older, push to a new lane, or refuse)
      and test it before shipping move. openDAW made this a preference after getting it wrong twice.
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
- [ ] **Insert slots on the strip** mirroring the chain strip, so both views edit one list.
- [ ] **Strip snapshots, metering, render in place and consolidate** are under Phase C and Phase E, not repeated here.

### Session, clip launcher and interchange

- [ ] **Clip launcher (session grid).** Scenes and slots that trigger clips on the same tracks, quantised launch, follow
      actions later. Last on purpose: webdaw leaves it to milestone 9 and it needs the arrangement solid first.
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
- [ ] **The scheduler and piano roll reading signature changes** (tap tempo is under Shell, Transport).
- [ ] **Reverse and normalize** as offline render ops on take bytes. Time stretch and pitch shift stay out until a DSP design
      exists (see Keyframe).

### Phase B. MIDI editing

- [ ] **Velocity, CC and pitch-bend lanes.** Per-note velocity plus one lane per controller, drawn under the roll, keyboard
      editable (`src/ui/PianoRoll.js`).
- [ ] **Quantize and transforms: what is left.** Built: quantize (grid and strength), transpose, velocity scale and reverse as
      pure functions (`src/model/NoteTransform.js`), one `setClipNotes` change, the `clip_transform_notes` tool, and a row of
      buttons in the piano roll (Quantize with a grid choice, semitone and octave, Softer, Louder, Reverse) that act on every
      note of the clip. Seen in real Chrome on 2026-10-22: the row hidden for an empty clip and shown once there are notes,
      Quantize to the Beat grid, Reverse, one Undo, and a refused octave step said in the roll's status line. Not seen: Down,
      Softer and Louder, touch, a screen reader pass. Note selection is built
      (S or Shift-click toggles a note, Ctrl+A chooses all, Escape lets go before it closes; the buttons then change only the
      chosen notes, and the choice follows them), unit-tested and not yet seen in Chrome. Not built: a rubber band over notes,
      keeping the choice on a note moved by hand, invert, humanize (needs a seeded draw), scale snap, quantize strength in the roll, quantize that moves note
      ends, and a screen reader pass over the row.
- [ ] **Step input and virtual keyboard.** Enter notes from keys one step at a time; keep the on-screen keyboard playable from
      touch.
- [ ] **MIDI import and export.** Read and write a Standard MIDI File for one track, plus project-wide export, reusing the
      transport map.
- [ ] **Multi-clip editing and drum view.** Two clips side by side for reference; a drum lane view where the track holds a kit.
- [ ] **MIDI panic: what is left.** Built: a Panic button in the transport bar (CC 123 and CC 120 to every node, transport
      left running; `web/app/Transport.js`). The button was pressed in Chrome and logged; not tried with a stuck note; no key for it, no agent tool, and the
      on-screen keyboards' own held notes are not released.

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

- [ ] **Recent projects, startup recovery, autosave.** List recent sessions, reopen the last on choice, recover unsaved changes
      after a crash; periodic local snapshots including untitled sessions, clearly marked as not the saved project; never
      overwrite the saved file with a recovery copy. Shared with the PWA: offline use and the origin private file system as a
      store are decided here once, for both front pages.
- [ ] **Project settings, notes, metadata.** Title, author, revision note per session in the Turtle file, shown in one dialog.
      Editor-only fields stay out of the compiled graph.
- [ ] **Templates and project tabs.** Save a session as a template; open from a template. Tabs only if sessions stay
      independent documents with no shared audio state.
- [ ] **Media explorer and missing media.** Browse and import audio by drag and drop (import exists), resolve missing files on
      open with a replace dialog. Missing media must block render loudly.
- [ ] **Undo history panel.** A visible list of undo steps from `OpDispatcher.undo()` and `redo()`, click to jump. No second
      undo implementation.

### Phase G. Workflow and customization

- [ ] **Command palette.** Every Op reachable by name search over the one dispatcher, as WebMCP tools are. No palette-only
      commands.
- [ ] **Keyboard shortcuts and profiles.** A searchable shortcut list, scoped rebinding with conflict checks, import and export
      of named profiles, all from one binding store. The clip keys are hardcoded in `Timeline.js` today. One good default plus
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

1. **A note or audio clip that starts before the loop start is not heard on a later pass**, even when it is still sounding
   across the loop start. The scheduler plays what starts inside each pass (`src/engine/Scheduler.js`). A DAW usually
   retriggers it; deciding whether to is a musical choice, not a fix.
2. **A plugin editor's `jig:integrity` is not checked.** A browser cannot verify a frame's document against a digest the way it
   can a script, and fetching it first to check and then framing it is two fetches that can differ. The frame is sandboxed on
   the plugin's own origin either way; the digest is a claim nothing tests.

## Recurring, check periodically

- [ ] **Check builds for warning messages, and fix what is fixable locally.** The Rust plugins build with only the
      `private_interfaces` notice on the ABI pointer exports, shared with every worked sibling; resolving it in one plugin
      would diverge that plugin from the rest, so it stands until it is resolved everywhere at once. Anything beyond that is a
      defect to fix where it appears.
- [ ] **Play every preset in a real browser after a change to a plugin processor or the engine**, measuring each track and not
      only the master. The offline check (`tests/host/presetRender.test.js`) covers what the offline host models; Dice was
      silent in Chrome for weeks while it passed (MISTAKES.md).
