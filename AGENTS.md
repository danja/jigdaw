# JigDAW

A web-native digital audio workstation and a web-native plugin format. Everything runs in
the browser, everything is identified by a dereferenceable IRI, and the signal processing is
usually WebAssembly: `jig:module` is optional, for a plugin simple enough that its
AudioWorklet processor is plain JavaScript.

The specification is complete and normative, and a browser host implements it: 9 worked
plugins, undo and redo, a catalogue search, a WebMCP surface, sessions that save and reopen
as RDF. A second host, a native VST3/CLAP/LV2 adapter, implements it independently. Read
[docs/architecture.md](docs/architecture.md) for the shape of the thing, then
[docs/host-plugin-contract.md](docs/host-plugin-contract.md), which is normative and which
the rest hang off, before making structural changes.

The normative documents are the contract,
[docs/messaging.md](docs/messaging.md) for the wire format between host, processor and user
interface, [docs/latency.md](docs/latency.md) for compensation and feedback, and
[docs/project-format.md](docs/project-format.md) for the session graph.
[docs/plugin-profiles.md](docs/plugin-profiles.md) and [docs/webmcp.md](docs/webmcp.md)
describe the profile format and the agent tool surface.

This file is the guidance for agents and holds the conventions, which apply to everyone.
[HUMANS.md](HUMANS.md) is not a counterpart to it: it is a short list of the actions only a
person can take, the blockers. Keep it short. Anything that is guidance rather than an
action belongs here, and anything an agent can do itself does not belong there at all.

## The two inboxes

**Read [INBOX.md](INBOX.md) at the start of a session, and periodically during a long one.**
It holds later thoughts that have not been accommodated yet. Each item is worked into
`docs/plan.md`, `TODO.md` or the relevant document, and struck from INBOX.md once it has a
home. An item left there is an intention nothing acts on.

**Record a tool that would help in HUMANS.md.** Installing something is a person's action,
so asking for it in a chat message that scrolls away is how the ask gets lost. Say what the
tool is, what it would let the work do that it currently cannot, and what is being done
instead in the meantime.

There should be no inline fallbacks, as this leads to indeterminate code. If a value is not
successfully retrieved from config then that is an error that needs fixing.

## Mission

Keep four concerns separate: RDF persistence, the project model, the compiled audio graph,
and real-time processing.

```
 ui/ (browser)          webmcp/ (agent surface)
        \                 /
         \               /
            ops/            every operation is one Op
 ============ | ================ message thread only ====
      rdf/ . model/ . compiler/
 ============ | ================ real-time boundary =====
           engine/ . AudioWorklet . wasm
```

## Non-negotiable real-time rules

- Never allocate, touch the network or storage, log through an unbounded sink, or take an
  unpredictable lock inside `process()`.
- Never call `WebAssembly.Memory.grow()` from `process()`. It detaches every existing view
  on that memory, so a held `Float32Array` becomes zero-length and the symptom is silence
  rather than an exception.
- Preallocate every buffer before the processor reports ready. A processor that is not
  ready outputs silence; it does not throw and it is not audible.
- Anything that happens at a point in time is located by stream position, never by the index
  within the current block and never by equality with a block boundary. An event fires in
  the block that contains it. Both halves of this are the same bug: an offset within a block
  is meaningless once the block has passed, and a position that is not exactly a multiple of
  the quantum is never equal to a boundary and so never fires at all.
- RDF parsing, validation, graph compilation and profile fetching happen on the message
  thread only.
- Treat plugin code as untrusted. Surface errors, isolate failures, and make a failed load
  leave the previous graph playing.

## Architecture rules

- The UI never mutates the running audio graph. Changes go model, then compiler, then
  engine.
- Every operation is one Op. The UI and the WebMCP surface are thin adapters over one
  dispatcher, never a second implementation.
- Editor metadata lives in a separate graph from execution metadata. Moving a node must not
  invalidate the compiled graph.
- Named graph per source. Every triple lives in a graph saying where it came from, with
  `prov:` metadata. Never write to a shared catch-all graph. Re-crawling a source is a DROP
  and reload of its graph alone.
