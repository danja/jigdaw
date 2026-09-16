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

The project is in its specification phase. There is no implementation. What exists is a
vocabulary, a set of validation shapes, and a normative contract describing what a host
guarantees and what a plugin must do.

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
| `rapper` | Turtle syntax checking | `apt install raptor2-utils` |
| Node 20 or later | everything else, eventually | your preference |

There is no `package.json` yet, so there is nothing to `npm install` in this repository.

## Checking a profile

Syntax:

```sh
rapper -i turtle -c examples/cascade-profile.ttl
```

Shapes. There is no `npm run validate` yet, so this is the working recipe until Phase 1
provides one. Run it somewhere outside the repository:

```sh
mkdir -p /tmp/jigdaw-validate && cd /tmp/jigdaw-validate
npm init -y && npm install rdf-validate-shacl @zazuko/env @rdfjs/parser-n3

cat > validate.mjs <<'EOF'
import fs from 'node:fs'
import { Readable } from 'node:stream'
import rdf from '@zazuko/env'
import ParserN3 from '@rdfjs/parser-n3'
import SHACLValidator from 'rdf-validate-shacl'

const parse = (file, baseIRI) => rdf.dataset().import(
  new ParserN3({ factory: rdf, baseIRI })
    .import(Readable.from([fs.readFileSync(file, 'utf8')])))

const [shapesFile, ...dataFiles] = process.argv.slice(2)
const validator = new SHACLValidator(await parse(shapesFile, 'urn:shapes'), { factory: rdf })

let failed = false
for (const file of dataFiles) {
  const report = await validator.validate(await parse(file, 'file://' + file))
  // SHACL section 3.6: a warning must not make a graph non-conformant.
  // rdf-validate-shacl reports conforms: false for any result, so judge on
  // violations instead. Every consumer of this library needs that correction.
  const violations = report.results.filter(
    r => !String(r.severity?.value ?? '').endsWith('Warning'))
  console.log(`${file}: ${violations.length} violation(s)`)
  for (const r of report.results) {
    const sev = String(r.severity?.value ?? '').split('#')[1] ?? '?'
    console.log(`  [${sev}] ${r.focusNode?.value}`)
    console.log(`     ${r.path?.value ?? '(node)'}`)
    console.log(`     ${r.message.map(m => m.value).join(' ')}`)
  }
  if (violations.length) failed = true
}
process.exit(failed ? 1 : 0)
EOF

node validate.mjs ~/github/jigdaw/vocabs/shapes.ttl ~/github/jigdaw/examples/cascade-profile.ttl
```

Two sanity checks that should hold at all times, and which are the closest thing this
repository currently has to a test suite:

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
