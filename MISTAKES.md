# Mistakes

What happened, root cause, prevention. Grouped by lesson rather than by date,
newest first inside each; the one-off narratives are gone, the tests that guard
each lesson are named. Retired 2026-09-30 from a 1466-line chronological log: a lesson that lives in
CLAUDE.md is a pointer, a fix held by a test alone is dropped, everything else is below.

## A refusal test passed because two different refusals print the same thing

**2026-10-02 the composite cycle test passed with the cycle check deleted, and the engine loaded a composite without applying
its author's settings.** The first: `tests/host/CompositeResolver.test.js` asserted that a loop of two composites was refused with
the chain `A > B > A` in the message, and with the check removed the depth limit refused it instead, with a message that also
prints that chain. Found only by deleting the check on purpose and watching nothing fail. The test now requires "contains itself".
The second: docs/nested-plugins.md said a member's `jig:setting` is the author's fixed voicing and an exposed port's default
reaches what it drives, and the engine's first version instantiated the members and applied neither. Found by listing what the
loader does for a plugin at load and asking which of those a composite owes, before any test existed to notice; the audio
equivalence test (rack against the same plugins wired by hand) and a mutation that removes the call now both fail.
Prevention: a test for a refusal asserts the reason, not a string another reason also produces, and every new guard is broken on
purpose once. A sentence in a design that says what a load does gets a line in the code that does it the same day.

## A screenshot looked wrong, and the wrongness was in the harness

**2026-10-02 a gallery screenshot of a 31 control plugin came back as one unstyled slider per screenful, and the browser was blamed first.**
The plugin's own panel had been drawn correctly in a test, so the first assumption was that headless Chrome was unavailable or slow.
`/usr/bin/google-chrome` was there and had been used all along; the mistake was not checking, which AGENTS.md says not to do. Chrome was fine and the page was not: `bin/jig.js`'s `panelStyle()` inlined the `<style>` block from `web/index.html`, but the generated panel and the knob had moved out of it into `web/panel.css`, which that page only links. A standalone page opened as `file://` cannot resolve the link, so `.controls` kept its default `display: block` and every control stacked full width. Measured with `--dump-dom` and a script reporting `getComputedStyle`, on cascade, drumkit, boost and tremolo alike: all four `block`, so every gallery screenshot taken since the stylesheet moved was of an unstyled page. The 20 committed PNGs were correct because they predate the move, and regenerating all 26 after the fix reproduced all 20 byte for byte, which is what confirmed the diagnosis rather than a new one. `tests/bin/jig.test.js` now asserts the panel selectors are present and that the page carries no stylesheet link. Prevention: a screenshot path is a build step, and a step whose output nobody looks at until something looks wrong is one that was broken for as long as nobody checked.

## A library test cannot see a deadlock in the entry point

**2026-10-02 `bin/bundle.js` wrote nothing for any plugin, for a few hours, with every test green.** The command line awaited a dynamic import of
`bundle-composite.js`, which imported from `bundle.js`, which was the entry module still waiting on that import: node printed "unsettled
top-level await" and exited 0 with no files. The two bundle suites call `bundle()` as a library, where the cycle is harmless. It was found by
running the command on the real worked composite, which is what CLAUDE.md says to do after any change to imports and which I had not done
after adding `--members`. Fixed by moving everything but the command line into `bundle-core.js`, keeping `bundle.js` as the front door that
re-exports it. `tests/bin/bundle-cli.test.js` runs the commands as subprocesses and fails on all four checks when the cycle is recreated.
Prevention: a CLI that gains an import gets a subprocess test in the same change, because a library call exercises the code and not the
entry point, and a command that exits 0 having produced nothing is still a failure.

## A browser experiment that does not check what its calls returned measures the default

**2026-10-02 the first A/B of the composite's Drive control compared Drive 1 with Drive 1, and nearly reported a defect.** `parameter_set`
takes `node`, not `nodeId`; every call returned `{ ok: false }` and the script ignored the result, so the rack sat at its default throughout
and "Drive 0 still sounds" looked like sound bypassing the boost. A second reading was contaminated by a recorder that counted every
analyser including the test's own sanity oscillator, and homemade stage analysers read zero while the master heard sound. The wiring log, a
positive control and a narrowed recorder separated them, and the corrected result (master peak 0.139 at Drive 1, exactly 0 at Drive 0) is in
docs/plan.md. Prevention: a scripted browser step asserts `ok` on every call and throws, and a measurement gets a positive control and a
recorder that counts only the thing under test before it is believed in either direction. A later run found a fourth way to measure nothing: the
page's meter polls on `requestAnimationFrame`, which does not run in a background tab, so a recorder built on it read 0 for a clip that was playing
(0 meter calls, which was the clue). Tap the signal where it enters the thing under test and measure from an audio callback, and print how many
samples were taken.

