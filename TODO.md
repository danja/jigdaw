# TODO

What the project needs. Remove an item when its implementation and verification are
complete, and keep whatever it left undone as an item of its own. Review periodically.
What a finished item did and how it was checked is in `git log` and, for mistakes, in
[MISTAKES.md](MISTAKES.md).

## Where things stand

Built and working, so this file lists only what is left. One line each; the documents named
hold the detail.

- **The track view** (T0 to T4 in part). Timeline with header column, zoom, snap, loop row,
  follow and chain strips; dock with piano roll, audio clip panel and track, node and bulk
  track panels; selection; track rename, colour, size, reorder, multi-select and delete; the
  Routing tab (matrix); sends, bus outputs and the master strip acting on the audio; track
  alignment by declared latency (`docs/latency.md`, "Between tracks"); sidechain input as a
  named port (`jig:sidechainInput`); MIDI loops refused. Terms are in
  [docs/track-view-terms.md](docs/track-view-terms.md) and [docs/project-format.md](docs/project-format.md);
  the editor graph is `editor.ttl` in the session zip.
- **Clips.** Split, trim, duplicate, copy, cut, paste, mute, lock, colour and audio fades, by
  key and by the icon buttons above the lanes (`src/model/ClipEdit.js`, `src/ui/ClipActions.js`).
  Cut and trim snap to the grid.
- **Icon buttons** for the transport, history, files, zoom and clip actions
  (`src/ui/Icons.js`), 44px, with the words kept as the accessible name.
- **Plugins.** 24 worked plugins, including MIDI Filter (channel filter and remap, transpose,
  note range) and Dynamix's sidechain key. Six bundled presets, each checked offline by
  playing it through the chain (`tests/host/presetRender.test.js`).
- **The PWA.** Manifest, icons, one service worker, update and install notices, offline shell
  with the digest check intact (`docs/pwa.md`); the simple front page (`web/simple.html`) is the
  installed app's start page and links to the studio and back; one-button microphone recording
  on it.
- **The site.** `bin/docs-hidden.js` keeps working notes off GitHub Pages.

## From the inbox

- [ ] **Mop glitches in the JigDAW Adapter VST in Reaper.** 2026-09-30, user report, no
      buffer size or version yet. **Diagnosed headlessly:** Mop costs 1.70x realtime through the
      adapter's pure-interpreter WAMR (8 s of line plus drums took 13.6 s wall at 48 kHz and at
      44.1 kHz), so every realtime block overruns and the symptom is continuous dropouts.
      Output is otherwise correct (peak 0.10, no dead windows, MIDI and CC path intact), so
      it is throughput, not corruption. 8b8 through the same path costs 0.20x and Mop under
      node's JIT 0.06x, which is why no browser or offline test saw it. The voice cap and the
      buffer size change nothing (the OPL emulator steps every operator per sample). Fixes are a
      maintainer decision: WAMR AOT or JIT (needs wamrc and LLVM as build dependencies; the
      interpreter was chosen in `native/cmake/FindOrFetchWamr.cmake` because the gain was not
      needed, and for Mop 2x or more is), or Mop-side surgery against the unmodified-Opal rule.
      Confirmation from a person is in HUMANS.md.
- [ ] **A keyframe time-stretch plugin from the DAFx26 extrema-sampling paper.** 2026-09-26.
      The paper is at `/chalet/github/dafx26-paper` (Nielsen, DAFx26, CC BY 4.0, credit
      required): a content-adaptive overlap-add where the spacing between local extrema drives
      both when a splice happens and how long its crossfade lasts. Analysis is a 4-tap B-spline
      derivative with a deadband threshold and subsample refinement; reconstruction is
      smoothstep interpolation between timestamped extrema; stretching tracks reference, play
      and temporary playheads with a leash of K keyframes. Output is sample by sample with no
      block latency in principle; live block processing needs boundary keyframes (paper section
      2.7, e.g. a 512-sample delay, declared as `jig:latencyFrames`). Likely parameters: time
      rate, pitch rate, splice threshold K, maximum splice duration, analysis threshold
      epsilon. Rust, `no_std`, Abi1 audio effect. Design doc goes in `docs/plugins/` before code.
- [ ] **An additive resynthesis effect that builds harmonics from the input.** 2026-09-26
      (r/synthesizers idea): pitch-shift the input to 2x, 3x and 5x, then use feedback to supply
      the intermediate non-prime harmonics (4x from 2x fed back, 6x from 2x and 3x combined, and
      so on). Needs design before code: what the pitch shifters are, what the feedback network
      is, and how gains stay bounded. Any cycle needs an explicit delay by the latency rules,
      and latency inside a cycle is never compensated. Probably Rust, Abi1.
