# JigDAW, for people

Instructions for human colleagues. [AGENTS.md](AGENTS.md) is the counterpart for agents, and
holds the coding conventions, the real-time rules and the RDF conventions. Those apply to
everyone; they live there because that is the file an agent reads first. Read it too.

Keep the two in step. A working practice that changes for one usually changes for the other,
and neither file will complain when it goes stale.

## What this is

A digital audio workstation and a plugin format, both native to the web. The premise is that
a plugin's identity, its metadata and its delivery are one URL: you search, you get a link,
the host dereferences it, and the plugin is running.

The project is in its specification phase. What exists is a vocabulary, a set of validation
shapes, a normative contract describing what a host guarantees and what a plugin must do,
and a validator that enforces the shapes. None of the DAW exists.

## Reading order

1. [README.md](README.md) for the idea in a paragraph.
2. [docs/architecture.md](docs/architecture.md) for the shape of the thing, and for the
   decisions that have already been made and why.
3. [docs/host-plugin-contract.md](docs/host-plugin-contract.md), which is the real content.
   It is normative and it is long. Sections 1 to 3 are the ones that constrain everything
   else.
4. [docs/plugin-profiles.md](docs/plugin-profiles.md) if you are writing or reading a
   profile, or [docs/project-format.md](docs/project-format.md) for a session.

The rest are read when you need them: [docs/messaging.md](docs/messaging.md) for the wire
format between host, processor and user interface, [docs/latency.md](docs/latency.md) for
compensation and feedback, [docs/webmcp.md](docs/webmcp.md) for the agent tool surface, and
[docs/namespace.md](docs/namespace.md) for what the vocabulary IRIs serve.

[docs/plan.md](docs/plan.md) says which phase we are in. [TODO.md](TODO.md) is what the
project needs. [MISTAKES.md](MISTAKES.md) is what has already gone wrong, and is worth
reading before you assume something obvious is also true.

## What you need installed

For the current phase, very little.

| Tool | For | Install |
|---|---|---|
| Node 20 or later | the validator and the tests | your preference |
| `rapper` | Turtle syntax checking | `apt install raptor2-utils` |

Then `npm install`.

## Checking a profile

Syntax:

```sh
rapper -i turtle -c examples/cascade-profile.ttl
```

Shapes:

```sh
npm install          # once
npm run validate -- examples/cascade-profile.ttl
```

It exits non-zero on a violation, so it works in a script. `--shapes FILE` points it at a
different shapes file. A warning does not make it fail, per SHACL section 3.6, which is a
correction `ShapeValidator` applies because `rdf-validate-shacl` does not: it reports a
graph as non-conformant for a warning, and a caller that refuses to store non-conformant
graphs would then reject a whole harvest over one odd string.

```sh
npm test             # the counts below, plus the repository guards
```

`npm test` runs `bin/check-suites.js` first, which fails if a `tests/<dir>/` is missing from
`vitest.config.js`, then the suites. Those enforce the documentation rules that would
otherwise need a careful reader: no em dashes, no broken internal links, no unreferenced
document, a path comment at the top of every source file, and the vocabulary bound to the
shapes and examples in both directions.

`npm test` enforces these, in `tests/validate/ShapeValidator.test.js`:

| File | Expected violations |
|---|---|
| `examples/cascade-profile.ttl` | 0 |
| `examples/session-project.ttl` | 0 |
| `examples/counterexample-profile.ttl` | 8 |
| `examples/counterexample-project.ttl` | 10 |

The counts go **up** when a constraint is added, and a counterexample must gain a defect in
the same change. What must never happen is a count going down on its own: that means a shape
has stopped firing. It has already happened twice, and both times the shape looked
perfectly reasonable. See `MISTAKES.md`.

## If you are contributing a plugin profile

Copy `examples/cascade-profile.ttl` and edit it. It is complete and it validates.

The parts people get wrong:

- **Set an explicit `@base`.** Otherwise relative locations resolve against wherever the file
  happens to be served from, and every resource IRI is quietly one directory off.
- **Every resource needs a `jig:integrity` digest.** This is not optional and a profile
  without one is refused. The host runs code it found by following a link, and the profile
  and the code need not share an origin.
- **CORS.** The profile and everything it points at must be served with
  `Access-Control-Allow-Origin`. This is the one hosting requirement that cannot be relaxed,
  for the reason in section 1.3 of the contract.
- **Declare parameters once**, as `lv2:port`. The panel and the `AudioParam`s both come from
  that, so they cannot disagree. Do not name a widget; declare the shape that implies it.

## Reviewing a change

The failure this family of projects makes over and over is changing one file when a second
file had to change with it, and nothing connecting the two. plugin-universe's `CLAUDE.md`
has a table of nineteen instances. So the review question is not only "is this correct" but
"what else now has to agree with it".

Concretely, for a change here:

- A new term in `vocabs/jigdaw.ttl`: is it constrained in `vocabs/shapes.ttl`, used in an
  example, and mentioned in the contract or the profile documentation? A term nothing writes
  and nothing reads is invisible, and invisibility is not a state anything reports.
- A new or changed constraint in `vocabs/shapes.ttl`: does
  `examples/counterexample-profile.ttl` violate it, and did the violation count go up?
- A claim in prose about a number, a file or an endpoint: was it taken from the system or
  from memory? A `curl`, a `grep -c` or a SPARQL count settles it in a second, and three of
  the entries in `MISTAKES.md` are sentences that were simply believed.
- A rule added to `AGENTS.md` or to this file: what would notice it being broken? If the
  answer is "a careful reader", the rule is decoration.

## Decisions that are yours, not an agent's

These are in `TODO.md` and they are blocked on a person:

- **A web plugin format term.** `trn:WebAudio` is used by the worked example and does not
  exist. Adding it means changing a vocabulary and the `sh:in` list in plugin-universe's
  shapes in the same change, across two repositories and a deployed service.
- **Which repository owns the `trn:` vocabulary.** `trn:format`, `trn:MidiCC` and
  `trn:AudioSidechain` are declared in plugin-universe and absent from transmission, which is
  the repository everything calls upstream. The rule says propose extensions upstream; the
  practice has already gone the other way. That needs settling before a third term is added.

## Related repositories

Prior art, described in [docs/local-references.md](docs/local-references.md). JigDAW depends
on none of them and none should become a dependency.

`transmission` has the vocabulary. `downspout` has 52 profiles written by hand. `valis` has
the idea that the instrument is the document. `plugin-universe` is live, with 758 plugins, a
public SPARQL endpoint and a public MCP endpoint, and is the format this project extends.

## Licence

Apache 2.0, in [LICENSE](LICENSE). Note that this is the licence on the code and the
documents. Catalogue data is a separate question: plugin-universe publishes its factual
catalogue as CC0, and if JigDAW ever redistributes harvested profiles the licence travels
with the data rather than with this repository.