- Plugin user interfaces are loaded cross-origin into a sandboxed frame. Never into the
  host document, by any means.

## RDF conventions

- One namespace of our own: `http://purl.org/stuff/jigdaw/`, prefix `jig:`, trailing slash.
- Mint under the PURL, never under the host that happens to serve it. The PURL is the
  identity and the host is an implementation detail; minting under the serving domain breaks
  every IRI ever published the day the site moves, including those written into other
  people's files. See [docs/namespace.md](docs/namespace.md).
- `src/rdf/Vocabulary.js` is the single source of IRI truth, frozen string constants only.
  Never hardcode a namespace IRI in any other module.
- New terms go in `vocabs/` first. Code follows the ontology, not the reverse.
- Reuse before inventing. Musical semantics are `trn:`, parameters are `lv2:` and `units:`,
  provenance is `prov:`. A term general enough to belong to `trn:` is proposed upstream to
  the transmission repository rather than forked into `jig:`.
- Model topology as explicit named arcs with named ports. Do not encode it as `rdf:List`.
- No blank nodes for anything addressable. Skolemise as a fragment of the containing
  document's IRI. Blank nodes are not diffable, they duplicate themselves on re-ingest
  rather than replacing, and they are awkward to query. A fourth reason arrived with
  signing: a blank node has no stable name, so a graph containing one has no canonical form
  and cannot be signed. Checked by `tests/rdf/Canonical.test.js` over every tracked `.ttl`;
  `vocabs/shapes.ttl` is the one exemption.
- SPARQL queries live in files under `sparql/queries/<category>/<name>.sparql`, loaded by
  name. Do not inline SPARQL as a template literal in JavaScript, and do not add a second
  loader or syntax.
- Changes to the graph model update `vocabs/shapes.ttl` and the query regression suite in
  the same commit.

## Repository conventions

- ES modules throughout. Node 20 or later. npm. Scripts run from the repository root.
- TypeScript only as `.d.ts` declaration files for public interfaces. No TypeScript build.
- Vitest, with `tests/` mirroring `src/` exactly. Cover valid, invalid and failure cases.
- Small modules with explicit dependencies and dependency injection.
- Every source file opens with a path comment, as `// src/rdf/Vocabulary.js`.
- Comments describe intent where it is not obvious, or an unusual API. Not effects.
- Prefer deterministic offline audio tests over device-based ones. An `OfflineAudioContext`
  render is reproducible; a live context is not.
- **A browser check needs the window in front.** Chrome grants no user activation to a tab
  whose `document.visibilityState` is `hidden`, so `AudioContext.resume()` never settles and a
  scripted click is not activation either. Anything needing audio then hangs with no error,
  and the same page passes when the window is foreground. Read
  `navigator.userActivation.hasBeenActive` before concluding anything from a browser hang:
  false means the environment, not the code.
- A source file past about 400 lines is worth a look and past about 600 usually wants
  splitting, along a seam that already exists rather than by line count. Keep the old module
  as the front door and re-export, so callers do not change. A split that edits its callers
  is a rewrite wearing a refactor's clothes.

## Interface rules

