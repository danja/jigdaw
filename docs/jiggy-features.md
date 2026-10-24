# What Jiggy does

Jiggy is the browser host for JigDAW: a page that loads Jigs by IRI, plays and edits a piece, and
saves it as RDF. This document lists what it does now. It is a catalogue of what is built, not a
plan; what is not built is in [TODO.md](../TODO.md), and where Jiggy stands against other browser
DAWs is in [usp.md](usp.md). A figure here is checked by a test against what it counts.

There are two pages over one model and one set of operations. The **studio** (`index.html`) is the
whole thing: a track view, plugin routing, automation and rendering. The **simple page**
(`simple.html`) is for playing with a piece: pick a tune, press Play, change the sound. A phone
starts on the simple page.

## Playing

- Play, Stop and Loop in the transport bar, a tempo field, a time signature field, a position
  readout and a level meter. The loop can be drawn on the timeline and is played as a loop.
- Record keeps each track as it was heard as an audio clip, in one edit, so one undo takes the pass
  back out.
- Web MIDI input plays into the armed track, or the selected one when none is armed, with a note
  stamp located by stream position.
- A microphone can be recorded into a new track from the simple page.
- Events are scheduled ahead of the audio clock and located by stream position, never by block
  count, so a note fires in the block that contains it.

## The track view

- **Tracks.** Rename, colour, three lane sizes, reorder (Alt with Up or Down on a name), select several
  and edit them together, delete with their plugins in one undoable step. A track says its own latency
  and how much it was delayed to line up with the others.
- **Timeline.** A ruler with zoom, a snap grid (bar, beat, halves, quarters, eighths, off), a loop row with
  a draggable brace, and a playhead that follows and stops following when you scroll.
- **Dock.** A panel under the lanes that follows the selection: a MIDI clip opens the piano roll, an audio
  clip its numbers, a track its chain and routing, a plugin its ports and connections.
- **Clips.** MIDI and audio, added from a lane, imported from a file, or recorded. Move and resize by drag
  or by keys. Split at the playhead (S), duplicate (D), mute (M), lock (L), trim the start or end to the
  playhead ([ and ]), copy, cut and paste (Ctrl or Cmd with C, X and V), delete, colour. Each is one edit
  and one undo, with a button for each above the lanes for a phone. Cuts and trims snap to the grid.
  Audio clips have fades in and out, straight lines in level.
- **Piano roll.** Draw, move, resize and delete notes with the pointer or the keyboard, with an audition.
  Whole-note edits sit above the grid, each one edit and one undo: quantize, transpose, softer and louder, reverse, invert, humanize,
  legato (each note held until the next starts) and strum (each chord rolled upward by a sixteenth).

- **Keys list.** A Keys button and F1 open a dialog listing the keyboard shortcuts by what has to be focused (a clip, a track
  name, a chain plugin, an envelope point, the script box, the Browser, or anywhere). The list is data (`src/ui/KeyTable.js`) and
  `tests/ui/KeyTable.test.js` fires each row's keys at the real control, so a listed key that does nothing fails. Keys in the piano
  roll and the timeline are not listed yet, and the dialog says so.

## Plugins and routing

- **Finding and loading.** A browser panel searches a catalogue of Jigs by role, signal and other facets,
  loads one by IRI, and opens a collection or a preset. The page checks every file's digest before it runs.
- **Generated panels.** Every plugin's controls are drawn from its declared ports, so there is no
  per-plugin interface code: knobs, selectors and switches with units spoken out, named and reachable by
  keyboard.
- **Chain strip.** Under each track, its plugins in signal order with what each takes and gives. Bypass a
  plugin (it keeps its state, passes the signal on, and is put back instantly). Move one earlier or later
  (Alt with Left or Right, or the buttons), which rewires the joins as one edit.
- **Composite plugins.** A plugin made of other plugins, such as an effects rack, loads as one plugin: one node, with the few
  controls its author exposed, which saves and reopens, undoes as one edit and is bypassed as a whole. Its members are loaded and wired
  behind it and compensated for latency as if wired by hand, and a bad member refuses the whole thing, naming it. The page generates its
  panel from the controls the author exposed. This was run in Chrome on 2026-10-02: it loads from an IRI, a real key played through it is
  governed by its Drive control, a composite pinned to a profile that has since changed is refused with the session untouched, and remove
  and undo restore it. A second run covered a MIDI clip played from the transport through Pulse and the rack (silent at Drive 0, a peak of
  0.25 at the default), saving a session and reopening it with the setting and the author's voicing restored, and the Routing and Mixer
  tabs. Its catalogue search lists it as loadable, and `plugins/stomp-rack/` is the worked example. Not yet done: a phone, listening to it, and loading it from a
  search result, which fetches the canonical address and so waits for the rack to be deployed. A composite's card has an **Unpack** button, on
  composites only: it turns the rack back into the plugins it is made of, each with the value it had inside, joined to what the rack was joined
  to, as one undo step (checked in Chrome: Drive 0.6 became Boost's Gain 0.6, and the author's tremolo rate became a knob). The agent tools
  `node_unpack` and `composite_pack` do the same, and the second describes a selection as a composite profile to publish and changes nothing.
  See [nested-plugins.md](nested-plugins.md).
