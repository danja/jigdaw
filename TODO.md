# TODO

What the project needs. Remove an item when its implementation and verification are complete, and keep
whatever it left undone as an item of its own. Review periodically. What is built is in
[docs/jiggy-features.md](docs/jiggy-features.md); what a finished item did and how it was checked is in
`git log`, and mistakes are in [MISTAKES.md](MISTAKES.md).

## From the inbox

- [ ] **Studio layout, what was done and what is left** (from the inbox, 2026-10-10, after playing Glass Hours). **Done, seen in Chrome:**
      the plugin browser starts closed on every visit (it had been remembered open); a track row defaults to the small size (105 px, not 261 or
      more: `DEFAULT_LANE_SIZE` in `src/model/EditorState.js`, and a session that said nothing is now drawn small, which `docs/project-format.md`
      says); the arrangement is a box no taller than the screen that scrolls both ways inside itself, so its horizontal bar is at the bottom of
      the window and not down the page, with the ruler and loop row pinned above the lanes and the playhead as tall as the lanes
      (`web/app/Arrangement.js` fits the box to the window and `.timeline-scroll` in `web/index.html`); an automation lane is 64 px of plot, not 96.
      No horizontal overflow at 386 px, measured in an iframe. **Done since:** small tracks are one row (45 px), buttons are 28 px under a mouse and 44 px on touch or below 760 px, and
      an automation lane has a Fold button (106 px to 42 px; the fold is kept across redraws, not across a reload). **Left:** the master row and the editor dock below the arrangement are
      untouched; a MIDI clip now draws its notes as lines (one path per clip), and an automation lane's buttons stay at the left edge while scrolling; a person should look at it on a phone.
- [ ] **Glass Hours, and what making it showed.** 2026-10-10. A 40 bar piece in D minor, built through the WebMCP tools in the browser and
      balanced by playing it and reading per-track peaks (no clipping, master worst peak -2.5 dB), is `examples/songs/glass-hours.ttl` and the
      bundled preset `web/presets/glass-hours.ttl`, both written by `examples/songs/glass-hours.js`, and `tests/rdf/SongExamples.test.js` binds
      the script to both. **Done from the limits it hit:** the plugins are deployed, so its `strandz.it` addresses resolve and it opened in
      Chrome from the file; `renderChain` now plays the clips with the real Scheduler and follows sends and bus outputs to the receiving
      track's audio input, so a piece of clips is a preset and the render check hears it (mutation checked: with clips off, Drums is silent);
      `transport_play` takes `fromBeat`, and playing with a loop on starts at the loop's start, so a section is heard by looping it, with the
      envelopes seeded at the start point (`Scheduler.start(atTime, { from })`); `parameter_set` and `parameter_reset` take `nodeId`, as every
      other tool does, and say so when it is missing (it had taken `node`, and the docs said `nodeId`). The other RDF readers were timed:
      28 ms for the largest plugin profile, so they were left alone. **Done since:** clicking the ruler, or typing a bar in "Go to bar", cues the start while stopped and seeks while playing
      (`Transport.seek`). **Done since:** the offline render reports the master too (the sum of the tracks through its plugin). **Left:** the clips' audio is
      not in it, and no fader is applied, so what it checks is that sound reaches each place, not how it sounds.
