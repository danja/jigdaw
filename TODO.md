# TODO

What the project needs. Remove an item when its implementation and verification are
complete. Review periodically.

## From the inbox

- [x] **A C++/wasm boilerplate to copy, 2026-09-23.** Asked directly: "Do we have a
      C++/wasm + JS boilerplate kind of SDK setup comparable to DPF that a developer of
      JigDAW plugins could use as a starting point?" Not quite: every wasm plugin here was
      Rust except the 8-Bit 8asterd, which is a real, large, ported firmware, not a template
      anyone would want to copy to start from zero. `.claude/commands/new-plugin.md` already
      pointed a WebAssembly-needing plugin at `plugins/cascade/`, a real reverb, for lack of
      anything smaller.

      `plugins/boost/` is that starting point: a gain stage in C++, `boost.cpp` about 60
      lines, everything past `jig_process` being ABI wiring rather than DSP, so copying it,
      renaming it and replacing one line is the whole job of starting a new WebAssembly
      plugin. `build.sh` is `clang++ --target=wasm32 -nostdlib`, the same toolchain
      `plugins/8b8/build.sh` already established, and needs no shim: the gain math calls
      nothing a freestanding build leaves missing. `<stdint.h>` rather than `<cstdint>`, a
      freestanding header clang always supplies, was the one thing that needed correcting by
      actually trying it rather than assuming a C++17 flag was enough.

      `tests/host/boost.test.js` (5 tests) loads it through the real
      `PluginLoader`/`Engine` path, the same shape as `tests/host/tremolo.test.js`: the
      profile parses, the init/ready handshake completes, the signal passes through unchanged
      at the declared default gain of 1, a gain of 2 doubles a known input (proving
      `jig_set_param` actually reaches the module rather than the parameter default coincidentally
      matching), and silence stays silent at any gain. Validates clean against
      `vocabs/shapes.ttl`.

      Becoming the repository's 10th worked plugin moved a number five other documents state
      (`README.md` twice, `README.agents.md`, `docs/index.md`) and found that
      `docs/revisions.md`, a dated log opened this same day, needed the same exemption
      `tests/docs/conventions.test.js` already gives `MISTAKES.md` from that check: a log
      records what was true when it was written, and editing it to agree with today is not a
      log. `.claude/commands/new-plugin.md` now recommends `plugins/boost/` over
      `plugins/cascade/` unless Rust is specifically wanted, and
      [docs/for-plugin-authors.md](docs/for-plugin-authors.md) section 3 does the same in
      prose, including the correction that not every plugin here is Rust, which had gone
      stale since the 8b8 was added and nothing had said so. `npm test`: 868 of 868.

- [x] **A checklist for a host implementer, 2026-09-23.** From "suggest ways we can
      potentially reduce the effort needed for the developer of a DAW or plugins to support
      JigDAW": `docs/for-plugin-authors.md` already ends in a checklist and
      `docs/for-hosts.md` did not, despite asking the harder question. Added, drawn from "The
      sequence" already on the page and contract section 11 rather than invented: the eight
      steps run in order and abort on the first failure, bytes never a compiled `Module`,
      every digest verified with no continue-anyway path, locations resolved against the
      fetched URL rather than the profile's own IRI, capabilities checked before any code is
      fetched, plugin UI sandboxed, a failed plugin muted rather than taking the graph down,
      every profile-sourced string treated as data, and a real render heard rather than only
      a test suite passed.

      **Other candidates, not built this pass**, roughly in order of expected effort against
      value: a plain `bin/new-plugin.js` doing what `.claude/commands/new-plugin.md` currently
      asks an agent to do, so scaffolding a plugin needs no AI assistant, only `node`; a
      portable, host-agnostic conformance fixture set (worked plugin plus expected rendered
      output) that an implementation in any language could run against, rather than each host
      here proving itself only against its own test suite; and extracting
      `docs/host-plugin-contract.md` section 11's security list and the load sequence into one
      normative checklist section the contract itself carries, since `for-hosts.md` restating
      it is a second copy that can drift from the first.

