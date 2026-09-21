# TODO

What the project needs. Remove an item when its implementation and verification are
complete. Review periodically.

## From the inbox

- [x] **Read every document against the documentation rules, 2026-09-19.** Normative documents
      first, per the item's own instruction: `host-plugin-contract.md`, `plugin-profiles.md`,
      `messaging.md`, `latency.md`, `project-format.md`, `webmcp.md`, `namespace.md`,
      `module-abi.md`, `plugin-bundles.md`, `architecture.md`. Then `README.md`,
      `README.agents.md`, `HUMANS.md`, the two plugin READMEs (`8b8`, `_jsfx-runtime`), and the
      background docs (`plan.md`, `local-references.md`, `deployment.md`, `wam.md`).
      `first-thoughts.md` was left alone, as the original sketch always is.

      No cliche turned out to be frequent: a grep for the usual list (delve, leverage,
      seamless, robust, and about thirty more) found nothing anywhere in the set, so there is
      nothing to promote into `MISTAKES.md` or the guard. Most of the normative documents
      needed no changes at all; they already do what the rule asks, heading answering its own
      question in the first sentence.

      What the pass actually found was a different, more concrete class of defect: sentences
      that were true when written and are not any more, which is exactly the failure `AGENTS.md`
      names ("a sentence is a claim, and nothing tests sentences"). Fixed:

      - `plugin-profiles.md` and `README.md` leaked or pointed at things that no longer exist:
        an absolute `/home/danny/...` filesystem path where every sibling document says
        `~/github/...`, and two links to `web/docs/plugins.html` and `.../hosts.html`, a
        directory removed by the GitHub Pages migration (`docs-site` note in this file, above).
      - `module-abi.md` said "both worked plugins declare" the ABI. Five now do (Cascade, Pulse
        and Dynamix at version 1; BassGen and the 8-Bit 8asterd at version 2), and its own link
        to the removed `plugins.html` page needed the same fix as README's.
      - `namespace.md` pointed at "`HUMANS.md` item 2" for a vocabulary-serving runbook that
        item no longer is, because the numbering moved when today's earlier HUMANS.md tidy-up
        closed out the two items that used to sit above it. Removed rather than repointed: the
        deployment already happened and does not need a runbook entry any more.
      - `architecture.md` opened with "None of the DAW is implemented," which stopped being
        true phases ago, and its catalogue and deployment sections described the planned
        Fuseki-backed store as though it were what runs, when what actually shipped is
        `LocalCatalogue.js` reading `profile.ttl` files with no store at all and federating
        plugin-universe's search live. Corrected to say what runs and what is still planned,
        matching the framing `deployment.md` already had for the same fact.
      - `deployment.md`'s own "not settled" list still said "the store," predating the decision
        that there isn't one yet either.
      - `wam.md` had a literal duplicated `## Testing` heading, and a stray double blank line
        sat between two paragraphs in `deployment.md`.

      None of this was a style problem the rule set out to catch; all of it was found by
      reading each document against the current state of the repository rather than against
      itself. `README.agents.md` got the two remaining mechanical misses (a doubled comma, the
      same "signal processing is WebAssembly" absolute claim `for-plugin-authors.md` already
      had softened for Tremolo) and otherwise needed nothing.

- [x] **Foreign plugins work in the application, 2026-09-18.** Contract section 12, end to
      end in Chrome: a Web Audio Module fetched by IRI, classified as foreign, consented to
      through the dialog, verified as a container, served from the worker, adapted, adopted by
      the engine, drawn with a generated panel, marked FOREIGN in the rack, and **passing
      audio to the speakers** with the impulse source feeding it. A native Cascade sits in the
      same rack, unmarked, and a parameter set through the WebMCP surface returns its clamped
      value from the range the plugin itself reported.

      The earlier "hang" was the browser tab being hidden, which grants no user activation, so
      `AudioContext.resume()` never settled. Recorded in `MISTAKES.md` and in `AGENTS.md`.

