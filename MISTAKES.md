# Mistakes

What happened, root cause, prevention. Newest first.

## 2026-09-25 The adapter freed a chain the audio thread was still running

**What happened.** Loading a plugin while the transport ran crashed Reaper. Both native
wrappers published the new chain by atomic swap and freed the retired one on the spot,
so an audio thread mid-process on it was freed out from under itself. Found live, loading
Quefrency; why that plugin and not the others is thread history, not the plugin, and the
same swap would have crashed on any of them.

**Root cause.** An atomic pointer is publication, not reclamation: the swap says which
chain is current, and nothing in it says when the previous one stops being used. The
comment claimed freeing on the message thread made it safe; the thread doing the freeing
was never the question, the audio thread still holding the pointer was.

**Prevention.** The audio thread announces the chain it runs (`jigdaw/Publish.hpp`:
acquire/stable, release, retire, reap), the message thread retires rather than frees, and
reaping frees only what is not announced. `tests/publish_test.cpp` scripts the rule
deterministically: a retired chain held across a swap survives the reap and goes on the
next one. Both wrappers use the same three calls, so the second one cannot drift.

## 2026-09-24 Undoing the first change to a parameter did not undo it

**What happened.** Set Tremolo's Depth once, press Undo, and Depth stayed where it had been
set. The model, the AudioParam, the generated panel and the plugin's own editor all agreed on
the value being undone. Found by driving the new plugin editor in a browser. It predates the
editor: any first change to any parameter behaved this way.

**Root cause.** `UndoHistory.#restoreTo` walked the target snapshot's settings and set each one
that differed. The snapshot from before the first change has no setting for that parameter at
all, so nothing was walked, and the edit being undone was the one thing left alone. Every undo
test changed a parameter that already had a setting, from `addPlugin(IRI, { settings })`.

**Prevention.** A setting the live node has and the target lacks goes back to the plugin's
default, through a new `clearSetting` operation and `OpDispatcher.resetParameter`, which also
moves the AudioParam and tells every surface. The rack now draws an unset port at its default.
`tests/ops/OpDispatcher.test.js` "steps the first change to a parameter back to its default"
starts from a node with no settings, and was mutation tested by removing the reset.

## 2026-09-24 The message protocol required two things no frame can do at once

**What happened.** messaging.md 2.1 required the host to check `event.origin` and never to
address a message to `"*"`, and contract 9.1 required a sandboxed frame. The obvious sandbox,
`allow-scripts` alone, gives the frame the opaque origin `"null"`, and the only target a
message to it can have is `"*"`. Found when building the first plugin editor. It had been
normative since phase 0 without anything implementing it.

**Root cause.** A specification written before any implementation, and one that stayed
unimplemented, so nothing tested its claims.

**Prevention.** Resolved in the documents and the code together: `allow-scripts
allow-same-origin`, with the UI served from an origin other than the host's and refused when it
is not (contract 9.1, messaging.md 2.1, `src/ui/PluginFrame.js`). The one message sent to `"*"`
is the UI's contentless `ready`, which is now said explicitly. The frame's fake window in
`tests/ui/PluginFrame.test.js` throws on `"*"`, so a host that reverted to it fails there,
which was checked by making that change.

## 2026-09-24 Every session saved before a loop was set was invalid against the shapes

**What happened.** A new project's transport has `loopStart 0` and `loopEnd 0`, and
`ProjectWriter` wrote both unconditionally. `TransportShape` says a loop starts before it ends
(`sh:lessThan jig:loopEnd`), so every session saved from a page where nobody had set a loop
failed validation. Found while adding tracks, by a new test that opens a session with no
transport, writes it back and validates the result.

**Root cause.** Every round-trip test built its project with a loop set, `loopEnd: 32`, so the
writer's output was only ever validated for the one transport that was not the default. The
default was the case a person actually saves.

**Prevention.** The writer leaves the bounds out unless they describe a loop, and the reader
already supplies the defaults. `tests/rdf/ProjectRoundTrip.test.js` "a session saved before
tracks" validates a written project whose transport was never touched. A fixture that fills in
every field tests the writer against the one case nobody meets first.

## 2026-09-24 Two instances of one plugin gave every control an id the other also had

**What happened.** `createPanel` built control ids from the plugin IRI and the port symbol.
Two Pulse instances on one page, which tracks make ordinary, produced ten duplicate ids: each
second label pointed at the first instance's knob, and `preserveFocus` could put the focus
back on the wrong plugin. Found in a real browser by listing duplicate ids after loading Pulse
twice. It predates tracks; loading one plugin twice had always done it.

**Root cause.** An id is per element on a page, and the IRI is per plugin. The panel tests
built one panel at a time, so no test ever had two panels on one page to collide.

**Prevention.** `createPanel` takes a `scope`, and the page passes the node id.
`tests/ui/Panel.test.js` builds two panels from one profile, checks no id repeats and checks
every label still finds its control in its own panel, and checks that `drawSlot` passes the
scope. Mixer strips take their ids from the track for the same reason, and
`tests/ui/Mixer.test.js` checks two tracks with one name share no id.

## 2026-09-24 A mixer that rebuilt itself on every edit took the focus from the button just pressed

**What happened.** The first `src/ui/Mixer.js` emptied its container and appended the cached
strips again on every draw. The strips were the same elements, so it looked like focus would
survive. It did not: taking a focused element out of the document blurs it, so pressing Mute
by keyboard left the focus on the body. Every unit test passed, because linkedom has no focus
to lose.

**Root cause.** "The same element is put back" was reasoned about rather than measured, which
CLAUDE.md already warns about for the pointer and the focus.

**Prevention.** The mixer only replaces its children when the list of tracks changes, and
otherwise updates headings and strips in place. `tests/ui/Mixer.test.js` counts
`replaceChildren` calls across a redraw that changes only a strip's state. The browser check
read `document.activeElement` after a click on Mute. That check first gave a false failure,
because the button was on the hidden Mixer tab and could not take focus at all.

## 2026-09-24 A guessed port reached the real Web Audio graph as an uncaught exception

**What happened.** The first version of `reorderNode` (dragging a plugin in the rack to a new
position, rewiring the chain to match) spliced the moved node into whatever direct connection
joined its new neighbours, guessing `portIndex: 0` on the moved node's own end because
neither neighbour's port layout says anything about a third plugin's. Moving Pulse (an
instrument, `audioInputs: 0`) into a position that fed it audio threw `IndexSizeError: Failed
to execute 'connect' on 'AudioNode': input index (0) exceeds number of inputs (0)`, uncaught,
from inside `OpDispatcher.apply`'s `#rebuildLinks`, on a real render, past every check
`addConnection` normally goes through.

**Root cause.** `OpDispatcher.apply`'s own comment already states the layering this violated:
"the model checks the shape of an endpoint and cannot check more... The engine has the
profiles... So the check belongs here." `reorderNode` lives in `Project.js`, the model layer,
which has no profile and so cannot know whether port 0 is valid for the node it was guessing
onto. The guessed connection reached `#rebuildLinks` and the real `AudioNode.connect` with no
layer in between ever having the information needed to refuse it first. Found immediately by
testing the feature end to end in a browser rather than only against `Project.test.js`, whose
model-level assertions could not see the engine-level failure at all.