- [x] **JUCE spitting out a JigDAW bundle from the same build, reframed, then the reframing
      built, 2026-09-23.** The inbox asked for this "from a slightly different angle": when a
      JUCE developer builds their VST3/AU/whatever, JUCE's own build system also produces a
      web-native `jig:` bundle from the same source, tested against the planned Ferrite
      (impulse response and neural amp modeler) plugin.

      **Checked rather than assumed, and it does not exist.** JUCE 9's own CMake API
      (`juce_add_plugin`'s `FORMATS`) has no WebAssembly target for a plugin's DSP; the only
      `wasm` in the JUCE tree is HarfBuzz's unrelated font-shaping API and a `juce_core`
      source file supporting a JUCE app itself compiled with Emscripten as a browser
      standalone, not a plugin's audio code exported as a portable module. There is no
      "spits out a bundle" button to wire up, because JUCE never learned to export a plugin's
      DSP as anything but a plugin.

      **What is actually true**, and it is a smaller claim than the inbox item made: an
      `AudioProcessor`'s DSP *can* be made to compile to `wasm32` and expose `jig:Abi1`'s
      exports, exactly as `native/jigdaw-adapter/src/juce/PluginProcessor.cpp` shows a JUCE
      shell can wrap `jigdaw_core` rather than the other way round. What that needs is the
      DSP written as a portable core with no JUCE dependency, `AudioBuffer`, `ValueTree`, or
      anything else framework-specific reaching into it, which most JUCE projects are not
      written as, because JUCE gives them no reason to be. This is the same shape of
      separation `jigdaw_core` itself demonstrates, in the other direction: a portable core
      wrapped by a DPF shell here, by a JUCE shell there.

      **Built the same day, asked directly: "how do we make this easy for someone experienced
      in JUCE?"** Not a JUCE CMake export target, which the above rules out, but the
      documented recipe and the part of the work that is genuinely mechanical rather than
      judgement.

      [docs/for-juce-developers.md](docs/for-juce-developers.md) states the recipe: extract
      the DSP into a portable core by hand (no tool can safely decide which parts of a
      `processBlock` are the algorithm and which are JUCE plumbing), wrap it once for JUCE and
      once for JigDAW, `plugins/boost/` as the shape to copy for the JigDAW side.

      The parameter layer is not judgement, and is automated.
      `native/jigdaw-adapter/src/juce/tools/DumpParameters.h` is a header a JUCE developer
      copies into their own project and calls once, reading the live
      `AudioProcessorParameter` objects (needs only `juce_audio_processors_headless`, so no
      GUI modules pulled in) rather than parsing the C++ that created them, since JUCE has
      already resolved every range, default and choice list correctly. Verified against real
      JUCE, not assumed: a throwaway `AudioProcessor` with a float, an int, a bool and a
      choice parameter, compiled and run, produced exactly the JSON expected.
      `bin/juce-params-to-profile.js` turns that JSON into a profile's `ports` array (written
      in place, everything else in the file untouched), a `jig_set_param` C++ switch, and the
      processor's `PARAM_INDEX`/`parameterDescriptors`, all three agreeing by construction
      since they are read from the one file in the one order. Round-tripped for real: the
      generated `ports` block was dropped into a copy of `plugins/boost/profile.json`,
      regenerated with `bin/write-profile.js`, and validated clean against
      `vocabs/shapes.ttl`. `tests/bin/juce-params-to-profile.test.js` (11 tests) covers the
      mapping directly, including the `lv2:symbol` sanitising a JUCE parameter id might need
      and the bool/choice/plain-range branches.

      **Found while wiring the test in**: `tests/bin/` was a new suite directory and
      `vitest.config.js`'s `include` list is exactly what `AGENTS.md` already warns a new
      suite must be added to or it runs zero tests silently; `npm test`'s own
      `bin/check-suites.js` step is what is supposed to catch that, and did, the moment `npm
      test` was actually run instead of `vitest run <file>` directly against the one new file.
      Fixed by adding the entry rather than by trusting that a passing single-file run meant
      anything.

      Not built: Ferrite itself, which would be the first real worked example of the "one
      core, two shells" pattern this recipe asks for, since its DSP (convolution, a small
      neural network) has no obvious reason to touch JUCE at all. `npm test`: 879 of 879, 55
      files.