- Follow [WCAG 2.2](https://www.w3.org/TR/WCAG22/) at AA. This is load bearing rather than
  aspirational: almost every control a person touches in JigDAW is generated from an
  `lv2:port` declaration by `src/ui/Panel.js`, so one accessible generator makes every
  plugin accessible and one careless one makes every plugin unusable. A plugin author who
  ships no `jig:ui` gets whatever that file does.
- Every control has a programmatic name, a role and a current value. A slider reports its
  value as text, not only as a number, because "4200" and "4200 Hz" are different
  information.
- Keyboard before pointer. Anything reachable by mouse is reachable by tab, and the focus
  indicator is visible against the panel background.
- Do not signal state by colour alone.
- **A control nobody can use is left out, not shown disabled.** Found twice: a port bar
  drawing 44 buttons where 43 were disabled modulation targets, and a channel strip's Level,
  Pan, Mute and Solo on a node declaring `jig:audioOutputs 0`, where none of the four reached
  anything with a signal to change. A disabled control looks identical to an enabled one
  under a screen reader and under the pointer, so nothing about interacting with it says
  whether it does anything; not drawing it is the version of this that is actually
  accessible.
- **Works on a phone.** A `viewport` meta tag, one column below 720px, no horizontal
  scrolling, touch targets of at least 44px, and a font size of at least 16px on any text
  input, because iOS zooms the page in when a smaller one takes focus. A plugin panel is
  generated, so getting this right once gets it right for every plugin.
- **Size by proportion, not by pixels.** A fixed width on a flex child does not shrink, so
  `max-width` on its parent will not save it: that is how the keyboard came to be 88px wider
  than the phone it was on.
- **Measure a narrow layout rather than reasoning about it.** The tests cannot see layout,
  because there is no layout in a DOM without a renderer. Load the page into a narrow iframe
  in a real browser and compare `documentElement.scrollWidth` with `innerWidth`. Note that
  `clientWidth` includes padding, and that an element outside the document measures zero.
- **The same is true of the pointer and the focus**, and it is easier to miss because the
  code looks testable. A DOM without a renderer has no pointer capture to fail and no
  `activeElement` to lose, so a drag that stops at the edge of its element and a control
  that can be nudged once by keyboard both pass every unit test. Drive the real thing:
  dispatch the move and the release on the document, count the arrow keys, and read
  `document.activeElement` afterwards.

## Documentation rules

- Technical plain English. No em dashes. No novel jargon.
- No large language model cliches. Not "delve", "leverage", "robust", "seamless",
  "it's not just X, it's Y", "let's dive in", or a sentence whose only content is that the
  next sentence is coming. A document is read by someone deciding what to do, and a sentence
  that carries no decision is a sentence that wastes theirs.
- Structure a document so it can be read in pieces: a heading says what its section decides,
  and the first sentence under it answers the question the heading asks.
- Link anything that is not common knowledge.
- The contract is normative and uses RFC 2119 keywords. Where it and the vocabulary
  disagree, the contract governs and the vocabulary is a defect.

## Three failures worth naming in advance

This project has made plenty of its own mistakes since, recorded in full in
[MISTAKES.md](MISTAKES.md), newest first. These three recur across bugs that otherwise share
nothing: a UI control, a graph compiler, a native profile parser, a message channel. The
first two were anticipated in advance, inherited from repositories that made them repeatedly;
this project made them too.

**A change in one file usually needs a second file to change with it, and nothing
connects them.** When adding a runtime dependency on a path, a value or a list, find what
else has to agree with it and write the test that binds them. A test asserting that two
lists match is worth more than either list being carefully reviewed.

That instance is now closed, and it is worth reading as a worked example. `trn:WebAudio` did
not exist upstream and plugin-universe's `pu:PluginShape` had an `sh:in` list of permitted
formats, so every JigDAW profile harvested there was a violation. Fixing it turned out to
need **three** files in step, not two: the format individual in
`plugin-universe/vocabs/trn-extensions.ttl`, the `sh:in` list in its `vocabs/shapes.ttl`, and
`PLUGIN_FORMATS` in `src/contrib/Submissions.js`, which is the list its submission form
offers. The third was found by a test that repository already had, binding the form's list to
the shapes, which failed the moment the other two changed.

Two lessons. The population was larger than the rule stated, which is the recurring shape of
this failure. And the guard that caught it was written by the project that had paid for the
mistake before.

**A rule worth stating is worth a test.** A rule in this file that nothing checks will be
broken, and nobody will notice until it has been broken many times. When adding one, ask
what would notice it being violated. If the answer is "a careful reader", write the check
instead.

The worked example is in this file. "No blank nodes for anything addressable" has been stated
here since phase 0, and `bin/write-profile.js` wrote every `lv2:scalePoint` as a blank node
from phase 2 to phase 9b, three per enumerated port across every plugin and the reference
example. Nothing read it, because nothing had needed a stable name for one, and it surfaced
only when signing needed a canonical form and the first real plugin refused to canonicalise.
`tests/rdf/Canonical.test.js` now canonicalises every tracked `.ttl`, which is the check that
should have existed instead of the sentence.

**A guard is only as wide as the list it walks**, and the list is the part nobody re-reads.
Three separate guards here have been right about the rule and wrong about the population:
one read only committed files and so ignored all new code, one listened only to nodes that
had routes, one checked a config list from inside a suite that list governed. When adding a
guard, write down what it walks and ask what is outside that set.

Corollary, learned twice: a guard that cannot run is worse than no guard, because it looks
like coverage. **A guard must not depend on the thing it guards**, and the way to find out
is to break the thing on purpose and watch the guard go red. One check of the vitest include
list lived in a suite governed by that list, so deleting the entry switched off the test that
would have caught it. Three sibling guards mutation-tested at the same time all failed
correctly; that one looked identical and did not. Three constraints there were written as
`sh:sparql` and would have thrown rather than validated; two more were written in forms that
passed everything. They were found by writing `examples/counterexample-profile.ttl`, a
profile that violates every constraint once, and checking that each one fired.

**A sentence about the system is a claim, and nothing tests sentences.** Take every figure
from the system rather than from memory: a `curl` to `/health`, a SPARQL count, a `grep -c`.
Where prose is a commitment, bind it with a test.

**A fake that is more permissive than the real thing turns a specification error into a
passing test.** A stand-in for a platform API is worth having only where it refuses what the
real one refuses. When writing one, ask what the real API forbids, not only what it returns
for ordinary input.

Twice, and by a wide margin the more expensive failure in this project's own record.
`src/testing/OfflineHost.js`'s fake `MessagePort` handed a `WebAssembly.Module` straight to a
callback, so 288 passing tests, including an end-to-end one that rendered real audio, said
nothing about `port.postMessage({ module })` being silently undeliverable in a real
`AudioWorklet`: found on the first page load, ten seconds into a timeout that named nothing
useful. `PluginLoader`'s default `fetch = globalThis.fetch`, called through a private field,
passed 219 tests because node's `fetch` does not care what it is called on; a browser's
throws `Illegal invocation` on a detached call, and the deployed page failed on its first
real request with an error message that blamed CORS instead. Both fakes now refuse what the
real thing refuses, mutation tested by reverting each fix and watching the suite fail the way
the browser did.

## Working rules

- API keys are sacred. They must not be shared, and nor may anything that merely looks like
  one be committed. A scanner cannot tell an invented fixture from a live credential.
- Do not run any `git` operations unless the user explicitly approves them.
- Before creating a file, list the directory it is going into.
- Run the program after any change to imports, wiring or startup. The test suite does not
  catch that class of failure.
- A route or a tool is not reachable until a real request has reached it. Unit-testing a
  handler proves the handler and says nothing about the guard or the mounting order in front
  of it.
- Read a test run by its `Test Files` line and its exit code, not only the `Tests` count. A
  file that cannot be parsed runs no tests and prints none of the markers a failing
  assertion does, so filtering the output can turn it into an apparent pass. A suite just
  added must move the count; if it did not, it did not run.
- Log mistakes in `MISTAKES.md`, newest first: what happened, root cause, prevention.
- Review `TODO.md` periodically and revise it. Promote anything systematic from
  `MISTAKES.md` into this file.

## Related repositories

Prior art and seed data, described in [docs/local-references.md](docs/local-references.md).
JigDAW depends on none of them.

- `~/github/transmission` gives the `trn:` vocabulary and the discovered/curated split, and
  now hosts JigDAW plugins itself by linking `jigdaw_core`, which makes it the one place a
  change to that library is felt outside this repository
- `~/github/downspout` gives 52 hand-written profiles, the format in real use
- `~/github/valis` gives instruments as RDF, and the ontology to registry symmetry test
- `~/github/plugin-universe` is live at plugin-universe.com, with a public SPARQL endpoint
  and MCP endpoint over 756 plugins