- [x] **A panel's readout did not follow a parameter set from outside it, fixed 2026-09-19.**
      `drawRack` now pushes every entry of `node.settings`, the model's own record of what was
      actually set, into the panel on every redraw, whether the panel was just created or
      reused from the cache. Verified in Chrome: Cascade's Mix set to 0.83 through WebMCP now
      moves the knob, the readout and `aria-valuetext` together, not only the model.

      The channel strip was checked and did not need the same fix: `strip.update(node.channel,
      ...)` already runs unconditionally on every redraw, cached or fresh, so it was never
      exposed to this. There is no `setChannel` WebMCP tool to demonstrate that live with, so
      it stands on the source rather than on a browser run.

      `tests/ui/Panel.test.js` binds the wiring in `web/app.js` the way
      `tests/ui/Focus.test.js` already does for the focus fix: one assertion that the push
      exists, one that it is not gated inside the `if (!panel)` branch that only a freshly
      created panel takes. Mutation tested both ways: removing the push fails both, moving it
      inside the creation branch leaves the first green and fails only the second, which is
      what makes it the assertion that matters.

- [x] **Provenance and signing for bundles, 2026-09-18.** Done, and in
      [docs/plugin-bundles.md](docs/plugin-bundles.md) sections 5 to 8 rather than here. Every
      bundle carries a `provenance.ttl`; `bin/bundle.js --key` signs; `bin/verify.js` reports.
      Phase 9b in [docs/plan.md](docs/plan.md) has the shape of it.

      Three things are deliberately not done and are recorded as absent rather than as work.
      **No revocation**: nothing can say a key was later withdrawn, which needs somewhere to
      publish a withdrawal and a reason to believe that place. **No trusted key list**, ever:
      whose signature means something is a question about people. **No countersigning tool**,
      though the format allows it and the canonical form was built so that a second signature
      cannot invalidate the first.

- [x] **A published key has a home, 2026-09-19.** `HUMANS.md` item 2, done by the user:
      `https://strandz.it/jigdaw/keys/danja#ed25519` is live, `web/keys/danja.ttl` committed
      and pulled. Measured against the server, not assumed: the IRI answers 200, `text/turtle`,
      byte for byte the same as the committed file, so `node bin/verify.js <bundle> --online`
      now has something real to check a signature against rather than only the copy inside the
      bundle. No plugin has actually been bundled and signed with it yet; that is a separate,
      smaller step whenever a bundle is wanted.

- [x] **CORS audited, 2026-09-17.** Measured through the real servers, not read from config.

      Clean: every route the page fetches returns exactly one `Access-Control-Allow-Origin: *`,
      on the live site and locally, and preflight answers 204 with the right headers. Now
      guarded by `tests/server/cors.test.js`, which starts `bin/serve.js` and asks it, counting
      `rawHeaders` because node joins duplicates with a comma and would turn the exact fault
      into a plausible string. Mutation tested by adding a second header and by removing it.

      **The cross-origin case was exercised for the first time.** A plugin served from
      `localhost:6027` loaded into a page served from `127.0.0.1:6026`, a genuinely different
      origin, and played a note: fetched, digest verified, worklet registered cross-origin,
      WebAssembly instantiated, peak 0.2284 held and 0 released. The identity and retrieval
      split held: the profile kept its canonical `https://strandz.it/...` IRI while its module
      and processor were rebased onto the origin it was actually fetched from. This is the case
      the whole design rests on and nothing had ever run it.

      An origin that forgets the header fails correctly: *Failed to fetch. If the profile is on
      another origin, it must be served with Access-Control-Allow-Origin.* The real error first
      and CORS as a conditional suggestion, which is the corrected wording from `MISTAKES.md`.

      Two findings, neither ours to fix, both recorded below.

- [x] **`http://purl.org/stuff/jigdaw/` cannot be dereferenced by a browser. Said so,
      2026-09-19.** `docs/namespace.md`'s "Dereferencing it from a browser needs the https
      form" section states it in full: the measured redirect chain, why the opening hop being
      mixed-content-and-no-CORS is enough to stop the fetch on its own, and that a browser
      based consumer MUST use the `https://purl.org/stuff/jigdaw/` form. Checked whether
      `for-hosts.md` or `for-plugin-authors.md` needed the same note, since that was the
      original worry (an author following advice to dereference hitting this and concluding the
      vocabulary is broken): neither tells an author to dereference the namespace IRI at all,
      only to write `jig:` terms into a profile, so there is no advice there that leads into the
      trap. `docs/namespace.md` is itself published, on GitHub Pages as of today.