- [x] **Every plugin now says who wrote it, dereferenceably, 2026-09-23.** Surfaced by an
      independent implementation, `~/github/diddums` (danbri, built against this project's
      published spec), fetching `provenance.ttl` beside each served plugin and 404ing. Under
      the model `docs/plugin-bundles.md` already states, that 404 is correct:
      `jig:Bundle`/`jig:Bundling` describe a copy arriving by hand, and a plugin served at its
      own canonical origin was never one, so it was never going to carry a `provenance.ttl`.
      But the question underneath the 404 was real: nothing dereferenceable said who wrote a
      plugin. `trn:vendor "danja"` was already on all nine profiles and had been since phase 2,
      and it answers a different question, a display string for a catalogue rather than
      something a tool can follow.

      Fixed on the profile itself rather than by inventing a third `jig:BundleForm` for the
      served-origin case: `doap:developer <http://danny.ayers.name>`, reusing DOAP the way
      `doap:revision` already does rather than minting a jig: term, and an IRI rather than a
      name for the same reason provenance attribution already insists on one, a name is not
      something a search or a signature can be checked against. `src/rdf/Vocabulary.js`,
      `vocabs/shapes.ttl` (optional, `sh:nodeKind sh:IRI`), `vocabs/jigdaw.ttl`'s comment
      explaining why it is not declared there, `bin/write-profile.js`, and `bin/jsfx-import.js`
      so a future JSFX conversion carries it without anyone remembering to add it by hand. All
      nine `plugins/*/profile.json` gained the field and every `profile.ttl` was regenerated
      from it, touching no digest, since digests are of the module and processor bytes, not
      of the profile document.

      `examples/counterexample-profile.ttl` gained a `doap:developer "danja"` literal to
      exercise the new constraint, matching this file's own rule that a shape without a
      counterexample is indistinguishable from one that never runs;
      `tests/validate/ShapeValidator.test.js`'s expected count for that file went from 10 to
      11. Mutation tested: removing the new `sh:property` block dropped the count back to 10
      and failed the test, confirmed, then restored. `npm test`: 855 of 855.

      **Deployed and verified live, 2026-09-23**: committed, pulled on strandz.it, no restart
      needed since `bin/serve.js` reads `profile.ttl` from disk on every request; `curl -H
      'Accept: text/turtle' https://strandz.it/jigdaw/plugins/cascade/` shows `doap:developer
      <http://danny.ayers.name>` beside `doap:revision`.

      **The normative docs needed the same fix as the code, and had not had it.** The first
      pass changed the vocabulary and every plugin but left `docs/plugin-bundles.md` and
      `docs/plugin-profiles.md` exactly as they were, which would have reproduced the whole
      problem: a future implementer reading section 5's "beside a profile on a server" and
      forming the same expectation diddums did, with `doap:developer` still undocumented in
      prose anywhere, only in `vocabs/shapes.ttl` and a comment in `vocabs/jigdaw.ttl`. Caught
      by being asked directly whether the spec had been updated, not found unprompted.

      Fixed: `docs/plugin-bundles.md` section 5 now states plainly, in its second paragraph,
      that provenance describes a copy and not the plugin, that a 404 for
      `provenance.ttl` at a plugin's own canonical origin is the correct answer rather than a
      gap, and points at where authorship actually lives. `docs/plugin-profiles.md` gained a
      "Who wrote it" section distinguishing `trn:vendor` (a display string) from
      `doap:developer` (an IRI meant to be followed), and documents `doap:revision` in prose
      for the first time as well, which turned out to have the same gap since phase 10.

      One near miss on the way: the first draft linked both new sections with
      `plugin-bundles.md#5-provenance` and `plugin-profiles.md#who-wrote-it`.
      `bin/build-docs-site.js` does not generate heading `id`s, so both anchors would have
      been dead links in the published site, and `tests/docs/conventions.test.js`'s link
      checker does not catch a broken fragment, only a broken file. No other document in
      `docs/` links to another with a `#fragment`, which is what said this was the wrong
      pattern rather than a bug in the checker; rewritten as plain file links with the
      section named in prose instead. `npm run build:docs` and the full suite both clean
      afterward, 855 of 855.

