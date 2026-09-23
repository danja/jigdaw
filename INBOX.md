This file will contain things that are later thoughts, they will need accommodating in the plan and/or TODO.md

Make a note in AGENTS.md to periodically read and integrate this.

## Items

* ~~is there a script I need to run to generate the provenance.ttl for the plugins?~~ Turned
  into a real gap once it became clear why: `~/github/diddums` (danbri, built against this
  spec) was fetching `provenance.ttl` beside each served plugin and 404ing. Correct, under the
  current model: `jig:Bundle` describes a copy, and a plugin served at its own canonical
  origin (`plugins/*/` on strandz.it) is never a copy of anything, so it was never meant to
  carry one. But the underlying need was real: nothing dereferenceable said who wrote a plugin.
  `trn:vendor "danja"` was already on all nine profiles and answers a different question, a
  display name for a catalogue rather than something a tool can follow.

  Fixed by adding `doap:developer <http://danny.ayers.name>` directly to the profile, reusing
  DOAP the way `doap:revision` already does, rather than by inventing a served-origin bundle
  form. `src/rdf/Vocabulary.js`, `vocabs/shapes.ttl` (optional, `sh:nodeKind sh:IRI`, the same
  rule provenance attribution already follows), `vocabs/jigdaw.ttl`'s comment,
  `bin/write-profile.js` and `bin/jsfx-import.js` (so a future JSFX import carries it too), and
  all nine `plugins/*/profile.json` regenerated into `profile.ttl`. `examples/counterexample-
  profile.ttl` gained a `doap:developer` literal to exercise the new constraint, and
  `tests/validate/ShapeValidator.test.js`'s expected count went from 10 to 11; mutation tested
  by removing the shape and confirming the count drops back to 10. `npm test`: 855 of 855.
* ~~the layout of the documentation is dominated by links at the top. Could these go in a left
  sidebar instead~~ Already done, 2026-09-19: `TODO.md`'s "Documentation" entry replaced the
  single wrapping top nav (all eighteen documents in one list, which is the layout this item
  describes) with a grouped sidebar (Specification, Guides, Background), measured at 375px
  width in a real iframe.
* ~~Reaper : either a JSFX or script wrapper for loading plugins (without the adapter
  VST)~~ Now `TODO.md`, under "From the inbox".
* ~~JUCE extension to build JigDAW plugins? It would be good to allow a JUCE developer to add
  the option as an output format. The DSP side should be straightforward but I don't know
  about the UI - ideally it would follow the design given in JUCE~~ Now `TODO.md`, under
  "From the inbox", together with the DPF-as-JUCE item below.
* ~~Any more ways of verifying a plugin?~~ Now `TODO.md`, under "From the inbox".
* ~~New plugin : Impulse Response and Neural Amp Modeler, loads corresponding files, processes
  2 channels of audio, reference : /home/github/NeuralAmpModelerPlugin - think of a snappy
  name~~ Now `TODO.md`, under "From the inbox". Working name proposed there: Ferrite, not yet
  committed to.
* ~~DPF plugin, as JUCE~~ Now `TODO.md`, under "From the inbox", together with the JUCE
  extension item above.