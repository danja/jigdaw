# Plan

Phased. Status is updated as a phase completes, and a phase is not complete until its
verification has actually been run.

## Phase 0. Specification. Complete.

The vocabulary, the shapes, the normative contract and the profile documentation. No
implementation.

Delivered:

- `vocabs/jigdaw.ttl`, the `jig:` delivery and runtime vocabulary
- `vocabs/shapes.ttl`, SHACL Core, validated to fire against a counterexample
- `docs/host-plugin-contract.md`, normative, twelve sections
- `docs/messaging.md`, the host, processor and user interface protocol
- `docs/latency.md`, latency compensation and feedback
- `docs/project-format.md`, the session graph model
- `docs/webmcp.md`, the agent tool surface
- `docs/namespace.md`, what the vocabulary IRIs serve
- `docs/plugin-profiles.md` and `docs/architecture.md`
- four worked examples, two valid and two counterexamples
- `AGENTS.md`, with `CLAUDE.md` a symlink to it, and `HUMANS.md` listing the blockers

Verified: all four examples parse; both valid ones conform; the profile counterexample
produces eight violations and the project counterexample ten, one per constraint; a profile
fetched live from plugin-universe.com conforms untouched.

Left open, and blocking Phase 2: there is no plugin format term for the web. See `TODO.md`.

## Phase 1. The vocabulary in code. Started.

Delivered:

- `src/validate/ShapeValidator.js` and `bin/validate.js`, so `npm run validate` exists and
  the documented command is true. It holds the SHACL section 3.6 severity correction.
- `tests/validate/ShapeValidator.test.js`, which asserts the exact violation count for every
  example, so a shape that stops firing is a failing test rather than a quiet gap.
- `tests/rdf/vocabulary.test.js`, which binds the vocabulary to the shapes and examples in
  both directions, and refuses a `trn:` term that upstream does not declare.

Both guards were checked by mutation: removing a constraint from `vocabs/shapes.ttl` and
adding an undeclared term to an example each turn a test red.

Remaining: a profile parser, and `src/rdf/Vocabulary.js` once there is code that names a
term.

## Phase 2. One plugin, loaded

The vertical slice. A page fetches one plugin IRI, validates the profile, verifies integrity,
registers the worklet, instantiates the WebAssembly, and makes sound.

This is where the contract stops being prose. Expect sections 3 and 4 to change.

Needs the format term from `TODO.md` resolved first, or the example plugin cannot be
published anywhere that will accept it.

## Phase 3. A graph

More than one plugin, connected. The model, the compiler and the operation dispatcher.
Parameters as `AudioParam`s derived from `lv2:port`. Generated panels.

Latency compensation is specified in [latency.md](latency.md) and this is where it is first
implemented, including the refusal of a cycle with no delay in it.

## Phase 4. Events and transport

MIDI over message ports, located by stream position. Host transport. The first plugins that
require `trn:HostTransport`.

## Phase 5. The catalogue and the namespace

The compose stack with the SPARQL store, per [deployment.md](deployment.md). Crawling
profiles, named graph per source.
Federating with or mirroring plugin-universe rather than starting empty.

Serving the vocabulary at its namespace IRI belongs here too, and is independent of
everything else in this phase. It is a deployment rather than a build, and `TODO.md` carries
it because it needs a person.

## Phase 6. WebMCP

The agent surface, as a thin adapter over the same dispatcher the editor uses. Demand-driven
search and chain validation.