- [ ] **Let a local agent drive the DAW.** Two ways, and the cheap one is probably enough.

      **First, try inverting the direction.** The page already has everything: `registerTools`
      returns a surface with the eleven tools, their schemas, and `call(name, input)` that
      normalises a throw into a result. A local model with an HTTP API is reachable from the
      page, so the page can run the agent loop itself: read `jigdaw.mcp.tools` as the tool
      list, POST to the model, call `jigdaw.mcp.call` with what comes back. No new endpoint, no
      new listener, and nothing outside the browser can reach the session. Ollama and llama.cpp
      both answer on loopback and both send permissive CORS, so this works today.

      **If the agent must be the caller**, a relay, never a second implementation. `bin/serve.js`
      gains `GET /mcp/events` as an SSE stream and `POST /mcp/result`; the page connects,
      receives `{id, name, input}`, calls `jigdaw.mcp.call`, and posts the result back. An MCP
      client POSTs to `/mcp`, the server parks the request until the page answers. SSE and POST
      rather than a WebSocket because node has a WebSocket client and no server, and
      `bin/serve.js` is guarded to node builtins only: a dependency there breaks deployment.
      The page posts its tool list on connect so `tools/list` needs no round trip.

      **What it costs, which is the part to decide on.**

      - It only works while a page is open. The DAW *is* the page, and there is no session
        without one. An agent that should run unattended wants something else entirely.
      - Two open pages are two sessions. Needs a session id, or first-one-wins stated plainly.
      - **Security is the real objection.** A loopback endpoint that can drive the DAW is
        reachable by every process on the machine, and by any website through DNS rebinding: a
        public page resolving its own name to 127.0.0.1 can POST to it, and CORS blocking the
        *response* does not help, because the edit has already happened. Bind to loopback,
        require a bearer token printed at startup, and reject any request carrying an `Origin`
        that is not the DAW's own. Doing this without a token would be a bad idea.

      **What would be a bad idea: moving the model out of the page.** The audio graph cannot
      leave the browser, so a model in node means the model and the engine are on opposite
      sides of a wire, which is two sources of truth for the thing `docs/architecture.md` keeps
      as one. Refuse that even though it is the obvious way to get a headless agent.

## Namespaces

- [x] **JigDAW vocabulary served, and it resolves.** `http://purl.org/stuff/jigdaw/` reaches
      `https://hyperdata.it/xmlns/jigdaw/` and answers 200, content negotiated, with CORS and a
      303 from every term. `trn:` was done the same way on 2026-09-18 and now carries 208 terms.
- [ ] **Individual `pu:` terms dereference for nobody.**
      `purl.org/stuff/plugin-universe/supportedPlatform`, whose namespace root resolves
      correctly, lands on `plugin-universe.com/supportedPlatform` and 404s, because the
      override is a prefix replacement that does not account for sub-paths.

      The fix is now a worked example twice over, in `deploy/nginx/vocab.conf` here and in
      transmission's. Needs the user: it is a deployment to a server, in another repository.

## Blocking, cross-repository

- [x] **A web plugin format term, 2026-09-17.** `trn:WebAudio` added to plugin-universe's
      `vocabs/trn-extensions.ttl` and to the `sh:in` list on `trn:format` in its
      `vocabs/shapes.ttl`, and `trn:requires` there no longer insists on the `trn:` namespace,
      which was refusing `jig:MidiEvents` and `jig:MidiOut`.

      All three JigDAW profiles now conform to plugin-universe's shapes, measured with its own
      validator; all three failed before. Both changes mutation tested, its suite at 1351
      passing. Uncommitted in that repository: `HUMANS.md` item 2.

      It needed a third file, `src/contrib/Submissions.js`, which its own test found. See the
      worked example in `AGENTS.md`.

- [x] **Platforms decided: meaningless here, 2026-09-19.** The second option: no web platform
      term was added. `plugin-universe/vocabs/trn-extensions.ttl` carries the reasoning as a
      comment beside `trn:WebAudio` itself, checked present just now: "`pu:supportedPlatform`
      does not apply to one... the platform is the browser... and this format term carries what
      the platform list was carrying." Recorded as `HUMANS.md` item 5 in this repository too.

- [x] **`trn:` has converged on its upstream, 2026-09-18.** The format individuals and the
      deprecations moved from plugin-universe's `trn-extensions.ttl` into
      `~/github/transmission/vocabs/formats.ttl`, which its own header had been asking for.
      Measured after: plugin-universe declares nothing upstream does not. A test in
      transmission compares the two when that checkout is present.
