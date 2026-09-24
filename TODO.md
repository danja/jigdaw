# TODO

What the project needs. Remove an item when its implementation and verification are
complete. Review periodically.

## From the inbox

- [ ] **Verify `reaper/jigdaw-render.lua` against a real REAPER install.** From the inbox,
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

- [ ] **More ways of verifying a plugin, an open question from the inbox, 2026-09-23.** What
      exists: `jig:integrity` digest checks on every fetched resource
      ([host-plugin-contract.md](docs/host-plugin-contract.md) section 3.2), SHACL shape
      validation (`src/validate/ShapeValidator.js`), a signed provenance record over the
      canonical profile (`bin/verify.js`, [plugin-bundles.md](docs/plugin-bundles.md) section
      6), a per-load outcome record (`src/host/Inspections.js`), and, built 2026-09-24, an
      offline-render check: `npm run check-plugin -- IRI...` (`src/host/PluginCheck.js`,
      `bin/check-plugin.js`) renders the chain through `ReferenceHost.js` and reports whether
      it produced audio, stayed within a peak bound, and, for an instrument given notes,
      actually responded to them. Referenced from the checklist in
      [for-plugin-authors.md](docs/for-plugin-authors.md). Still candidates, not built: a
      static check of the compiled WebAssembly for the operations the real-time rules forbid (a
      `memory.grow` import, an import outside what the ABI declares); and a CPU load or
      wall-clock budget measured against `jig:blockSize` rather than assumed. Each is a
      different kind of proof and none replaces the others.

## Namespaces

## Blocking, cross-repository

- [ ] **Propose `jig:PluginCollection` to the transmissions vocabulary.** Nothing about a named
      set of plugin IRIs is specific to web plugins, and plugin-universe could publish its own
      curated lists in the same form. Upstream as a `trn:` class, with `jig:PluginCollection`
      kept as a subclass so no published collection breaks.


## The application

Behaving more like a real DAW, an open-ended direction rather than a phase with an end. Plugin-related parts should have most attention.

Read /home/danny/github/OpenStudio/docs/implemented_features.md for ideas.

- [ ] **The interface is not yet usable and intuitive.** From the inbox, 2026-09-24: "a change
      from a standard DAW visual interface is welcome, but only if it is usable and intuitive.
      This isn't right now." Not designed. The four items below are the concrete parts of it
      already named, and each moves the page toward a conventional DAW layout; what else is
      unintuitive is worth asking the maintainer for directly rather than guessing.

- [ ] **Rearrange plugins by dragging.** From the inbox, 2026-09-24. A drag in the rack that
      reorders nodes. Open question before building: whether dragging changes only where a
      node is drawn, which is editor metadata and must not touch the compiled graph
      (AGENTS.md), or also rewires the chain, which is one Op through the dispatcher like any
      other edit and needs a keyboard equivalent for WCAG 2.1.1.

- [ ] **Tracks, with a mixer of faders governing them.** From the inbox, 2026-09-24: "there
      needs to be the concept of multiple tracks, like in a DAW. The mixer should be sliders
      to govern these." Today a mixer strip belongs to each node, and there is no track. Needs
      a `jig:Track` in `vocabs/`, `docs/project-format.md` and the shapes first (code follows
      the ontology): a track as a chain of nodes ending in a fader, pan and mute, the mixer
      drawing one strip per track rather than per node.

- [ ] **A MIDI timeline per track.** From the inbox, 2026-09-24. Recorded or drawn notes on a
      track, played against the transport. Depends on tracks. Events already carry an absolute
      stream position (contract section 6.2), which is what a timeline schedules by.

- [ ] **An audio timeline per track.** From the inbox, 2026-09-24. Audio clips placed on a
      track. Depends on tracks, and on deciding where clip audio lives in a saved session:
      embedded as node state is, for the Fender preset, already 846 kB.


## Documentation

- [ ] **Whether `web/collections/jigdaw.ttl` should stop being the exception and hold absolute
      IRIs.** The inbox item this came from also asked for the general "refer to a plugin by
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