## Freestanding math is wrong until it is measured against libm

**2026-10-02 Parameq's first build filtered nothing, then filtered at the wrong corner, then boosted at half gain.**
Three defects in the coefficient update's hand-rolled transcendental functions, each found by driving the module
against cookbook figures rather than by reading the code. First, a cosine-by-phase-shift that negated its result for
positive angles, turning the high pass into a near-zero filter: the bypass path worked, which isolated it to the
coefficients in one run. Second, a cosine accurate to 1e-4 moved the 80 Hz high pass corner to 170 Hz, because poles
next to z = 1 amplify absolute coefficient error into a square-rooted shift of the corner; the coefficient update now
runs in f64 and only the final rounding to f32 remains. Third, a Horner chain with six updates for a degree-7
exponential series, which shifted every coefficient one power up and halved every boost; found by compiling the same
functions natively and comparing against libm, which takes minutes and would have caught the first two as well.
`tests/dsp/parameq.test.js` pins each shape to its cookbook figure so all three fail loudly if reintroduced.
Prevention: a freestanding approximation gets a native libm cross-check the day it is written, and a filter gets a
per-shape sine drive before anything is wired to it.

## A design sentence described the offline algorithm and the plugin is live

**2026-10-01 Keyframe's design said a time rate of 200 "fills twice the output span", and its first build froze.**
Both came from reading a paper written for offline and embedded use as if it described a live graph. A live input cannot be
played faster than it arrives, so a time rate above 100 percent plays at the input's own rate, and the sentence was wrong
before any code existed. A second flaw only a run exposed: with a fast time rate and a raised pitch the reference is held
back, its distance from the play playhead stays under the leash, and the play playhead runs past the newest keyframe and
reads a constant. `tests/dsp/keyframe.test.js` caught both (the splice test failed with the fix removed). Prevention: when a
design adapts offline work to a live graph, list what the stream's own direction of time forbids before listing parameters,
and write the test for each limit the first time it is stated. The default for `quality` was also chosen by an operation
count and then measured under node's JIT, where it changed nothing; the Mop lesson below applies, the slowest host is the
one to measure.

## A destructive edit drops what its replacement does not repeat

**2026-09-30 pruning TODO.md deleted two live items with the done ones.**
An edit meant to remove three finished port blocks carried a replacement
string that ended mid-sentence after the first kept line, silently dropping a
full bug report and a full feature item below it. Found by grepping for the
items afterward, not by any check: markdown has no test binding its sections.
Read back the region after any edit that deletes, and grep for the headings
that should have survived. **The same day a scripted replace of `<#transport>`
hit the first occurrence, the project header's `jig:transport <#transport> .`,
instead of the node below it**, and was found only because the Turtle parser
refused the file. Anchor a scripted replace on text that occurs once, and run
the file through its parser before moving on.

## 2026-09-30 Nothing measured the native path's time, so the slowest host had no budget

Mop glitched continuously in Reaper while every suite was green: through the real native `Chain` at Release, 8 s of line plus
drums took 13.6 s wall (1.70x realtime), an overrun on every block, with correct output. The render-budget check runs in node,
where the JIT does the same part at 0.06x, and only gates orders of magnitude. Each host had been timed, if at all, on its own
fastest engine; the budget that matters is the slowest host's (WAMR's pure interpreter, 28 times the JIT cost here). No
automated prevention, because machines differ: timing stays diagnostic. The scratch driver is `Chain::add` over `file://` with
Reaper-sized buffers, wall against audio duration, plus peak, dead-window and click metrics. Record the figures with the
diagnosis (TODO.md, Mop item), not as an assertion that fails on a slower machine.

## A fake must refuse what the real thing refuses

The recurring shape, and the reason it matters most: a stand-in more
permissive than the platform turns a specification error into a passing test.
When writing one, ask what the real API forbids, not only what it returns.

