# Mistakes

What happened, root cause, prevention. Newest first.

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
