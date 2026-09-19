# TODO

What the project needs. Remove an item when its implementation and verification are
complete. Review periodically.

## From the inbox

- [ ] **Read every document against the documentation rules, 2026-09-19.** The rules in
      `AGENTS.md` now say plain technical English, no em dashes, no novel jargon, no large
      language model cliches, and a structure that can be read in pieces. Only the em dash is
      checked by anything (`tests/docs/conventions.test.js`), because the rest cannot be
      checked mechanically without producing false positives on prose that is doing its job.

      So it is a reading pass over `docs/`, `README.md`, `README.agents.md`, `HUMANS.md` and
      the plugin READMEs, one document at a time, rewriting rather than annotating. The
      normative documents come first, because a specification that is hard to read is a
      specification that gets implemented wrong. Note in `MISTAKES.md` any cliche that turns
      out to be frequent, so the pattern can be added to the guard if a safe check exists
      for it.

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

- [ ] **A published key has nowhere to live.** `bin/keys.js publish` prints the Turtle to serve
      at a verification method IRI, and `bin/verify.js --online` will dereference it, but
      nothing in `deploy/` serves one and `strandz.it` has no key published. Until it does,
      every JigDAW signature is checked against the copy inside the bundle, which proves self
      consistency and not authorship. Serving one file fixes it; deciding which IRI is in
      HUMANS.md.


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

- [ ] **`http://purl.org/stuff/jigdaw/` cannot be dereferenced by a browser.** The namespace is
      minted on `http:`, and that first hop redirects to `https://purl.org/...` **without**
      `Access-Control-Allow-Origin`. Every later hop has it and the vocabulary itself answers
      correctly, so only the opening redirect is the problem. From a page served over `https:`
      it fails earlier still, as mixed content.

      This does not make the IRI wrong: it is an identifier, and minting on `http:` is the
      convention the sibling projects follow. It does mean **a browser based consumer must
      dereference the `https://purl.org/stuff/jigdaw/` form**, which works end to end with CORS
      all the way. Say so in `docs/namespace.md` and in the published plugin author guide,
      because an author who follows the advice to dereference will hit this and conclude the
      vocabulary is broken.

      Re-measured 2026-09-18 and still true: the `http://purl.org/stuff/jigdaw/` hop answers
      302 with no `Access-Control-Allow-Origin` at all. Every later hop has it, and
      `https://purl.org/stuff/jigdaw/` works end to end, so the guidance stands: a browser
      based consumer dereferences the `https:` form.

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

- [ ] **Decide whether platforms apply.** `pu:supportedPlatform` was assumed to have a
      `pu:Web` value. It does not, and a query for the predicate over the public endpoint
      returns nothing. Either a web platform term is added alongside the format term, or
      JigDAW says platform is meaningless for a plugin that runs in a browser and relies on
      the format term alone. The second is probably right.

- [x] **`trn:` has converged on its upstream, 2026-09-18.** The format individuals and the
      deprecations moved from plugin-universe's `trn-extensions.ttl` into
      `~/github/transmission/vocabs/formats.ttl`, which its own header had been asking for.
      Measured after: plugin-universe declares nothing upstream does not. A test in
      transmission compares the two when that checkout is present.
- [ ] **The inspection vocabulary still has no consumer.** `jig:Inspection`,
      `jig:inspectionOf`, `jig:inspectedAt`, `jig:hostVersion` and `jig:loadOutcome` are
      declared in `vocabs/jigdaw.ttl`, constrained by nothing in `vocabs/shapes.ttl`, written
      by nothing and read by nothing. `jig:Threads` and `jig:ExceptionHandling` are in the
      same position. That is the state plugin-universe describes as invisible: terms
      written into the data and selected by no query, which is not a condition anything
      reports. Either Phase 5 uses them or they come out.

## The application

Behaving more like a real DAW, an open-ended direction rather than a phase with an end.

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

## Before there is code

- [x] `src/rdf/Vocabulary.js` exists, is frozen constants, and is bound to the ontology in
      both directions by `tests/rdf/vocabulary.test.js`.
      `tests/rdf/vocabulary.test.js` already binds the vocabulary to the shapes and examples
      in both directions, which is the useful half of valis's ontology-to-registry symmetry
      test. The other half arrives with the code.
- [ ] A `/new-plugin` command scaffolding profile, processor, registry entry and test in one
      pass, modelled on `~/github/valis/.claude/commands/new-element.md`.

## Recurring, check periodically

- [ ] Read `MISTAKES.md` for anything systematic and promote it into `AGENTS.md`.
- [ ] Re-measure every figure quoted in a document. The plugin count, the profile count and
      the format list all drift.
- [x] Line counts checked, 2026-09-18. The largest is `src/ops/OpDispatcher.js` at 456, then
      `bin/bundle.js` at 409. AGENTS.md says past about 400 is worth a look and past about 600
      usually wants splitting, so nothing is due yet and two are worth watching.