- [x] **Let a local agent drive the DAW, 2026-09-23.** Built the cheap direction the item
      already named: inverted, the page runs the loop itself, never the relay. `registerTools`
      already returns a surface with the tools (14 now, not the eleven this item was written
      against; `documented.test.js` binds the count to `docs/webmcp.md` so it will not go
      stale again), their schemas, and `call(name, input)` that normalises a throw into a
      result. `src/mcp/LocalAgent.js` reads that surface and runs a tool-calling loop against a
      local model's chat API, in the page, with no new endpoint and no new listener: nothing
      outside the browser tab can reach the session, which was the whole point of choosing this
      direction over the relay.

      `runAgentTurn({ surface, chat, model, prompt, onStep })` is the loop, with the network
      call injected as `chat` so it is tested against a fixed sequence of fake responses rather
      than a running model, the same discipline `OfflineHost.js` applies to the audio path. It
      caps at `MAX_TURNS` (8) rather than trusting the model to stop calling tools, the same
      reasoning the JSFX runtime bounds a script's own loop by. `ollamaChat` is the real network
      call, against Ollama's native `/api/chat`, kept separate for exactly that reason.

      **The response shape was measured against a running Ollama, not assumed.**
      `message.tool_calls[].function.arguments` arrived as an object already, not the
      JSON-encoded string OpenAI's API uses; `argumentsOf` accepts either, since a model that
      does stringify them is a real, not hypothetical, case. A follow-up `{role: 'tool',
      content}` with no id was enough for the model to use the result; confirmed by hand with
      `curl` against `/api/chat` before writing a line of the loop.

      **The "both send permissive CORS" claim this item made was wrong, measured directly.**
      Ollama on this machine returned `403` for `Origin: http://evil.example.com` and `200`
      with the origin echoed back for `Origin: http://127.0.0.1:8748` (the dev server's own
      origin): an allowlist, not "permissive", though one that happens to include loopback by
      default, which is what makes this usable from `npm run serve` without configuration.

      **A page loaded over `https:` cannot use this at all**, mixed content rather than CORS:
      `https://strandz.it/jigdaw/` fetching `http://127.0.0.1:11434` is blocked before CORS is
      ever evaluated. Stated in the panel's own copy in `web/index.html` rather than left for
      someone to discover, since the deployment most people will meet this feature on is
      exactly the one where it cannot work.

      **UI**: a `<details class="agent">` disclosure, the same accessible pattern the existing
      `<details class="log">` already uses, with an endpoint field, a model field, a prompt
      field and a transcript (`renderAgentStep`, role written as text first, never colour
      alone). Wired in `web/app.js`: `mcpSurface` is set where `registerTools` already runs,
      and `askAgent()` follows `search()`'s own shape, `ensureRunning()` first, disable the
      button, restore it in a `finally`.

      `tests/mcp/LocalAgent.test.js` (7 tests): the tool schema mapping, answering directly
      with no tool call, routing a tool call through `surface.call` and feeding the result
      back (caught its own bug while writing it: `messages` is one array mutated in place
      across turns, so a mock that records the reference rather than a snapshot sees every
      call's argument as the array's *final* state; fixed by snapshotting with a spread on the
      way in), stringified arguments parsed the same as an object, the `MAX_TURNS` cap firing
      on a model that never stops calling tools, and `ollamaChat`'s request shape and its
      error path.

      **Verified live, twice over.** First in Node, the real `createTools`/`OpDispatcher`
      surface against the real running Ollama (`qwen2.5:0.5b`): the model called `status`, got
      a real result back, and answered from it correctly. Then in the actual browser, `npm run
      serve` plus the Claude in Chrome extension: typed a prompt, watched the transcript render
      through two full exchanges, `navigator.userActivation.hasBeenActive` true so
      `AudioContext.resume()` was never in question, console clean. The smallest installed
      model does not reliably choose to call the tool it was asked to (prose instead, twice, at
      the default `qwen2.5:0.5b`); that is the model, not the loop, which is why the
      network-level check above used the same model and did get a real tool call through it.
      One exchange took 19s end to end under load, measured rather than guessed at, which is
      why the panel calls this experimental rather than instant.

      `npm test`: 862 of 862.

      Not built: the relay (`GET /mcp/events`, `POST /mcp/result`), the second of the two
      original options. Nothing here needed it, and the security cost the item itself named
      (a loopback endpoint reachable by any process on the machine, and by DNS rebinding from
      any website) is exactly what choosing the page-loop direction avoided. Left as a possible
      future item if an agent that must be the caller, rather than the page, is ever wanted.

- [ ] **A way to load a JigDAW plugin into REAPER without the native adapter.** From the
      inbox, 2026-09-23. `native/jigdaw-adapter` already does this as a VST3/CLAP/LV2, built
      once against `jigdaw_core`. The inbox item asks for an alternative that needs no such
      build: either a JSFX wrapper, in the same restricted EEL2 the `src/jsfx/` toolchain
      already parses one direction (JSFX into JigDAW), run the other way; or a script wrapper
      that drives an external host process from REAPER's own scripting side. Neither is
      designed. The JSFX direction is the harder of the two: EEL2 has no WebAssembly and no
      way to call out to it, so a JSFX-hosted JigDAW plugin would need its module compiled to
      EEL2 by a tool that does not exist, or would be limited to the plain-JavaScript-shaped
      plugins Tremolo showed are legal, translated to EEL2 by hand or by a generator with its
      own scope to define. The script-wrapper direction is closer to what
      `bin/host.js`/`ReferenceHost.js` already does: a ReaScript could drive a small
      persistent Node process hosting one JigDAW chain and pipe audio and MIDI across, which
      is a second real-time boundary to get right rather than none. Worth settling before
      building: whether "without the adapter VST" means without building native code at all,
      which favours the wrapper, or without REAPER's own VST3 slot specifically, which the
      JSFX route answers directly.