- [x] **The inspection vocabulary now has a consumer, 2026-09-20.** Contract section 10.3
      says a host SHOULD record load outcomes as `jig:Inspection` records, including
      failures; nothing did. `src/host/Inspections.js` is the minimal thing that makes that
      true: plain records shaped like the four predicates (`inspectionOf`, `inspectedAt`,
      `hostVersion`, `loadOutcome`), kept in `localStorage` under a bounded, oldest-dropped
      list, because nothing in a browser host writes RDF triples of its own and this is what
      would serialise cleanly if something ever did.

      Wired into the one place a load's outcome is actually known,
      `OpDispatcher.addPlugin`: a record on success (`"loaded"`), a record on failure
      (`"failed: <reason>"`, matching `jig:loadOutcome`'s own "loaded, refused, or failed,
      with the reason"), neither for a `ConsentRequired` since nothing was attempted yet.
      Present by default rather than opt-in, unlike foreign plugin support, because
      recording is what the SHOULD asks for rather than a capability a host chooses to
      offer; `web/app.js` needed no change to get it.

      `tests/host/Inspections.test.js` covers the module (round trip, the 200-record bound,
      no storage, corrupt storage, a storage that throws on access); two tests in
      `tests/ops/OpDispatcher.test.js` bind the wiring with an injected fake. Verified live in
      Chrome, not only in the suite: loaded Pulse, read `localStorage['jigdaw:inspections']`
      back with `loadOutcome: "loaded"`; loaded a nonexistent IRI, read
      `loadOutcome: "failed: ... returned 404"` appended beside it.

      Not done, and deliberately smaller than this: `jig:Threads` and `jig:ExceptionHandling`
      (WasmFeature individuals) are still declared and still unused by any profile or shape.
      Separate question from Inspection, unrelated to Phase 5, not investigated this pass.

## The application

Behaving more like a real DAW, an open-ended direction rather than a phase with an end.

- [ ] **A Preset menu, loading a particular configuration of plugins.** From the inbox,
      2026-09-19. Not designed yet. The obvious shape given what already exists: a preset is a
      project (`src/rdf/ProjectWriter.js`/`ProjectReader.js` already round-trip one), so this is
      closer to a curated, named `openSession` than a new format. Open questions worth settling
      before building: where presets live (bundled with the app under `web/`, or user-saved
      alongside `Save`/`Open`), whether loading one should go through `OpDispatcher.undo()`'s
      history the way `openSession` does (clearing it, since a preset is a different session,
      not a further edit to the one open), and whether a preset names plugins by IRI, which
      needs them reachable, or bundles them the way `bin/bundle.js` does for one plugin.

- [x] **Undo and redo, 2026-09-19.** `OpDispatcher.undo()`/`redo()`, snapshot-based: every
      commit through `apply()` pushes the project as it was just before, and stepping back
      reconciles the live project to a snapshot through the same public methods a person or
      the WebMCP surface would use (`apply()`, `addPlugin()`, `setParameter()`), never by
      writing state in directly, so the engine's AudioParams, the channel strip and the links
      move with the model exactly as they do for any other edit.

      A node the target snapshot has and the present does not is reloaded from its plugin
      IRI, the same path reopening a saved session takes, with its id, settings, channel and
      state preserved; a node a reload could not restore is left out rather than refusing the
      whole step. Connection identity is the connection's own id, stable across a project's
      history, so restoring after a healed removal (Remove with `heal: true`, which bridges
      the gap left in a chain) puts back exactly the two original connections and removes the
      bridge, not both.

      Wired to Undo and Redo buttons in the transport bar (disabled rather than hidden, so a
      screen reader always finds the same two controls) and to Ctrl/Cmd+Z and
      Ctrl/Cmd+Shift+Z or +Y, left alone while an input, a textarea or anything contenteditable
      has focus so the browser's own text undo still works there. `OpDispatcher.clearHistory()`
      is called after `openSession` loads a different project, so undoing right after opening
      a file cannot try to step back into the session that was open before it.

      `tests/ops/OpDispatcher.test.js` covers parameter, channel, connection and transport
      edits, adding and removing a node (including the reload path and its engine calls), the
      healed-removal case, that undo/redo do not themselves become undoable, and that a dry
      run or a refused change is not recorded. `tests/ui/History.test.js` binds the button and
      keyboard wiring in `web/app.js`, which has no `AudioContext` to run under vitest, the
      same source-position pattern as `tests/ui/Focus.test.js`. Both the `#recording` guard
      and the healed-connection reconciliation were mutation tested. Verified live in Chrome:
      turning a knob and undoing it moves the engine's `AudioParam`, not only the model;
      removing Pulse and undoing the removal reloads it with its settings intact.

## Documentation

- [x] **The specification publishes to GitHub Pages, built from the same markdown, 2026-09-19.**
      `web/docs/` was a hand-written trio of HTML pages summarising the specification, and it had
      gone stale the way a hand-kept copy of something else always does: it named two plugins
      once there were eight and said there was no mixer once there was one. It is gone.

      `bin/build-docs-site.js` renders every `docs/*.md` file into a static site, one page each,
      with a nav built from the files that are actually in `docs/` rather than a curated list
      that goes stale the day a document is added. `.github/workflows/docs.yml` builds and
      deploys it on every push to `docs/`, through the standard `upload-pages-artifact`/
      `deploy-pages` actions. `docs/index.md` (new), `docs/for-hosts.md` and
      `docs/for-plugin-authors.md` (converted from the old HTML, content kept, counts and status
      brought current) are the pages that used to be hand-written; every other normative document
      publishes as a rendering of itself, unchanged.

      `web/index.html`'s Docs link now points at the published site rather than a local path.
      `tests/docs/conventions.test.js`'s published-documentation checks now build the site for
      real (`docs-site/` is gitignored, built fresh by the workflow) and check its output:
      every document gets a page, every internal link resolves, a link leaving `docs/` points at
      the right GitHub `blob` or `tree` URL depending on whether it names a file or a directory,
      and the repository is named correctly. That last check had to be narrowed while doing this:
      it used to flag any `github.com` link that was not exactly `danja/jigdaw`, which was fine
      against three curated pages and a false positive against eighteen, one of which links to
      one of WAM's own example repositories. Narrowed to the actual historical mistake (the
      account written as `jigdaw`, or `danja` pointed at some other repository) and mutation
      tested against the original.

      **Needs a person**, in `HUMANS.md`: GitHub Pages is not turned on for the repository yet,
      so the workflow will build and have nowhere to deploy to until someone does.

      **Redesigned the same day, once deployed and seen live.** The first version reused
      `web/docs/`'s old single-column layout with all eighteen documents in one wrapping top
      nav, which was the flat list `web/docs/` itself never had to carry (it named three
      pages, this names every document there is). Now a grouped sidebar (Specification, Guides,
      Background; a document not placed in `GROUP_OF` in `bin/build-docs-site.js` still appears,
      filed under Background, rather than disappearing) that scrolls independently of the
      article, and code blocks syntax highlighted at build time with `highlight.js` rather than
      left as plain monochrome text. highlight.js ships no Turtle grammar, and Turtle is what
      most of this documentation's own examples are written in, so `bin/highlight-turtle.js` is
      a small one written for exactly what appears in `docs/*.md`: comments, `@prefix`/`@base`,
      prefixed names, IRIs, strings, numbers and the bare `a` keyword.

      `tests/docs/highlight-turtle.test.js` checks the case that would be easy to get wrong: `a`
      must not fire inside a prefixed name (`trn:AudioEffect`) or inside a string that happens to
      contain the word "a", both directly asserted and reasoned through highlight.js's own
      leftmost-match engine (whichever rule's opening delimiter appears earliest in the
      remaining text wins, so a string's opening quote, appearing before any `a` inside it, wins
      the string the content belongs to before the keyword rule is ever consulted). Verified live
      in Chrome, including the sidebar's collapse to a stacked layout at 375px width, measured in
      a real iframe rather than reasoned about, the same discipline AGENTS.md already asks for
      narrow layouts elsewhere.