- [ ] **A panning effect with non-linear motion.** 2026-09-26. An auto-panner whose position
      follows non-linear trajectories rather than one LFO: circular motion, random walk and
      envelope-follower-driven jumps, with per-band panning so low and high content move
      independently. Needs design before code: the trajectory set, the parameters with units,
      and a mono-compatibility rule.
- [ ] **A static check that a `jig:Abi1`/`jig:Abi2` module never calls `memory.grow`.**
      `npm run check-wasm-abi` (`src/validate/WasmAbi.js`) checks the easy half of
      module-abi.md's calling sequence step 1 (no imported memory), and `npm run check-plugin --
      IRI --measure-budget` is a deliberately coarse render-time budget. The hard half, whether
      a module ever executes `memory.grow` after `jig_init`, is open. A hand-rolled instruction
      decoder would be wrong the way CLAUDE.md calls worse than no check
      (`@webassemblyjs/wasm-parser` fails on `ferrite.wasm` at `0xfc00`). Disassembling with
      `wasm2wat` and grepping the mnemonic is exact; wabt is requested in HUMANS.md.

## The track view

Derived 2026-09-30 from a graph index of this repository and of `~/github/openDAW`,
`~/github/webdaw` and `~/github/daw` (GridSound; its `daw-core` and `gs-*` directories were
empty submodules, so its column was from its README and general knowledge). Every one of them
is built around one screen, a track-oriented arrange view: transport, track header column,
ruler with zoom and snap, clips on lanes, a bottom editor that follows the selection, a browser
side panel, a mixer, automation as lanes, undo.

What Jiggy takes from each: **openDAW** (`packages/app/studio/src/ui/timeline`) an audio unit
owning its instrument, automation and effect chain, markers, signature and tempo tracks,
freeze, consolidate, effect composites, aux sends, modulators, a spotlight search, per-context
shortcuts, DAWproject and live collaboration; **webdaw** (`notes/milestones.md`) the plainest
order to build in (arrangement, projects, effects and automation, instruments, MIDI,
recording, plugin modules, mixer, clip launcher, DAWproject); **GridSound** pattern-based
composition, a sampler and drum grid, and a per-channel mixer.

Where Jiggy should be better, and the core does not change: **routing is the model, not a
menu** (a track holds nodes joined by named arcs, audio and MIDI, with latency accounted
through them, and the view shows that graph on the track), and **a plugin is a dereferenceable
IRI with a machine-readable profile**, so the view needs no per-plugin code and an agent drives
all of it through the same Ops. The bar: every feature is one Op, undoable, keyboard
reachable, named to a screen reader and usable at phone width. The three examples are pointer
first; that is the gap to keep. [docs/usp.md](docs/usp.md) says where Jiggy is ahead and behind.

### T0. Decisions

- [ ] **Layout decision for the main view**, recorded with its rejected alternatives: header
      column, lane area, bottom dock, side browser, top transport. Built that way and measured
      at phone width; what remains is writing the decision and the alternatives down.
- [ ] **An editor-graph shape in `vocabs/shapes.ttl`.** The editor document types no subject, so
      the existing target-class shapes do not reach it (now also carrying clip colour).
- [ ] **Marker and region colour in the editor graph**, and **folders** (`jig:parent`).
- [ ] **Dedicated WebMCP tools for the arrangement terms** (master, sends, bus outputs, markers,
      regions, envelopes); the generic changeset tool accepts them today. Clips have `clip_set`
      (mute, lock, fades, colour), `clip_split` and `clip_duplicate`; trim, copy, cut and paste have
      none (`clip_move` and `clip_remove` cover the parts).

### T1. The main view shell

- [ ] **A view module of its own.** `src/ui/Arrange.js` with a header column and a lane area
      sharing one vertical scroll, built from `Timeline.js`, `Strip.js` and `Panel.js` rather than
      a rewrite. Split along those seams if it passes 400 lines.
- [ ] **Transport.** The metronome (the scheduler unrolls a click source through the loop the
      way it does notes; a count-in with it), tap tempo, a seconds or SMPTE readout, and a
      compact phone transport bar (Play, Stop, Loop, then a menu).
- [ ] **Playhead and loop.** Seek by clicking the ruler, drag the whole loop, a loop range from a
      selection or region, and follow for the piano roll.
- [ ] **Zoom and snap.** Pinch on touch, zoom to selection, seconds as an alternative ruler, the
      piano roll reading the shared `TimeView` (it has its own scale), snapping to other clips'
      edges, and the grid following signature changes (`barBeat` still assumes one signature).
- [ ] **Dock.** Escape does not close the piano roll (Close does); a dock view for an envelope
      (T5); keyboard selection of a track other than by its name; move a selected group of
      clips as one.
- [ ] **First run and narrow layout.** A guided tour and a hint for the second step (add a clip);
      collapse the header to icons at phone width; "Load onto" following the selected track.

### T2. Tracks

- [ ] **Duplicate a track, and add an empty one from the header.** Duplicate needs one composite
      Op that loads each plugin, copies settings and state, and remaps connections and track
      inputs, or undo takes one step per plugin.
- [ ] **Track types visible in the header.** Instrument (MIDI in, audio out), audio, MIDI only,
      bus; drawn from the node ports, not a flag.
- [ ] **Folders and groups.** Editor-only folder first (no compiler change), then bus tracks
      that sum other tracks. Same distinction as Phase C "Buses, folder tracks, groups".
- [ ] **Reorder by drag; collapse a lane to a thin bar;** show and hide by folder; resize from the
      header by keyboard. Order is layout and is not part of undo.
- [ ] **Bulk edit of level and pan for several tracks** (needs a rule for relative changes), and a
      range select by Shift with the keyboard.
- [ ] **Track input and monitoring.** Built: Web MIDI input with Arm per track and routing to the
      armed or selected track; the microphone on the simple page. Open: a real controller
      (untried against hardware), choosing among several MIDI and audio inputs, MIDI panic, input
      monitoring, the microphone as a choice on any studio track, and MIDI learn (Phase D).
- [ ] **Track alignment, what is left.** Clips and live MIDI are not offset (they reach a plugin
      that then has its own latency); the setting is not in the saved session, so two people can
      hear differently; a limit warning is in the console, not on the page; and a render comparison
      has not measured that audio really arrives aligned.

### T3. Routing and plugin chains

- [ ] **MIDI loops are refused** (error kind `midi-cycle`, `docs/latency.md`). This was my
      decision, not yours; say if they should be allowed with some limit instead.
- [ ] **Chain strip.** Reorder by drag, draw a sidechain key connection as its own thing, and measure the
      strip at phone width. Reorder by keys and buttons is built (`src/ops/ChainReorder.js`: Alt+Left or Right,
      or Move earlier and Move later beside each plugin, swapping two neighbours in a plain audio chain as one
      changeset that rewires the three joins; refused with the reason for a branch, a plugin that does not take
      and give audio, or a join shared with something else; `node_move_in_chain` tool; MIDI chains are not
      reordered). Bypass is built (`jig:bypassed`, `setNode` Op, a button
      on each loaded plugin, `node_bypass` tool, `src/ops/Bypass.js`): it is not counted in latency
      compensation, which still counts a bypassed plugin's declared latency, and it has not been heard
      with a real A/B by ear.
- [ ] **Connections.** A drawn line as an extra to the text cables; port names from the profile
      beyond "Audio out 1" and "MIDI out" (Dynamix's key is the only named one); a "why not" for a
      missing matrix cell; matrix column headers are wide at phone width.
- [ ] **Sends and buses, what is left.** A return-track marker beyond the header text, the
      alignment delay counting a bus's latency, a send's own alignment, and a level meter per send.
- [ ] **MIDI routing tools, what is left.** A note-range split as a connection property rather than only a
      plugin (MIDI Filter), and only Dynamix declares a sidechain key. The MIDI monitor is built: each MIDI
      connection in the plugin view has Watch, which shows the last 24 events over it in words (the router keeps
      them per route, on the message thread, and a timer redraws the open ones twice a second); not yet on the
      routing matrix or the chain strip, and a bypassed end shows nothing.
- [ ] **Parallel chains and layers.** Two chains from one input mixed back, openDAW's "effect
      composite". Only after the nested plugins design (see "Before there is code").
- [ ] **Failed load stays isolated.** The chain strip draws a failed plugin as failed beside the
      working ones (tested at model and strip); not yet driven with a plugin that really fails to
      load in a live page.

### T4. Clips, regions and the editors in the dock

- [ ] **Clip preview on the lane.** Note clips draw their notes as a miniature roll; audio clips
      draw the waveform (exists).
- [ ] **Selection.** Rubber band and lasso on lanes, by pointer and by keys.
- [ ] **Clip operations, what is left.** Takes and comping (TrackRecorder already captures passes;
      select the active take, explode to tracks), slip edit, reverse and normalize as offline
      renders, a fade curve choice (only straight lines exist) and auto-crossfade where two audio
      clips overlap, grouping so moves apply together, split at a click and trim by drag, and a fine
      nudge. Mute, lock and fades have not been checked by ear.
- [ ] **Loop a clip.** Content repeats inside the clip bounds, with the loop end draggable
      (openDAW's `loopDuration`). Probably needs vocabulary.
- [ ] **Overlap behaviour.** State the rule for clips that overlap on a lane (clip the older, push to
      a new lane, or refuse) and test it before shipping move. openDAW made this a preference after
      getting it wrong twice (`docs/overlapping-regions-behaviour.md` there).
- [ ] **Piano roll in the dock** with zoom and scroll bound to the shared time model, plus velocity
      and controller lanes (Phase B).
- [ ] **Drum grid.** Step editor for a track whose target is a kit, using DrumKit.
- [ ] **Audio editor.** Waveform view with start, end, gain and fade handles for one clip.
- [ ] **Markers and a tempo and signature lane** on the ruler (Phase A).
- [ ] **Pattern clips** (GridSound's model): a reusable MIDI pattern placed on several tracks or
      times, edit once and all instances follow. Needs a design note first; build only if it earns
      its cost over copy and paste.

### T5. Automation

Goal: parameters move over time, drawn on the timeline, for any plugin. The model has
`jig:Envelope` and the file format carries it; the scheduler does not act on it yet.

- [ ] **Automation, what the scheduler still does not play.** Envelopes on plugin parameters are played
      (`src/engine/Automation.js`, `Scheduler` and `web/app/Transport.js`: each point and each segment to the
      next, step, linear or smooth, on the audio clock, looped passes set to the value at the loop start, stop
      restoring the value set by hand; real Web Audio in Chrome on a held Pulse note with its gain rising
      0.02 to 0.5 over four beats: peaks 0.066 up to 0.419 and then held, falling back each pass when looped,
      and the parameter back to 0.05 after Stop). Master level and pan envelopes are played too (`Engine.holdMaster`, so the graph rebuild on every edit does
      not cut into them; Chrome: a master level falling 1 to 0.1 over 16 beats read 0.319 down to 0.186, an unrelated
      edit did not interrupt it, a hand change to 0.5 held it flat and Stop left 0.5). Open: tempo envelopes, which
      change the beat to seconds map the scheduler itself reads, and signature changes.
- [ ] **Lanes, what is left.** Built: Automate in a plugin's view (every parameter with a range that has no
      lane) adds a lane under the track (`src/ui/EnvelopeLane.js`, `EnvelopeLanes.js`); each point is a button
      named in words (parameter, value with its unit spoken out, bar and beat, curve); Left and Right move it
      a grid step (never past a neighbour), Up and Down change it by a fiftieth of the range (Shift a
      two hundredth), C cycles step, linear and smooth, Delete removes it; Add point puts one a bar on; a drag
      moves a point and a click on empty lane adds one; every gesture is one `setEnvelope` edit, one undo. Real
      mouse and keys in Chrome on Squelch's cutoff: a click added a point at beat 8, a drag moved it to beat 10
      and lowered it, four keys (Up, Up, Right, C) made it 3882 Hz at beat 11, smooth, with focus kept; played,
      the cutoff climbed 712 to 2633 and went back to 500 at Stop. Open: tempo and signature lanes; a
      range select and scale; a point's exact value typed in; zoom and scroll shared with the lane (it follows
      the timeline's zoom but was not checked at phone width); lanes for a plugin on no loaded profile are
      left out. Envelopes have WebMCP tools (`envelope_add`, `envelope_set`, `envelope_remove`).
- [ ] **Write, touch, latch and read modes.** openDAW records any write while the transport runs and
      latches until stop; copy that, because a gate on one control type left every other control
      unrecordable (`docs/automation.md` there).
- [ ] **A manual change while automated, what is left.** Built (`web/app/AutomationHost.js`): a hand edit,
      an agent's or undo's, while a lane plays takes over at once, cancels the scheduled events and pauses
      that lane until Stop, saying so in the log; Chrome: a gain rising under an envelope went flat at the
      edited level and resumed from the start after Stop and Play. Open: a "restore" that resumes the lane
      without stopping, and showing on the control that it is paused.
- [ ] **Tempo lanes** on the same lane machinery (they need the scheduler to play tempo envelopes, above). The
      master has its own row after the tracks (`src/ui/MasterRow.js`): Automate offers Master level (0 to 2, spoken
      in decibels) and Master pan, and its lanes are the same lane component; Chrome: a level lane was added, its
      first point named "Master level, 0.0 decibels at bar 1 beat 1, linear", keys kept focus on it, and the lane
      played. **MIDI learn** writes into the same lanes (Phase D).
- [ ] **Modulation sources** (LFO, step, random, macro) as a Jig with a control output port, so it
      stays a plugin and not a host feature (openDAW sums depth times source onto a parameter).

### T6. Mixer, aligned with the track view

Goal: the mixer is the same tracks seen as strips, not a second model.

- [ ] **Mixer as a dock or a page** built from the same track list and selection.
- [ ] **Master strip, what is left:** meters with clip hold, automation (T5), a mono switch, and
      controls beyond level, pan and mute (a master bus with its own chain, Phase D).
- [ ] **Insert slots on the strip** mirroring the chain strip from T3, so both views edit one list.
- [ ] **Snapshots, freeze, render in place, consolidate** (Phase C; share the bounce path in Phase E).
- [ ] **Metering and correlation as displays**, with no loudness-compliance claims.

### T7. Session, clip launcher and interchange

- [ ] **Recent projects, autosave, recovery, templates** (Phase F).
- [ ] **Undo history panel** (Phase F), listing the existing `OpDispatcher` steps.
- [ ] **Clip launcher (session grid).** Scenes and slots that trigger clips on the same tracks,
      quantised launch, follow actions later. Last on purpose: webdaw leaves it to milestone 9 and it
      needs the arrangement solid first.
- [ ] **Standard MIDI file import and export** (Phase B).
- [ ] **DAWproject import and export.** Bitwig's open format (in openDAW
      `packages/studio/core/src/dawproject`, on webdaw's list) gives sessions an escape route to and
      from other DAWs. Track, clip, note, level, pan and tempo map first; plugin state only for a Jig
      with an equivalent on the other side.
- [ ] **Stems and bounce in the page** (Phase E).
- [ ] **Sample and preset libraries.** A browser tab for audio files with preview, folder tree and
      drag onto a lane (openDAW's `browse/`), next to the plugin browser.

### T8. Workflow, access and the surfaces around it

- [ ] **Command palette** over the dispatcher (Phase G); openDAW's spotlight is the model.
- [ ] **Shortcuts scoped by context** (global, lanes, dock, piano roll) from one binding store, with
      a searchable list and conflict checks (Phase G). The clip keys (S, D, M, L, [, ], Ctrl+C, X, V)
      are hardcoded in `Timeline.js` today.
- [ ] **Screen reader pass over the whole view.** A lane is a labelled region, a clip a button with
      its position and length, a header a group with named controls. Announce selection and playhead
      on request, not continuously. Test with a real screen reader and record what was and was not
      tested.
- [ ] **High-contrast theme and reduced motion** checked against the new view.
- [ ] **Touch.** Long press for the context menu, two-finger pinch zoom, drag handles of at least 44px,
      measured at a real phone width.
- [ ] **WebMCP parity.** Every Op appears in the tool surface with no second implementation, and a test
      walks the dispatcher's Op list against the tool list so an Op not exposed fails a check.
- [ ] **Agent-driven arrangement.** With profiles available, an agent builds a track: chooses plugins
      by role, connects them, writes a clip. Regress with a scripted session against the real
      dispatcher.
- [ ] **Live collaboration, considered.** openDAW runs Yjs sync and a peer-to-peer room
      (`packages/studio/p2p`, `ysync`). Jiggy has revisions and `expectedRevision` changesets, a better
      base for merge. Design note only.
- [ ] **Retire the three tabs** once the main view covers each of them and the measured checks pass,
      keeping the plugin rack as the dock's chain view.

Suggested order: T0, then T1 and T2 with the rest of T4's clip work, T3 next (it is what makes the
view Jiggy's own), T5 before T6 (master and send automation depend on it), T7 and T8 alongside from
T3, and the launcher last.

## Web-native Jiggy, and a mobile PWA

From the inbox, 2026-09-30. Both directions need a design note in `docs/` before code, since both
touch the "host is a page, plugins are IRIs" premise.

- [ ] **Investigate what would make Jiggy more Web-native.** Questions for a design note, each with
      what the answer would cost, ranked by cost and by fit with the premise:
      1. *Discovery.* Can the browser search plugin-universe.com's public SPARQL and MCP endpoints
         directly and offer Jigs the catalogue marks as compatible? Needs CORS on those endpoints
         (check, do not assume) and a rule for trusting what it returns: a catalogue entry is a claim,
         and the profile at the plugin's own IRI is the authority.
      2. *Sync between instances.* Two or more pages sharing one session live. Peer to peer first
         (WebRTC data channels; a signalling step needs a minimal server or a copy-and-paste offer;
         failing that a small relay). The wire could be changesets over a channel with the revision as
         the conflict check. Decide what does not sync (the transport clock, the audio, editor state)
         before any code.
      3. *Others to weigh:* Web Bluetooth MIDI for controllers; Web Locks and BroadcastChannel for two
         tabs of one session; installable plugin collections by URL.
- [ ] **The PWA, what is left.** The shell, the simple front page and microphone recording exist (see
      "Where things stand" and `docs/pwa.md`). Open:
      - Web Share Target and File Handling: a shared or opened `.ttl`, `.zip` or plugin bundle opens as a
        session or bundle through the same path as Open.
      - An Export button over Phase E's bounce and encoder, WAV first and MP3 when an encoder exists
        (WebCodecs does not encode MP3 in every browser, so a WASM encoder may be needed). Until then
        the page says only what it can do.
      - Offline use and recovery depend on Phase F's store (the origin private file system is the
        candidate): one store, two front ends. A real offline network and a real phone are unchecked.
      - The simple page: carry a piece into the studio other than by Save and Open; three generated
        trigger checkboxes are 22px (as in the studio); one click on "Change the sound" once left its
        card closed and did not reproduce; reduced motion and a screen reader pass; the phone-width
        frame and a real phone.
      - The microphone is verified only with a stand-in stream (`window.__jigdawMicrophone`); the
        studio page has no record-voice button. A real microphone is in HUMANS.md.
      - `web/foreign/probe.html` (manual, absolute paths, needs the WAM example built) and a real WAM
        plugin have not been re-run since the container paths were derived from the scope.
      - A constraint to keep: an app-wide service worker must never answer a plugin resource in a way
        that skips the digest check; a cached response is still verified when instantiated.

## The application

Behaving more like a real DAW, an open-ended direction rather than a phase with an end. Plugin-related
parts should have most attention.

Derived 2026-09-30 from OpenStudio `docs/implemented_features.md` and `docs/USER_MANUAL.md`, filtered
for what fits a browser host. Native-only items (ASIO/WASAPI device setup, JUCE/VST3/CLAP/LV2 hosting,
NAM capture hardware flows, ONNX runtimes, ACE-Step/Stable Audio local generation, DDP, ARA,
MCU/OSC/MTC, video post, surround/VBAP, 32-bit bridge) are deliberately excluded: the browser has no
device driver layer, no native plugin ABI, and no bundled heavy model runtime. Where a heavy analysis
(YIN pitch, Basic Pitch, stem separation) could run in WASM or ONNX in the page, it is marked as
research, not committed.

### Phase A. Arrangement editing

- [ ] **Razor areas, ripple modes, time selection ops.** Razor selection that cuts across tracks, ripple
      that closes or preserves the gap, time selection cut, copy, delete and insert-silence. One Op each,
      over the same changeset path as clip ops.
- [ ] **Markers, regions, region manager.** Named positions and ranges with a list view, jump by keys,
      loop a region. The terms exist (`jig:Marker`, `jig:Region`); the view does not.
- [ ] **Tempo map, time signature, tap tempo.** The transport maps beats to seconds and the model holds
      signature points; add a tap-tempo Op and have the scheduler and piano roll read signature changes.
- [ ] **Reverse and normalize** as offline render ops on take bytes. Time stretch and pitch shift stay out
      until a DSP design exists (see the DAFx26 item above).

The rest of Phase A (split, trim, copy, duplicate, delete, fades, mute, lock, colour) is built; what
remains of clips is under T4.

### Phase B. MIDI editing

- [ ] **Velocity, CC and pitch-bend lanes.** Per-note velocity plus one lane per controller, drawn under
      the roll, keyboard editable (`src/ui/PianoRoll.js`).
- [ ] **Quantize and transforms.** Quantize selection, transpose and octave, velocity scale, reverse,
      invert, humanize, scale snap. Each a pure function over notes with a test, then one Op.
- [ ] **Step input and virtual keyboard.** Enter notes from keys one step at a time; keep the on-screen
      keyboard playable from touch. Keyboard before pointer.
- [ ] **MIDI import and export.** Read and write a Standard MIDI File for one track, plus project-wide
      export, reusing the transport map.
- [ ] **Multi-clip editing and drum view.** Two clips side by side for reference; a drum lane view where
      the track holds a kit (DrumKit is the worked instrument).
- [ ] **MIDI panic and input readiness.** One action that sends note-offs on every track, plus a visible
      state when Web MIDI is denied.

### Phase C. Mixing, routing and automation

- [ ] **Buses, folder tracks, groups.** Bus outputs exist; a folder as an editor-only grouping, linked
      faders as a group parameter, and latency through a bus sum are open.
- [ ] **Sends, what is left.** Send pan, and the routing matrix naming (T3).
- [ ] **Automation lanes.** Read, write, touch and latch per track and per parameter, drawn lanes with
      range replace and clear, a move-with-items option, an envelope manager list (T5).
- [ ] **Mixer snapshots.** Save and recall every strip and send as one named, undoable object, reusing
      the snapshot path `UndoHistory` takes.
- [ ] **Metering and gain staging.** Peak and RMS per strip with clip reset, phase invert, stereo width,
      pan law. LUFS, phase correlation and spectrum stay meter-only displays if built, never claims about
      loudness compliance.
- [ ] **Freeze, render in place, consolidate.** Freeze a track to its post-FX audio (reuse TrackRecorder
      takes), render in place to a new clip, consolidate a range to one file. All reuse the Phase E bounce.

### Phase D. Plugin and effect workflows

- [ ] **Safe mode.** An open-with-FX-bypassed recovery path (bypass and reorder by keys exist).
- [ ] **Plugin presets and A/B compare.** Named parameter sets per plugin IRI, saved beside the session,
      with A/B slots that swap without a revision.
- [ ] **FX-chain presets.** Save and load a whole track chain including order and settings: a collection
      of IRIs plus settings, not a new format.
- [ ] **MIDI learn and parameter mapping.** Bind a controller to a parameter explicitly, on top of the
      declared CC bindings Quefrency and 8-Bit 8asterd have. Pairs with "Show a controller's value on the
      panel" below: learned values need the same processor-to-host message.
- [ ] **Input, master and monitoring FX chains.** Where a chain may sit besides a track: an input
      monitoring chain, a master chain, a monitoring-only chain that never renders. The render path must
      exclude the monitoring chain by construction.
- [ ] **Channel strip EQ modal.** A small built-in EQ view per strip using existing plugins, if strips
      need one at all.

### Phase E. Render, export and delivery

- [ ] **In-page offline bounce.** Render project, time selection, region or razor range through the same
      graph the page plays, including latency compensation and tails. `bin/host.js` renders in node; this
      is the page equivalent with the same frame counts.
- [ ] **Stems and add-back.** Render every track (or every sounding track) to takes, and offer rendered
      output back into the project as a clip, reusing the WAV take path.
- [ ] **Formats and options.** WAV always; AIFF, FLAC, MP3 and OGG only if the encoder runs in the page
      (WebCodecs or a WASM encoder), with sample rate, mono or stereo, normalize, tail and dither. No FFmpeg
      dependency: OpenStudio shells to system FFmpeg, which a page cannot do.
- [ ] **Render queue and filename wildcards.** Named jobs with bounds and source, run in order, named by
      pattern (track, region, date).
- [ ] **Session archive, compare, clean.** The zip save exists; add a diff of two Turtle sessions and a
      clean-unused-media tool. The archive stays the zip `src/host/Zip.js` writes.

### Phase F. Project and media management

- [ ] **Recent projects and startup recovery.** List recent sessions, reopen the last on choice, recover
      unsaved changes after a crash from local storage; never overwrite the saved file with a recovery
      copy. Shared with the PWA: offline use and the origin private file system as a store are decided
      here once, for both front pages.
- [ ] **Opt-in snapshots and autosave.** Periodic local snapshots including untitled sessions, clearly
      marked as not the saved project. Same store rule.
- [ ] **Project settings, notes, metadata.** Title, author, revision note per session in the Turtle file,
      shown in one dialog. Editor-only fields stay out of the compiled graph.
- [ ] **Templates and project tabs.** Save a session as a template; open from a template. Tabs only if
      sessions stay independent documents with no shared audio state.
- [ ] **Media explorer and missing media.** Browse and import audio by drag and drop (import exists),
      resolve missing files on open with a replace dialog. Missing media must block render loudly.
- [ ] **Undo history panel.** A visible list of undo steps from `OpDispatcher.undo()` and `redo()`, click
      to jump. No second undo implementation.
- [ ] **MIDI export.** One track and whole project; pairs with Phase B.

### Phase G. Workflow and customization

- [ ] **Command palette.** Every Op reachable by name search over the one dispatcher, as WebMCP tools are.
      No palette-only commands.
- [ ] **Keyboard shortcuts and profiles.** A searchable shortcut list, scoped rebinding with conflict
      checks, import and export of named profiles. One good default plus the machinery, not 19 ports.
- [ ] **Screensets, toolbar editor, big clock.** Saved panel layouts, an editable transport toolbar, a
      large timecode display. Layout is editor metadata, stored apart like node positions.
- [ ] **Themes and high contrast.** A theme editor over CSS variables plus one tested high-contrast theme;
      the generated panel must pass in every theme.
- [ ] **Help overlay and getting started.** A first-run guide over the real page and a help overlay naming
      the current keys, generated from the binding store, never hardcoded.
- [ ] **Detached mixer and piano roll.** Pop a panel into a second window that follows the same model; only
      if window sync stays exact.
- [ ] **Narrow-layout pass.** One measured check per new view in a real browser at phone width: no
      horizontal scroll, 44px targets, 16px inputs.

### Larger directions, not started

- [ ] **A desktop Jiggy built on Electron.** From the inbox, 2026-09-25: packaging, auto-update, native
      audio device handling, and what happens to the dereferenceable-IRI premise when the host is an
      installed application. Kept so the option is visible.
- [ ] **Master bus beyond a level.** From the inbox, 2026-09-25: a master bus with controls in the mixer
      view; the term-first rule applies to whatever controls it carries (see T6, and Phase D chains).

### Loose ends from tracks, clips and plugin editors, 2026-09-24

Each is known and none is built.

1. **A note or audio clip that starts before the loop start is not heard on a later pass**, even when it
   is still sounding across the loop start. The scheduler plays what starts inside each pass
   (`src/engine/Scheduler.js`). A DAW usually retriggers it; deciding whether to is a musical choice, not
   a fix.
2. **A plugin editor's `jig:integrity` is not checked.** A browser cannot verify a frame's document
   against a digest the way it can a script, and fetching it first to check and then framing it is two
   fetches that can differ. The frame is sandboxed on the plugin's own origin either way; the digest is a
   claim nothing tests.
3. **Real key presses were not driven into the piano roll, or into the new clip keys.** Every keyboard
   path was exercised with dispatched KeyboardEvents against real focus in a real renderer. One pass with
   real keys, window in front, is in HUMANS.md.
4. **Clicks from the automation reach a cross-origin plugin frame only sometimes.** One did, which proved
   the frame-to-host path; the path from a real pointer through the frame was seen once.

## Quefrency

- [ ] **Listen to Quefrency, and check compensation against a parallel path.** Built to
      [docs/plugins/quefrency-design.md](docs/plugins/quefrency-design.md), 23 tests. In Chrome's real
      AudioWorklet `ready` reported 2047 at 48 kHz and 4095 at 96 kHz and an impulse arrived at exactly those
      offsets; live after Pulse the engine held latency 2047 and the master meter moved with the controls.
      Not done: listening to it, and a graph where a parallel path has to be delayed to line up with it.
      The meter dropped from 8 to 4 segments under shift (partials past Nyquist are dropped, which accounts
      for some of it); not fully explained.
- [ ] **Show a controller's value on the panel, and save it.** Quefrency takes MIDI control changes 70 to
      80 (design doc, "MIDI control"), verified live by the master meter following CC 80. The panel's knob
      does not move, and the project does not save the value, because messaging.md has no
      processor-to-host message saying a parameter changed. 8-Bit 8asterd has the same gap. Needs a message
      in messaging.md, the host updating its AudioParam and the model from it, and a guard so that update is
      not written straight back to the processor.

## Before there is code

Determined 2026-09-26 from testbed.md's "What nothing exercises yet". Each item is the smallest plugin or
host behaviour covering one unused clause. None is started.

- [ ] **Nested plugins: meta-plugins built from simpler components.** From the inbox, 2026-09-26 (a guitar
      effects rack assembled from existing effects). Needs design before code: what nesting is in the project
      graph (a node holding a subgraph, or a profile listing member plugins), how the compiler flattens it and
      accounts latency through it, how state and presets address the inside, and whether a nested graph can
      itself nest.
- [ ] **A plugin that prefers shared memory, and an isolated host mode to run it in.** Covers contract section
      2.3. Smallest plugin: declares `jig:prefers jig:SharedMemory` with the mandated fallback to port
      transfer. Host side: an opt-in isolated serve mode, since the baseline must not require isolation of
      itself. Test both paths: the capability offered in isolated mode, the fallback elsewhere.
- [ ] **Tremolo's interface-to-processor direction through the opaque relay.** Covers messaging.md section
      2.4. The processor-to-interface direction is done (real snapshots at 12/s,
      `tests/host/tremolo.test.js`); the reverse direction has no real user beyond the fakes.

## Recurring, check periodically

- [ ] **Check builds for warning messages, and fix what is fixable locally.** From the inbox, 2026-09-25.
      The Rust plugins build with only the `private_interfaces` notice on the ABI pointer exports, shared
      with every worked sibling; resolving it in one plugin would diverge that plugin from the rest, so it
      stands until it is resolved everywhere at once. Anything beyond that is a defect to fix where it appears.
- [ ] **Play every preset in a real browser after a change to a plugin processor or the engine**, measuring
      each track and not only the master. The offline check (`tests/host/presetRender.test.js`) covers what
      the offline host models; Dice was silent in Chrome for weeks while it passed (MISTAKES.md).
