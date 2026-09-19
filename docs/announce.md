# JigDAW: a web-native plugin specification

JigDAW is a specification for audio plugins that run natively in a browser but which is also 
designed to build on the substantial ecosystem of tools and code targeting native/desktop
DAWs. 
A plugin is identified by a single dereferenceable IRI. Fetching it returns a description of what the
plugin is, what it needs from a host, and where its code lives, each resource carrying an
integrity digest a host verifies before running it. There is no separate installer and no
registry; publishing a plugin is putting these files somewhere a browser can fetch them.

## Why

Native plugin formats such as VST3 and LV2 separate identity, discovery and delivery into
different mechanisms: a class ID, a catalogue entry, an installer. The web has not had an
equivalent for a plugin whose processing is real code, distributed by URL and verified before
it runs. Web Audio Modules cover part of this gap; JigDAW adds identity, verification,
capability negotiation and an RDF description a catalogue can query, and interoperates with
WAM rather than replacing it.

## Security

A plugin is arbitrary code from an origin the host does not control. A host fetches, parses
and validates the profile before fetching anything the profile names; verifies a SHA-384
digest on every resource before it is instantiated, with no continue-anyway path past a
failed one; and, where a plugin carries its own user interface, loads it into a sandboxed
cross-origin frame rather than the host's own document.

## Linked Data

A profile is RDF. Its musical description (role, the signals it accepts and produces) is
written in the `trn:` vocabulary already published by the plugin-universe catalogue, so a
JigDAW plugin is a valid entry there without translation. Its parameters are plain LV2
(`lv2:`), so an existing LV2 plugin's port descriptions carry over unchanged. Only the terms
specific to running a plugin in a browser, `jig:`, belong to JigDAW, published at
[http://purl.org/stuff/jigdaw/](http://purl.org/stuff/jigdaw/) and dereferenceable like
everything else here.

## Relation to other specifications

- **LV2**: a plugin's parameters are LV2 ports, not a JigDAW-specific format.
- **plugin-universe / transmissions (`trn:`)**: the musical vocabulary, shared rather than
  forked. `jig:WebPlugin` is a subclass of `trn:PluginProfile`, so an existing catalogue entry
  becomes loadable by extension, not by being rewritten.
- **Web Audio Modules**: a JigDAW plugin can be packaged as a WAM 2.0 module, and JigDAW can
  host a foreign WAM under stricter isolation and explicit user consent than the WAM API
  itself requires.
- **REAPER JSFX**: an importer converts a JSFX effect's script to bytecode run by a shared
  WebAssembly interpreter, so an existing JSFX effect becomes a JigDAW plugin without being
  rewritten by hand.
- **VST3 / CLAP / LV2 (native)**: an optional portable module ABI lets a plugin with no
  JavaScript engine around it be loaded directly by a native host. A reference adapter built
  on it loads JigDAW plugins into a desktop DAW.

## For DAW developers

Loading a plugin you did not write is an ordered sequence, documented in
[for-hosts.md](for-hosts.md): fetch the profile, parse it, validate it against the published
SHACL shapes, check what the plugin requires against what the host offers, fetch and verify
its resources, register and construct its `AudioWorkletNode`, then send `init` and wait for
`ready` before connecting it into the graph. A minimal, standalone reference host renders real
audio from a plugin's IRI to a WAV file with no browser at all.

## For plugin developers

A plugin is a profile, a processor, and usually a WebAssembly module doing the signal
processing; [for-plugin-authors.md](for-plugin-authors.md) covers writing all three, the
real-time rules a processor must follow, and generating integrity digests as part of a build
rather than by hand. The module is optional: a plugin simple enough for plain JavaScript
declares none. Two shortcuts exist for a plugin that already exists elsewhere: one importer
converts a REAPER JSFX effect, another packages a JigDAW plugin for a WAM 2.0 host.

## What is implemented

The specification is complete and normative. A browser host implements it and runs 9 worked
plugins: a subtractive synthesiser, a reverb, a compressor/expander/limiter/clipper with a
sidechain input, a transport-synced bass line generator, the firmware of a three-chip
synthesiser compiled unmodified from C++, three REAPER JSFX effects, and a plugin whose entire
signal path is JavaScript. A native VST3/CLAP/LV2 adapter fetches, verifies and sounds the
plugins that declare a portable ABI. The session format saves and reopens carrying the IRIs
that make it portable. Plugin user interfaces of their own, as opposed to a panel generated
from declared parameters, are specified and not yet implemented.

Source and specification: [github.com/danja/jigdaw](https://github.com/danja/jigdaw). Apache
2.0.