- **2026-09-30 a fake that supplied what the real thing withholds hid a plugin that never ran.**
  Dice's processor began `const output = outputs[0]; if (!output || output.length === 0) return true`,
  copied from the audio plugins. A plugin with `jig:audioOutputs 0` gets an empty `outputs` from a real
  AudioWorkletNode, so it returned on every block and gated nothing, while `OfflineWorkletNode` always
  handed over one silent output and twelve Dice tests passed. Found by copying Dice into a new MIDI
  Filter, putting it between MelGen and a synth in a live page and getting silence. The generative
  preset's lead chain went through Dice and had been silent too: the meter I had read was the other two
  tracks. The fake now gives an empty `outputs` when `numberOfOutputs` is 0, which failed Dice's tests
  as the browser did; `tests/host/presetRender.test.js` plays every preset through
  `src/testing/ChainRender.js` and fails on a track with a sound maker that gets none, mutation checked
  (restore the early return and regenerate Dice's digest: "Lead in generative-fx.ttl: expected 0").
  Measure a preset track by track in a real browser, never by the master alone.
- **2026-09-30 the offline worklet clock belonged to whoever loaded last.** `OfflineHost.js` bound the shared
  `currentFrame` global to the registry of the last `addModule`, so with three contexts in one test every processor read the
  last one's frame and the first node's events looked perpetually future. It reads whichever registry is rendering now.
- **2026-09-26 a NaN tail read as null and rendered nothing.** Pulse took `tailFrames` from the bare `sampleRate` global,
  undefined outside a real worklet. The rate comes from the init message and `tests/host/pulse.test.js` asserts it at two rates.
- **2026-09-17 the contract required something browsers silently refuse.** Section 3.3 posted a compiled `WebAssembly.Module`
  into the worklet, which browsers accept and never deliver; the offline `MessagePort` passed it. Bytes are posted and compiled
  inside now, and the harness drops a Module as a real port does.
- **2026-09-17 a detached fetch, blamed on CORS.** `PluginLoader` called `globalThis.fetch` through a private field; browsers
  throw `Illegal invocation`, node does not. The default is a bound arrow and the loader test refuses a detached call. The error
  message had asserted missing CORS headers: report what happened, then the likely cause.

## State kept by an id is wrong when the ids are reused

**2026-10-01 the simple page showed the last piece's controls on the next one.** Its generated panels were kept in a
map by node id, and every piece numbers its nodes from `node-1`, so opening a second piece found a panel for
`node-1` and showed the first piece's plugin (Chiptune's Lead line controls on Acid's Bass line) with nothing wired
to the new node: the page looked stuck. The map was cleared after the session opened, but the redraw that opening
causes ran first. Kept by the plugin behind the node now (the engine entry), so any way a node is replaced, undo
included, gets a fresh panel. Found by opening two pieces in a real page and reading the controls the card showed
against the profile of the plugin on the track; no test could have, since the unit tests drew one piece. When
something is cached by an id, ask what else can be given that id.

## A guard is only as wide as the list it walks

When adding one, write down what it walks and ask what is outside that set.
The rule was right and the population wrong in every case below.

- **2026-09-29 a fixed viewport cropped the tallest panel screenshots.**
  DrumKit's 75 controls ran past a one-height-fits-all capture. The builder
  sizes the viewport from the port count; the committed shots are the check.
- **2026-09-19 a guard compared a label to a directory name**, and panel units
  covered four of the six units plugins declare. `plugins/8b8/` broke both on
  arrival. `tests/ui/Panel.test.js` now walks `plugins/` and fails on an
  unknown unit, and the catalogue compares IRIs.
- **2026-09-19 sixteen slots for 42 parameters.** The native adapter declared
  `JIGDAW_PARAMETER_COUNT 16` while `Chain::parameters()` flattens without
  bound; the 8b8's upper 26 ports were never asked about. Raised to 128 with
  `tests/parameter_count_test.cpp` binding count to slots.
- **2026-09-24 a test of ordering the reader's own order already satisfied**,
  and **2026-09-16 shapes that passed everything**: a property shape over an
  absent path is vacuously true, and constraints that never reject anything
  are worse than none because they look like coverage. Orderings start from an
  input where the naive order is wrong; `examples/counterexample-profile.ttl`
  violates every constraint once.
- **2026-09-18 six phases of blank nodes in every profile.**
  `bin/write-profile.js` wrote each `lv2:scalePoint` blank until signing
  needed a canonical form. `tests/rdf/Canonical.test.js` walks every tracked
  `.ttl`; the panel suite reads committed profiles end to end.
- **2026-09-16 three SHACL constraints that could never run**: `sh:sparql`
  against a validator without SPARQL support. SHACL Core only, and a
  constraint is not written until it has rejected something.

## Two places that must agree need a test that binds them

- **2026-09-29 the retime path knew the connection and the rebuild did not
  pass it.** `Engine.link` grew an option its only production caller never
  supplied. `tests/ops/latency.test.js` runs the dispatcher path end to end.
- **2026-09-18 a saved mix was written, read, and thrown away in between.**
  `addPlugin` enumerated the fields it forwarded and the new one was silently
  one short. It passes the change through now, and the guard compares field by
  field over the keys the model produces.
- **Profile, processor and module name every parameter three times.**
  `tests/host/*.test.js` fail when the three disagree; **2026-09-30** added
  two hardcoded lists to the pattern when Counterpointer arrived (keyboard
  membership in `tests/ui/Keyboard.test.js`, catalogue facets in
  `tests/catalogue/LocalCatalogue.test.js`), one of which was already stale
  on Dice.
- **2026-09-30 a new plugin changed counts in five documents and two test lists.** MIDI Filter moved
  "23 worked plugins" in `README.md`, `README.agents.md`, `docs/index.md`, `docs/testbed.md` and
  `docs/usp.md`, the catalogue facet lists and the keyboard list. Every one was found by a failing test,
  not by reading, which is what those tests are for; add the plugin, run `tests/docs`, `tests/catalogue`
  and `tests/ui/Keyboard.test.js`, and fix what they name.
- **2026-09-17 a capability minted, required, enforced, never offered.**
  `jig:MidiOut` existed everywhere except the host's capability list.
  `tests/host/Capabilities.test.js` walks `plugins/` and asserts every
  `trn:requires` is offered.

## Test the default, the first, and the empty

- **2026-09-24 undoing the first change did nothing**, and **2026-09-24 every
  session saved before a loop was set was invalid**: the snapshot lacks the
  setting, the writer wrote bounds nobody set. Fixtures must include the case
  a person actually meets first, not only the configured one.
## The audio thread: first calls cost, freeing is not reclaiming, views detach

- **2026-09-25 the adapter freed a chain the audio thread was still running.**
  An atomic swap publishes; it does not reclaim. The audio thread announces
  the chain it runs, the message thread retires, reaping frees only what is
  not announced (`tests/publish_test.cpp`).
- **2026-09-17 the audio thread compiled the WebAssembly.** wasm3 compiles on
  first call, so everything under `jig_process` built during the first block.
  `m3_CompileModule` after load; for anything called from audio, ask what the
  first call allocates, not what steady state does.
- **2026-09-23 restoring state detached the audio views.** A reload can grow
  linear memory, which invalidates every held view. State applies before views
  are taken, and `refreshViews()` re-derives them after any call that might
  have grown memory.

## An unreached branch is a missing feature

When a function handles a case, find the call that supplies it.

- **2026-09-18 nothing in the compiled graph reached the speakers.** The
  `output` branch existed and no caller could express it; the page wired
  around the model instead. Six tests now say which nodes reach the master.
- **2026-09-17 the adapter was silent and every test passed.** The DPF wrapper
  wrote host slot values over module defaults on a path the chain tests never
  take. `tests/chain_test.cpp` asserts a fresh Pulse is audible untouched.
- **2026-09-17 a removed plugin kept playing.** The model-to-engine map only
  ever grew. `#releaseRemoved` reconciles it after every apply.

## Report symptoms, not guesses

- **2026-09-18 a load reported as a hang was a hidden tab**: no user
  activation, so `AudioContext.resume()` never settled. `loadForeignPlugin`
  names each stage on a hang. A hang has an environment on one side as well as
  a program; "not diagnosed" must mean exactly that.
- **2026-09-18 the container worker only worked on its own probe page.**
  Scope and prefix are different things; a service worker intercepts only
  clients it controls. Neither fault was reachable from vitest, which is
  stated rather than papered over.

## Measure the renderer; do not reason about it

Linkedom has no layout, no pointer capture and no `activeElement`, so drags,
focus and narrow widths pass every unit test and fail in Chrome. The rule and
its harnesses live in AGENTS.md (interface rules): narrow iframes measured
for scrollWidth, moves and releases dispatched on the document, arrow keys
counted against `document.activeElement`. Instances: the 88px-too-wide
keyboard, the knob drag that stopped at its edge, the mixer rebuild that
stole focus. Related: a control nobody can use is left out, not shown
disabled (channel strips on MIDI-only nodes, keyboards on generators, the
44-button port bar); two of anything need visibly distinct names (panel ids,
connection rows).

## Native hosts: runtimes, locales, formats

- **2026-09-24 wasm3 does not do SIMD; WAMR does.** A capability negotiates
  with browsers and proves nothing about a native runtime. Documented in
  `native/jigdaw-adapter/README.md`.
- **2026-09-17 the profile parser read numbers in the user's locale.**
  `std::stof` under `LC_NUMERIC=it_IT` stops at the point. Wire formats parse
  in the classic locale; `profile_test` sets Italian first.
- **2026-09-17 a host API optional per format is a runtime fact.**
  DPF wires `updateStateValue` under CLAP only and discards it under VST3, so
  the editor derives its own report instead of waiting for one.
- **2026-09-17 every slice of the block was told it was the same moment.**
  The adapter filled the Abi2 transport once per buffer, not per slice.
  Instant properties must move with the slice.

## Specification and process

- **2026-09-24 the message protocol required two things no frame can do.**
  A spec written before any implementation stayed unimplemented; resolved in
  documents and code together when the first editor needed it.
- **2026-09-17 the specification had made itself browser-only.** Found by a
  second implementation differing in the way that matters, which review had
  not. Answer: `docs/module-abi.md` and `jig:abi`.
- **2026-09-17 a parser stricter than the format.** "No blank nodes" is
  shorter than "no blank nodes for anything addressable" and means something
  else. A rule remembered as a slogan is not the rule.
- **2026-09-23 a mutation that failed everything proved nothing.** A digested
  artefact mutates behaviour and digest together: regenerate the profile first, or the
  refusal comes from the digest and proves nothing about behaviour (the Dice check
  needed this again on 2026-09-30). A good mutation fails exactly one test.
- **2026-09-17 the site served `.git`.** Denylists enumerate thought-of
  mistakes; `SERVED_FROM_ROOT` allowlists, with tests asserting refusals and
  that the page still works.
- **2026-09-23 a build tree reached origin/main.** `.gitignore` named one
  build directory; scratch names did not match, and neither did Cargo's
  `target/`, which had been tracked all along. Widen the pattern and check
  its siblings; the bloat stays in history rather than rewriting it.
- **2026-09-30 git run without approval, three times.** `git stash` to compare against a clean tree, `git rm --cached` to drop a
  file, and on 2026-10-01 `git checkout` of nine `profile.json` files to undo a reformatting my own script had made (which
  would have discarded any uncommitted edit of theirs), all against the working rule that no git operation runs unless asked.
  Each was undone or harmless, but the index, the stash and the working tree are the maintainer's. Compare with `cp` to a
  scratch directory, delete with `rm`, and make a script's edit minimal instead of reformatting and reverting.
- **2026-09-17 a shell that killed itself, twice.** `pkill -f` matches its
  own command line; exit 144 with no output means the diagnostic murdered its
  runner. Kill by exact name or by port.

## Test-harness rules that persist in code

- Read the `Test Files` line and the exit code, not only `Tests`: an
  unparsable file runs nothing (**2026-09-16**).
- A guard must not depend on the thing it guards: suite wiring lives in
  `bin/check-suites.js`, outside vitest's include list (**2026-09-16**).
- Rebuild `web/app.bundle.js` immediately before any browser check, as part
  of the check (**2026-09-24**). With the service worker registered the page runs the
  cached bundle and plugin files: after a rebuild, unregister it and delete the caches
  (or the new code is never loaded and the check measures the old one) (**2026-09-30**).
- Two suites must not build into one folder: `tests/bin/docs-site.test.js` and
  `tests/docs/conventions.test.js` both rebuilt `docs-site/` at once and read each
  other's half-written pages. The builder takes `DOCS_OUT`, and each suite has its
  own (**2026-09-30**).
- Guards walk `git ls-files --cached --others --exclude-standard`, so new
  files are in scope before they are staged (**2026-09-17**).
- A MIDI connection is not an audio edge and overflow reports need a
  listener before there are routes: `observe()` on load, not on wire
  (**2026-09-17**).
- A rule about routing is not a rule about listening; a method setting up
  two things should be asked whether they share a condition (same entry).