- [x] **Announcement draft, 2026-09-19.** From INBOX.md: "check docs/announce.md and draft the
      sections - I will edit later to humanize." Filled in the outline (introduction and
      security posture, the Linked Data description, relation to LV2/plugin-universe/WAM/JSFX/
      VST3, a section each for host and plugin developers, and what is implemented) against the
      normative documents and `README.md`'s own status section, in the same plain-English house
      style as the rest of `docs/`. Deliberately not linked from `docs/index.md` or anywhere
      else: it is a draft for the user to edit, not yet a published page, and `tests/docs/
      conventions.test.js`'s orphan check already treats it as referenced because INBOX.md
      names it by filename.

## JSFX plugins

- [x] **An adapter converting REAPER JSFX effects into native JigDAW plugins,
      2026-09-19.** A JSFX effect is EEL2 script, not compiled code, so this runs the script
      inside a plugin's real-time sandbox rather than wrapping a binary. `src/jsfx/` parses a
      restricted EEL2 subset (`Parser.js`), compiles it to a small bytecode format
      (`Compiler.js`), and reads a JSFX file's header and sliders (`HeaderParser.js`);
      `plugins/_jsfx-runtime/` is a `#![no_std]` Rust crate implementing the stack-based VM
      that bytecode runs on, copied into every converted plugin's own directory rather than
      shared across profiles, so nothing about how a plugin directory works had to change.
      `bin/jsfx-import.js source.jsfx plugin-name` does the conversion end to end.

      Proven on three original fixtures rather than claimed complete against arbitrary JSFX:
      [examples/jsfx/](examples/jsfx/) has a gain trim, a one-pole lowpass filter (state
      surviving across blocks) and a soft/hard clipper. What the restricted subset does not
      cover, and why, is in `plugins/_jsfx-runtime/README.md`: user-defined `function`,
      strings, `@gfx`/`@serialize`, `gmem`, the two-parenthesis form of `while`, and
      case-insensitive identifiers.

      Real-time rules hold the same way as every other plugin here: the compiled program, the
      variable registers, the local memory array and the operand stack are fixed size and
      preallocated, and a runaway script is bounded by one instruction budget per
      `jig_process` call rather than by trusting the script to terminate.

      This needed one real host-contract addition along the way: `jig:asset` had been
      declared and read into `profile.assets` for a while but nothing delivered the bytes to a
      running plugin. `src/host/Instantiate.js` now fetches and verifies every declared asset
      the same way as the module and the processor, and posts them alongside the module bytes
      in the `init` message (`docs/messaging.md` section 1.2), which is what
      `plugins/_jsfx-runtime`'s processor uses to load a converted script. Generic rather than
      JSFX-specific, so a future plugin wanting a wavetable or an impulse response gets it too.

      `tests/dsp/jsfx-runtime.test.js` is the strongest check: real compiled bytecode run
      through the real built VM, not the compiler checked against itself. Also
      `tests/jsfx/HeaderParser.test.js`, `tests/catalogue/PluginDirectories.test.js` (a shared
      helper five call sites now use, after `plugins/_jsfx-runtime/`, which has no
      `profile.ttl`, broke two tests that walked `plugins/` independently), and the new asset
      tests in `tests/host/PluginLoader.test.js`. Mutation tested: the short-circuit
      compilation of `&&`/`||`, and asset delivery and verification in `Instantiate.js`.
      Verified live in Chrome: all three converted plugins loaded, auto-chained, played real
      audio, and a slider moved during playback with the console clean.

