# A path from the first sound to the whole studio

**Status:** a design, written 2026-10-26. The first step of the order of work is built (the Show control and the step list); nothing else is. It sets out how Jiggy can look and behave like the DAWs people
already know, and how a person moves from pressing Play to routing plugins without meeting the whole studio on the first
screen. It does not replace [main-view.md](main-view.md), which says where the parts of the studio sit. It decides which of those
parts a person sees, and when.

## The decision

**Jiggy keeps the common DAW layout, in the vocabulary of the common DAWs, and shows it in three steps: Simple, Standard and
Advanced.** The layout is the one [Reaper](https://www.reaper.fm) shares with most desktop DAWs: a transport, tracks down the
left, clips across, an editor under them, a mixer, an FX chain per track. Reaper is the model for how much a studio can hold and
for where things go. [GarageBand](https://support.apple.com/guide/garageband/gbnd7f48d68b/mac) is the model for how little a
person has to know on the first day: start from a sound, not from a plugin; a few controls for a sound, with the full editor behind
them; a library to browse and audition.

Four rules follow.

1. **One app, one piece, three steps.** The simple page and the studio are the same model and the same operations. Moving up is
   changing how much is drawn. It never loads another document, so a piece started on the simple page is still there.
2. **The step is the person's choice, with a nudge from what they do.** It is a setting called Show, with the three names, and it
   is remembered in the browser. Nothing is locked. When a person does something that needs a part that is not shown, the page
   says where it is and offers to show it.
3. **A control that is not shown is left out, not disabled.** This is the rule from [CLAUDE.md](../CLAUDE.md) and it matters more
   here, because a disabled control teaches nothing and misleads a screen reader. The step adds and removes controls, as data, and a
   test binds the list to the page.
4. **The words are the ones other DAWs use.** A person who knows one DAW should find the thing by its usual name.

## What the studio is today

**Seen in Chrome on 2026-10-26, on a fresh load at 1280 by 903.** An empty session says "No tracks yet", and offers Browse plugins,
Open the Chiptune preset and Load the Pulse synth. The transport is two rows of icon buttons, about twenty in all: the browser,
keys, play, stop, panic, record, record MIDI, tap tempo, loop, click, a count-in menu, MIDI in, mic in, undo, redo, save, export,
the MIDI import and export buttons, stems, open and install. Seven tabs sit under it: Arrangement, Plugins, Routing, Mixer, Launcher,
Script and Settings. Opening the Chiptune preset made six tracks with names, mute and solo, and no clips drawn in the
lanes, and the lane area took about the left half of the width. I did not press Play, so this note says nothing about how it sounds.
The simple page is a heading and nine buttons under "Pick a tune", which is as plain as a first screen gets.

What that says about the learning curve:

- **The gap is between the two pages.** The simple page is ready for a first-time person, and the studio is ready for a
  person who knows what a routing matrix is. Nothing sits between them, and the only link is "Full studio".
- **The first screen of the studio is a developer's, not a musician's.** The empty state offers a plugin before it offers
  a track, and "Plugins", "Routing" and "Script" are names from our model.
- **Everything is on at once.** Twenty buttons are equally prominent, and the ones a first-timer needs (play, stop, tempo, save)
  are among them without being first.
- The pieces for a good middle are already there: count-in, click, tap tempo, a piano roll, templates, presets, a clip launcher,
  right-click menus, a Keys dialog. What is missing is the order in which a person meets them.

## The three steps

**Each step is defined by what a person is doing, not by how much they know.** Someone who only wants to loop a drum pattern is
never made to feel like a beginner.

| Step | What the person is doing | What is drawn |
|---|---|---|
| **Simple** | Playing a piece, changing its sound, perhaps adding a part | The transport (play, stop, loop, tempo, position, count-in, click), the tracks with name, mute, solo and level, a sound picker, undo, save and open, and the Show control. No tabs. |
| **Standard** | Making a piece: recording, drawing notes, arranging clips, mixing | Simple, plus the clip editors in the dock, the Mixer, the Launcher, automation lanes, the library, export, MIDI in and mic in. The tabs are Arrangement, Mixer and Launcher. |
| **Advanced** | Building: routing plugins, composing chains, scripting, loading by address | Standard, plus Plugins, Routing, Script, the plugin browser by IRI, composites, collections, the agent connections, and every setting. |

Two details keep the steps honest.

- **Undo, save, the Keys list and help are in every step.** A person on any step needs to get back out of a mistake and to find
  out what a key does.
- **The default depends on the screen, decided 2026-10-26.** A phone, and any window narrow enough for the one-column layout, starts on Simple, as
  it starts on the simple page today. A desktop starts on Standard. A person's own choice, once made, is remembered and wins over
  both. Advanced is never a default.

## A first hour

**This is the path the steps are built to make easy, and it is also the test: a person can do each step without being told.**

1. *Hear something.* Open Jiggy, pick a tune, press Play. Space also plays and stops. This works today.
2. *Change it.* Click a track, and a few controls for its sound appear, with names a musician uses. (See "A few controls for a
   sound" below.) Mute and solo a track to hear what each one is doing. Both work today.
3. *Add a part.* Add track, then choose what kind of part: an instrument, drums, a bass line, a microphone. Choose a sound from a list
   and hear it before loading it. Today Add track makes an empty track, and the sound comes from a separate trip to the Browser.
4. *Put notes in.* Double click an empty lane to make a clip, and the piano roll opens under it. Play a MIDI keyboard or the
   on-screen keys and record. This works today.
5. *Make it longer.* Drag the corner of a clip to repeat it. Copy and paste a clip. Today repeats are made in the piano roll's
   loop length, and the corner gesture is not drawn.
6. *Balance it.* The Mixer appears in Standard: levels, pan, meters, and an FX button per channel.
7. *Shape it.* Add an effect to a track from a short list by role (reverb, delay, compressor). In Advanced, the same list
   is the whole catalogue, and the person can load a plugin by its address.
8. *Automate it.* Draw an envelope on any parameter. This works today and is a Standard control.
9. *Route it.* Sends, buses, sidechain, MIDI splits. Advanced.
10. *Build it.* Write a script, publish a Jig, open a collection. Advanced.
11. *Play with others.* [collaboration.md](collaboration.md), when it exists, as a button in the transport.

## Vocabulary

**Each of our terms that a person would meet is checked against what the common DAWs call the same thing.** The model's own names
stay in the files and in the agent tools. This table is about labels and headings in the page.

| Today | Shown in Simple and Standard | Shown in Advanced | Why |
|---|---|---|---|
| Browser | Sounds | Plugins | A person looks for a sound before a plugin. |
| Plugins (tab) | FX, on a track | Plugins | Every other DAW says FX or effects for a chain. |
| Routing | not shown | Routing | A matrix is not a first-day idea. |
| Launcher | Live loops, as GarageBand calls the same grid | Clip launcher | Both names are used. Say it once where it is introduced. |
| Script | not shown | Script | |
| Mixer | Mixer | Mixer | Same everywhere. |
| Clip, track, tempo, loop, snap, count-in | unchanged | unchanged | Already the usual words. |
| Panic | All notes off, in the label, Panic in the tooltip | Panic | Plain first. |

A Reaper user will look for items and takes, and the project's word is clip. The mapping goes in the Keys dialog and the help
text, not in a rename.

## A few controls for a sound

**GarageBand's Smart Controls are the answer to a generated panel that shows every port: show the few that matter, and put the
rest one click away.** Jiggy draws every control of a plugin from its declared ports, which is right for completeness and bad for a
first look at a 30-parameter synth.

- A profile can say which ports are primary. The first time a person opens a plugin they see those, and a "More" opens the rest.
- A plugin with no such statement shows everything, as now. Nothing breaks and nothing is left out.
- A composite plugin already exposes the few controls its author chose
  ([nested-plugins.md](nested-plugins.md)). Those become its primary ports without further work.
- **This needs a vocabulary term**, and per the vocabulary rule it goes into `vocabs/` and the shapes first, and is proposed to the
  upstream `trn:` vocabulary before it is minted under `jig:`. The term is not named here.

## Sounds, not plugins

**Adding a track starts with what the person wants to hear.** A sound is a saved chain on a track: an instrument and the effects
that make it a particular patch. The presets in `web/presets` and the composites are the two forms that exist now.

- The chooser lists sounds by role (keys, bass, drums, lead, pad, a microphone) and has a Play button that auditions one before it
  is loaded, in the project's tempo.
- A track has no stored kind, because its kind is read from the ports of its plugins (`src/model/TrackKind.js`). The chooser keeps
  that. It selects sounds by facets the catalogue already has, and a role is a facet and not a new field on a track.
- A sound that is a generator, like the drum and bass Jigs, can offer a style and one two-axis pad (simple to busy, soft to loud) in
  place of its ports. GarageBand's Drummer is this idea. It needs the primary-controls term above, plus a way to say which two ports
  go on the pad.
- A library of MIDI loops by role and mood, auditioned in time, is a later step. MIDI loops need no time stretching, and the
  generators can produce starter material, which avoids licensing.

## The transport, grouped

**The transport keeps the controls a person needs every minute in one place and moves the rest into menus by step.**

- Always in the bar: Play, Stop, Record, Loop, Click, the count-in, tempo, the time signature and the position.
- Grouped, not scattered: File (open, save, export, import), Edit (undo, redo), and Input (MIDI in, mic in, record MIDI).
- Moved out of the bar into a menu, in Advanced: Panic, stems, install, the keys list stays one key away.
- Text beside the icon for the five that matter first, as other DAWs do. Icon only is for a person who has learned the set.
- A recovery notice and an update notice are one line, in one place, and never above the transport. Both appeared above the tabs
  in the check above and pushed the work down by about a hundred pixels.

## Help comes from the profile

**GarageBand's Quick Help explains the control under the pointer, and Jiggy can do the same from data it already has.** A generated
control has its name and units from the port declaration. A comment on the port, in the profile, is the help text, and the
panel shows it on hover and on focus for the length of the pointer's stay or the focus's. A plugin that says nothing gets nothing.
It never blocks and it never moves focus. Help for the page's own controls comes from one table of strings beside the Keys table
(`src/ui/KeyTable.js`), checked by the same kind of test.

## Keys

**Where Reaper has a key for something, use it, and say so in the Keys dialog.** Space for play and stop, S to split, R to record,
Ctrl or Cmd with Z, S, C, X and V are the ones that are plain DAW. Jiggy already uses S, D, M, L and the brackets on a focused clip.
A table of Reaper's defaults for the actions Jiggy has, set against Jiggy's, is the task, and the Reaper note in TODO.md is where
it belongs. It has not been done, and this note does not claim what Reaper's keys are beyond the few above.

## What this does not do

- **No tour and no quiz.** A tour is clicked through and forgotten. The nudge at the moment of need is where the page can teach.
- **No locked levels and no skill rating.** The step is a view, and it is one click to change.
- **No second, cut-down application.** One model, one set of operations, one set of tests.
- **No hiding of the person's own work.** A track with an effect on it is shown with the effect in every step. The step decides
  which controls to offer, not which parts of the piece exist.

## Order of work

**Each step stands alone, and the first two need no new vocabulary.**

1. **Show, as data. Built 2026-10-26.** One list of the controls and tabs and which step each belongs to (`src/ui/Show.js`), the Show control in the transport bar (Settings is a tab, and Simple has none), and the page
   drawing from it (`web/app/Show.js`). A tab asked for from code that the step does not draw is not switched to: a note says which step draws it, with a button to show that step. Checked in Chrome on 2026-10-26: 13 controls drawn in Simple, 22 in Standard and 25 in Advanced, the tab list absent in Simple, and no horizontal overflow or touch target under 44px at 320 and 390 wide. Still to do from this step: controls that scripts draw later (the timeline tools, mixer channels) have no step yet, and Browser keeps its name and stays in Simple until the sound chooser exists. A test walks every button and tab in `web/index.html` and fails on one that has no step. Measured at 1280 and
   at 360 in a real browser, as CLAUDE.md asks of every view.
2. **A start screen** in place of the empty arrangement: Play a tune, Start a new piece, Open a file. It uses the simple page's
   list and the templates store. **Built 2026-10-26.** `src/ui/StartScreen.js` makes the groups (Play a tune, Start a new piece, From a template, Open a saved piece; a group with nothing in it is left out) and the Timeline draws them as named groups of buttons. The tunes are the bundled presets, read from the same index as the simple page, though that page puts Chiptune first and the index does not. The screen is drawn again when the presets arrive and when the templates are listed. "Browse plugins" became "Find a plugin", and the Chiptune and Pulse buttons became the tune list and "A synth to play". Checked in Chrome on 2026-10-26: an empty track, undo back to the screen, a tune (Acid, two tracks at 124), and at 320 wide 13 buttons with none under 44px or past the right edge. Choosing a file was not clicked, since the file chooser needs a person.
3. **Add track as a chooser by role**, with an audition, over the presets and composites that exist. **Built 2026-10-26, for instruments.** The toolbar's Add track and the start screen's "A track with a sound" open a dialog listing the instruments the host can run, each with a line about it and a Hear and an Add (`src/ui/SoundChooser.js`, `web/app/AddTrack.js`). Hear loads the sound onto a trial track and plays four notes through it (a C major chord rising, or kick, hat, snare, hat for a drum kit). The trial track is made and removed with recording off, so it is never an undo step, and there is at most one. Add loads the sound onto a new track as one undo step. Cancel, Escape and An empty track leave no trial behind, including when the dialog is dismissed while a sound is still loading. Checked in Chrome on 2026-10-26: Pulse and DrumKit each peaked about 0.5 on their trial track, Add gave one undo step and Undo returned to the start screen, Escape closed it and put the focus back on Add track, and at 320 wide the dialog fits with 18 buttons none under 44px. Not done: sounds are the eight instruments from the catalogue and not yet saved chains (presets and composites as a sound), and there are no roles other than instrument (no "make notes for me", no effects, no microphone).
4. **The transport grouped**, text on the first five, one-line notices. **Built 2026-10-26, except the notices.** The bar is seven named groups (Sounds and help, Play, Tempo and time, Input, Edit, File, and Output for the meter), each a `role="group"` with a name, and Panic, Stems and Install sit in a More disclosure that only Advanced draws. Play, Stop, Record, Save and Open carry their words beside the icon (the other buttons stay icons with names); the words give way to the icons below 480px, where the bar is mostly wrapping. A group is drawn from the step of its earliest control, and a test fails on a group that would be left empty. Rec MIDI moved from beside Record into Input with MIDI in and Mic in, so the tab order changed. Checked in Chrome on 2026-10-26: 13, 22 and 25 controls at the three steps, no horizontal overflow and no control under 44px at 320, 390 and 700 wide. Not done: the notices were left as they are, because the recovery notice is already one line (about 56px) and the update notice shows only when an update is waiting. The bar is still tall on a phone: 323px at 320 wide on Simple, which scrolls away with the page. Not compared with the bar before this change.
5. **The clip corner for repeating**, using the loop length the model already has. **Built 2026-10-26.** A MIDI clip has a loop mark at its top right. Dragging it repeats the clip to the length dragged to, on the grid (`src/model/ClipLoop.js`, `repeatClip`): a clip that did not loop starts to, repeating its own length as it stood, and a clip that already loops keeps its pattern and only gets longer. R repeats it once more, and the clip menu has Repeat once more and Stop repeating, so each gesture has a keyboard and menu equivalent. A repeated clip draws its notes coming round again, with a line where each repeat starts. It is one edit and one undo. The mark is left out of audio clips and locked clips. Checked in Chrome on 2026-10-26 with a real drag (4 beats became 12 with a loop of 4, six notes drawn), R (12 became 16), one Ctrl+Z each, and the menu. Not done: the mark is 18px, smaller than the 44px touch rule, because it shares the clip's edge with the resize handle; R and the menu are the touch-and-keyboard route, and a long press is not wired.
6. **Primary controls** in the profile and the panel: the vocabulary term, the shapes, the generator, a "More" disclosure. **Built 2026-10-26, with no new term.** LV2's port properties extension already has `pprops:displayPriority`, a nonnegative integer where higher matters more, so the profile reuses it (the note above had expected to propose a term). `ProfileReader` reads it (invalid values are refused), `vocabs/shapes.ttl` constrains it and the counterexample profile violates it, `bin/write-profile.js` writes it, and the panel (`src/ui/PrimaryControls.js`, `src/ui/Panel.js`) draws the ranked ports first, highest first, with the rest under a "More controls (N)" disclosure. A profile with no priorities, or with a priority on every port, is drawn whole. DrumKit is the worked example: 14 of its 75 ports are ranked (the master controls and each voice's level). See [plugin-profiles.md](plugin-profiles.md). Not done: the other large plugins (Conductor, Ground, 8-Bit 8asterd, Parameq) are not ranked yet, and a plugin's own interface and skins are untouched.
7. **Help from the profile**, and the table for page controls.
8. **A pad for generator sounds**, then **a MIDI loop library**.
9. **The Reaper key table**, and the Keys dialog showing Jiggy's key beside Reaper's where they differ.

## How it is checked

**By a person who has not used it, and by tests that stop a control being left behind.**

- **A first-hour test with a person.** Someone who has used another DAW, and someone who has not, given the eleven steps above
  and no instructions. The record is where they stopped, in their words, and nothing is scored. This is the check that finds what the
  document missed, and it needs a person. Recorded in HUMANS.md when it is ready to run.
- **Every control has a step**, by a test over the page's own markup, and an addition without one fails.
- **A step never removes a person's work.** A test opens a session with an effect and an automation lane on each step and
  checks that both are drawn.
- **Left out, not disabled.** The existing rule, checked by `getClientRects().length` and never by an attribute, since
  `[hidden]` loses to an author `display` rule.
- **Accessibility at every step.** A name, a role and a value for every control, tab order that follows the picture, and a live
  region for the nudge.

## What BandLab adds

**BandLab is the closest browser DAW to GarageBand, and it is free and cloud-based; its help pages and some third-party guides gave these ideas, and none of it was used or tested.** What was read: its [Getting started](https://help.bandlab.com/hc/en-us/articles/115002945153-Getting-started-on-BandLab) and [education Studio](https://help.edu.bandlab.com/hc/en-us/articles/900000382306-Getting-started-in-the-Studio) pages, its [invitation article](https://help.bandlab.com/hc/en-us/articles/48010528581529-How-do-I-invite-other-users-to-collaborate), its [Studio help index](https://help.bandlab.com/hc/en-us/categories/360001466574-Studio), release notes for the Splitter, and third-party guides on forking and loops. The figures for track and length limits differ between sources and are not used here.

- **One New Track screen, by kind.** It offers Instruments, Voice/Mic, Drum Machine, Guitar/Bass, Sampler, Import audio or MIDI, and BandLab Sounds. Our chooser lists instruments only. The same list by kind is the next step for it: Instrument, Drums (the drum kit with a rhythm generator on it), Microphone (an audio track fed from the mic, which the page already can do), and Import a file (the MIDI and audio imports already exist as buttons). A kind is a facet or a preset of an existing control, not a new field on a track, since a track's kind is read from its ports.
- **Click, double click or drag a sound to make a track.** BandLab's loop browser creates a track from a sound by any of the three. Our Hear and Add pair is the keyboard-first form of the same thing. Dragging a sound onto the lane area is a gesture to add later, as a second way to press Add, and it is a pointer-only extra.
- **Loop packs by style, and a Looper.** A Looper picks a pack in a genre and loads it as pads to trigger. That is the clip launcher with a starting kit, and the generator Jigs can make the kit, which avoids licensing. Third-party guidance on BandLab stresses checking each loop's licence before a release. A loop shipped with Jiggy would name its licence in its profile, as plugins already name theirs.
- **Invite, and fork.** Collaboration there is by account: a project's menu has Invite Collaborators, by username or email, and a creator can allow others to fork a project into their own account. [collaboration.md](collaboration.md) covers invitation by link. Forking has a direct equivalent: a session is a file at an address, so opening a copy of someone's published session is a fork, and whether a session may be copied is a statement the publisher makes (a licence, or an explicit permission) and the host reads. Neither is designed yet.
- **A Splitter.** BandLab offers stem separation into vocals, drums, bass and other, free. It is a large feature, and the TODO already lists heavy analysis as research to run in WebAssembly or ONNX in the page. It is not proposed here.
- **A built-in tutorial.** BandLab's Studio has one (Menu, Help, Show Tutorial). This note decides against a tour, on the view that it is clicked through and forgotten, and BandLab is the case against that view. The first-hour test with a person is where to find out which is right, and the tutorial is not ruled out if it shows people stopping.
- **Cloud sync across devices.** Everything lives in the person's account there. Jiggy keeps a session as files in the browser and on a server only if the person puts it there, so a session moving between a laptop and a phone is a link or a file today. A shared folder or a room (collaboration.md) is the nearest thing planned.

## Open questions

- **Is Standard the right desktop default?** Decided: it is, and Simple on a phone. The first-hour test is where that could
  turn out wrong, so it stays a thing to check and not a thing to argue.
- **Where does the simple page go?** It could remain the page a link opens, as Simple on the same app. That removes a page and
  keeps the address.
- **Which Reaper conventions are worth the cost of copying?** A track's control panel and mixer strip are the first two, and
  the TODO item for them is the place to settle it.
