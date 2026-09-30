# JigDAW

A Jig is a plugin that conforms to the JigDAW spec. It runs natively in a browser, but I also want it to build on all the tools and code that already exist for desktop DAWs. Ok, that's the ambition. Here's what's actually there.

A plugin is identified by one dereferenceable IRI. Fetch it and you get a description of what the plugin is, what it needs from a host, and where its code lives. Every resource has an integrity digest, which the host checks before running anything. No installer, no registry. To publish a plugin you put some files somewhere a browser can fetch them.

## Why

VST3 and LV2 spread identity, discovery and delivery over different mechanisms: a class ID, a catalogue entry, an installer. On the web there was nothing equivalent for a plugin whose processing is real code, delivered by URL and verified before it runs. Web Audio Modules cover part of that. JigDAW adds identity, verification, capability negotiation and an RDF description a catalogue can query. It works alongside WAM, it doesn't replace it.

## Security

A plugin is arbitrary code from an origin the host doesn't control, so the host treats it that way. It fetches, parses and validates the profile before fetching anything the profile names. Every resource gets a SHA-384 check before it's instantiated, and there's no continue-anyway path past a failure. If a plugin has its own user interface, that goes in a sandboxed cross-origin frame, never the host document.

## Linked Data

A profile is RDF, naturally. The musical side (role, the signals it takes and gives) uses the `trn:` vocabulary from the plugin-universe catalogue, so a Jig is a valid entry there without translation. Parameters are plain LV2 (`lv2:`), so an existing LV2 plugin's port descriptions carry over as they are. Only the browser-specific terms, `jig:`, are JigDAW's own. They live at [http://purl.org/stuff/jigdaw/](http://purl.org/stuff/jigdaw/) and can be dereferenced like everything else.

## Other specs

Parameters are LV2 ports, not something new I invented.

The musical vocabulary is shared with plugin-universe and transmissions (`trn:`), not forked. `jig:WebPlugin` is a subclass of `trn:PluginProfile`, so an existing catalogue entry becomes loadable by extension without being rewritten.

A Jig can be packaged as a WAM 2.0 module. JigDAW can also host a foreign WAM, with tighter isolation and more explicit user consent than the WAM API asks for.

For REAPER JSFX there's an importer. It turns the effect's script into bytecode that a shared WebAssembly interpreter runs, so an existing JSFX effect becomes a Jig with no hand rewriting.

For native VST3, CLAP and LV2 there's an optional portable module ABI, so a plugin with no JavaScript engine around it can be loaded directly by a native host. A reference adapter built on it loads Jigs into a desktop DAW.

## Hosts

Loading a plugin you didn't write goes in this order (details in [for-hosts.md](for-hosts.md)):

1. Fetch the profile.
2. Parse it.
3. Validate against the published SHACL shapes.
4. Check what the plugin requires against what the host offers.
5. Fetch and verify its resources.
6. Register and construct its `AudioWorkletNode`.
7. Send `init`, wait for `ready`, and only then connect it into the graph.

There's a minimal standalone reference host that renders real audio from a plugin's IRI to a WAV file, no browser involved. [bin/jig.js](../bin/jig.js) puts a jalv-like surface on the same machinery. It will list the local plugins, show one plugin's ports, draw its generated panel, render audio and screenshot the panel.

## Plugins

A plugin is a profile, a processor, and usually a WebAssembly module doing the signal processing. [for-plugin-authors.md](for-plugin-authors.md) covers writing all three, the real-time rules a processor has to follow, and generating the digests in a build instead of by hand (much less error-prone). The module is optional. If the plugin is simple enough for plain JavaScript, it declares none.

If the plugin already exists somewhere else, there's an importer for REAPER JSFX effects and another that packages a Jig for a WAM 2.0 host.

## State of play

The spec is complete and normative. A browser host implements it and runs the worked plugins, including:

- a subtractive synth
- a reverb
- a compressor/expander/limiter/clipper with a sidechain input
- a transport-synced bass line generator
- the firmware of a three-chip synth, compiled unmodified from C++
- three REAPER JSFX effects
- one whose whole signal path is JavaScript

The native VST3/CLAP/LV2 adapter fetches, verifies and sounds the plugins that declare a portable ABI. Sessions save and reopen carrying the IRIs, which is what makes them portable.

Not done yet: plugin UIs of their own. They're specified, but so far you only get the panel generated from the declared parameters.

Source and spec: [github.com/danja/jigdaw](https://github.com/danja/jigdaw). Apache 2.0.