- **Replace a plugin.** A Replace button on each plugin in the chain strip opens the Browser, says which plugin the next Load takes
  the place of, and the Load swaps it in as one undoable edit (the agent tool is `node_swap`). The new plugin keeps the track, the
  joins whose ports it also has, the settings whose parameters it also has, the label a person gave, bypass, and the track's or master's
  input role; what it could not take is listed in the log in words. Refused for a composite and for a plugin with automation on it.
  Seen in Chrome on 2026-10-23: Tremolo in a Pulse, Tremolo, Cascade chain replaced by Boost, joined as before, undone by Ctrl+Z.
- **Routing matrix.** Every output against every input, joined or not, by pointer or arrow keys.
- **Connections.** Audio and MIDI, within a track or across tracks. A connection that would make a loop
  with no declared delay is refused with the reason, and so is a loop of MIDI connections. A MIDI
  connection can be watched: the last 24 events over it, in words.
- **Mixer channels.** The Mixer tab draws each track, and the master, as a channel: a Pan knob on top, a Level fader standing up
  below it with the level meter standing beside it (the fader is the native range laid on its side, so the arrow keys, Home and End
  and the value in decibels are the platform's), then Mute over Solo. A channel is 96px wide. Channels sit side by side and wrap, with
  the master at the right end. Seen in Chrome on 2026-10-24: a click above the
  middle of the master fader raised it to +2.2 dB and Down lowered it a step each press.
  An FX button under each channel (FX 2 when two plugins are on it) opens a list of that track's plugins in signal order. Remove
  takes one off, healing the chain as Remove on the Plugins tab does, and Add plugin opens the Browser with that track as the place
  the next Load goes. Seen in Chrome on 2026-10-24: Add then Load put a plugin on the first track, and Remove took it off and left
  the focus on FX.
- **Mouse gestures and context menus.** Right click on a clip, a track's header, an empty stretch of lane, a plugin in a chain or a
  mixer channel opens a menu of the actions that thing already has on buttons and keys; the Menu key or Shift+F10 opens the same menu
  for whatever has the focus. A menu follows the ARIA menu pattern (Up, Down, Home, End, Enter, Escape, focus back where it came from),
  and an action that cannot act is left out. Double click on empty lane adds a MIDI clip there on the grid, on a track's name moves the
  focus to its name field, and on a plugin in a chain shows its controls on the Plugins tab. Escape during a clip, track or folder drag puts it
  back. A single click still selects, and on a clip also opens it; Space on a focused clip adds it to the selection or takes it out, and Enter opens it. Seen in Chrome on 2026-10-24: the clip, lane, track and mixer menus,
  Duplicate by keyboard from a menu, Shift+F10 on a track name, and a double click on a name selecting its field. Not yet: a hover
  preview, menus on clips in the piano roll or on automation points.
- **Clip launcher.** The Launcher tab is a grid: a column per track that has a MIDI input, a row per scene, and a cell per slot that says its state
  in words (stopped, queued, playing, stopping, or empty). Pressing a cell launches its clip at the next boundary of the Launch on setting; pressing
  an empty cell adds a one-bar clip and opens the piano roll; a scene button launches a row, Stop stops a track and Stop all every track. Arrow keys
  move over the grid, and right click or the Menu key offers Launch, Stop, Edit the notes and Delete. The tools `launcher_launch`, `launcher_stop`,
  `launcher_quantise` and `launcher_state` do the same for an agent. Launching changes no revision and is not saved. See
  [clip-launcher.md](clip-launcher.md).
- **Euclidean rhythm.** Above the note roll, Note, Onsets, Steps, Rotate and A step is, with Lay rhythm, put that many onsets spread as evenly as they
  can be over the steps into the open clip, repeated to fill it. Notes already at that note are replaced and the rest are kept, and the text beside it says
  so. One undo step; the same edit as the `clip_euclidean` tool. Seen in Chrome: 5 in 8 sixteenths laid over a four beat clip.
- **Chance on a note.** Choose notes in the piano roll (or none, for all of them), pick a percentage beside Chance and press Set chance: each of those notes
  then sounds only that often each time it comes round, drawn from where and when it falls so a render repeats exactly, and again on every pass of a loop. A note with a
  chance is a half-filled square in the roll and is said as "50 percent chance of sounding"; 100% takes the chance away. The tool is `clip_transform_notes` with
  `setChance`, and `chance` can be given on a note to `clip_set_notes`.
- **Time readout.** The transport bar shows the position as minutes, seconds and tenths (from the tempo map, so it follows tempo changes and loops) beside the bar and beat.
- **Settings.** A Settings tab holds what is not part of playing: Line tracks up for latency, the project's title, author and notes, and
  the Local agent and Agent bridge connections.
- **Output meter with a clip hold.** The meter beside the transport shows the level of the mix, and a Clip button appears when it
  reached full scale and stays until pressed. Every strip on the Mixer tab has a level meter of its own with the held peak in decibels
  beside it, and the Master channel lists the plugins on the master.
- **Sends, buses and the master.** Sends before or after the fader, a track's output to another track, and
  a master with level, pan and mute, all acting on the sound. A cycle of them is refused. Audio sent or bused to
  a track arrives at the plugin the track names as its audio input, so a reverb on a bus is in the path, and the
  master has a chain of its own the same way: plugins on the master, and the one the mix of every track arrives
  at. Generative Gamelan has its reverb there. MIDI between tracks is a connection between two plugins, or a MIDI send
  from one track to another, which delivers to the plugin the target plays its MIDI into; Generative Gamelan's
  Conductor drives both lines by two MIDI sends. A MIDI send or connection can carry a note range, so one keyboard is
  split between two instruments, and either end of a send can be a composite plugin.
- **Sidechain.** A plugin can mark an input as a key, and the matrix names it "Sidechain key". Dynamix
  ducks from a kick on another track.
- **Latency.** Declared latency is compensated between connected plugins, and tracks are delayed so that
  parallel tracks arrive together, with a switch.

## Automation

- An envelope on any plugin parameter, on the master level or pan, or on the tempo, with step, linear and
  smooth curves between points. Played on the audio clock, looped passes included, and Stop puts every
  parameter back to the value set by hand.
- Lanes under each track and a row for the master and tempo: each point is a button named in words, moved
  by keys or by dragging, with a click on empty lane to add one. Every gesture is one undo.
- A hand edit while a lane plays takes over at once and pauses that lane until Stop.
- A tempo envelope is the tempo map, so notes, audio clips and the position all follow it.

## Rendering

- **Export** renders the mix to a WAV in the page, faster than it plays, without disturbing playback. The loop,
  when it is on, is what is rendered.
- **Stems** render every track that makes sound to its own WAV in one zip.
- **Export MIDI** saves the notes of every unmuted MIDI clip as a Standard MIDI File (format 1, 480 ticks to the quarter): a conductor track with the tempo and time signature changes, then one track per project track that has notes, each on its own channel from 1 (10 is skipped, as General MIDI keeps it for drums). Audio clips, muted clips and mixing are not in it.
- **Controller and pitch bend lanes** sit under the note roll: velocity bars for each note, or a lane for pitch bend, modulation, volume, pan, expression, sustain or any controller number. A clip holds the events as a step curve, plays them with its notes, and carries them through split, copy and MIDI import and export. Where a loop comes round, or playing starts part way in, each controller is set to what it held at that point, and a pitch bend wheel with nothing earlier to say goes back to rest.
- **Undo history** under the arrangement lists every edit in words, with the current state marked; choosing one goes there by undoing or redoing. It holds the last 100 edits and is not saved with the session.
- **Mute and Solo** are small lettered squares, an M that turns red and an S that turns yellow. The word is still the control's name for a screen reader, and on is a filled square with an underlined letter, so it does not rely on colour.
- **Project** section under the arrangement keeps a title, an author and notes with the session. They are saved in the file, are not an undo step, and an agent reads and sets them with `project_info`.
- **Templates** keep the open session in this browser under a name, and start a new session from one. They stay until deleted, and they are not saved with a session or shared between browsers.
- **Tap** beside the tempo sets it from your taps: the average gap of the last five, started again after a two second pause.
- **Folders** have a bar with a hide and show button, Move up and Move down, and a grip to drag the whole folder to another row. Whether a folder is hidden is saved with the session.
- **Loop a clip** repeats a MIDI clip's first beats to fill its length. Type a loop length in the note roll (Loop, Clear loop), and the clip plays, exports to a MIDI file and is announced to a screen reader as looping. A note that starts after the loop end is kept and not played while the loop is set. Splitting a looped clip, or trimming its start, writes the repeats into the notes and clears the loop.
- **Rec MIDI** plays the transport and keeps what you play on a MIDI keyboard (the armed tracks, or the selected one) or the on-screen keys as one MIDI clip per track, from where the take began and a whole number of bars long, with the pitch bend wheel and controllers kept as events. Stop ends it too, and one undo takes the take back. It is separate from Record, which keeps audio.
- **Import MIDI** adds each part of a format 0 or 1 Standard MIDI File as a new track with one clip from beat zero, in one edit
  (one undo). A project with no MIDI clips yet also takes the file's tempo and time signature changes; one that already has
  music keeps its own and only gains the notes, and the log says which. A file that counts time in frames, is cut short, or
  is not MIDI is refused with the reason and changes nothing. Files over 8 MB are not imported.
- **Freeze** renders one track as heard to an audio clip on a new track and mutes the original, in one edit.
- Rendering uses a second engine built from a snapshot of the session: the same plugins, scheduler, clips,
  envelopes and transport messages, with the audio context suspended each tick.

## Sessions

- A session is RDF (Turtle), or a zip of it with its audio and a separate `editor.ttl` for layout, colours and
  positions. Layout is kept apart from the model and is not part of undo.
- Undo and redo cover every edit; a changeset is atomic and carries a revision.
- Save and Open, nine bundled presets that play a piece on their own, and a piece carried between
  the two pages: following the link to the other page keeps the open session and the other page offers it.

## The simple page

- Six tunes as big buttons, Play and Stop, a Speed slider in plain words, and a card per instrument with On
  and Off, its loudness, and "Change the sound".
- "Change the sound" opens a rack screen for that track: its plugins as generated panels, with Back, a
  history entry so the browser's Back works too.
- Record your voice into a new track, save the piece, and make a sound file (a WAV).
- Targets are 44px and the layout is one column with no sideways scroll at phone width.

## The Reel page

- `reel.html` is for writing Reel scripts ([livecoding.md](livecoding.md)), on a phone first. A menu and an Open button pick one of the bundled pieces; Play, Stop, speed and the meter stay at the foot of the screen.
- Four tabs. **Script** is the editor with Run, Check only and Stop, and saves or opens a `.reel` file (opening one does not run it). **Examples** has ready-made scripts, each written for one bundled piece: "Edit this" puts it in the editor, "Play it" opens the piece, starts the music and runs it. **This piece** lists the names a script can use in the open piece and their parameters, with an Insert button that writes the line to set one. **Reference** is the language: statements, units, functions, naming and limits, with an Insert button on each example.
- The examples, the reference and the Insert lines are checked by tests against the real pieces, plugin profiles and parser, so none of them can name a parameter or a form that is not there.

## Installing and offline

- A web app manifest and icons, a service worker that keeps the page and what you have opened, an update
  notice that never reloads under a playing piece, an install button, and an offline indicator. A cached
  plugin is still checked against its digest when it is run.

## For agents

- **67 tools** over the same dispatcher the page uses, through WebMCP: search and load plugins, edit tracks
  and clips, connect and bypass and reorder nodes, set and reset parameters, write envelopes, undo and redo, and play and stop.
  Nothing an agent does goes around the operations the interface uses, so it is undoable and checked the same
  way ([webmcp.md](webmcp.md)).
- **A Script tab** drives the plugins from text, in Reel ([livecoding.md](livecoding.md)): every plugin a script loads is
  fetched and validated before anything runs, a script with a problem changes nothing and says which lines, a new script
  takes over at the next bar line (or now), and one run is one undo step. Control+Enter runs it and
  Control+Shift+Enter runs it now. Checked in Chrome, at phone width too.

## The plugins

**33 plugins** are served beside the page, written in Rust, C++, JavaScript and JSFX, each described by a
profile and loadable by its IRI:

- *Instruments:* Pulse (subtractive), Canticle (tonal), DrumKit, Mop (OPL3 FM), 8-Bit 8asterd (AY chip).
- *Generators:* MelGen, BassGen, DrumGen, Ground, Cadence and Counterpointer play a piece from a few settings
  and the transport.
- *MIDI processors:* Dice (probability gate) and MIDI Filter (channel, transpose, note range).
- *Effects:* Cascade (reverb), Ferrite (neural amp and cabinet or room), Dynamix (compressor, limiter,
  clipper, with a sidechain key), Squelch (acid filter), Tremolo, Quefrency (formant and pitch), Lookahead,
  Boost, and three JSFX effects (gain trim, one-pole filter, soft clipper).

**9 presets** are bundled: Glass Hours (a 40 bar piece of clips), Chiptune, Acid, Generative through effects, Sam in a room, Fender into the
Ropery, Fugue, Generative Gamelan, and Through Keyframe. Each is played offline in a test and must put sound on every track that has a sound maker.

## Built to be used by everyone

- Every control has a name, a role and a value said as text. The keyboard reaches everything the pointer does.
  State is never colour alone. A control nobody can use is left out, not shown disabled.
- Touch targets are at least 44px and text inputs 16px. One column below 720px, with no sideways scroll,
  measured in a real browser.
- Standard icons carry their words as their accessible name.
