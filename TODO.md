# TODO

What the project needs. Remove an item when its implementation and verification are
complete. Review periodically.

## From the inbox

- [ ] **Verify `reaper/jigdaw-render.lua` against a real REAPER install.** **Parked
      2026-09-24: the maintainer will do this when there is more time**, not blocked on
      anything else. From the inbox,
      2026-09-23, resolved 2026-09-24: "without the adapter" meant without the JigDAW Adapter
      VST specifically, and the wanted route takes advantage of REAPER's own scripting rather
      than a live, playable plugin. Built as an offline bounce: a ReaScript
      ([reaper/README.md](reaper/README.md)) that asks for plugin IRIs, a duration and MIDI
      notes, drives `bin/host.js` (the existing Node reference host, no browser), and drops the
      rendered WAV into the project as a new track. Reaches an instrument, or an instrument
      feeding effects placed after it, never a bare effect on REAPER's own audio, because
      `ReferenceHost.js` is a chain with no audio input. No REAPER install was available to
      actually run this against, so it is written against REAPER's documented ReaScript API
      (`ExecProcess`, `GetUserInputs`, `InsertMedia`) and unverified; see HUMANS.md. A live,
      playable JigDAW plugin in REAPER (a JSFX in EEL2, which cannot call WebAssembly, or a
      persistent external process piped in real time) is a separate, larger piece of work and
      was not attempted here.

- [ ] **A static check that a `jig:Abi1`/`jig:Abi2` module never calls `memory.grow`.**
      2026-09-24: `npm run check-wasm-abi -- your.wasm` (`src/validate/WasmAbi.js`) now checks
      the easy half of module-abi.md's calling sequence step 1 statically, an exact and
      cheap read of the import section: a module declaring the ABI MUST have none. The harder
      half, whether the module ever executes `memory.grow` (forbidden after `jig_init`), was
      not attempted. It needs decoding every instruction in the code section correctly,
      including the newer 0xFC/0xFD-prefixed ones (bulk memory, saturating conversions, SIMD).
      `@webassemblyjs/wasm-parser`, a real and maintained parser, was tried against this
      project's own plugin `.wasm` files and failed to decode `ferrite.wasm`
      ("Unexpected instruction: 0xfc00"), so a hand-rolled decoder here would very likely be
      wrong in the same shape, which AGENTS.md already names as worse than no check at all.
      The other remaining candidate, a wall-clock render budget, is now built: `npm run
      check-plugin -- IRI --measure-budget` (`checkRenderBudget` in `PluginCheck.js`) times two
      renders of different lengths after a discarded warm-up and reports the slope as a
      multiple of real time. Deliberately coarse and said so in its own docstring: it runs in
      Node, offline, not on a real audio thread at a fixed priority, so it can only ever catch
      a plugin off by orders of magnitude (an unbounded loop, say), not one merely tight on a
      slow device. `memory.grow` is the one piece of this item still open.

- [ ] **Whether to reduce the native build's dependency on a sibling `downspout` checkout.**
      **Decided 2026-09-24: leave as-is for now.** Revisit if the shared-DPF tradeoff in item 2
      below ever stops being worth it. From the inbox, 2026-09-24: "reduce cross-repo
      dependencies where it can be done without breakage." An audit found three actual
      couplings to a sibling repository, not counting
      the ones README.md/AGENTS.md already say are prior art only and depended on for
      nothing:
      1. `tests/rdf/vocabulary.test.js` hardcoded `/home/danny/github/...` where
         `tests/wam/WamModule.test.js`'s equivalent check already used `process.env.HOME`.
         Fixed 2026-09-24, no behaviour change on this machine, and portable elsewhere now.
      2. `native/CMakeLists.txt` defaults `JIGDAW_DPF_DIR` and `JIGDAW_HTTPLIB_DIR` to paths
         inside `~/github/downspout/third_party/`, by design: the comment there says a path
         rather than a fetch, because it is the same DPF downspout's own plugins build
         against, and two copies would be two answers. Reducing this would need either
         accepting that two copies could disagree, or teaching the build to fetch DPF itself
         (as `native/cmake/FindOrFetchWamr.cmake` now does for WAMR) while still checking it
         against whatever downspout has, which is more machinery than the coupling it
         replaces. Not changed: the stated reason is a real tradeoff, not an oversight, and
         needs a maintainer decision, not a silent reversal.
      3. `tests/rdf/vocabulary.test.js`'s upstream `trn:` check and
         `tests/wam/WamModule.test.js`'s WAM API check both already degrade gracefully when
         the sibling checkout is absent (skip loudly, or return early), which is the pattern
         AGENTS.md asks for; nothing to reduce there beyond the path fix above.