## The reference host

- [x] **A minimal, standalone host, 2026-09-19.** Asked in a session on whether an SDK plus a
      minimal cross-platform host existed for developers to build against: the SDK-shaped
      pieces did (`PluginLoader.js`, the bundler, the signer, the JSFX importer), a real
      headless host did not, and the closest thing, `src/testing/OfflineHost.js`, was filed
      under `src/testing/` and every existing use of it rendered one node in isolation, never a
      chain. This is that promoted: `src/host/ReferenceHost.js`'s `renderChain()` loads plugins
      by IRI (or a local directory via `roots`, for one not yet published) and renders them, in
      Node, no browser; `bin/host.js` is its CLI, writing a WAV file.

      Deliberately a **chain, not a graph**: each plugin's output feeds the next, no branching,
      no mixing. `OfflineContext`'s fake gain and delay nodes only record connections for a
      test to inspect; they do not actually mix audio during a render. Building something that
      does would duplicate `src/compiler/GraphCompiler.js`'s topological order and latency
      compensation in a second implementation that can drift from the one the app itself uses,
      exactly what AGENTS.md warns against. It is also **not built on `OpDispatcher`/`Engine`**:
      it posts MIDI to a plugin's `port` directly, `{ type: 'events', events }` per
      `messaging.md` section 6, the same shape a host written from scratch would use, which is
      more useful as a reference than routing through this app's own convenience layer.

      A real timing bug surfaced and got fixed while building it: `OfflinePort` delivers a
      posted message via `queueMicrotask`, and `render()` runs synchronously right after
      posting a note, so without a real turn of the event loop between the two the note was
      still in flight and landed one quantum late. Mutation tested by removing the
      `await new Promise(resolve => setTimeout(resolve, 0))` between them and confirming the
      "delivered at the frame it is due" test catches it.

      `src/host/Wav.js` is a hand-rolled WAV encoder (44 byte RIFF header, 16 bit PCM) rather
      than a dependency for something this small to get right directly. `tests/host/Wav.test.js`
      checks header fields and interleaving against a known buffer; `tests/host/
      ReferenceHost.test.js` runs Cascade (fed a single-frame impulse, since a chain starting
      with an effect has nothing feeding it otherwise, the same reason `web/app.js`'s own
      `makeSource()` exists) and Pulse (given a MIDI note) for real, plus a Pulse-into-Cascade
      chain proving one plugin's output actually reaches the next. Verified live: rendered
      against a local plugin directory, against a two-plugin chain with a held note, and against
      the real `strandz.it` deployment over the network, each producing a real, playable WAV.

      Explicitly not attempted here, each a separate, larger decision: real-time playback
      (needs a native audio binding this repository has never depended on); a packaged,
      installable SDK (`npm install`, versioning); a non-Node (compiled native) reference host.