**Prevention.** The splice was removed rather than guarded: a node moved to a new position is
left unwired there, exactly like a freshly added one, for a person to connect deliberately.
Healing the gap the node leaves (`reorderNode`'s other half) was never at risk the same way,
because it only ever reuses a connection's own existing, already-validated endpoints, the same
pattern `removeNode`'s heal already used safely. `tests/model/Project.test.js` now asserts the
splice does not happen. A general fix, letting `OpDispatcher` catch an internally-synthesized
connection's engine-level failure the way it already catches one from an external changeset,
was not attempted; nothing else in the codebase currently has a way to manufacture a connection
this route would need to guard against.

## 2026-09-24 A native adapter that loaded every plugin except the one using SIMD

**What happened.** Ferrite, hosted in [transmission](https://github.com/danja/transmission),
loaded and ran in every browser host but failed to instantiate in the native
`jigdaw-adapter`. The module declares `jig:Simd128` and passes every check up to
instantiation; wasm3, the WebAssembly runtime `src/Module.cpp` used through phase 9b, does not
implement the WebAssembly SIMD proposal, so a module compiled with SIMD instructions is not
one it can run at all, not one it runs slowly.

**Root cause.** `jig:Abi1` names an ABI, not a runtime, and nothing checked that the runtime
behind the native adapter implemented every WebAssembly feature a conforming module might use.
Capability negotiation (`jig:Simd128` among them) tells a browser host what to offer; it does
nothing for a native host whose "WebAssembly support" turns out to be partial.

**Prevention.** `src/Module.cpp` now runs modules through
[WAMR](https://github.com/bytecodealliance/wasm-micro-runtime) instead of wasm3, which
implements SIMD. Documented in
[native/jigdaw-adapter/README.md](native/jigdaw-adapter/README.md) under "Why WAMR rather
than wasm3", so a future native host developer checks their runtime's SIMD support before
assuming a browser-verified module will load.

## 2026-09-24 A browser check ran a bundle built before the last change

**What happened.** Checking Ferrite in Chrome, the page offered only `jig:Simd128`, though
`src/host/Capabilities.js` by then probed four WebAssembly features. `web/app.bundle.js` had
been rebuilt after the first probe was added and not after the other three. The third time in
two days this session has tested a stale bundle; the first two are in the Ferrite state entry.

**Root cause.** The bundle is built by hand and nothing ties it to its sources, so "rebuilt"
means "rebuilt at some point", not "rebuilt after the last edit".

**Prevention.** Run `npm run build:web` immediately before any browser check, as part of the
check rather than of the change. It was caught here only because the check read what the page
offered rather than only whether the plugin loaded.

## 2026-09-24 A test of ordering that the reader's own order already satisfied

**What happened.** A test that sessions open in signal order listed the nodes in reverse and
expected `a` before `b`. It passed with the ordering code removed, because the reader returns
nodes alphabetically and `a` feeds `b`. Found by removing the code and watching nothing fail.

**Prevention.** A test of an ordering has to start from an input where the naive order is the
wrong one, and assert that it is before asserting the result.

## 2026-09-23 A mutation test of a plugin proved nothing, because the digest refused it first

**What happened.** Mutation testing Squelch's tests, each of three edits to
`plugins/squelch/squelch-processor.js` (no resonance, no envelope, no output clip) turned
every DSP test red at once, which reads as a strong result and was not one. The profile
declares the processor's sha384, so every mutated processor failed its integrity check and
never loaded. The tests failed for a reason none of them was written to detect.

**Root cause.** A mutation of a digested artefact changes two things, the behaviour and the
digest, and only the first was the point.

**Prevention.** After mutating anything a profile declares a digest for, regenerate the
profile (`./build.sh`) before running the tests. The sign to look for is a mutation that fails
every test rather than the one it targets: a good mutation fails exactly one. Rerun that way,
each of the three failed exactly its own test.

## 2026-09-23 Restoring Ferrite's saved state detached its own audio views

**What happened.** Adding runtime asset loading and session-state restore to `plugins/
ferrite/ferrite-processor.js`, a test that restored a saved `.nam` into a freshly instantiated
node failed with `Cannot perform %TypedArray%.prototype.set on a detached ArrayBuffer`, thrown
from inside `process()` itself, nowhere near the code that had just run.

**Root cause.** `instantiate()` loaded the shipped default assets, took `inputViews` and
`outputViews` over the module's memory, and only then applied a restored session's state as a
separate step. Restoring a `.nam` calls `jig_load_nam` again, which asks `nam-rs` to allocate
a second `Model`; if that allocation needs more than the module's current linear memory
already has, the module grows its own memory, and `docs/module-abi.md` says exactly what that
does: "growing invalidates every [view] the host is entitled to hold." The `Float32Array`s
taken a few lines earlier were already invalid by the time `process()` next read them.

**The same hazard exists after `ready`, not only during `init`.** `onLoadAsset`, a person
loading a bigger model from the running plugin's own panel, calls `jig_load_nam` exactly the
same way and can grow memory exactly the same way, at a point views were taken long ago and
have been used correctly ever since. The ABI's "must not grow after init" is a rule for
`jig_process`; a reload requested from outside it is precisely the case that rule does not
cover, and nothing about it being requested later makes the JavaScript side's held views any
safer.

**Prevention.** State is now applied inside `instantiate()`, before views are taken rather
than after, for the load path. For every path, `refreshViews()` re-reads
`exports.memory.buffer` and every pointer after any call that might have grown memory,
`instantiate()`'s own default-and-state loading and `onLoadAsset`'s runtime reload alike,
rather than assuming a view taken once stays valid. Pointers themselves do not move when
memory grows, only the buffer object they are read against does, which is what makes
re-deriving the views cheap enough to do unconditionally rather than only when something
detects growth actually happened. Caught by the test that exercises the restore path for
real, not by reasoning about it: the fix was written, and confirmed, only after watching the
exact failure the hazard predicts.

## 2026-09-23 A CMake build tree reached origin/main

**What happened.** Building a JUCE-hosted second adapter alongside the DPF one
(`native/jigdaw-adapter/src/juce/`), two scratch configure/build passes were run into
`native/build-default/` and `native/build-juce/` to test the default (non-JUCE) path and the
new JUCE path separately. Something then ran `git add -A && git commit` and pushed while both
directories existed on disk, landing 621 build-tree files (CMake caches, object files, a 14MB
Standalone executable, `.a` static libraries) in a single commit, "JUCE-based wrapper"
(673a95c), already on `origin/main` by the time it was noticed.

**Root cause.** `.gitignore` excluded exactly `native/build/`, the one name
`native/install.sh` and every documented workflow ever produces. Naming the two scratch
configurations `build-default` and `build-juce`, to keep them apart from a normal build and
from each other, meant neither matched. A guard that names one path is a guard that ignores
the population outside it, the same shape as every other guard-width mistake in this file:
the rule that mattered was "nothing under `native/build` should ever be tracked", and the
pattern only said "this one directory named exactly that".

**Prevention.** `.gitignore`'s entry widened from `native/build/` to `native/build*/`, so a
differently named scratch build is excluded by the same rule rather than needing its own
line remembered in the moment. The 621 files were removed from tracking in a follow-up
commit rather than by rewriting `673a95c`'s history, which would have needed a force-push to
a branch already fetched elsewhere; the bloat stays in history, once, rather than the
repository's public history being rewritten to remove it.

**The same guard-width mistake was already sitting in the repository, older and wider.**
Checking `plugins/*/build/` (added above) against every plugin directory while adding
`plugins/ferrite/`, `git ls-files` turned up 86 already-committed files under
`plugins/bassgen/target/`, `plugins/cascade/target/`, `plugins/dynamix/target/`,
`plugins/pulse/target/` and `plugins/_jsfx-runtime/target/`: Cargo's own build directory,
named `target` rather than `build`, which nothing in `.gitignore` excluded at all. Not new
today, just never looked for: five real plugins had been carrying their build artifacts in
git the whole time, silently, because nothing had ever measured tracked file counts against
what should be there. `plugins/*/target/` added, the 86 files untracked in the same commit as
the fix. The lesson generalises past this one repository: a `.gitignore` pass prompted by one
incident is the moment to check siblings of the pattern that caused it, not only the exact
path that did.

## 2026-09-19 Only sixteen of the 8-Bit 8asterd's 42 controls reached Reaper

**What happened.** Reported by the user: loading the 8b8 through the JigDAW Adapter in
Reaper, only a fraction of its controls showed.

**Root cause.** `JIGDAW_PARAMETER_COUNT` in `src/dpf/DistrhoPluginInfo.h` is a compile-time
constant declaring how many generic parameter slots the DPF wrapper offers a host, fixed at
plugin construction, before any JigDAW chain is loaded: `Plugin(kParameterCount, 0, 2)`. It
was 16, chosen when Cascade and Pulse (five parameters each) were the only worked plugins.
`jigdaw::Chain::parameters()` flattens every loaded plugin's ports into one list with no
bound of its own, so a host was told about slots 1 to 16 and the 8b8's ports 17 to 42 simply
had no parameter to answer to: not dropped, not reported, just never asked about.

**Why it had not been noticed.** Every native test loads Pulse, Cascade, BassGen and Dynamix,
none of which reaches sixteen. The 8b8 is tested in `tests/dsp/8b8.test.js` (the WebAssembly
module) and `tests/host/integration.test.js` (the browser host), both of which read every
parameter by name and neither of which goes anywhere near the native adapter's own fixed
slot count. Nothing connected the two: a bug specific to native hosting a plugin whose
Rust/C++ module is fine, in the one layer the JavaScript tests cannot reach.

**Prevention.** Raised to 128, which covers the 8b8 alone with room to spare and even covers
every `jig:abi`-declaring plugin here loaded in one chain (79). `tests/
parameter_count_test.cpp` loads the 8b8 through `jigdaw::Chain` over `file://` and asserts
its parameter count fits within `JIGDAW_PARAMETER_COUNT`, so the next plugin that outgrows it
fails a build instead of a user's session. Verified by running it against the unfixed
constant first: "42 parameters, 16 slots declared to the host", failed as expected; passed
after the fix.

**Fixed the same day, once DPF was found.** The adapter's own NanoVG panel
(`JigdawUI::drawPanel`) drew each loaded plugin's ports in a fixed-height list with no
scrolling, breaking out once a row would fall outside the window: roughly ten fit in the
default 760x560 size, and nothing said the other 32 of the 8b8's 42 existed. Left open at
first because DPF was not checked out in this environment and a UI patch nobody has watched
render is a worse risk than leaving the gap documented. The user pointed at
`~/github/downspout/third_party/DPF`, which built the real VST3, CLAP, LV2 and a standalone
JACK executable immediately.

`panelScroll_` now tracks the topmost visible port; `onScroll` moves it by the wheel, arrow
keys move it enough to keep the selection visible (`revealSelected`), and a clicked or
dragged control maps back from its drawn row to the absolute port index it actually is
(`row = which - panelScroll_` in `setFromX`, the reverse in `pressPanel`), which is the part
a screenshot cannot check by itself: a control that moves the parameter next to the one you
clicked is a worse bug than one that does not scroll at all. A "12-20 of 42" readout and a
minimal scrollbar say what is not on screen, which the list view already had no equivalent
gap to be caught missing.

Verified running, not only compiling: launched the standalone JACK build on a virtual X
display (`Xvfb`, kept separate from the real one so nothing opened on the user's actual
desktop), loaded the 8b8 over the network, and drove it with `xdotool` and `import`
screenshots. Confirmed the list now reports "params 1-42" where it read "params 1-16" before;
confirmed the panel scrolls to "34-42 of 42" and clamps exactly there, not short and not past
it; confirmed a click on "Tuning: Temperament" while scrolled to rows 34-42 set that control
and not some other one; confirmed arrowing down past the visible window scrolls to follow the
selection. `ctest` and `npm test` both still pass in full afterward.

## 2026-09-19 A channel strip on a plugin with no channel to strip

**What happened.** Every node in the rack got a Level knob, a Pan knob, a Mute button and a
Solo button, including BassGen, which declares `jig:audioOutputs 0` and produces MIDI only.
Asked whether a plugin that generates no audio needs Pan and Level; tracing where those two
controls actually go found that none of the four did anything for such a node, not only the
two that were asked about.

**Root cause.** `Engine.adopt` only builds a gain and pan stage `if (profile.audioOutputs > 0
...)`, so a MIDI-only node's engine entry has `strip: null`. `Engine.setChannel` already knows
this and refuses politely, `if (!entry.strip) return`, before it touches gain, pan or the
silence flag mute and solo turn into. So the strip's own state (`node.channel.gain`, `.pan`,
`.muted`, `.soloed`) was tracked in the model, drawn in the interface and pressed by a person,
and never reached anything with a signal to change. `drawRack` in `web/app.js` had no
equivalent check: it built and appended the strip for every node unconditionally.

**Why it had not been noticed.** The strip looks identical whether or not it does anything.
Level and Pan report a number and move under the pointer regardless, and Mute and Solo flip
`aria-pressed` regardless, so nothing about interacting with any of the four says whether the
node they belong to can be heard at all, unlike everything else on that node's slot.

**This is the second time a control has been shown that could not be used.** The port bar
found the same shape a day earlier, forty four buttons of which forty three were disabled
modulation targets, and the fix there was to stop drawing the ones that could not be pressed
rather than disable them in place. The same rule now applies one control group over: a
control nobody can use is left out, not shown inert.

**Prevention.** `drawRack` now builds the strip only when `(profile?.audioOutputs ?? 1) > 0`,
the same condition `Engine.adopt` already used to decide whether to build one, read rather
than re-derived so the two cannot drift apart. `tests/ui/Strip.test.js` binds them: one
assertion that the guard exists and is not inverted, one that it names the identical
threshold Engine.js uses, one that a strip cached from before the fix is dropped rather than
left showing. Mutation tested by removing the guard and by widening it to `>= 0`; both were
caught. Verified in Chrome: BassGen and Pulse loaded into the same chain, BassGen's slot runs
straight from its heading into its own parameters, and Pulse keeps its strip.

## 2026-09-19 A panel that never heard about a change made anywhere but itself

**What happened.** Setting a parameter through the WebMCP surface applied correctly to the
model and the `AudioParam`, and the generated panel kept showing whatever it had shown before:
Cascade's Mix read its declared 0.30 after being set to 0.83. Found earlier in this project
and left as an open item rather than fixed at the time.

**Root cause.** `drawRack` in `web/app.js` only ever told a panel about a new value through the
panel's own `onChange` callback, which fires when a person moves the control. Nothing pushed
the model's own record of a node's settings into the panel from the other direction, so a
panel fetched from the `panels` cache on a later redraw showed whatever it had last been told
directly, and a freshly created one showed the port's declared default. Neither is what the
project actually has: `node.settings`, a `Map` the dispatcher updates on every successful
`setParameter`, already carried the right answer and nothing read it back out.

**Why it had not been noticed.** Every value change that had been tested came from the panel
itself, which is self-consistent by construction: the control that changed a value is the same
control asked to display it. The gap only shows up when something else changes a value the
panel is already open on, which a saved project reopening, a MIDI mapping and WebMCP all do
and a person turning a knob does not.

**Prevention.** `drawRack` now iterates `node.settings` and calls `panel.update(symbol, value)`
after the panel exists, cached or fresh, on every redraw. `tests/ui/Panel.test.js` checks the
wiring in the source, the same way `tests/ui/Focus.test.js` already checks that `drawRack`
calls `preserveFocus`: one assertion that the push exists, and a second, separate one that it
sits outside the `if (!panel)` branch a freshly created panel takes, because a mutation that
moved it inside that branch still passed the first assertion and is the exact shape the
original bug had. Verified in Chrome afterward: the knob's position, its readout and its
`aria-valuetext` all move together when a value is set from WebMCP. The channel strip was
checked and needed nothing: `strip.update` already ran unconditionally on every redraw.

## 2026-09-19 A connection to a port that was not there

**What happened.** Found while checking that BassGen no longer draws a keyboard. Loading
four plugins in a row left the 8-Bit 8asterd with a header, a channel strip and no panel at
all, and the next change threw:

    IndexSizeError: Failed to execute 'connect' on 'AudioNode':
    input index (0) exceeds number of inputs (0)

**Root cause.** `web/app.js` chains each plugin to the one before it, so loading Cascade and
then the 8b8 asked for an audio edge into a plugin that declares `jig:audioInputs 0`. The
model accepted it: `checkEndpoint` in `src/model/Project.js` validates the shape of an
endpoint and has no profiles to check it against, deliberately, because a project is
loadable before its plugins are. The engine has the profiles and found out by throwing out
of `AudioNode.connect` while rebuilding the links, after the change was committed. The
throw escaped `loadPlugin` before its final `drawRack()`, which is why the slot was half
drawn: the state was fine and the render had stopped halfway.

**The question "which ports has this node got" existed in exactly one place**,
`src/ui/Routing.js`, where it drew the buttons, and the dispatcher could not reach it. So
the interface offered only edges that exist and the dispatcher accepted any edge at all,
which is the same rule in one layer and not the next.

**Prevention.** `outputsOf`, `inputsOf` and `compatible` moved to `src/model/Endpoints.js`,
with `Routing.js` re-exporting them so nothing that draws a port bar changed. The
dispatcher refuses an `addConnection` whose ends name ports the nodes have not got, before
the model commits anything, with a message that says what the node does have.
`web/app.js` chains only where both ends have a compatible port, which is not an error and
is not logged as one.

**Two tests were asserting the broken behaviour**, which is how far this had got. The
compensation test in `tests/host/integration.test.js` connected into Cascade's audio input
1, and Cascade has one input; the MIDI routing test connected a MIDI edge out of Pulse, and
Pulse declares `trn:produces trn:Audio` and nothing else, so nothing would ever have been
delivered along it. Both were rewritten to the shape they were describing, the second with
BassGen as the source because BassGen is the plugin that produces MIDI.

## 2026-09-19 A keyboard on a plugin that makes no sound

**What happened.** BassGen was drawn with two octaves of on-screen keys. It produces MIDI
and declares `jig:audioOutputs 0`, so pressing one made nothing happen.

**Root cause.** `web/app.js` had the right intent written in a comment, "an instrument gets
a keyboard, so it can be played", and the wrong test underneath it: `accepts` includes
MIDI. BassGen accepts MIDI so that its `follow` parameter can take a root note from
whatever is playing, which is a different thing from being played. The comment and the
condition disagreed and the comment was correct, which is the least visible way for this to
go wrong.

**Prevention.** `src/ui/Keyboard.js` now exports `playable(profile)`, which asks both
halves: does it take notes, and does it make a sound. `tests/ui/Keyboard.test.js` walks
`plugins/` and checks the verdict for every committed profile, and separately checks that
the verdict is the conjunction rather than either half, so a change that drops one fails
with a reason instead of with a list. Steering BassGen from a keyboard still works, through
a MIDI connection into its MIDI input, which is where a MIDI input's notes should come from.

## 2026-09-19 Forty four buttons that could not be pressed

**What happened.** The block between the mixer and the controls was the port bar: the
outputs and inputs a connection can be made from and to. Asked to remove it as serving no
purpose, which from the screen it did not, because on the 42 parameter instrument 43 of its
44 buttons were modulation targets and every one of them was disabled. It is the only way
to make a connection in the application, so removing it would have removed patching.

**Root cause.** A comment in `src/ui/Routing.js` says the inputs are "disabled rather than
hidden while something is selected, so the shape of what is possible does not change under
the pointer". That is a good rule about a gesture in progress, and it had been applied to
the resting state too, where there is no gesture and nothing can be pressed. The rule was
right and its scope was wrong, which is the same shape as the guards further down this
file.

**What was done.** The inputs are drawn only while an output is chosen, which is the only
time any of them can be used. At rest the bar is the one output button. The `rdfs:comment`
paragraph went with it: the browser and the catalogue both show it where somebody is
choosing a plugin, and the rack is where they are playing one. The slot header went from
around 560 pixels to 57, and the page from 1940 to 1451.

**Prevention.** `tests/ui/Routing.test.js` states the new rule, checks the inputs all appear
the moment an output is picked, and checks that a plugin with inputs and no outputs is not
reported as having no connectable ports, which counting the drawn buttons would have said.
Picking an output also rebuilds the rack, so the port buttons were given stable ids and
`src/ui/Focus.js` now keeps the keyboard on the button that was just pressed. Measured in
Chrome: focus stays on the output across both the reveal and the cancel.

## 2026-09-19 Two faults a DOM without layout cannot have

**What happened.** The generated panel's sliders became rotary knobs, to fit a 42 control
plugin on a screen instead of on two thousand pixels. `tests/ui/Dial.test.js` passed with 20
assertions, covering the range element, the drawing, the drag and the class names. The knob
was then opened in Chrome and two things were wrong, neither of them reachable from vitest.

**A drag tracked only to the edge of the knob.** `setPointerCapture` is the API for
continuing a drag outside the element it started on, and it threw on the pointerId Chrome
handed it. A throw inside the `pointerdown` handler takes the rest of the handler with it,
so the focus call after it never ran either, and the symptom was a value that moved by a
fifth of what the hand asked for. Fixed by not using capture: the move and the release are
listened for on the document, which always has them.

**One arrow key worked and the second went to the body.** Not the knob's fault and much
older than it: `drawRack` in `web/app.js` empties the rack and rebuilds it on every project
change, a parameter change is a project change, and emptying a container blurs whatever was
focused inside it. Every generated control has been nudgeable exactly once by keyboard for
as long as that has been true, which is WCAG 2.1.1 gone across the whole interface. A
pointer never sees it. Fixed by `src/ui/Focus.js`, which notes what was focused and puts it
back by id after the rebuild.

**Root cause.** Both are properties of a real renderer. linkedom has no pointer capture to
fail and no `activeElement` to lose, so the first was invisible and the second was not
expressible. AGENTS.md already says to measure a narrow layout in a browser rather than
reason about it; the same is true of anything to do with the pointer or the focus, and the
knob happens to be made of both.

**A third thing, which I stopped short of and was asked about.** The knobs went into
`Panel.js`, which draws plugin parameters, and not into `Strip.js`, which draws the host's
own level, pan, mute and solo. The distinction is real and is written at the top of both
files: no `lv2:port` declares a channel strip. It is also not what anyone sees. The page had
knobs for the plugin and full width sliders for the mixer directly above them, and read as
two interfaces. Asked about, and fixed by sharing the widget while keeping the distinction:
`Strip.js` now calls `createDial` and still is not a panel. The lesson is that an internal
boundary is a reason to share carefully, not a reason to look inconsistent.

**Prevention.** Both now have tests that would have caught them given the knowledge:
`tests/ui/Dial.test.js` dispatches the move and the release on the document rather than on
the knob, which is what a real drag does, and fails if the source reaches for pointer
capture at all. `tests/ui/Focus.test.js` covers the helper and checks that `drawRack`
captures before it empties and restores after it rebuilds. The wider lesson is in AGENTS.md:
the browser check is not only for layout.

## 2026-09-19 A guard that compared a label to a directory name

**What happened.** Adding `plugins/8b8/` broke two tests that had nothing to do with it, and
both broke for the same reason: a list they walked was narrower than the thing they checked.

`tests/catalogue/LocalCatalogue.test.js` asserted that the catalogue finds every plugin, and
its own comment explains why it reads `plugins/` instead of naming them: "a list in a test
that names the plugins is a list that goes stale the day one is added". It then compared
`entry.label.toLowerCase()` against the directory name. That is a different claim, and it
held for three plugins by coincidence: cascade, pulse and bassgen are each labelled after
their directory. `plugins/8b8/` is labelled "8-Bit 8asterd". The guard was right about the
population and wrong about the field, which is the same failure one level in. Fixed by
comparing the IRI, read from each profile.

`src/ui/Panel.js` knows four units, `hz`, `ms`, `db` and `s`, and looks a port's unit up in
that table to print and to speak it. A unit missing from the table is not an error anywhere:
the control renders a bare number, the screen reader reads a bare number, and nothing reports
it. The 8b8 declares `units:pc` and `units:semitone12TET`. AGENTS.md's accessibility rule is
explicit that "4200" and "4200 Hz" are different information, and there was no test binding
the units any plugin declares to the units the panel knows.

**Root cause.** Both are the shape already named twice in this file: a guard is only as wide
as the list it walks. Adding the first plugin that is not like the others is what found them,
and nothing else would have.

**Prevention.** `tests/ui/Panel.test.js` now walks `plugins/` and fails on a unit neither
table knows, and fails separately if the two tables disagree with each other. Both were
mutation tested by deleting `units:pc` and watching them go red. `README.md` now states the
number of worked plugins as a figure, and `tests/docs/conventions.test.js` counts the
directories and fails on any document that disagrees, which found three more stale sentences
in two files.

**Also worth naming.** The port is of somebody else's firmware, and it surfaced two bugs in
it that hardware hides: a register cache whose flush window is always free on a Leonardo and
never free in a host, and a reset that leaves the chips ramping to full scale sixteen seconds
later. Both are measured and worked around in `plugins/8b8/8b8.cpp`, described in
`plugins/8b8/README.md`, and recorded for upstream in `HUMANS.md`. Neither is a mistake made
here; they are here because the fix lives here.

## 2026-09-18 The container worker worked only on the page that tested it

**What happened.** Foreign plugins loaded perfectly in `web/foreign/probe.html` and not at all
in the application. Two separate faults, both invisible to the probe.

**First, the load hung forever with no error.** `ForeignOrigin.start()` awaited
`navigator.serviceWorker.ready`, which resolves for the registration whose scope contains the
*current page*. The worker is scoped for the container path and the application is at `/`, so
nothing controlled it and that promise never settled. Fixed by waiting on the registration's
own worker reaching `activated`, with a timeout, so a stall is reported rather than silent.

**Then the entry point 404ed.** A service worker only intercepts requests from clients it
**controls**, and a client is controlled when its own URL is inside the registration scope.
Scoping to `/foreign/` meant the application's requests never reached the worker at all. Fixed
by registering for the whole origin, with `Service-Worker-Allowed: /` from `bin/serve.js`, and
keeping a fixed `/foreign/` prefix inside the worker to decide what it answers for. Scope and
prefix are different things and conflating them was the bug.

**Why the probe could not see either.** `web/foreign/probe.html` is itself inside `/foreign/`.
It was controlled, `ready` resolved, and its imports were intercepted. **The only thing
exercising this code was the one page where both faults are invisible**, which is the
recurring shape in this file: a guard whose population is narrower than the thing it guards.

**Prevention.** Neither is caught by a test in this repository, because neither a service
worker nor a second page is reachable from vitest, and that is stated rather than papered
over. What would catch them is a probe served from outside the container prefix, which is the
configuration the application actually uses. Recorded in TODO.md.

**A third thing, which was not a defect at all, and which I reported as one.** With both fixed,
the application reached consent and then the load neither resolved nor rejected. I recorded
that here and in TODO.md as an undiagnosed hang in the load path. It was not one.

The browser tab had become `document.visibilityState === "hidden"`, and Chrome grants no user
activation to a hidden tab: `navigator.userActivation.hasBeenActive` was false however many
times it was clicked, so `AudioContext.resume()` never settled and everything downstream of it
waited forever. Confirmed by re-running `web/foreign/probe.html`, which had passed 18 of 18
an hour earlier on the same code and now produced no results at all, because the click never
reached its handler.

**The lesson is about reporting, not about audio.** I had a symptom, no error, and an
unverified guess, and I wrote the guess into the permanent record as a defect in the code. A
hang in a browser has an environment on one side of it as well as a program, and "not
diagnosed" should have meant exactly that rather than an entry implying where the fault lay.

`loadForeignPlugin` now wraps every stage in a named timeout, so a hang says which stage
stopped instead of nothing at all. That is worth having either way, and it is what would have
told me in one run that no stage was stuck.

## 2026-09-18 The live site served the whole repository, including .git

**What happened.** `bin/serve.js` served any path from the repository root when it was not
under `web/`. Measured against strandz.it: `/jigdaw/package.json`, `/jigdaw/AGENTS.md`,
`/jigdaw/.gitignore` and `/jigdaw/.git/HEAD` all answered 200, and `/jigdaw/.git/index` with
them, which is enough to reconstruct the repository.

**Root cause.** The static fallback was `[safeResolve('/web' + path), safeResolve(path)]`. The
second candidate is what makes `/src/host/ForeignLoader.js` and `/plugins/pulse/pulse.wasm`
work, and it was written to serve exactly those. Nothing limited it to them, so it served
everything else too.

**Why it had not been noticed.** Nothing in this repository is secret, so no test asking "is
this file served" would have looked wrong, and the deployment is a `git pull`, so `.git`
being present on the server is the normal state rather than an accident. The exposure is not
that today's tree leaks something; it is that the server's behaviour was "serve whatever is on
disk", and gitignore is precisely where a key would be. `bin/keys.js` refuses to write a
private key inside a git working tree, which was the only thing standing between that
convention and this server.

**How it was found.** By a test I wrote for something else. A new `/keys/<name>` route needed
an assertion that it takes a name rather than a path, and `/keys/../package.json` returned 200.
The route was fine; the fallback behind it was not.

**Prevention.** An allowlist, `SERVED_FROM_ROOT`, rather than a denylist, because a denylist is
a list of the mistakes somebody already thought of. Any segment beginning with a dot is
refused wherever it appears. `tests/server/cors.test.js` asserts twelve specific paths are
refused and that everything the page and the plugins need still works, because an allowlist
that is too tight breaks the site quietly. Mutation tested: restoring the old line fails nine
assertions.

## 2026-09-18 Every generated profile had blank nodes in it, for six phases

**What happened.** The first attempt to sign a real plugin failed immediately:
`cannot canonicalise a graph containing a blank node (_:b1)`. `bin/write-profile.js` had been
writing every `lv2:scalePoint` as `[ rdfs:label "Saw" ; rdf:value 0 ]` since phase 2, so all
three worked plugins and `examples/reference-profile.ttl` contained them. Three per enumerated
port, and bassgen has thirty nine.

**Root cause.** AGENTS.md has said since phase 0: no blank nodes for anything addressable,
skolemise as a fragment of the containing document's IRI. Nothing checked it. A scale point is
addressable, it is what the generated selector's options come from, and it was written as a
blank node because that is what the shorthand makes easy.

**Why it had not been noticed.** Nothing had ever needed a stable name for one. The reader
reads objects of `lv2:scalePoint` and does not care what kind of node they are, the shapes had
no constraint on them, and a blank node is invisible in a profile that is only ever read
forwards. It became a defect the moment the profile had to serialise the same way twice.

**Also found.** No test read a committed profile through `createPanel`. Every panel test built
its ports by hand, so a change to the profile writer could have emptied every selector in the
application and the suite would have stayed green. That is the recurring shape: the rule was
right and the population it was checked against was smaller than the rule.

**Prevention.** `tests/rdf/Canonical.test.js` walks every tracked `.ttl` and canonicalises it,
which fails on any blank node anywhere. `vocabs/shapes.ttl` is the one exemption and says why.
`tests/ui/Panel.test.js` now walks `plugins/` and asserts that the options in the generated
panel are the scale points the profile declares. Both were mutation tested by breaking the
thing they guard and watching them go red.

## 2026-09-18 Two instances of one plugin had one name between them

**What happened.** The routing view listed two different connections as the same sentence:
"Pulse out 1 to Cascade in 1", twice. Both disconnect buttons were announced identically to a
screen reader. The two edges went to two different nodes.

**Root cause.** A node's label comes from its plugin's profile, and the project format says in
as many words that two instances of one plugin are two nodes with the same `jig:plugin`. So a
duplicate label is the ordinary case, not an edge case, and every surface that named a node by
its label alone was ambiguous the moment anybody loaded a second reverb.

**Why it had not been noticed.** Nothing before this drew relationships *between* nodes. The
rack listed them in order, where two identical titles read as two identical things rather than
as a question about which was which. It became a defect the moment the interface started saying
"from this one to that one".

**Prevention.** The page numbers a name only where it is shared, so the common case stays
"Cascade" and never becomes "Cascade 1" on its own. The rack title, the channel strip, the port
bar and the connection list all take the resolved name, because two names for one node is the
same bug wearing a different hat. `tests/ui/Routing.test.js` asserts that two edges to
different nodes produce two distinct rows and two distinct button labels.

**The general shape.** A name that is unique in practice is not a key. Ask what happens when
two of the thing exist, and if the answer is "they look identical", the display needs something
the model already has, which here was the node id.

## 2026-09-18 A saved mix was written, read, and thrown away in between

**What happened.** Nodes gained a channel strip: gain, pan, mute, solo. The writer wrote it,
the reader read it, the round trip test passed, and reopening a session in the browser brought
every channel back at unity, centre, unmuted. The saved file was correct the whole time.

**Root cause.** `OpDispatcher.addPlugin` enumerated the fields it forwarded to `addNode`:
`{ position, id, label }`. The page's restore path goes through it, so the day a node gained a
fifth field that list was silently one short. Nothing failed, because dropping a field looks
exactly like a file that did not have one.

**Why no test caught it.** Every test either built a node or read one. The round trip covered
writer to reader, the dispatcher suite covered adding a plugin, and the path the page actually
takes on reopen, reader to `addPlugin` to model, was the join between them and had no test at
all. It is the same shape as the capability that was minted, required, enforced and never
offered: each link checked, the chain not.

**Prevention.** `addPlugin` passes the change through rather than listing its parts, so
whatever `addNode` understands survives. The guard compares a node built directly against one
built through `addPlugin` **field by field, over the keys the model produces**, so it covers
the next field without anybody remembering to add it. Mutation tested by restoring the
enumeration.

**The general shape.** A function that lists the fields it forwards is a paired file with the
structure it forwards them to, and nothing connects them. Prefer passing the thing through.
Where that is not possible, compare against the structure rather than against a list.

## 2026-09-18 Nothing in the compiled graph was connected to the speakers

**What happened.** `Engine.connect` and `Engine.link` both resolved a destination of `output`
to the audio context's destination, and nothing ever passed `output`. `OpDispatcher` only ever
handed them ids from its own map of loaded nodes, so that branch was unreachable from the one
place allowed to wire the graph. The page made itself audible instead, with
`engine.get(entry.id).node.connect(analyser)` once per plugin as it loaded.

It worked, which is why it lasted. The consequences were quieter than silence. Every node was
connected to the output whether or not the model thought it was the end of anything, so an
effect in the middle of a chain was heard twice, once wet and once dry. A meter measured one
node rather than the mix. A plugin with no audio outputs threw `IndexSizeError` in the middle
of loading. Removing a node left it connected. And the model was not in charge of what came
out of the speakers, which is the property the whole layering exists to provide.

**Root cause.** A capability was present and unreachable, so it looked implemented. The
`output` branch in `Engine` reads as support for connecting to the destination, and the only
caller could not express it. Searching for the feature found it; asking what reaches it did
not happen.

**Prevention.** The engine owns a master gain, the only thing connected to the destination, and
the dispatcher links every audio sink to it after each rebuild. A sink is derived from the
connections rather than declared, keeping the rule the project format already states for
processing order. `tests/ops/OpDispatcher.test.js` has six tests for which nodes reach the
speakers and `tests/engine/Engine.test.js` is new: the engine had no tests of its own, only
coverage through a fake engine in the dispatcher's suite, which records the options it is
handed and connects nothing.

**And the bug that fix introduced, caught by its own test.** `#rebuildLinks` runs inside
`apply`, and `addPlugin` records the new node in `#nodeIds` after the apply returns, so a
freshly loaded plugin was not in the map when the links were rebuilt and never reached the
speakers until some unrelated edit happened next. Harmless for a connection, whose other end
arrives later anyway; not harmless for the output.

**The general shape.** An unreachable branch is worse than a missing one. When a function
handles a case, find the call that supplies it, and if there is none, that case does not exist.

## 2026-09-17 A removed plugin kept playing

**What happened.** Removing a node from the model never removed the
`AudioWorkletNode` behind it. The rack's Remove button took the plugin off the screen and out
of the project, and left it running and connected to whatever the page had wired it to. Found
while adding session reopening, where clearing the old session before loading the new one
would have stacked the two.

**Root cause.** `OpDispatcher` kept a map from model node to engine node and only ever added
to it. `#rebuildLinks` runs after every change and looked like the place that would catch
this, but it rebuilds *links*, and a node with no links is exactly the case that leaks. The
one call to `engine.remove` in the file was in the failure path of `addPlugin`, which made the
capability look present.

**Prevention.** `#releaseRemoved` reconciles the map against the project after every apply and
releases anything whose model node has gone. Driven by the model rather than by the change
list, so it is right for any route that removes a node, including a changeset that removes one
as a side effect. Three tests in `tests/ops/OpDispatcher.test.js` cover one node, a whole
session, and leaving the survivors alone.

**The general shape.** A pair of structures where one is authoritative and the other mirrors
it needs a reconcile, not a handler per operation. Asking "what removes from this map" found
nothing, and the answer was that nothing did.

## 2026-09-17 A diagnostic command that kills the shell running it, twice

**What happened.** `pkill -f 'bin/jigdaw-adapter'` was used to clear a stray process before a
test run. The pattern matched the shell's own command line, which contains that string, so the
shell killed itself: exit 144, no output, and a log file that was empty because the thing it
was meant to capture never started. It cost an hour of looking for a fault in a plugin that
was working. It was diagnosed, written up here, and then **done again** three hours later with
`pkill -f "PORT=6027"`, for the same reason.

**Root cause.** `pkill -f` matches against the full command line of every process, including
the one issuing it. Writing the pattern down as a lesson did not help, because the second time
the pattern looked nothing like the first and the rule was remembered as being about that
specific string rather than about `-f`.

**Prevention.** Do not use `pkill -f` from a shell whose command line contains the pattern.
Kill by exact process name, `pkill -x jigdaw-adapter`, or by the port, which is what the
process actually holds:

```sh
pid=$(ss -lptn "sport = :6027" | grep -oP 'pid=\K[0-9]+' | head -1) && kill "$pid"
```

**The general shape.** A rule stated as an example gets remembered as the example. This one is
about `-f`, not about any particular pattern, and the way to notice it is that a command which
exits 144 with no output has almost certainly killed its own shell.

## 2026-09-17 A capability minted, required and enforced, and never offered

**What happened.** `jig:MidiOut` was added to the vocabulary, required by BassGen's profile,
and enforced by a SHACL shape that refuses a MIDI producer without it. The native adapter ran
it end to end. The browser refused to load it: *BassGen requires jig:MidiOut, which this host
does not offer.* The capability existed in four places and was offered in none.

**Root cause.** `src/host/Capabilities.js` holds a literal list of what the host provides, and
nothing connects that list to the capabilities plugins ask for. Minting a term, requiring it
and validating it are three separate acts, and none of them makes a host able to do the thing.
The negotiation behaved correctly: it refused a plugin the host genuinely could not serve. The
defect was that the host could serve it and had not said so.

341 tests passed. It took one page load to find, which is the same lesson as the last browser
run and the reason that run happens.

**Prevention.** `tests/host/Capabilities.test.js` walks `plugins/` and asserts that every
`trn:requires` of every worked profile is in `detectCapabilities`. Mutation tested by
withdrawing `jig:MidiOut`, which reproduces the browser's message as an assertion failure. The
guard walks the plugin directory rather than a list, so a plugin added later is covered
without anyone remembering to add it.

**Also found in the same run.** `web/app.js` connected every loaded plugin to the analyser, and
`connect()` on a node with no outputs throws `IndexSizeError`. A MIDI generator threw in the
middle of loading. And the BassGen processor read `timeSignature` as a pair while
`Transport.messageAt` sends `{ beatsPerBar, beatUnit }`, so its meter was silently undefined.
Both are one shape: a thing that is true of every plugin so far, written as if true of all.

**Not a defect, recorded so it is not chased twice.** The level meter read zero throughout.
It is driven by `requestAnimationFrame`, and the tab was hidden, where rAF does not fire.
Measuring a page from outside it does not make the page's own animation run.

## 2026-09-17 Every slice of the block was told it was the same moment

**What happened.** The adapter runs a chain in slices of at most the module's `jig_max_frames`,
which is 128, while a DAW hands over a whole buffer at once, here 1024 frames. The `jig:Abi2`
transport block was filled in once per buffer, so all eight slices were told they were at the
same beat. A generated note could only land on a buffer boundary.

**Root cause.** The transport was treated as a property of the callback rather than of the
moment. It is written once because the host reports it once, and that made it look like one
value for the whole call. Each slice is at a different point in time, and the block says so
only if something advances it.

At a 1024 frame buffer and 48 kHz that is 21 milliseconds of quantisation, which is audible
as a late note and gets worse as the buffer grows. It would have been invisible at a 128 frame
buffer, where the slice and the buffer are the same thing, and that is the size a developer
tends to run.

**Prevention.** The slice loop advances `beat` and `seconds` by the frames already processed,
from the tempo the host reported. Found by watching what a plugin emitted in a real host with
a real transport rather than by reading the code: the native tests drive the transport by hand,
one block at a time, and a test that advances the transport itself can never catch a host that
does not.

**The general shape.** When code processes a buffer in pieces, ask which of the things handed
to it are properties of the buffer and which are properties of the instant. The instant ones
have to move.

## 2026-09-17 The adapter was silent in a DAW, and every test passed

**What happened.** Asked to confirm that Pulse responds to MIDI, the byte level tests said yes
and a real host said nothing at all. MIDI arrived, the voices ran, and the output was digital
silence. Six seconds of recorded audio measured a peak sample of exactly 0.000000 while the
note on and note off were visible on the plugin's own MIDI output in the same run.

**Root cause.** After loading a chain the plugin wrote the host's parameter values into it,
mapping a normalised slot onto the port's declared range. The host's sixteen slots mean nothing
until something is loaded, so they all read zero, and zero normalised is the bottom of whatever
range the port turns out to have. Pulse came up with its gain at its minimum and its filter at
100 Hz. Nothing was broken in any component; the defaults the profile declares were simply
never consulted.

It survived because the code that did it lived in the DPF wrapper, which no test can construct,
and the chain tests drive `Chain` directly, where a module keeps the defaults `jig_init` gave
it until something overwrites them. The test suite and the real plugin took different paths
through the same load, and only one of those paths had the bug.

**Prevention.** `jigdaw::applyParameters` and `jigdaw::normalisedDefault` in the core library,
with `tests/chain_test.cpp` asserting that every port of a freshly loaded Pulse sits at its
declared default and that the plugin is audible without touching a control. Mutation tested:
reverting the fix turns that check into "audible without touching a control: 0.000000", which
is the symptom stated as an assertion. The editor computes its displayed values through the
same `normalisedDefault`, because DPF cannot tell a VST3 host that a parameter changed, so the
two sides can never be told each other's answer and have to compute the same one.

**The general shape.** When a test and the shipped program reach the same feature by different
routes, the untested route is where the bug will be. Ask what the wrapper does that the test
harness does not, and this time the answer was "applies the host's idea of every parameter".

## 2026-09-17 The editor waited for a message DPF never sends

**What happened.** The adapter grew an editor, because a host with no editor shows a generic
panel of sliders named "Param 7" and no way to say which plugin to load. The editor sent the
IRIs to the plugin and then waited to be told what had loaded. It waited for ever. The load
itself was fine: the plugin fetched both profiles, verified both digests, instantiated both
modules and wrote the report. Nothing was broken except the one path a person can see.

**Root cause.** The report travelled by `Plugin::updateStateValue`. DPF wires that callback
under CLAP only. It is a literal `nullptr` in the VST3, VST2 and JACK wrappers, which is every
format this is actually used in. DPF says so out loud at runtime, `updateStateValueCallback
(nil)`, and the line was in the log all along under a plugin that was otherwise working
perfectly. The API is present, compiles, and returns a value, so nothing at build time
distinguishes a format that delivers from a format that discards.

Two things hid it. The standalone was driven with `pkill -f bin/jigdaw-adapter` beforehand,
and that pattern matches the shell running it, so the shell killed itself, the launch never
happened and the log was empty rather than wrong. And the wrapper does push state to the
editor once, on open, so reopening the editor showed the right report and made the channel
look sound.

**Prevention.** The editor works the report out for itself, through the same
`jigdaw::buildChain` the plugin calls, on a worker so a network fetch does not freeze the
panel. One writer, two callers, so the two cannot disagree. `tests/native/adapter-report.test.js`
binds them and was mutation-tested in both directions. The push is kept, because it is an
improvement where it lands, and is now commented as never being the only source.

**The general shape.** A host API that is optional per format is a runtime fact wearing a
compile-time face. Ask what a wrapper that does not implement it does, and assume it is
"nothing, silently". Before that: a diagnostic command must not match its own command line.

## 2026-09-17 The specification had made itself browser-only

**What happened.** A VST3 was proposed as a sanity check on the plugin specification. It
found the problem before it played a note: there was no way for a native host to load a
JigDAW plugin at all.

**Root cause.** The contract guarantees a host exactly one thing it can execute, a JavaScript
`AudioWorkletProcessor`, and states explicitly that what the processor and the WebAssembly
module say to each other is the plugin author's business. That is right for a browser and a
dead end for anything else. Every reader of the specification until now was a browser, so
nothing was ever in a position to notice.

**Prevention.** `docs/module-abi.md` and `jig:abi`: a module may declare that it implements a
published ABI, and a host with a WebAssembly runtime then loads it directly and ignores the
processor. Optional on both sides, so nothing existing is invalidated. Both worked plugins
declare it, every port gained a `jig:paramIndex`, and the shapes refuse a plugin that
declares an ABI without one.

The general shape: **a specification checked only by implementations of one kind will encode
that kind's assumptions and look complete.** The way out is not more careful reading; it is a
second implementation that is different in the way that matters. Writing the host in C++ took
a day and found in an hour something that four hundred tests and several passes of prose
review had not.

## 2026-09-17 A parser stricter than the format it parsed

**What happened.** The native Turtle parser refused both worked profiles at line 92.

**Root cause.** It rejected blank nodes outright, because `plugin-profiles.md` says not to
use them. The document says something narrower: nothing *addressable* may be a blank node,
for reasons about diffing and re-ingest that do not apply to an `lv2:scalePoint`. The format's
own worked example uses blank nodes there, so the parser was enforcing a stricter rule than
the specification states, against the specification's own example.

**Prevention.** Blank nodes are parsed, with a comment saying which rule actually applies.

The general shape, which keeps recurring in a different costume: a rule remembered as a
slogan is not the rule. "No blank nodes" is shorter than "no blank nodes for anything
addressable" and means something else.

## 2026-09-17 A keyboard 88px wider than the phone it was on

**What happened.** The DAW page scrolled sideways on a phone, slightly.

**Root cause.** The keyboard sized its keys in pixels: `--white-width: 30px` on a narrow
screen, fourteen white keys, 420px in a 390px viewport. `.keyboard` carried
`max-width: 100%`, which did nothing, because `.keys-white` is a flex row and a flex child
with a set `width` does not shrink below it.

The mobile guard in `tests/ui/` passed throughout. It checks font sizes, touch targets, the
viewport meta and the media query, and it cannot see layout, because there is no layout in
linkedom.

**Prevention.** Keys divide the width they are given: `flex: 1 1 0` on the white keys, and
`--white-width: calc(100% / var(--white-count))` so the absolutely positioned black keys
follow. A stylesheet guard fails if `.key-white` gets a fixed width again.

**Two further faults surfaced while measuring**, and both would have shipped:

Reading `element.clientWidth` before the element was in the document returned zero, so the
code fell back to the body width and chose two octaves where one fits. The slot is now
appended before anything measures it.

`clientWidth` **includes padding**. Counting the slot's 14px each side made a 390px phone
look like it had room for two octaves, and the keys came out at 22.6px, under the 24px WCAG
minimum. The width that matters is the content box.

**How it was found, which is the transferable part.** The extension cannot resize the
viewport, so the page was loaded into a 390px iframe inside a normal window and measured
there: `documentElement.scrollWidth` against `innerWidth`, and every element whose right edge
passed the viewport. That gives a number rather than an impression, and the same harness then
showed the fix working at nine widths from 320 to 1280.

## 2026-09-17 A 502, from an import into a server that has no dependencies

**What happened.** The site went down with a 502 immediately after a deploy. `bin/serve.js`
failed to start with `ERR_MODULE_NOT_FOUND`.

**Root cause.** `LocalCatalogue` was written to read `plugins/*/profile.ttl` and parse them
at runtime, which pulled `@zazuko/env` and `n3` into the server's import graph. The server
runs on a machine with no `node_modules`, because every artefact is committed and the
deployment is a pull and a restart. I had written that property into `docs/deployment.md` and
`HUMANS.md` myself, argued for it, and then broke it two days later without noticing, because
nothing checked it and it works perfectly on a machine that happens to have the packages.

**Prevention.** The index is generated by `npm run build:index` into `plugins/index.json` and
committed, exactly as the wasm, the profiles and the browser bundle are. `LocalCatalogue`
reads JSON, so the server is back to node builtins alone. Verified by deleting
`node_modules` entirely and watching it start.

Two guards, both mutation tested:

- `tests/docs/conventions.test.js` walks the import graph from `bin/serve.js` and fails on
  any bare specifier, naming the file that introduced it.
- `tests/catalogue/LocalCatalogue.test.js` checks the generated index against the profiles
  on disk, so it cannot drift.

The general shape, which is now the fourth of its kind: **a property nothing checks is not a
property, it is a coincidence.** Writing it in a document and arguing for it does not make it
hold. The browser-bundle guard already existed for the mirror image of this exact fault, and
I did not think to write its counterpart for the server until the server fell over.

## 2026-09-17 The contract required something browsers silently refuse

**What happened.** The first time the page was ever opened in a browser, every plugin load
failed after ten seconds with `"pulse" did not report ready`. 288 tests passed, including an
end-to-end one that loads the same plugin, compiles the same WebAssembly and renders audio
from it.

**Root cause.** Contract section 3.3 required the host to compile the module on the main
thread and post the resulting `WebAssembly.Module` to the processor, reasoning that a Module
carries already-compiled code and keeps compilation off the audio thread. That does not work.
Measured in Chrome: `port.postMessage({ module })` does not throw and the message is never
delivered. A `WebAssembly.Module` is serializable only within an agent cluster and an
`AudioWorklet` is outside the page's. The processor waits for an `init` that never arrives.

The offline harness passed it through happily, because a fake `MessagePort` that hands an
object to a callback is not a structured clone and never could have caught this.

**Prevention.** The contract now requires the bytes to be posted and compiled inside the
worklet with `new WebAssembly.Module(bytes)`, which was verified in the same session to work
for a 227 KB module: the 4 KB synchronous-compile limit applies to the main thread, not to a
worklet. And `src/testing/OfflineHost.js` now drops a message carrying a `WebAssembly.Module`
exactly as a real port does, so the old contract fails in the suite. Verified by reverting
the fix and watching the offline tests time out the way the browser did.

The general shape, and the reason this one matters most: **a fake that is more permissive
than the real thing turns a specification error into a passing test.** When writing a
stand-in for a platform API, ask what the real one refuses, not only what it accepts.

## 2026-09-17 Three smaller things the first browser run found

All three had passed every headless test.

**A slot built and never appended.** `drawRack` created each plugin's element, attached its
panel and keyboard, and never called `rack.append(element)`. The rack drew Source, two wires
and Output with nothing between them. Nothing tests the page's own rendering, which is why
the DOM-level guards in `tests/ui/` exist for the panel and should grow to cover the rack.

**`https:` only, which forbids localhost.** `Project.addNode` required a plugin IRI to be
`https:`, so a host running on `http://localhost:6017` refused its own plugins. A browser
already treats loopback as a secure context because it cannot be intercepted. The rule now
allows `http` on `localhost`, `127.0.0.1` and `[::1]`, and the contract says why. Refusing it
meant the only way to develop a plugin was to deploy it.

**`performance` does not exist in an `AudioWorkletGlobalScope`.** Not a defect in the
project, but worth writing down: a diagnostic added to a processor that calls it throws, and
the throw surfaces as the processor never replying.

## 2026-09-17 A browser module reaching a node builtin, twice

**What happened.** `npm run build:web` failed with `Could not resolve "node:fs/promises"`
after the agent surface imported `FACET_NAMES` from `Catalogue.js`, which imports
`QueryService`, which reads query files off disk. The same thing had happened earlier with
`ShapeValidator` reaching `node:fs`.

**Root cause.** A module that a browser bundle must reach had been put in the same file as
one that needs a filesystem, because the two are about the same subject. Subject is the wrong
axis: what matters is which runtime a module can exist in.

**Prevention.** `src/catalogue/facets.js` holds the list, with no filesystem anywhere near
it, exactly as `src/validate/files.js` keeps the reading apart from the validating. And
`tests/docs/conventions.test.js` now walks the import graph from `web/app.js` and fails on
any `node:` specifier reachable from it. esbuild catches this too, but only when someone runs
the build, and `npm test` passed happily both times.

Verified by adding `import { readFile } from 'node:fs/promises'` to the tool surface and
watching the guard fail.

## 2026-09-17 Guards that could not see new code

**What happened.** A no-inline-SPARQL guard was added to `tests/docs/conventions.test.js`,
and mutation-testing it by putting a `SELECT ... WHERE` template literal into
`src/catalogue/Catalogue.js` produced a passing run.

**Root cause.** Every guard in that file walks `git ls-files`, which lists only committed
files. `src/catalogue/` was new and therefore invisible, along with `sparql/` and
`tests/catalogue/`. So the em-dash rule, the path-comment rule, the broken-link check and the
new SPARQL rule had all silently stopped applying to exactly the code most likely to break
them: code that had just been written and not yet committed.

**Prevention.** `git ls-files --cached --others --exclude-standard`, which is tracked files
plus new ones that are not ignored. Verified by repeating the mutation and watching the guard
fail.

This is the third instance of the same shape in three days, and the shape is worth stating
plainly: **a guard is only as wide as the list it walks, and the list is the part nobody
re-reads.** The first was a check of the vitest include list that lived inside a suite
governed by that list. The second was a router that listened only to nodes with routes. This
was a linter that read only committed files. In each case the rule was right and the
population it ran over was wrong.

When adding a guard, write down what it walks and ask what is outside that set.

## 2026-09-17 A detached fetch, and an error message that blamed the wrong thing

**What happened.** The deployed page failed on its first real load with
`[fetch-profile] could not fetch https://strandz.it/jigdaw/plugins/cascade/. A cross-origin
profile must be served with Access-Control-Allow-Origin.` The request was same-origin, so
CORS could not have been involved, and `curl` showed the headers were correct anyway.

**Root cause, two of them.**

`PluginLoader` defaulted to `fetch = globalThis.fetch` and then called it through a private
field. A browser's `fetch` must be called with the window as its receiver and throws
`TypeError: Illegal invocation` otherwise; node's does not care. So the defect passed 219
tests and failed on the first page load. The shapes fetch in `web/app.js` worked throughout
because it calls `fetch(...)` directly, which is what made the failure look selective.

Then the error message asserted a cause rather than reporting one. Any throw from `fetch`
was labelled a missing `Access-Control-Allow-Origin`, so the message sent the reader to look
at nginx for a bug that was in this file. Two of us spent time on the configuration.

**Prevention.** The default is now `(...args) => globalThis.fetch(...args)`, and
`tests/host/PluginLoader.test.js` installs a `fetch` that refuses a detached call, exactly as
a browser does. Verified by reverting the fix and watching the test fail with the same
`Illegal invocation` text the browser produced.

For the message: report what happened, then the likely cause. `could not fetch X: <the real
error>. If the profile is on another origin, it must be served with
Access-Control-Allow-Origin.` A diagnostic that states a cause it has not established is
worse than one that states nothing, because it is believed.

The general shape: **a default that reads a host global is a default that only the host can
test.** Anything taken from `globalThis` and called later needs a test that exercises it the
way the real environment will.

## 2026-09-17 A node dropping events while nobody was listening

**What happened.** `EventRouter` accumulated the counts a processor reports when its event
queue overflows, and a test flooding a real instrument with 700 notes saw the processor drop
188 and say so, while `router.droppedFor()` reported zero.

**Root cause.** The router attached its listener inside `setRoutes`, so it heard from a node
only once that node had an outgoing MIDI route. Overflow arrives on the same channel as
outgoing events, so a node with nothing wired to its MIDI output was never listened to at
all. The condition for hearing a report was confused with the condition for forwarding one.

**Prevention.** `observe()` is now public and the dispatcher calls it when a plugin loads,
not when it is wired. An instrument dropping notes is worth knowing about whether or not
anything is listening to it.

The general shape, which is the second time this week: a rule about routing is not a rule
about listening. When one method sets up two things, ask whether they really share a
condition.

## 2026-09-16 Latency stopped at the edge of a feedback loop

**What happened.** `compileGraph` computed accumulated latency over the graph with every
cycle edge removed. A test asking whether the acyclic part of a graph containing a loop still
gets compensated failed: it produced none at all.

**Root cause.** Two different things were conflated. `latency.md` says latency inside a cycle
is never *compensated*, which is right, and that was implemented by dropping cycle edges
before *accumulating*, which is not the same thing. Dropping them stops latency propagating
forward through a loop, so a delay line in a feedback path contributes nothing to what the
rest of the graph thinks it must wait for, and a dry signal beside it arrives early. The
symptom would have been a phase problem nobody could trace to the compiler.

**Prevention.** Condense each strongly connected component to a single unit, which makes the
graph a DAG, and accumulate over that. A component's latency is the largest latency of any
one member. There is no exact answer, because a signal entering a loop may leave it by any of
several paths, so the figure is documented as an under-estimate and the reasoning is in the
code rather than in a commit message.

The general shape: a rule about what not to do at a boundary is not the same as a rule about
what not to compute across it. Ask which one a piece of code implements.

## 2026-09-16 A test file that could not parse, reported as a pass

**What happened.** `tests/compiler/GraphCompiler.test.js` contained
`it('counts a plugin's own latency...')`, an unescaped apostrophe inside a single-quoted
string. The file failed to parse, so it ran no tests. Reading the run through
`grep -E 'check-suites|x |-> |Tests '` showed `Tests 126 passed` and nothing else, and the
new suite appeared to have been added and to be passing. It had not run at all.

**Root cause.** Two together. The filter matched the markers vitest prints for a failing
assertion, and a file that cannot be parsed produces none of them: it reports a failed *file*
with no tests. And the test count was read as a number rather than compared against what it
was before, so 126 before and 126 after looked like success.

**Prevention.** Read the `Test Files` line and the exit code, not only `Tests`. A suite that
was just added must move the count; if it did not, it did not run. `npm test` did exit 1
throughout, which is the thing that would have caught it in CI and the thing a person filters
away at a terminal.

## 2026-09-16 A guard that could not catch its own removal

**What happened.** `tests/docs/conventions.test.js` included a check that every
`tests/<dir>/` appears in the `include` list of `vitest.config.js`, so that a suite could not
be written and then never run. Mutation-testing it, by deleting `tests/docs/` from that
include list, produced a passing test run.

**Root cause.** Removing `tests/docs/` from the include list stops
`tests/docs/conventions.test.js` from running at all. The check was governed by the list it
was checking, so the one edit it existed to catch was also the edit that switched it off. It
went blind rather than red, and a green run said the opposite of the truth.

**Prevention.** The check moved to `bin/check-suites.js` and runs as part of `npm test`,
before vitest, where the include list has no power over it. Verified by mutation in both
directions: removing a wired directory and adding an unwired one now both fail.

The general rule, which is worth more than the instance: a guard must not depend on the
thing it guards. When adding one, ask what happens to the guard when the defect is present,
not only what happens when it is absent. Three sibling guards were mutation-tested at the
same time and all three failed correctly; this one looked identical and did not.

## 2026-09-16 Three SHACL constraints that could never have run

**What happened.** `vocabs/shapes.ttl` was first written with three `sh:sparql` constraints:
that a plugin with audio outputs declares their width, that a plugin speaking MIDI requires
`jig:MidiEvents`, and that a port's default lies inside its own range. Running
`rdf-validate-shacl` over them threw `Cannot find validator for constraint component
sh:SPARQLConstraintComponent` and validated nothing at all.

**Root cause.** The validator this project intends to use, the one plugin-universe uses,
does not implement SPARQL-based constraints and does not degrade gracefully when asked to.
The constraints were written in the most expressive form available rather than the most
portable one, without checking that anything would execute them.

**Prevention.** SHACL Core only. All three rules turned out to be expressible in Core, and
more precisely: `sh:lessThanOrEquals` compares two properties of one node directly, and
enumerating the MIDI signal types with `sh:in` is exact where a substring match on the IRI
would also have matched any future term whose name merely contains "Midi". A constraint is
not written until it has rejected something.

## 2026-09-16 Two shapes that passed everything

**What happened.** After moving to SHACL Core, `examples/counterexample-profile.ttl` was
written to violate every constraint once. Six of eight fired. The MIDI capability rule and
every constraint on fetchable resources did not.

**Root cause.** Two separate versions of the same error, which is depending on something
that is not in the graph being validated.

The MIDI rule was a property shape on `trn:requires`. A property shape whose path has no
values is vacuously satisfied, so it passed exactly the plugins that omit `trn:requires`
altogether, which are the only ones it existed to catch. A conditional rule belongs at node
level.

The resource constraints targeted `jig:Resource` and relied on `rdfs:subClassOf` from
`vocabs/jigdaw.ttl` to reach `jig:Module`, `jig:Processor` and `jig:UserInterface`. A
profile arriving from a third-party origin is validated on its own and carries no
vocabulary, so nothing was ever in scope. The same reasoning applied to `sh:class` on a
vocabulary individual, which was changed to `sh:in`.

**Prevention.** The counterexample file, and the rule that nothing in `vocabs/shapes.ttl`
may depend on the vocabulary being loaded alongside the data. A shape that has never
rejected anything is indistinguishable from one that does not run, and it is worse than no
shape because it looks like coverage.

## 2026-09-16 An invented vocabulary term in the worked example

**What happened.** `examples/reference-profile.ttl` declared `pu:supportedPlatform pu:Web`.
Neither the value nor, in the public dump, the predicate exists.

**Root cause.** The term was written because it was the obvious thing to say, not because
it had been looked up. It looked correct, it parsed, and it validated, because nothing in
the shapes constrains a vocabulary that is not ours.

**Prevention.** Take a term from the system, not from memory. A query against
`https://sparql.plugin-universe.com/public/query` for the distinct values actually in use
takes one call and settles it. This is how the `trn:WebAudio` gap in TODO.md was found, and
it was found one step too late.

## 2026-09-17 The audio thread compiled the WebAssembly

**What happened.** `Module::load` found the exported functions, called `jig_init`, took the
pointers and reported ready. wasm3 compiles a function the first time it is *called*, and
`Compile_Call` emits `op_Compile` for a callee that is not compiled yet, so everything
`jig_process` reaches was compiled during the first `jig_process`, on the audio thread,
allocating, inside a callback that must do neither.

**Root cause.** `m3_FindFunction` compiles the function it returns, so the four exports the
loader looks up were compiled on the loading thread. That looked like the whole answer. It
is not: the call tree underneath them was not touched, and nothing in the loader says
"everything reachable is now compiled" because nothing was checking.

**Why it was not noticed.** The symptom is one late block at the start of playback, which is
indistinguishable from a host still settling, and none of the tests measure a first block
against a later one. It was found by reading wasm3's compiler while writing a second host,
not by anything failing.

**Fix.** `m3_CompileModule` after `m3_LoadModule`, which compiles every function ahead of
time. Non-fatal on failure: a module may carry a function this build cannot compile and
never call it, and refusing a plugin that works would be worse than the problem.

**Prevention.** For anything called from an audio callback, the question is not "does this
allocate" but "does anything it reaches allocate, the first time". A lazy runtime moves the
cost to the first call, which is exactly the call a host makes in the worst place.

## 2026-09-17 The profile parser read numbers in the user's locale

**What happened.** `Profile.cpp` parsed `lv2:default`, `lv2:minimum`, `lv2:maximum` and
`rdf:value` with `std::stof`. That function reads the decimal separator from the global C
locale. A library does not set the locale, but an application does, and every GTK
application and every DAW calls `setlocale(LC_ALL, "")`. On a machine with
`LC_NUMERIC=it_IT.UTF-8`, `std::stof("0.3")` stops at the `.` and returns 0.

So every fractional number in every profile became zero, in every host, for every user
outside the anglosphere. Pulse came up with its gain at 0 and its attack range starting at
0 instead of 0.5.

**Why it survived every test.** The tests ran in the default `C` locale, which a C++
program starts in and which nothing here changed. And whole numbers parse identically
everywhere: `5`, `200`, `6000` and `2` were all correct, so the output looked right unless
you knew that one specific port's default was `0.3`. It was found by hosting Pulse in
transmission's GTK editor and noticing one control out of five sitting at the bottom.

**This is very likely the bug behind `Params.hpp`.** That file's comment describes Pulse
coming up with "its gain at minimum and its filter at 100 Hz: notes arrived, voices ran,
and nothing was audible", and attributes it to untouched host slots reading zero. A zeroed
`defaultValue` produces exactly that, from the other direction. Worth re-checking whether
the slot-initialisation logic was treating a symptom.

**Fix.** `toFloat` parses through an `istringstream` imbued with `std::locale::classic()`.
A Turtle number is always `.`-decimal, so the classic locale is the only correct one.

**Prevention.** `profile_test` now calls `setlocale(LC_ALL, "it_IT.UTF-8")` before parsing
anything, and asserts that `0.3` and `0.5` survive. Verified to fail before the fix. More
generally: a parser for a wire format must never use a locale-sensitive conversion, and a
test that runs only in `C` is testing the one case that was never in doubt.
