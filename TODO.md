# TODO

What the project needs. Remove an item when its implementation and verification are
complete. Review periodically.

## From the inbox

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

## Namespaces

## Blocking, cross-repository

- [ ] **Propose `jig:PluginCollection` to the transmissions vocabulary.** Nothing about a named
      set of plugin IRIs is specific to web plugins, and plugin-universe could publish its own
      curated lists in the same form. Upstream as a `trn:` class, with `jig:PluginCollection`
      kept as a subclass so no published collection breaks.


## The application

Behaving more like a real DAW, an open-ended direction rather than a phase with an end.

- [ ] **A WebMCP tool to open a collection.** The page can and an agent cannot. It is a
      catalogue read rather than an Op, so it sits beside the search tool, not in the
      dispatcher, and `docs/webmcp.md` gains it in the same change.
- [ ] **Loading a collection member, verified in a foreground window.** The collection form
      was checked in a real browser on 2026-09-24 (12 of 12 verified, errors named by step, no
      horizontal scroll), but the window was in the background, so the Load click that follows
      could not start audio. It calls the same `loadPlugin` as "Load by IRI".
- [ ] **Show collection notes more quietly on a local checkout.** Every shipped plugin names
      itself by its strandz.it IRI, so opening the collection on localhost reports all twelve
      as differing by identity. Correct, and noisy.


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

- [ ] **A "SHOULD refer to plugins by absolute IRI" recommendation, and whether
      `web/collections/jigdaw.ttl` should stop being the exception.** From the inbox,
      2026-09-24. `host-plugin-contract.md` section 1.1 already MUSTs absolute identity for a
      plugin; what is missing is a recommendation, in prose docs and tutorials, to *write*
      plugin references as absolute IRIs rather than relative ones, for the same reason a
      collection of someone else's plugins already must
      ([plugin-collections.md](docs/plugin-collections.md) section 1.1). That much is a small,
      non-conflicting addition, worth placing in `for-hosts.md` or `for-plugin-authors.md`.
      The inbox item goes further and asks that `web/collections/jigdaw.ttl` itself hold
      absolute IRIs. That conflicts with a deliberate, documented and tested design: section
      1.1 explains the file omits `@base` on purpose, so `<../plugins/pulse/>` resolves
      against whichever host serves it and the same file works on `localhost` and on
      strandz.it alike, and `tests/catalogue/CollectionLoader.test.js` checks it against
      `plugins/` on disk under that assumption. Switching it to absolute IRIs would pin the
      shipped collection to one origin and needs a maintainer decision, not a silent reversal
      of a choice that was made and tested for a reason. Done in the meantime: docs now link
      the published collection at
      [strandz.it/jigdaw/collections/jigdaw.ttl](https://strandz.it/jigdaw/collections/jigdaw.ttl)
      (`plugin-collections.md` section 4).

## JSFX plugins

## The reference host

## A pure-JavaScript plugin

## The native adapter

## Before there is code

## Recurring, check periodically