- [x] **A JUCE-hosted adapter, built alongside the DPF one, 2026-09-23.** The second of the
      two JUCE directions from the inbox: whether a JUCE-based adapter of the same shape as
      `native/jigdaw-adapter` (loading a JigDAW plugin by IRI, in a chain) was worth having,
      mainly for AU, which DPF does not target and JUCE does. It was: `jigdaw_core`
      (`Turtle`, `Profile`, `Integrity`, `Module`, `Chain`, `Params`) is already separate from
      `src/dpf/`, the thin shell over it, which is what let Transmission add it as a library
      rather than reimplement the contract, and a JUCE shell over the same core turned out to
      be exactly that shape of work and no more.

      **Not Apache-2.0.** JUCE's free tier is AGPLv3, not GPLv3 as first assumed; corrected
      after actually reading the header rather than trusting memory. `native/jigdaw-adapter/
      src/juce/README.md` states plainly that a binary built this way is AGPLv3 (or
      commercially licensed, if built against a paid JUCE license) and that nothing else this
      repository produces is affected. `JIGDAW_BUILD_JUCE_PLUGIN` defaults `OFF` in
      `native/CMakeLists.txt` so building the rest of the project, DPF adapter included, never
      depends on JUCE and never risks an AGPL-encumbered binary by accident. Not wired into
      `install.sh`, for the same reason.

      `src/juce/PluginProcessor.h`/`.cpp` mirrors `src/dpf/JigdawPlugin.cpp`: the same atomic
      chain swap, the same sub-block loop against `Chain::maxFrames()`, the same real-time
      rules. One genuine simplification rather than a port of DPF's own workaround: JUCE
      reports host transport position in quarter notes directly
      (`AudioPlayHead::PositionInfo::getPpqPosition()`), so filling in `jigdaw::Transport`
      needs none of the ticks-per-beat conversion DPF's BBT block requires.
      `src/juce/PluginEditor.h`/`.cpp` is a JUCE-native editor rather than a port of
      `src/dpf/JigdawUI.cpp`'s 728-line NanoVG one: a `TextEditor` for the IRIs, a Load
      button, and a read-only view of the load report, because JUCE gives a plugin real
      widgets and the job DPF's UI does by hand (drawing a scrollable 128-slot parameter
      picker) is a text box here instead.

      Built and verified live on this machine (Linux, so VST3 and Standalone; AU needs macOS
      and was not attempted here): `cmake -DJIGDAW_BUILD_JUCE_PLUGIN=ON
      -DJIGDAW_JUCE_DIR=/path/to/JUCE`, both targets link clean. Running the Standalone under
      Xvfb, typing `https://strandz.it/jigdaw/plugins/cascade/` into the editor and pressing
      Load produced `ok Cascade params 1-5 mix size damping freeze mode` in the report field,
      a real network fetch, a real digest verification and a real chain build, not a fake
      standing in for one. The default, non-JUCE native build and its ctest suite (6 passed,
      1 skipped without a server, as before) were re-run afterward to confirm the new,
      off-by-default CMake option changes nothing about the existing path.

      **Found while doing this, unrelated to the code and worth naming so it is not repeated:**
      two scratch build directories from this same session reached `origin/main` in a
      639-file commit, because `.gitignore` excluded `native/build/` exactly and these were
      named `native/build-default/` and `native/build-juce/` to keep them apart. Untracked in
      a follow-up commit and `.gitignore` widened to `native/build*/`. Full account in
      `MISTAKES.md`, 2026-09-23.

      Not built: the first JUCE direction (an export target letting a JUCE developer produce
      a `jig:WebPlugin`), which is a much larger and separately scoped question about
      compiling JUCE DSP to WebAssembly and has no `jig:ui` story yet either.

- [ ] **More ways of verifying a plugin, an open question from the inbox, 2026-09-23.** What
      exists today: `jig:integrity` digest checks on every fetched resource
      ([host-plugin-contract.md](docs/host-plugin-contract.md) section 3.2), SHACL shape
      validation (`src/validate/ShapeValidator.js`), a signed provenance record over the
      canonical profile (`bin/verify.js`, [plugin-bundles.md](docs/plugin-bundles.md) section
      6), and a per-load outcome record (`src/host/Inspections.js`). All of those check what a
      plugin *is* and where it came from; none of them check what it *does*. Candidates worth
      weighing rather than building yet: an offline render through
      `src/host/ReferenceHost.js` as a pre-publish check (does it produce audio at all, does
      it stay within a peak bound, does it respond to MIDI); a static check of the compiled
      WebAssembly for the operations the real-time rules forbid (a `memory.grow` import, an
      import outside what the ABI declares); and a CPU load or wall-clock budget measured
      against `jig:blockSize` rather than assumed. Each is a different kind of proof and none
      replaces the others. Not scoped into a phase yet.

