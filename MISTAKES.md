# Mistakes

What happened, root cause, prevention. Newest first.

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
