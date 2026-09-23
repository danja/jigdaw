This file will contain things that are later thoughts, they will need accommodating in the plan and/or TODO.md

Make a note in AGENTS.md to periodically read and integrate this.

## Items

* ~~Can we address JUCE from a slightly different angle, so that when a developer builds a
  VST etc, JUCE's build system also spits out a Web-native JigDAW format bundle. The Impulse
  Response/NAM runner in TODO.md plugin might be a good test case~~ Checked rather than
  assumed: JUCE's own build system has no WebAssembly export for a plugin's DSP at all, so
  there is no "spits out a bundle" switch to turn on. Now `TODO.md`, under "From the inbox",
  reframed toward what is actually true: a portable, JUCE-independent DSP core wrapped once
  for JUCE and once for JigDAW, the same separation `jigdaw_core` already demonstrates in the
  other direction. Not built.
* ~~Do we have a C++/wasm + JS boilerplate kind of SDK setup comparable to DPF that a
  developer of JigDAW plugins could use as a starting point?~~ Now `plugins/boost/`, a gain
  stage in C++ meant to be copied: everything past `jig_process` is ABI wiring. `TODO.md`
  has the worked-example record; `.claude/commands/new-plugin.md` and
  `docs/for-plugin-authors.md` both point at it.
* ~~Suggest ways we can potentially reduce the effort needed for the developer of a DAW or
  plugins to support JigDAW~~ `plugins/boost/` (above) for a plugin developer;
  `docs/for-hosts.md` gained a checklist for a host developer, drawn from its own existing
  "The sequence" and the contract's section 11 rather than invented. Further candidates,
  not built, recorded in `TODO.md`: a plain `bin/new-plugin.js` needing no AI assistant, a
  portable conformance fixture set any host implementation could run against, and folding
  `for-hosts.md`'s checklist into the contract itself so there is one copy rather than two.
