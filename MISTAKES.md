# Mistakes

What happened, root cause, prevention. Newest first.

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
