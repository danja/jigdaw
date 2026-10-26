# Mistakes

What happened, root cause, prevention. Newest first. A lesson that applies beyond its one
instance is promoted to [CLAUDE.md](CLAUDE.md) ("Lessons kept from the mistakes log") and its
entry is removed from here; a fix held by a test alone is dropped. Cleared on 2026-10-12 from a
346 line file, and everything it held is in CLAUDE.md.

## 2026-10-26: A pad set only one of its two controls

**What happened.** The new Feel pad moved the across control and left the up control where it was. Every unit test passed, including ones that
dragged the pad and checked both values. A real drag in Chrome set density to 0.9 and left variation at 0.35.

**Root cause.** The pad sent the across value, then read its own state to send the up value. In the page, sending the first value makes the
rack redraw, and a redraw pushes every port's last value back through `panel.update()`, including the up port's old one, so the pad's state was
overwritten between the two sends. The tests used an `onChange` that did nothing, a stand-in more permissive than the real one, which never
redraws (CLAUDE.md, "a fake more permissive than the real thing").

**Prevention.** Both values are worked out before either is sent, and `tests/ui/Pad.test.js` has an `onSet` that pushes old values back the way
the rack does; reverting the fix fails exactly that test. Checked with a real drag. Any widget that sets two things at once should be tried against
a host that echoes, since the echo is where the second write goes wrong.

## 2026-10-26: The first track's name field said "Track 0"

**What happened.** The track editor in the dock showed "Track 0" as the placeholder of the first track's name field, while its heading said "Track 1". Found
by looking at the page after building the start screen, not by a test.

**Root cause.** `web/app/Dock.js` named the default by passing a copy of the track, `{ ...track, label: null }`, to a helper that finds the track's place with
`indexOf`. A copy is not in the list, so `indexOf` said -1 and the label was `Track ${-1 + 1}`. Every first track was affected, and nothing drew it into a test
because the dock's wiring has no unit test and the label helper was right for what it was given.

**Prevention.** The index is now taken from the track itself. The general point is the old one: a helper that locates a thing by identity is wrong for a copy of
it, and the wrong answer is a plausible one. Checked in Chrome, where it showed.

## 2026-10-24: Splitting a module left guards reading text that had moved

**What happened.** Seven large source files were split along their seams (the agent tools, the dispatcher, the project model, the engine, the
piano roll, the rack and the project reader), keeping each old module as the front door. The unit tests of behaviour stayed green. Five guards that
read source text failed: the tool count and the parity check read only `src/mcp/tools.js`, three checks on the page read `web/app/Rack.js` for
`drawSlot`, a Rec MIDI check wanted `ctx.midiRecord.capture(` in the file that now only calls the slot drawer, and the foreign-plugin mark was
looked for in a file that no longer drew it. One more slip was found only by the piano roll tests: a moved line still named `band`, not `g.band`.

**Root cause.** Each guard named the files it read, so it was exactly as wide as the list when it was written (CLAUDE.md, "a guard is only as
wide as the list it walks"). A move by search and replace of a closure's variables also leaves a bare name where an accessor belongs, and a
syntax check does not see it.

**Prevention.** The tools guards read `tests/mcp/toolsSource.js`, which walks `src/mcp/tools/`, and the tool count now also checks that the
declared names are the names `createTools` builds, so a group file left out of the front door fails. After a split, run the whole suite and then
the real page: a real drag in the roll and a launch were done in Chrome, and `/tmp`-style undefined-name scans of the moved files were run.

## 2026-10-22: A scale test passed only because the machine was slow

**What happened.** The test for snapping a dragged note pressed the same note twice and passed. Rerun on a
faster moment it failed: two presses on one note within 400 ms are a double click, which removes the note, so
nothing was sent.

**Root cause.** The roll reads the real clock for its double click window and the test did not inject one, so the
result depended on how long the first press took to render.

**Prevention.** A test of the roll that presses one note twice passes a `now` that moves on each read. It was run
three times to see it stay green.

## 2026-10-22: A roll gesture with no release committed beside the next one

**What happened.** Found in real Chrome while checking the rubber band. A press on the note roll listens for
`pointerup` on the document and nothing else. A press whose release never arrives (a touch ended by
`pointercancel`, a scripted drag that stopped early) stays listening, so the next gesture's single release
committed both: two identical notes at one start and pitch.

**Root cause.** Each gesture owned its listeners and removed them only on `pointerup`. No path existed for a
gesture that ends any other way.

**Prevention.** One `abandon` handle: a new press, `pointercancel`, `show` and `hide` drop the gesture in
progress without committing it. `tests/ui/PianoRoll.test.js` covers the cancel and the replaced press, and
fails with the abandon-on-press line removed.

## 2026-10-21: Add track threw in an empty session

**What happened.** The new `onAddTrack` in `web/app/Arrangement.js` called `edit()`, which reads
`ctx.dispatcher`. That is null until `ctx.runtime.ensureRunning()` has run, which is on the first plugin
load. Every other arrangement handler needs a track, so a dispatcher already exists; this was the first
reachable with none. Both clicks threw `Cannot read properties of null (reading 'apply')` and nothing
happened. 800 unit tests passed, because they hand the toolbar a recorded handler and never build the page.

**Root cause.** A handler wired into a page that can be in a state the others cannot: no session started.
Found by clicking it in Chrome on an empty page.

**Prevention.** A handler reachable with no tracks awaits `ensureRunning()` first. Nothing checks it, since
no test builds `createArrangement` with a null dispatcher; a click in a fresh page is the check.