## A pure-JavaScript plugin

- [x] **Tremolo, 2026-09-19.** From INBOX.md: "Can we have a pure JS example, that doesn't
      involve WASM?" `jig:module` has been optional since phase 0
      (`vocabs/shapes.ttl`'s `jig:WebPluginShape` only warns about its absence), but every one
      of the 8 existing plugins declared one anyway, so nothing had ever exercised that path.
      `plugins/tremolo/` is an amplitude modulator, `rate` and `depth` into a sine LFO, whose
      processor is the entire plugin: no `.wasm` file in its directory, no compile step in its
      `build.sh`. The same real-time rules apply with no relaxation, because they are Web
      Audio's rules rather than WebAssembly's: `process()` still allocates nothing, and
      `src/host/Instantiate.js` still runs the full init/ready handshake before the host
      connects the node, posting `module: null` rather than skipping the message.

      `bin/write-profile.js` emitted `jig:module <#module> ;` unconditionally, so a profile
      with no module resource would have written a triple pointing at nothing. Made
      conditional on `template.resources.module` being present, the same shape as how
      `jig:asset` is already optional there.

      Found and fixed along the way: `jig:module`'s SHACL constraint was `sh:maxCount 1`
      at warning severity, which a profile with **zero** modules satisfies trivially, so the
      warning ("No WebAssembly module declared... worth confirming") could never fire for the
      absence it names, and nothing had ever tested it. Split into a structural `sh:maxCount 1`
      and a separate `sh:minCount 1` at warning severity so the absence case actually fires;
      `tests/validate/ShapeValidator.test.js` now asserts the warning appears for Tremolo's
      profile and not for Cascade's. Mutation tested: reverted the fix, confirmed the new test
      fails, restored it.

      `tests/host/tremolo.test.js` loads it through the real `PluginLoader`/`Engine` path
      (`profile.module` is `null`, not a stub), confirms depth 0 passes a signal through
      unchanged (proving the audio path is connected rather than faked), and confirms depth 1
      modulates a steady tone's envelope down toward silence and back without ever inverting
      it. Mutation tested: replaced the gain calculation with a constant 1, confirmed the
      envelope test fails, restored it. Verified live in the browser (panel generates
      correctly from `lv2:port`, plays with no console errors) and via
      `bin/host.js --root ...=plugins/tremolo`, whose reported peak (0.750, at the default
      depth 0.5 and an impulse at LFO phase 0) matches the DSP by hand.

## The native adapter

- [x] **`Chain::process` dropped the tail of every block, fixed 2026-09-18.** It rendered
      `min(frames, jig_max_frames())` and left the rest of the host's buffer as it found it, so
      a DAW at 512 got one sub-block rendered and three quarters stale, with the MIDI and the
      transport handled once for the lot.

      Now split properly: sub-blocks of at most `jig_max_frames()`, the transport advanced to
      each sub-block's position through `Chain::transportAt`, incoming events rebased onto the
      sub-block and outgoing ones rebased back onto the host's block.

      `native/jigdaw-adapter/tests/chain_test.cpp` runs a chain at 512 with a sentinel in the
      buffer and checks that nothing survives. Mutation tested: reverting the loop leaves 384
      of 512 frames stale. The mutation also showed the first version of the second check
      passing on the sentinel itself, whose RMS is enormous, so it now requires the tail to be
      in a range audio can occupy.

      `docs/module-abi.md` now states the splitting rule instead of implying it, which is what
      let this through.

- [x] **`JIGDAW_PARAMETER_COUNT` too small for the 8b8, fixed 2026-09-19.** Reported by the
      user: loading it through the JigDAW Adapter in Reaper, only a fraction of its 42
      controls showed. Raised from 16 to 128; full account, including why it went unnoticed
      and how it was reproduced natively without Reaper, in `MISTAKES.md`.

- [x] **The adapter's own editor panel now scrolls, fixed 2026-09-19.** Found DPF at
      `~/github/downspout/third_party/DPF`, per the user, which built the real VST3, CLAP,
      LV2 and a standalone JACK executable. `panelScroll_`, mouse wheel, arrow-key auto-scroll
      (`revealSelected`), and a "34-42 of 42" indicator with a minimal scrollbar. Verified
      running on a virtual display with `xdotool` and screenshots, not just compiling: full
      account, including confirming a click on a control still sets the right one once
      scrolled, in `MISTAKES.md`.

## Before there is code

- [x] `src/rdf/Vocabulary.js` exists, is frozen constants, and is bound to the ontology in
      both directions by `tests/rdf/vocabulary.test.js`.
      `tests/rdf/vocabulary.test.js` already binds the vocabulary to the shapes and examples
      in both directions, which is the useful half of valis's ontology-to-registry symmetry
      test. The other half arrives with the code.
- [x] **A `/new-plugin` command, 2026-09-19.** `.claude/commands/new-plugin.md`, modelled on
      `~/github/valis/.claude/commands/new-element.md`. Takes `<PluginName> <role>` where role
      is `effect`, `instrument` or `generator`, and defaults to a plain-JavaScript plugin
      (`plugins/tremolo/` copied as the shape) rather than templating a WebAssembly toolchain,
      because that compiles and validates immediately with nothing installed; a plugin that
      genuinely needs WebAssembly is pointed at `plugins/cascade/` to copy from instead rather
      than templated, which is a different and larger job.

      No registry step, unlike valis: JigDAW discovers plugins by walking `plugins/`, and
      `npm run build:index` finds whatever validates there. The command's steps are profile,
      processor, `build.sh`, validate, `build:index`, a test modelled on
      `tests/host/tremolo.test.js` that loads the plugin through the real
      `PluginLoader`/`Engine` path, then `npm test`.

      Verified by actually running it, not by reading it: scaffolded a scratch effect plugin
      by hand-following the command's own steps, confirmed `npm run validate` passed with
      exactly the "no WebAssembly module" warning `jig:module`'s shape is supposed to give,
      confirmed `npm run build:index` found it, and confirmed its own test passed a real
      signal through the real host path unchanged. Deleted afterward, along with its test;
      nothing from the scratch run was kept.

## Recurring, check periodically

- [x] Read `MISTAKES.md` for anything systematic and promote it into `AGENTS.md`, 2026-09-19.
      All 1029 lines, newest first. The three failures already stated there (files that need
      to change together, rules with no test, guards narrower than their population) covered
      most of the recurring shape; two more had 2+ occurrences and no home yet, now added:
      hiding a control nobody can use rather than showing it disabled (the port bar, then a
      channel strip on a MIDI-only node), and a test double more permissive than the real
      platform turning a spec violation into a pass (a fake `MessagePort` accepting a
      `WebAssembly.Module`, `PluginLoader`'s default `fetch` not enforcing a detached-call
      error). Also fixed while in there: `AGENTS.md`'s opening said "None of the DAW exists,"
      unchanged since phase 0, and "This project has not made its own mistakes yet" above a
      file that is now 1029 lines of exactly that.
- [x] **Re-measured, 2026-09-20, and the rule changed rather than the figure.** The
      plugin-universe count had drifted again, 756 in nine places against 761 measured live,
      two days after the last correction. Not a one-off: `/health` shows it was 756 on
      2026-09-18 and 761 on 2026-09-20, real churn in a catalogue this project does not run.
      Chasing it is a chore with no end. Reworded every mention to "hundreds of plugins" or
      similar instead of a number, and replaced `tests/docs/conventions.test.js`'s "one stated
      figure" check with one that asserts no document states an exact plugin-universe count at
      all, so the next well-meaning correction of the number fails the build instead of
      shipping. JigDAW's own worked-plugin count is unaffected by this: that one is ours to
      keep exact, and its own test (`states the number of worked plugins there actually are`)
      is unchanged.
- [ ] `src/ops/OpDispatcher.js` is 712 lines, up from 456 on 2026-09-18, past the "600 usually
      wants splitting" line in `AGENTS.md`. Noticed while re-measuring line counts for the
      item above; not investigated further this pass. `bin/bundle.js` is still 409, unchanged.