## Namespaces

## Blocking, cross-repository


## The application

Behaving more like a real DAW, an open-ended direction rather than a phase with an end. Plugin-related parts should have most attention.

Read /home/danny/github/OpenStudio/docs/implemented_features.md for ideas.

- [ ] **The interface is not yet usable and intuitive.** From the inbox, 2026-09-24: "a change
      from a standard DAW visual interface is welcome, but only if it is usable and intuitive.
      This isn't right now." Not designed. The four items below are the concrete parts of it
      already named, and each moves the page toward a conventional DAW layout. **Best guess,
      2026-09-24, at the maintainer's instruction: nothing further beyond those four is
      guessed at here** rather than inventing complaints nobody made; still worth asking the
      maintainer directly if the four together turn out not to be enough.

- [ ] **Tracks, with a mixer of faders governing them.** From the inbox, 2026-09-24: "there
      needs to be the concept of multiple tracks, like in a DAW. The mixer should be sliders
      to govern these." Today a mixer strip belongs to each node, and there is no track. Needs
      a `jig:Track` in `vocabs/`, `docs/project-format.md` and the shapes first (code follows
      the ontology): a track as a chain of nodes ending in a fader, pan and mute, the mixer
      drawing one strip per track rather than per node. No open question was raised against
      this shape, so it stands as the plan; not built yet.

- [ ] **A MIDI timeline per track.** From the inbox, 2026-09-24. Recorded or drawn notes on a
      track, played against the transport. Depends on tracks. Events already carry an absolute
      stream position (contract section 6.2), which is what a timeline schedules by.

- [ ] **An audio timeline per track.** From the inbox, 2026-09-24. Audio clips placed on a
      track. Depends on tracks. **Best guess, 2026-09-24, at the maintainer's instruction, for
      where clip audio lives in a saved session:** by reference (an IRI or an uploaded blob's
      URL), not embedded as node state is, the same way a plugin itself is a reference rather
      than inline bytes (CLAUDE.md's own RDF conventions: mint identity, do not inline it). The
      846 kB Fender preset is the concrete case this avoids repeating at timeline scale, where
      it would recur once per clip rather than once per preset. Not designed further or built.


## Documentation

- [ ] **Whether `web/collections/jigdaw.ttl` should stop being the exception and hold absolute
      IRIs.** **Decided 2026-09-24: leave unchanged for now.** Revisit if the localhost/mirror
      case this design serves ever stops mattering. The inbox item this came from also asked
      for the general "refer to a plugin by
      its absolute IRI" recommendation, added 2026-09-24 to
      [for-plugin-authors.md](docs/for-plugin-authors.md) ("Refer to it by its absolute IRI"),
      cross-linked from [plugin-collections.md](docs/plugin-collections.md) section 1.1. This
      part is unresolved: making the shipped collection itself absolute conflicts with a
      deliberate, documented and tested design. Section 1.1 explains the file omits `@base` on
      purpose, so `<../plugins/pulse/>` resolves against whichever host serves it and the same
      file works on `localhost` and on strandz.it alike, and
      `tests/catalogue/CollectionLoader.test.js` checks it against `plugins/` on disk under
      that assumption. Switching it to absolute IRIs would pin the shipped collection to one
      origin and needs a maintainer decision, not a silent reversal of a choice that was made
      and tested for a reason.

## JSFX plugins

## The reference host

## A pure-JavaScript plugin

## The native adapter

## Before there is code

## Recurring, check periodically