- [ ] **Master chain and track receives, what is left.** From the inbox, 2026-10-10. **Built, 2026-10-10:** a track's `jig:audioInput`
      is now also where a send or a bus output arrives, so a plugin on a bus is in the path; the master has a chain (nodes with
      `jig:onTrack <#master>`, `jig:audioInput` on the master for the node the mix arrives at, id `master` reserved), in the model,
      engine, RDF, shapes with a counterexample, WebMCP (`master_set` `audioInput`, `plugin_load` and `node_move_to_track` with the
      track `master`), the studio rack (a Master bus section, Load onto, an audio input menu on a track) and the simple page (an
      "Everything together" card). Generative Gamelan has its reverb on the master. Tested through the real engine in
      `tests/host/presetRender.test.js` and mutation checked. **Seen in Chrome, 2026-10-10:** Generative Gamelan on the simple page plays with the meter lit and the
      "Everything together" card opens to Hall's controls; the studio shows the Master bus section with its audio input menu
      and "The master bus" under Load onto; no console errors. **Left:** (1) a screen reader pass over the new controls; (2) **MIDI sends are built** (2026-10-10: `jig:Send` with `jig:signalKind trn:Midi`, in the model, router, RDF, shapes,
      WebMCP `send_add` `kind`, and the dock's Add send; Gamelan's Conductor uses two), seen in Chrome: the dock lists "MIDI to Sprout" and "MIDI to Markov" and the preset plays; a MIDI send
      from or to a composite is built (read at the composite's MIDI boundary, which also fixed MIDI sent into a composite reaching members
      behind its input), and so is a note range on a MIDI send or connection (`jig:lowNote`, `jig:highNote`, `setConnection`,
      `connection_set`, fields in the Sends panel and the connection list, the router filtering with note-off pairing); (3) **alignment through a bus is built** (2026-10-10: tracks feeding a bus are lined up with each other at it, and the
      others with what the bus adds; a send is not aligned, and the master chain's own latency delays everything alike); (4) **the master's chain is summarised on the Mixer tab and the output meter holds a clip** (2026-10-10: the Master channel lists
      its plugins and where the mix arrives, with Show plugins; a "Clip" button appears beside the meter when the output reached full
      scale and clears when pressed, on the studio, simple and reel pages; seen in Chrome); every Mixer strip now has a meter with the held peak in dB (`src/ui/Meter.js`,
      `web/app/Meters.js`, `Engine.trackMeter`).
- [ ] **Finish the Downspout ports: Moka, Sprout, Markov, Retune.** 2026-10-10. All four are plain JavaScript Jigs in `plugins/`
      (no module), ported from `~/github/downspout/plugins/`, each with a host test (`tests/host/{moka,sprout,markov,retune}.test.js`)
      that loads it through the real loader and engine and checks the music, not just that it loads. Retune's scale is a
      `jig:asset` the person replaces and is its saved state; Markov's matrix and learned counts are its saved state, in the VST3's
      own text format. **Left:** (1) **not yet seen in a browser**: load each in Chrome with the window in front, play Moka from the
      keyboard, run Sprout and Markov against the transport, and chain Retune into Moka with a `.scl` loaded from the panel (the tests
      render offline and use the offline host's fake port); (2) the VST3 panels did more than the generated panel can: Moka's presets
      and partial ladder, Markov's clickable 12 by 12 matrix, Sprout's and Retune's status read-outs. Presets and the matrix editor
      want a `jig:ui` or a preset mechanism for plugins; (3) Sprout and Markov now draw with the VST3's 64-bit mix, held as pairs of 32-bit halves so nothing allocates
      (2026-10-12, `tests/host/mix64.test.js` checks it against BigInt); whether a seed now gives the VST3's exact line is unchecked, since
      the rest of the port may differ, and Conductor was changed to the same draw on 2026-10-13; (4) the browser search bar asks for 25 results and the catalogue defaults to 30, so an empty search already hid plugins at 27
      and now hides 6 of 31.
- [ ] **SVG skins.** 2026-10-14. Specified in `docs/svg-skins.md`, with contract section 9.4, the vocabulary and shapes, the `AGENTS.md`
      rule amended. Built and seen working: Tremolo's skin (`plugins/tremolo/skin/`) drawn by `createPanel` in the studio page in Chrome,
      2026-10-14: a drag that left the knob moved Rate, a press on the track set Depth, ten arrow presses moved it 0.05 with the focus
      kept, readouts follow, hit boxes are 44px or more at a 300px width and sit inside the artwork. Parts: `src/ui/SkinArtwork.js`
      (allowlist builder), `src/ui/SkinPanel.js` (moves it, native inputs under it), `src/rdf/SkinReader.js`, `src/host/SkinLoader.js`
      (fetch, verify, rebase to where the skin came from), `web/app/Skins.js`, the `Panel.js` option, `web/panel.css`, and
      `bin/write-profile.js` (writes `skin.ttl`, the `jig:skin` arc, and lists both files as assets so a bundle carries them).
      `npm run check:skins` (`bin/check-skins.js`) runs the builder in real Chrome against hostile artwork. Cascade's skin (`plugins/cascade/skin/`) is the second and uses a toggle and a selector, seen in Chrome
      2026-10-14: a press and Space switch Freeze, a press and the arrow keys step Mode, focus stays on the control, Tab follows the picture
      (mix, size, damping, freeze, mode). **Not done:** (1) a Toggle's two-state text and a Selector's wrap on press are seen, but a skin with a
      vertical Linear control has not been drawn; (2) the
      simple page shows Cascade's skin since 2026-10-14, with the piece's own settings, after a fix: the sound rack kept the panels it had
      when a skin finished loading, so `SoundRack.invalidate()` now makes them again; (3) done 2026-10-14: a vertical linear control (Boost's fader, `plugins/boost/skin/`) was driven in Chrome: a press a quarter of the way up read 0.50,
      a drag off to the side clamped at 2.00, ten arrow presses moved it 0.10 with the focus kept, touch-type pointer events moved it and stopped at release,
      and the control reaches the accessibility tree as a slider named Gain with value text; **a real screen reader and a real finger are still not tried**.
      Found on the way: at phone widths a dense skin's padded targets overlapped (Parameq's switch, type plate and knob), so `createSkinPanel` now works
      out whether they would at the width given, from the drawing's units, and `createPanel` puts the drawing away and draws generated controls for every port
      when they would (and brings it back); the Chrome window used here renders at about 1.5 frames a second, so those checks needed 2 s waits; (4) `check:skins` is not part of `npm test` (Chrome); (5) done 2026-10-14: Parameq has a skin (`plugins/parameq/skin/`, six bands of On, type, Freq, Gain and Q, a vintage look; Q was first left unbound to see
      "Other controls" work, and was bound on request) beside its `jig:ui`, and contract 9.4 now says the editor is offered beside the panel. Seen in Chrome: dragging the
      skin's Band 3 gain knob to +12 dB moved the sandboxed editor's curve and slider, and a `setParameter` from outside moved the skin's knob. To see an
      editor locally the plugin must be on another origin than the page, so load `http://localhost:8748/plugins/parameq/` into the page at
      `127.0.0.1:8748`; on the same origin the Open editor button is correctly left out;
      (6) a flattened bundle's skin fetches its artwork from the canonical IRI. Meters wait for a named meter feed.

- [ ] **Conductor, what is left.** 2026-10-13. Built: an editable form of up to 12 steps (`form_1` to `form_12`, ending at the first
      0), a minimum and maximum bars per section (0 uses the general limits), and a scene, density, energy, mutation and restart value per section; the
      defaults reproduce the VST3, tested in `tests/host/conductor.test.js`. **`jig:ui` built 2026-10-13** (`plugins/conductor/ui/index.html`, `tests/ui/conductor-ui.test.js`): the form as a row of selectors, then a block per section; seen in Chrome 2026-10-14: it opens in the sandboxed frame, typing 55 into Development density reached the host (`develop_density` 55), and at 390px wide it is two columns with no sideways scroll. **Left:** (1) the other controls in it (selects, the reset checkboxes) were not driven, only the number field; (2) a section count that is
      not fixed at five, a transition CC ramping across the bar before a boundary, a lead-in before the boundary, and a time signature
      override are not built; (3) not heard or seen in a browser; **downstream, 2026-10-13:** Sprout, Markov and MelGen now ignore notes on the Conductor channel (the
      section note had been taken as a held key, a line to learn and a line to follow), tested in each plugin's host test; not changed, and
      left as it is, by decision: MelGen takes CC 21 (Conductor's density) as its *scale* and CC 22 (energy) as its density, so editing a section's
      density changes the key; Sprout now takes CC 20 (scene) as its generations, tested in `tests/host/sprout.test.js`, and still takes CC 23 (mutation) as its seed; Markov ignores CC 20 (scene); Ground and DrumGen
      have no way to say which section they are in beyond CC values; (4) a current-section read-out needs the processor-to-panel message
      (see the Quefrency item).
- [ ] **Finish Reel, the livecoding language.** 2026-10-01 (DIM task `/farelo/task/t4600ce199d2f`). Designed and its four questions
      decided in [docs/livecoding.md](docs/livecoding.md); live performance is the principle. **Built, tested and checked in
      Chrome, 2026-10-01:** everything in `src/reel/`, `OpDispatcher.grouped`, `script_run`, saving a script in a session
      (`scripts.ttl`, shown and never run on open; the browser check reached the simple page and not the final hop back into the
      Script tab, so repeat that hop), and the **Script tab** with its
      wiring (the clock ticks beside the scheduler, `ReelClock` takes `since` so a script taking over at a bar line acts on that
      bar line's downbeat, found in the browser). **Left:** (1) repeat in Chrome the one hop not yet seen, a session carrying a script back into the studio's Script tab
      (covered by `tests/web/Script.test.js`, and the browser tool refused to continue); (2) a real screen reader pass over the tab, which
      only a person can do (`HUMANS.md`); (3) **the simple page now has a Script tab** (2026-10-01, `web/simple.html`, `web/simple.js`; `Runtime` builds
      the tools for Reel alone there, with no public agent surface; `tests/web/SimplePage.test.js` binds its ids). Checked
      in Chrome with the window in front and a real click (a scripted click carries no activation and the tune never opens):
      a tune plays, Check reports two bad names with line numbers, Run now sets Square bass's cutoff to 800 and shows Stop, and
      at 360px there is no horizontal overflow, every button is 44px and the text area is 16px. A script's name for a plugin is
      its label with underscores (`square_bass`), which the error message offers. Not yet seen: the saved-session round trip on
      this page, and a screen reader. The timing of a ramp is held to the frame by
      `tests/reel/RampTiming.test.js`. **Known limits to decide:** a new plugin named by a
      script is validated before the swap but instantiated at it, so a swap that adds one can stall the bar (preloading is the
      fix); a failure after the swap begins has already stopped the old script; a timed parameter set is accurate to the tick,
      and sample accuracy for one means giving `parameter_set` an `atFrame`; parse errors are reported before planning, so a
      script with a typo and a bad range shows the typo first.
- [ ] **Decide whether more docs should be hidden.** 2026-10-01 (DIM task `/farelo/task/t57b75c497c2a`). The mechanism
      exists: `bin/docs-hidden.js` keeps six documents off the site, and `tests/bin/docs-site.test.js` now checks
      that the published set is every document not hidden and that `docs/plugins/*-design.md` has no page. That
      guard is weak by construction (the build derives the published set from the same list), so it catches a
      build that leaks, not a wrong decision. Open: whether `revisions`, `testbed` and `pwa` (published today, the
      first in a "Background" group) are essential. A maintainer decision, since `docs/index.md` links each.
- [ ] **Finish cross-linking the JigDAW pages, Jiggy and `~/github/plugin-universe`.** 2026-10-01. Done here: a
      "Where the catalogue is" section in `docs/index.md`, and a Plugin Universe link in Jiggy's header nav. Open:
      plugin-universe's own pages should link back to the spec and to Jiggy at strandz.it/jigdaw (a change in
      that repository, made and checked there), and nothing checks that an external link resolves, so a moved
      page still passes. A check needs network access, which the offline-first test rule argues against, so a
      scheduled check is the likelier shape.
- [ ] **Mop glitches in the JigDAW Adapter VST in Reaper.** 2026-09-30, user report, no buffer size or version
      yet. **Diagnosed headlessly:** Mop costs 1.70x realtime through the adapter's pure-interpreter WAMR (8 s of
      line plus drums took 13.6 s wall at 48 kHz and at 44.1 kHz), so every realtime block overruns and the
      symptom is continuous dropouts. Output is otherwise correct (peak 0.10, no dead windows, MIDI and CC path
      intact), so it is throughput, not corruption. 8b8 through the same path costs 0.20x and Mop under node's
      JIT 0.06x, which is why no browser or offline test saw it. The voice cap and the buffer size change nothing
      (the OPL emulator steps every operator per sample). Fixes are a maintainer decision: WAMR AOT or JIT (needs
      wamrc and LLVM as build dependencies; the interpreter was chosen in `native/cmake/FindOrFetchWamr.cmake`
      because the gain was not needed, and for Mop 2x or more is), or Mop-side surgery against the
      unmodified-Opal rule. Confirmation from a person is in HUMANS.md.
- [ ] **Finish Keyframe, the extrema-sampling time and pitch stretcher.** 2026-09-26, built 2026-10-01 in `plugins/keyframe/`
      from the DAFx26 paper (`/chalet/github/dafx26-paper`, Nielsen, CC BY 4.0, credit kept in the profile). Design and
      measurements: [docs/plugins/keyframe-design.md](docs/plugins/keyframe-design.md). Built and tested (52 DSP tests, 6
      host tests): Economy, Balanced and Full quality, Linked and Independent stereo, defaults Economy and Linked. Open:
      **decide whether `quality` should default to Balanced** (measured 2026-10-01 under WAMR: Economy is about 15 percent cheaper than Full and every setting is 0.1 to 0.2 of realtime, so Economy stands as the cheapest; the figures and the driver are in the design); reduce the 10 dB the forced keyframes cost at Balanced and Full; listen to it, including
      Linked stereo on a wide clip (HUMANS.md). Checked in Chrome 2026-10-01: loads through Jiggy's own loader into a real
      AudioWorklet in 0.6 s, generated panel complete and labelled with spoken values. Not checked: sound through it in the live
      page, since no source was connected. The panel now follows a profile's `paramIndex` (2026-10-13, `ProfileReader`), so check Time rate's place.
- [ ] **An additive resynthesis effect that builds harmonics from the input.** 2026-09-26 (r/synthesizers idea):
      pitch-shift the input to 2x, 3x and 5x, then use feedback to supply the intermediate non-prime harmonics (4x
      from 2x fed back, 6x from 2x and 3x combined, and so on). Needs design before code: what the pitch shifters
      are, what the feedback network is, and how gains stay bounded. Any cycle needs an explicit delay by the
      latency rules, and latency inside a cycle is never compensated. Designed 2026-10-01 in
      [docs/plugins/harmonics-design.md](docs/plugins/harmonics-design.md) (delay-line shifters, a loop gain bounded at 90 percent, plain
      JavaScript); settle its three open decisions, then build it.
- [ ] **A panning effect with non-linear motion.** 2026-09-26. An auto-panner whose position follows non-linear
      trajectories rather than one LFO: circular motion, random walk and envelope-follower-driven jumps, with
      per-band panning so low and high content move independently. Needs design before code: the trajectory set,
      the parameters with units, and a mono-compatibility rule. Designed 2026-10-01 in
      [docs/plugins/trajectory-pan-design.md](docs/plugins/trajectory-pan-design.md) (level-only panning so the mono sum cannot cancel,
      Linkwitz-Riley bands, plain JavaScript); settle its three open decisions, then build it.

## The track view

- [ ] **Arrangement and mixer UIs follow Reaper where possible**, familiar and intuitive. From the inbox, 2026-10-01. Needs a
      note of what Reaper's track control panel, mixer strip and arrange conventions are (and what to keep from Jiggy's own
      routing-first model) before changes; T0's layout decision and T6 are where it lands.

Derived 2026-09-30 from a graph index of this repository and of `~/github/openDAW`, `~/github/webdaw` and
`~/github/daw` (GridSound; its source was empty submodules, so what is said of it is from its README). All three
are built around one screen, a track-oriented arrange view. What Jiggy takes from each: **openDAW** markers,
signature and tempo tracks, consolidate, effect composites, modulators, a spotlight search, per-context shortcuts,
DAWproject and live collaboration; **webdaw** the order to build in (`notes/milestones.md`); **GridSound**
pattern-based composition, a sampler and drum grid. Where Jiggy should be better: routing is the model, not a menu,
and a plugin is a dereferenceable IRI with a machine-readable profile, so the view needs no per-plugin code and an
agent drives all of it through the same Ops. The bar: every feature is one Op, undoable, keyboard reachable, named to
a screen reader and usable at phone width. [docs/usp.md](docs/usp.md) says where Jiggy is ahead and behind.

### T0. Decisions

- [ ] **Layout decision for the main view, what is left.** Written 2026-10-01 in [docs/main-view.md](docs/main-view.md) with its
      rejected alternatives, after the fact and from the code. The open question it names is a docked mixer in the
      Reaper manner against the tab (INBOX, T6); decide that, and the document is revised with the answer. Also unmeasured: the tab row at phone width with five tabs (needs the Chrome window in front).
- [ ] **Editor-graph shape, what is left.** Done 2026-10-01: shapes for position, order, lane size and colour, a reference
      and a counterexample (14 violations, each constraint once), and a session's `editor.ttl` is validated before it is applied.
      Open: marker and region colour, and folders (`jig:parent`), which have no model or writer yet, so their shapes come with them.
- [ ] **WebMCP tools for what has none, what is left:** trim, copy, cut and paste of clips, and freeze. Done 2026-10-01:
      the master, sends, bus outputs (`track_set` `output`), markers and regions, 10 tools, tested in `tests/mcp/tools.test.js`.

### T1. The main view shell

- [ ] **A view module of its own.** `src/ui/Arrange.js` with a header column and a lane area sharing one vertical
      scroll, built from `Timeline.js`, `Strip.js` and `Panel.js` rather than a rewrite. `Timeline.js` is down from 626 to 487
      lines (2026-10-01): `ClipText.js` and `ClipButton.js` came out along existing seams and it still re-exports. Next seam: the
      loop brace and the lane drawing.
- [ ] **Transport, what is left.** Built 2026-10-01, tested offline and not yet heard: a Click button and a count-in of 0, 1 or
      2 bars (`src/engine/Metronome.js`, `web/app/Click.js`). The click goes straight to the destination, so it is never in
      a bounce or the meter; recording waits through a count-in so a take starts at beat zero. **Check in Chrome with the window in
      front:** that it clicks in time, accents the bar, keeps time through a loop, and that a count-in leaves the playhead at the
      top and then starts everything together (a script's clock starts in the future during one). The accent assumes one
      signature, like `barBeat`. Left: tap tempo, a seconds or SMPTE readout, and a compact phone transport bar.
- [ ] **Playhead and loop.** Seek by clicking the ruler, drag the whole loop, a loop range from a selection or
      region, and follow for the piano roll.
- [ ] **Zoom and snap.** Pinch on touch, zoom to selection, seconds as an alternative ruler, the piano roll reading
      the shared `TimeView` (it has its own scale), snapping to other clips' edges, and the grid following signature
      changes (`barBeat` still assumes one signature).
- [ ] **Dock.** Escape does not close the piano roll (Close does); a dock view for an envelope; keyboard selection of
      a track other than by its name; move a selected group of clips as one.
- [ ] **First run and narrow layout.** A guided tour and a hint for the second step; collapse the header to icons at
      phone width; "Load onto" following the selected track.

### T2. Tracks

- [ ] **Duplicate a track, and add an empty one from the header.** Duplicate needs one composite Op that loads each
      plugin, copies settings and state, and remaps connections and track inputs, or undo takes one step per plugin.
- [ ] **Track types visible in the header.** Instrument (MIDI in, audio out), audio, MIDI only, bus; drawn from the
      node ports, not a flag.
- [ ] **Folders and groups.** Editor-only folder first (no compiler change), then bus tracks that sum other tracks.
- [ ] **Reorder by drag; collapse a lane to a thin bar;** show and hide by folder; resize from the header by
      keyboard. Order is layout and is not part of undo.
- [ ] **Bulk edit of level and pan for several tracks** (needs a rule for relative changes), and a range select by
      Shift with the keyboard.
- [ ] **Track input and monitoring.** A real MIDI controller (untried against hardware), choosing among several MIDI
      and audio inputs, MIDI panic, input monitoring, the microphone as a choice on any studio track, and MIDI learn.
- [ ] **Track alignment, what is left.** Clips and live MIDI are not offset; the setting is not in the saved session,
      so two people can hear differently; a limit warning is in the console, not on the page; and no render
      comparison has measured that audio really arrives aligned.

### T3. Routing and plugin chains

- [ ] **MIDI loops are refused** (error kind `midi-cycle`, `docs/latency.md`). This was my decision, not yours; say
      if they should be allowed with some limit instead.
- [ ] **Chain strip.** Reorder by drag, draw a sidechain key connection as its own thing, measure the strip at phone
      width, and count a bypassed plugin out of latency compensation (it still counts its declared latency). MIDI
      chains are not reordered.
- [ ] **Connections.** A drawn line as an extra to the text cables; port names from the profile beyond "Audio out 1"
      and "MIDI out" (Dynamix's key is the only named one, and only Dynamix declares one); a "why not" for a missing
      matrix cell; matrix column headers are wide at phone width.
- [ ] **Sends and buses, what is left.** A return-track marker beyond the header text, the alignment delay counting a
      bus's latency, a send's own alignment, send pan, and a level meter per send.
- [ ] **MIDI routing, what is left.** A note-range split as a connection property rather than only a plugin, and the
      MIDI monitor on the routing matrix and the chain strip (it is in the plugin view only).
- [ ] **Parallel chains and layers.** Two chains from one input mixed back, openDAW's "effect composite". Only after
      the nested plugins design (see "Before there is code").
- [ ] **Failed load stays isolated.** The chain strip draws a failed plugin as failed beside the working ones (tested
      at model and strip); not yet driven with a plugin that really fails to load in a live page.

### T4. Clips, regions and the editors in the dock

- [ ] **Clip preview on the lane.** Note clips draw their notes as a miniature roll.
- [ ] **Selection.** Rubber band and lasso on lanes, by pointer and by keys.
- [ ] **Clip operations, what is left.** Takes and comping (TrackRecorder already captures passes; select the active
      take, explode to tracks), slip edit, reverse and normalize as offline renders, a fade curve choice and
      auto-crossfade where two audio clips overlap, grouping so moves apply together, split at a click, trim by drag,
      and a fine nudge. Mute, lock and fades have not been checked by ear.
- [ ] **Loop a clip.** Content repeats inside the clip bounds, with the loop end draggable (openDAW's
      `loopDuration`). Probably needs vocabulary.
- [ ] **Overlap behaviour.** State the rule for clips that overlap on a lane (clip the older, push to a new lane, or
      refuse) and test it before shipping move. openDAW made this a preference after getting it wrong twice.
- [ ] **Piano roll in the dock** with zoom and scroll bound to the shared time model, plus velocity and controller
      lanes (Phase B).
- [ ] **Drum grid.** Step editor for a track whose target is a kit, using DrumKit.
- [ ] **Audio editor.** Waveform view with start, end, gain and fade handles for one clip.
- [ ] **Markers and a signature lane** on the ruler. The terms and the file format exist; the view does not.
- [ ] **Pattern clips** (GridSound's model): a reusable MIDI pattern placed on several tracks or times, edit once and
      all instances follow. Needs a design note first; build only if it earns its cost over copy and paste.

### T5. Automation

- [ ] **Signature changes** are in the model and the file and are not played; the lane and the ruler do not show them.
- [ ] **Lanes, what is left.** A signature lane; a range select and scale; a point's exact value typed in; checking the
      lanes at phone width; lanes for a plugin with no loaded profile are left out.
- [ ] **Write, touch, latch and read modes.** openDAW records any write while the transport runs and latches until
      stop; copy that, because a gate on one control type left every other control unrecordable.
- [ ] **A manual change while automated, what is left.** A "restore" that resumes the lane without stopping, and
      showing on the control that it is paused.
- [ ] **MIDI learn** writes into the same lanes (Phase D).
- [ ] **Modulation sources** (LFO, step, random, macro) as a Jig with a control output port, so it stays a plugin and
      not a host feature (openDAW sums depth times source onto a parameter).

### T6. Mixer, aligned with the track view

- [ ] **Mixer as a dock or a page** built from the same track list and selection.
- [ ] **Master strip, what is left** (every meter, tracks and master, now holds a clip until its Clip button is pressed): a mono switch, and controls beyond level, pan and mute (a
      master bus with its own chain, Phase D).
- [ ] **Insert slots on the strip** mirroring the chain strip, so both views edit one list.
- [ ] **Snapshots, render in place, consolidate** (Phase C; they share the bounce path, which Freeze already uses).
- [ ] **Metering and correlation as displays**, with no loudness-compliance claims.

### T7. Session, clip launcher and interchange

- [ ] **Recent projects, autosave, recovery, templates** (Phase F).
- [ ] **Undo history panel** (Phase F), listing the existing `OpDispatcher` steps.
- [ ] **Clip launcher (session grid).** Scenes and slots that trigger clips on the same tracks, quantised launch,
      follow actions later. Last on purpose: webdaw leaves it to milestone 9 and it needs the arrangement solid first.
- [ ] **Standard MIDI file import and export** (Phase B).
- [ ] **DAWproject import and export.** Bitwig's open format gives sessions an escape route to and from other DAWs.
      Track, clip, note, level, pan and tempo map first; plugin state only for a Jig with an equivalent on the other
      side.
- [ ] **Sample and preset libraries.** A browser tab for audio files with preview, folder tree and drag onto a lane.

### T8. Workflow, access and the surfaces around it

- [ ] **Command palette** over the dispatcher (Phase G).
- [ ] **Shortcuts scoped by context** from one binding store, with a searchable list and conflict checks (Phase G). The
      clip keys are hardcoded in `Timeline.js` today.
- [ ] **Screen reader pass over the whole view.** Test with a real screen reader and record what was and was not tested.
- [ ] **High-contrast theme and reduced motion** checked against the new view.
- [ ] **Touch.** Long press for the context menu, two-finger pinch zoom, measured at a real phone width.
- [ ] **WebMCP parity, the gaps it found.** Done 2026-10-01: `tests/mcp/parity.test.js` classifies every member of the
      dispatcher, so a new Op fails until it is exposed or excluded with a reason; `history_undo`, `history_redo` and
      `parameter_reset` were added because three real edits had no tool. Left as listed gaps, each a decision: the
      track-alignment preference and per-track latencies, `audibility`, a stateful plugin's live state, and `loadAsset`
      (how an agent would supply bytes). Closing one means removing it from the gap list in that test.
- [ ] **Agent-driven arrangement.** An agent builds a track from profiles: chooses plugins by role, connects them,
      writes a clip. Regress with a scripted session against the real dispatcher.
- [ ] **Live collaboration, considered.** openDAW runs Yjs sync and a peer-to-peer room. Jiggy has revisions and
      `expectedRevision` changesets, a better base for merge. Design note only.
- [ ] **Retire the three tabs** once the main view covers each of them and the measured checks pass, keeping the plugin
      rack as the dock's chain view.

Suggested order: T0, then T1 and T2 with the rest of T4's clip work, T3 next, T5 before T6, T7 and T8 alongside from T3,
and the launcher last.

## Web-native Jiggy, and a mobile PWA

From the inbox, 2026-09-30. Both directions need a design note in `docs/` before code, since both touch the "host is a
page, plugins are IRIs" premise.

- [ ] **Investigate what would make Jiggy more Web-native.** Questions for a design note, each with what the answer would
      cost, ranked by cost and by fit with the premise:
      1. *Discovery.* Can the browser search plugin-universe.com's public SPARQL and MCP endpoints directly and offer Jigs
         the catalogue marks as compatible? Needs CORS on those endpoints (check, do not assume) and a rule for trusting
         what it returns: a catalogue entry is a claim, and the profile at the plugin's own IRI is the authority.
      2. *Sync between instances.* Two or more pages sharing one session live. Peer to peer first (WebRTC data channels; a
         signalling step needs a minimal server or a copy-and-paste offer; failing that a small relay). The wire could be
         changesets over a channel with the revision as the conflict check. Decide what does not sync (the transport clock,
         the audio, editor state) before any code.
      3. *Others to weigh:* Web Bluetooth MIDI for controllers; Web Locks and BroadcastChannel for two tabs of one session;
         installable plugin collections by URL.
- [ ] **The PWA, what is left.**
      - Web Share Target and File Handling: a shared or opened `.ttl`, `.zip` or plugin bundle opens as a session or bundle
        through the same path as Open.
      - An MP3 encoder (WebCodecs does not encode MP3 in every browser, so a WASM encoder may be needed).
      - Offline use and recovery depend on Phase F's store (the origin private file system is the candidate): one store, two
        front ends. A real offline network and a real phone are unchecked.
      - The simple page: one click on "Change the sound" once left its card closed and did not reproduce; reduced motion and
        a screen reader pass; a real phone.
      - The microphone is verified only with a stand-in stream (`window.__jigdawMicrophone`); the studio page has no
        record-voice button. A real microphone is in HUMANS.md.
      - `web/foreign/probe.html` (manual, absolute paths, needs the WAM example built) and a real WAM plugin have not been
        re-run since the container paths were derived from the scope.
      - A constraint to keep: an app-wide service worker must never answer a plugin resource in a way that skips the digest
        check; a cached response is still verified when instantiated.

## The application

Behaving more like a real DAW, an open-ended direction rather than a phase with an end. Plugin-related parts should have most
attention. Derived 2026-09-30 from OpenStudio `docs/implemented_features.md`, filtered for what fits a browser host. Native-only
items (device drivers, native plugin hosting, ONNX runtimes, local generation models, DDP, ARA, surround, a 32-bit bridge) are
excluded. Where a heavy analysis (YIN pitch, Basic Pitch, stem separation) could run in WASM or ONNX in the page, it is marked
as research, not committed.

### Phase A. Arrangement editing

- [ ] **Razor areas, ripple modes, time selection ops.** Razor selection that cuts across tracks, ripple that closes or
      preserves the gap, time selection cut, copy, delete and insert-silence. One Op each, over the same changeset path as
      clip ops.
- [ ] **Markers, regions, region manager.** Named positions and ranges with a list view, jump by keys, loop a region.
- [ ] **Tap tempo,** and the scheduler and piano roll reading signature changes.
- [ ] **Reverse and normalize** as offline render ops on take bytes. Time stretch and pitch shift stay out until a DSP design
      exists (see the DAFx26 item above).

### Phase B. MIDI editing

- [ ] **Velocity, CC and pitch-bend lanes.** Per-note velocity plus one lane per controller, drawn under the roll,
      keyboard editable (`src/ui/PianoRoll.js`).
- [ ] **Quantize and transforms.** Quantize selection, transpose and octave, velocity scale, reverse, invert, humanize,
      scale snap. Each a pure function over notes with a test, then one Op.
- [ ] **Step input and virtual keyboard.** Enter notes from keys one step at a time; keep the on-screen keyboard playable
      from touch.
- [ ] **MIDI import and export.** Read and write a Standard MIDI File for one track, plus project-wide export, reusing the
      transport map.
- [ ] **Multi-clip editing and drum view.** Two clips side by side for reference; a drum lane view where the track holds a kit.
- [ ] **MIDI panic and input readiness.** One action that sends note-offs on every track, plus a visible state when Web MIDI
      is denied.

### Phase C. Mixing, routing and automation

- [ ] **Buses, folder tracks, groups.** Bus outputs exist; a folder as an editor-only grouping, linked faders as a group
      parameter, and latency through a bus sum are open.
- [ ] **Mixer snapshots.** Save and recall every strip and send as one named, undoable object, reusing the snapshot path
      `UndoHistory` takes.
- [ ] **Metering and gain staging.** Peak and RMS per strip with clip reset, phase invert, stereo width, pan law. LUFS, phase
      correlation and spectrum stay meter-only displays if built, never claims about loudness compliance.
- [ ] **Freeze, what is left.** Freeing the original's CPU (it is muted, not unloaded), unfreeze as one action, render in place
      onto the same track, and consolidate a range.

### Phase D. Plugin and effect workflows

- [ ] **Safe mode.** An open-with-FX-bypassed recovery path.
- [ ] **Plugin presets and A/B compare.** Named parameter sets per plugin IRI, saved beside the session, with A/B slots that
      swap without a revision.
- [ ] **FX-chain presets.** Save and load a whole track chain including order and settings: a collection of IRIs plus
      settings, not a new format.
- [ ] **MIDI learn and parameter mapping.** Bind a controller to a parameter explicitly, on top of the declared CC bindings
      Quefrency and 8-Bit 8asterd have. Pairs with "Show a controller's value on the panel" below.
- [ ] **Input and monitoring FX chains.** Where a chain may sit besides a track and the master: an input monitoring chain, a
      monitoring-only chain that never renders. The render path must exclude the monitoring chain by construction.
- [ ] **Channel strip EQ modal.** A small built-in EQ view per strip using existing plugins, if strips need one at all.

### Phase E. Render, export and delivery

- [ ] **Bounce, what is left.** A time selection, region or razor range (the loop is the only range so far); a chain that
      starts with an effect (the live page feeds it an impulse and the bounce does not); foreign (WAM) plugins, which are not
      loaded offline; live plugin state (the bounce uses the snapshot's); cancelling a render; and timing it against a
      real-time capture.
- [ ] **Stems, what is left.** Stems back into the project as clips, choosing which tracks, and including sends' returns.
- [ ] **Formats and options.** AIFF, FLAC, MP3 and OGG only if the encoder runs in the page, with sample rate, mono or stereo,
      normalize, tail and dither. No FFmpeg dependency: a page cannot shell out.
- [ ] **Render queue and filename wildcards.** Named jobs with bounds and source, run in order, named by pattern (track,
      region, date).
- [ ] **Session archive, compare, clean.** A diff of two Turtle sessions and a clean-unused-media tool. The archive stays the
      zip `src/host/Zip.js` writes.

### Phase F. Project and media management

- [ ] **Recent projects and startup recovery.** List recent sessions, reopen the last on choice, recover unsaved changes after
      a crash from local storage; never overwrite the saved file with a recovery copy. Shared with the PWA: offline use and the
      origin private file system as a store are decided here once, for both front pages.
- [ ] **Opt-in snapshots and autosave.** Periodic local snapshots including untitled sessions, clearly marked as not the saved
      project. Same store rule.
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
      of named profiles. One good default plus the machinery.
- [ ] **Screensets, toolbar editor, big clock.** Saved panel layouts, an editable transport toolbar, a large timecode display.
      Layout is editor metadata, stored apart like node positions.
- [ ] **Themes and high contrast.** A theme editor over CSS variables plus one tested high-contrast theme; the generated panel
      must pass in every theme.
- [ ] **Help overlay and getting started.** A first-run guide over the real page and a help overlay naming the current keys,
      generated from the binding store, never hardcoded.
- [ ] **Detached mixer and piano roll.** Pop a panel into a second window that follows the same model; only if window sync
      stays exact.
- [ ] **Narrow-layout pass.** One measured check per new view in a real browser at phone width.

### Larger directions, not started

- [ ] **A desktop Jiggy built on Electron.** From the inbox, 2026-09-25: packaging, auto-update, native audio device handling,
      and what happens to the dereferenceable-IRI premise when the host is an installed application.
- [ ] **Master bus beyond a level.** From the inbox, 2026-09-25: a master bus with controls in the mixer view; the term-first
      rule applies to whatever controls it carries.

### Loose ends

1. **A note or audio clip that starts before the loop start is not heard on a later pass**, even when it is still sounding across
   the loop start. The scheduler plays what starts inside each pass (`src/engine/Scheduler.js`). A DAW usually retriggers it;
   deciding whether to is a musical choice, not a fix.
2. **A plugin editor's `jig:integrity` is not checked.** A browser cannot verify a frame's document against a digest the way it
   can a script, and fetching it first to check and then framing it is two fetches that can differ. The frame is sandboxed on the
   plugin's own origin either way; the digest is a claim nothing tests.
3. **Real key presses were not driven into the piano roll, the clip keys or the lane points** in the checks; dispatched events
   were, and a few real keys. One pass with the window in front is in HUMANS.md.
4. **A real pointer through a cross-origin plugin frame was seen once.** The frame-to-host path was proved; the path from a real
   pointer was not repeated.

## Quefrency

- [ ] **Listen to Quefrency, and check compensation against a parallel path.** Built to
      [docs/plugins/quefrency-design.md](docs/plugins/quefrency-design.md). Impulses arrive at the declared latency in a real
      AudioWorklet. Not done: listening to it, and a graph where a parallel path has to be delayed to line up with it. The meter
      dropped from 8 to 4 segments under shift (partials past Nyquist are dropped, which accounts for some of it); not fully
      explained.
- [ ] **Show a controller's value on the panel, and save it.** Quefrency takes MIDI control changes 70 to 80 and 8-Bit 8asterd
      has the same gap: the panel's knob does not move, and the project does not save the value, because messaging.md has no
      processor-to-host message saying a parameter changed. Needs that message, the host updating its AudioParam and the model
      from it, and a guard so the update is not written straight back to the processor.

- [ ] **This project's generated profiles still declare the deprecated `trn:WebAudio`.** Found 2026-10-02 by running a composite through
      plugin-universe's own validator: it has deprecated `trn:WebAudio` for `trn:Jig` (its harvester maps the old term on ingest) and its
      raw shape rejects it, so every profile `bin/write-profile.js` emits, boost included, fails that shape with one violation. Fixing the
      generator changes every plugin's canonical digest, and so every pin on it and every signed bundle, so it is a decision, not a drive-by.
      A composite declares only `trn:Jig` and conforms.

## Before there is code

Determined 2026-09-26 from testbed.md's "What nothing exercises yet". Each item is the smallest plugin or host behaviour covering
one unused clause. None is started.

- [ ] **Nested plugins: meta-plugins built from simpler components.** From the inbox, 2026-09-26 (a guitar effects rack assembled
      from existing effects). Needs design before code: what nesting is in the project graph (a node holding a subgraph, or a
      profile listing member plugins), how the compiler flattens it and accounts latency through it, how state and presets address
      the inside, and whether a nested graph can itself nest. **Designed and specified 2026-10-02:**
      [docs/nested-plugins.md](docs/nested-plugins.md); vocabulary, shapes, examples, `CompositeReader` and contract section 14 done. A composite is a Jig (`jig:CompositePlugin`) whose profile lists member
      Jigs, internal connections and exposed ports; the model keeps one node and the compiler is given the flattened graph,
      beside `Bypass.js`. Built and tested 2026-10-02, including the dispatcher: a composite
      loads whole or not at all, is one node over several engine nodes, wires through `CompositeExpansion` after bypass, takes
      its exposed settings (and the author's voicing at load), saves and reopens, undoes as one edit, and plays headless to the
      same sound as its members wired by hand (`tests/ops/CompositeDispatcher.test.js`). Still to do, in order: **a phone with one loaded** (the rest of the page was checked in Chrome on 2026-10-02: load, panel, controls, signal path, stale pin, undo, clip and transport into a rack, save and reopen, Routing and Mixer; a composite has no `jig:ui`), packing from the page (the Op and the agent tool `composite_pack` exist and write a profile; the page has no
      way to select several plugins and ask for it), putting a packed composite in the selection's place once it is somewhere a host can fetch it, the MIDI monitor across a composite's boundary (`midiActivity` shows nothing for it). The native adapter now says a composite is one and that it cannot run it (`native/jigdaw-adapter/tests/profile_test.cpp`); running a
      linear composite there, which is already a chain, is the next step for it.
- [ ] **A plugin that prefers shared memory, and an isolated host mode to run it in.** Covers contract section 2.3. Smallest
      plugin: declares `jig:prefers jig:SharedMemory` with the mandated fallback to port transfer. Host side: an opt-in isolated
      serve mode, since the baseline must not require isolation of itself. Test both paths.
- [ ] **Tremolo's interface-to-processor direction through the opaque relay.** Covers messaging.md section 2.4. The
      processor-to-interface direction is done; the reverse direction has no real user beyond the fakes.

## Recurring, check periodically

- [ ] **Check builds for warning messages, and fix what is fixable locally.** The Rust plugins build with only the
      `private_interfaces` notice on the ABI pointer exports, shared with every worked sibling; resolving it in one plugin would
      diverge that plugin from the rest, so it stands until it is resolved everywhere at once. Anything beyond that is a defect to
      fix where it appears.
- [ ] **Play every preset in a real browser after a change to a plugin processor or the engine**, measuring each track and not
      only the master. The offline check (`tests/host/presetRender.test.js`) covers what the offline host models; Dice was silent in
      Chrome for weeks while it passed (MISTAKES.md).