- [x] **Ferrite, a cabinet impulse response and neural amp modeler plugin, 2026-09-23.**
      The working name from the inbox item this grew from, committed to. `/home/
      github/NeuralAmpModelerPlugin`, the referenced prior art, does not exist in this
      environment; the actual `.nam` format and its reference implementations were read
      directly from `sdatkinson/neural-amp-modeler`, `sdatkinson/NeuralAmpModelerCore` and
      `OpenSauce/nam-rs` instead of assumed from memory.

      **Reimplementing WaveNet inference from the format's documentation alone was the plan,
      and it was the wrong one, found before writing DSP rather than after.** The `.nam`
      schema has grown FiLM conditioning, a slimmable-width architecture and a packed layer
      variant since first publication; the actual Python model classes run to hundreds of
      lines with no single simple forward pass to port, and there was no reference input and
      output to check a from-scratch port against. That is precisely the "confident but
      unverified" shape `AGENTS.md` warns about, for code that would have sounded plausible
      and been quietly wrong.

      **Depended on `nam-rs` instead**, MIT-licensed, a from-scratch Rust port the crate's own
      test suite validates against the reference Python and C++ implementations within
      `1e-5` per sample. Attribution in `plugins/ferrite/README.md`, matching the crate's own
      table. This is the first plugin here with a real external dependency rather than
      hand-written DSP throughout, and the point of using one: an already-validated
      implementation is not a shortcut around AGENTS.md's warning, it is the same discipline
      pointed at a source of truth better than a format spec read once.

      **Compiles to `wasm32-unknown-unknown` with zero imports, measured rather than
      assumed**: `nam-rs` is a `std` crate (`serde_json`, `Vec`), not the `no_std` discipline
      `plugins/cascade` and its siblings hold to, and this target's `std` needs no host
      imports for heap allocation (a bump allocator over the module's own linear memory).
      Checked directly: a throwaway crate depending on `nam-rs` alone, compiled, inspected with
      `WebAssembly.Module.imports()` in Node, empty array. `plugins/ferrite/src/lib.rs`
      inherits this rather than fighting it: plain Rust, not `no_std`, with the real-time rule
      that actually matters, no allocation inside `jig_process`, upheld by fixed-size statics
      throughout, exactly as `plugins/boost/boost.cpp`'s are, and by `nam-rs`'s own
      documented and tested no-allocation contract for `process_buffer`.

      **Two `jig:asset`s, not one**: the `.nam` model and a cabinet impulse response, both
      delivered through the path `src/host/Instantiate.js` already fetches, verifies and posts
      alongside the module, generic rather than JSFX-specific since the JSFX runtime needed it
      first. Each has its own `jig_<name>_ptr`/`jig_<name>_max_len`/`jig_load_<name>` triplet,
      the same shape `plugins/_jsfx-runtime`'s one asset already uses, extended to two rather
      than invented fresh. Loading a `.nam` file also runs the WaveNet's warmup (`nam-rs`'s own
      documented `receptive_field()` samples of silence) before any real audio reaches it,
      inside `jig_load_nam`, not left to the processor.

      **A cabinet IR is convolved by a hand-written direct time-domain FIR**, the one piece of
      real DSP in this plugin that is not someone else's validated code, because it is simple
      enough to reason about directly: `O(IR_LEN)` per sample through a fixed-size shift
      buffer, capped at 8192 samples (170 ms at 48 kHz) and refused rather than truncated
      above that. A small WAV parser (RIFF/fmt/data, PCM16, PCM32 or float32, any channel
      count averaged to mono) reads a real IR file rather than requiring a raw-float
      conversion step first.

      **Sample rate mismatch is reported, not silently wrong.** `nam-rs`'s own documentation
      states plainly that a `.nam` run at the wrong rate is silently wrong, because dilations
      and recurrence are defined in samples, and a convolution's taps are timed the same way.
      Neither loader resamples; both compare the file's own declared rate against the host's
      and return 1 rather than 0 when they disagree, a status this plugin's own processor
      convention defines rather than the host contract, exactly as `for-plugin-authors.md`
      says that convention is free to be.

      `tests/host/ferrite.test.js` (4 tests) loads it through the real `PluginLoader`/`Engine`
      path with both assets served from disk, confirms finite output across ten blocks of a
      real tone (state carrying correctly across calls in both the WaveNet history and the
      convolution's shift buffer), and confirms the output level parameter scales every
      sample by exactly the requested factor, the one numeric claim about the whole chain
      simple enough to assert without a reference render to compare against. Verified live in
      Chrome beyond the offline suite: the real profile fetched, both assets fetched and
      verified over the network, the module compiled and instantiated in a real
      `AudioWorklet`, `Play` ran with the console clean.

      Shipped with a small MIT-attributed test `.nam` (`NeuralAmpModelerCore`'s own
      `example_models/wavenet.nam`, 131 weights, not a captured amp) and a synthetic cabinet
      IR generated for this example and stated as synthetic in both the profile's own
      `trn:caution` and the README, never claimed to be a real capture.

      **Found on the way, unrelated to the plugin's own code and worth naming so it does not
      recur a third time:** `plugins/bassgen`, `cascade`, `dynamix`, `pulse` and
      `_jsfx-runtime` all had Cargo's own `target/` build directory already committed, 86
      files, because `.gitignore` had no rule for that name at all, the same shape of miss as
      the `native/build*` incident earlier the same day just older and wider. Fixed alongside:
      `plugins/*/target/` added, the 86 files untracked. Full account in `MISTAKES.md`.

      `npm test`: 884 of 884.

- [x] **Loading your own model or impulse response into Ferrite, saved with the session,
      2026-09-23.** Reported directly: "I see no way of loading IR files or NAM files into
      the plugin." Ferrite shipped its two `jig:asset`s fixed at build time, and nothing in
      the panel could change them. Asked whether a loaded file should survive a save, the
      answer was that it should persist in the session.

      **Contract section 8's plugin state had never been implemented by the web host.**
      `messaging.md` specified `stateRequest`, `state` and `init`'s `state` field, and no code
      sent or read any of them. Built generically rather than for Ferrite alone:
      `Engine.requestState` (a token-correlated `stateRequest`, resolving `null` on timeout
      rather than rejecting), `Engine.addPlugin(iri, { state })` threaded through
      `PluginLoader` into `init`, with any `ArrayBuffer`s in the state transferred.
      `src/host/StateCodec.js` turns a state holding `ArrayBuffer`s into a string and back,
      because `jig:nodeState` is a literal in the saved graph. `OpDispatcher` decodes on the
      way into the engine and `web/app.js`'s `saveSession` encodes on the way out, so the
      model's `node.state` always holds the string form.

      **A new host-to-processor message, `loadAsset` (`{ key, bytes }`)**, in
      `messaging.md` section 1.2, for replacing an asset after `init`. A file that does not
      parse is reported as `{ type: 'error', phase: 'asset', fatal: false }` and leaves the
      previous asset playing. `Instantiate.js` and `Engine.watch` now treat only a fatal error
      as fatal; `watch` had never checked, which went unnoticed because nothing called it.

      **`jig:userReplaceable`**, a new boolean on `jig:Resource`, marks the assets a person
      may replace. It is in `vocabs/jigdaw.ttl`, `vocabs/shapes.ttl` (datatype and
      cardinality), `Vocabulary.js`, `ProfileReader.js` and `bin/write-profile.js`, and a
      defect in `examples/counterexample-profile.ttl` takes the expected violations from 11
      to 12. The constraint was mutation tested by removing it and watching the count drop.
      `src/ui/Panel.js` draws one labelled file input per such asset, after the knobs, and
      nothing at all for a profile that declares none.

      **Restoring a saved state detached Ferrite's own audio views**, caught by the test
      that restores into a fresh node: loading a second `.nam` can grow module memory, and
      the views had already been taken. Ferrite's processor now applies state before
      taking views and re-derives them after every load, including a runtime `loadAsset`.
      Full account in `MISTAKES.md`.

      `tests/host/ferrite.test.js` gains three tests: the reported state matches the shipped
      files byte for byte, `loadAsset` changes both the output and the reported state, and a
      state captured from one engine, run through `StateCodec` and given to a second engine
      reproduces both the bytes and the sound. Verified live in Chrome through the real
      interface: a WAV set on the panel's file input reached only its own node, and Save
      followed by Open (which removes every node and instantiates each afresh) brought the
      loaded impulse response back. The suite also caught the panel's file input at 12px,
      under the 16px that stops iOS zooming.

      `npm test`: 892 of 892. The machine was under a load average of about 15 at the
      time, and some full runs failed a different test each time by timeout (tremolo) or
      transiently (the em dash guard); each passed on its own and in the next full run.

## Namespaces

- [x] **Individual `pu:` terms now dereference, 2026-09-21.** Was 404ing because the nginx
      override was a prefix replacement that did not account for sub-paths; fixed by the user
      deploying `deploy/nginx/vocab.conf`'s pattern to plugin-universe's own server, the same
      fix already applied to transmission's.

      Measured live, not assumed: `purl.org/stuff/plugin-universe/supportedPlatform` now
      chains through the PURL, `purl.archive.org` and `hyperdata.it` hops to
      `plugin-universe.com/ns/plugin-universe.ttl`, 200, `text/turtle`, `Access-Control-Allow-
      Origin: *`. Checked against six real terms pulled from the vocabulary itself
      (`architecture`, `category`, `blockSize`, `CpuLoad`, `Correction`, `downloadUrl`), all
      200; a made-up term (`pluginId`) still 404s, which is correct rather than a sign the fix
      is incomplete.

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

- [x] **A Preset menu, loading a particular configuration of plugins, 2026-09-23.** From the
      inbox, 2026-09-19. Settled as: bundled presets only, under `web/presets/`; opening one
      replaces the session and clears the undo history the way Open does; plugins named by IRI,
      not bundled.

      A preset is an ordinary project file with **no `@base` and relative plugin IRIs**
      (`<../plugins/ferrite/>`), so it resolves against wherever it was fetched from and loads
      the plugins served beside it, on `127.0.0.1` and on strandz.it alike. A saved session
      keeps its absolute IRIs, which is right for a session and wrong for something shipped
      with the host. `web/presets/index.json` lists file names only; each file's own
      `rdfs:label` is its name in the menu, so the name has one home. `src/ui/Presets.js`
      fetches the list; the menu is a labelled select and an "Open preset" button, not a select
      that acts on change (WCAG 3.2.2), and it is not drawn until the list has loaded.

      Opening a saved file and opening a preset now share `src/ops/OpenProject.js`, moved out
      of `web/app.js`'s `openSession`, so the tests drive the same sequence a click does rather
      than a copy of it. `src/testing/OfflineHost.js` gained `sitePlugins`, serving every
      plugin in `plugins/` as if from one site, and `directoryFetch` responses gained `json()`,
      which a real `Response` has.

      Three presets: an acid bass line (BassGen driving Pulse through Squelch and Cascade,
      which plays on Play with nothing else to do), a square lead through Tremolo and a plate,
      and Ferrite into a Cascade hall. `tests/ui/Presets.test.js` walks the directory: index
      and directory agree both ways, no preset has an `@base`, each conforms to the shapes, and
      each opens for real through `openProject` against the real plugins with every setting
      landing unclamped and every connection made. Mutation tested: a setting out of range, a
      plugin that is not there, a MIDI connection marked as audio, and a file missing from the
      index each fail it. `tests/ops/OpenProject.test.js` covers a missing plugin costing one
      node and one error, not two. Verified live in Chrome through the real controls: the menu
      lists all three by label, the acid preset opens four nodes and three connections, and on
      Play BassGen's notes reach Pulse and Squelch's output brightness rises and falls with
      each note (spectral centroid from about 440 Hz to about 1700 Hz).

- [x] **Squelch, a resonant lowpass for the acid preset, 2026-09-23.** Asked for directly:
      "for an acid sound we also need a peaky LP filter". Pulse's own filter is one-pole with no
      resonance. Built as a separate effect rather than changing Pulse, so Pulse sounds as it
      did and the filter works on any source. Simper's trapezoidal state variable filter,
      chosen because it stays stable while the cutoff moves every sample; an envelope follower
      on the input moves it, which is the acid sweep without needing the notes. Resonance stops
      short of self-oscillation and the output is soft clipped, because a generated panel lets
      anyone turn resonance to the end. Plain JavaScript, no module, like Tremolo.
      `tests/host/squelch.test.js` measures what is heard: lows pass and highs are cut, the
      level at the cutoff rises more than five times with resonance, a loud signal opens the
      filter, and nothing leaves plus or minus one. Each claim mutation tested, which found
      that a mutated processor fails its digest before any assertion runs (`MISTAKES.md`).

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
      so the workflow will build and have nowhere to deploy to until someone does. Turned on
      2026-09-19; measured live afterward, `https://danja.github.io/jigdaw/` answers 200 with
      the right title. Removed from `HUMANS.md` once done, per that file's own rule of staying
      a list of open actions rather than a record of closed ones.

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
- [x] **`OpDispatcher.js` split, 2026-09-21.** Was 724 lines, past the "600 usually wants
      splitting" line in `AGENTS.md`. The seam was already drawn by the file's own comments:
      "A snapshot per undoable edit..." through the end of `#restoreTo` touched only the undo
      and redo stacks and called back into the dispatcher's own public `apply()`/
      `addPlugin()`/`setParameter()`, never into its other private state. Moved whole into
      `src/ops/UndoHistory.js` (175 lines): the stacks, `canUndo`/`canRedo`/`clear`/`record`,
      and the snapshot-to-snapshot reconciliation, taking the dispatcher itself as the host it
      calls back into. `OpDispatcher.js` is now 618 lines, still marginally over the line but
      most of the way there, and the remaining bulk (model-to-engine sync: link rebuilding,
      channel strips, sink routing) is a tighter unit that did not have as clean a seam to cut
      along in this pass.

      Public API unchanged: `undo()`, `redo()`, `canUndo()`, `canRedo()`, `clearHistory()` keep
      their exact signatures and behaviour, now one-line delegations to a private
      `UndoHistory` instance. One small new surface was needed rather than reaching into
      private state from outside the class: `OpDispatcher.withoutRecording(fn)`, which
      `UndoHistory` calls so the reconciliation's own `apply()`/`addPlugin()`/`setParameter()`
      calls are not recorded as further undoable edits, replacing the inline `#recording =
      false` / `finally` that used to sit directly in `#restoreTo`.

      Verification: `npm test` unchanged before and after, 52 files, 855 tests, including the
      existing 16-test `describe('undo and redo', ...)` block in
      `tests/ops/OpDispatcher.test.js`, which already exercises the reload, healed-removal and
      no-self-recording paths through the public API and needed no changes. `npm run build`
      rebuilds `web/app.bundle.js` clean. Not done this pass: no live Chrome check, since the
      extension was not connected in this session, so the wiring is verified by the test suite
      and the build, not by a real undo/redo in the running app. No mutation test added,
      because nothing in this change is new behaviour to mutation-test against; the existing
      suite is the regression check for the exact logic moved unchanged.
