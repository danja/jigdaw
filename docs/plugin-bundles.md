# Plugin bundles

**Status:** normative for a host that opens a bundle and for a tool that makes one.
**Extends:** [plugin-profiles.md](plugin-profiles.md), [host-plugin-contract.md](host-plugin-contract.md) section 1.

A JigDAW plugin is a dereferenceable IRI, and installing it is a HTTP GET. That works for as
long as somebody is serving it, which is not the same as for ever, and not the same as right
now on a machine with no network.

A bundle is the same plugin as a file: to send to someone, to archive, to mirror, to install
offline, or to keep as a cache of a plugin whose origin has gone away. **A bundle changes
nothing about what a plugin is.** It carries the same canonical IRI and the same integrity
digests, and a host that opens one loads it through exactly the path it uses for the web.

## 1. Completeness comes first

A bundle can only contain what the profile enumerates. A plugin's files are what it declares:

| Property | What |
|---|---|
| `jig:module` | The WebAssembly binary |
| `jig:processor` | The AudioWorklet module |
| `jig:ui` | The user interface entry point, if it has one |
| `jig:asset` | Anything else it needs: an impulse response, a wavetable, a font |

**A plugin MUST declare every file it fetches at runtime.** A processor that fetches a
resource the profile does not name is not bundlable, and MUST NOT do it. This cannot be
enforced by validation, because a `fetch` inside a processor is opaque to a shape, so it is
stated here as a requirement on the author and it is the one rule that makes the rest work.

`vocabs/shapes.ttl` already requires every declared resource to carry a `jig:location` and a
`jig:integrity`, so a complete declaration is automatically a verifiable one.

A tool that makes a bundle MUST include every declared resource and MUST NOT include anything
else. The plugin's source, its build script and its tests are not part of the plugin.

## 2. Two forms, for two jobs

Both carry the same plugin. Which to use is a question about the job, not about the plugin.

### 2.1 A flattened profile, for sending

A profile whose every `jig:location` is a `data:` URI holding the resource itself.

```turtle
<#module>
    a jig:Module ;
    jig:location <data:application/wasm;base64,AGFzbQEAAAABGgVgAX8AYAJ/fwB…> ;
    jig:mediaType "application/wasm" ;
    jig:abi jig:Abi2 ;
    jig:integrity "sha384-g3DvRxgIQlAOtAs4i…" .
```

**This is already a legal profile.** It needs no new media type, no new extension and no code
that does not exist: `resolveLocation` leaves a `data:` URI alone, `fetch` reads it, and the
integrity digest verifies over the decoded bytes exactly as over bytes from a server. A host
that has never heard of bundles opens one.

The file extension is `.ttl` and the media type is `text/turtle`, because that is what it is.

The cost is base64, which is a third larger than the bytes it carries, and that the resources
can no longer be served with their own headers. For a plugin of a few hundred kilobytes that
is a fair trade for a single file anybody can open.

### 2.2 An archive, for publishing and mirroring

A zip whose root holds `profile.ttl`.

```
pulse.jig
  profile.ttl
  pulse.wasm
  pulse-processor.js
  ir/hall.flac
```

The extension is `.jig` and the media type is `application/vnd.jigdaw.plugin+zip`.

`profile.ttl` MUST be at the root, not in a directory inside the archive, so that finding it
does not require guessing. Every `jig:location` in it MUST be relative, and MUST resolve to a
path inside the archive. An archive MUST NOT contain a file no resource names.

This form keeps the bytes as bytes, so it streams, it compresses, and a mirror can unpack it
into a directory and serve it unchanged. That last property is the point of it: **an archive
unpacked into a web root is a working plugin origin.**

## 3. Identity does not change

In both forms the profile keeps its canonical IRI, through `@base` and the `<>` subject.

A bundle is a **retrieval origin**, not an identity. This is the rule the profile format
already states for a mirror, and it is why opening a bundle needs no new concept: a host
resolves the canonical IRI from the document and rebases the resource locations onto wherever
it actually read them from, which for an archive is the archive. `rebaseLocation` in
`src/rdf/ProfileReader.js` and `rebase` in `native/jigdaw-adapter/src/Profile.cpp` are that
rule, already written and already exercised cross-origin.

Two consequences worth stating, because both are useful and neither is obvious.

**A bundle is a cache keyed by the plugin's IRI.** A project names its plugins by IRI. A host
holding a bundle for one of those IRIs MAY load from the bundle instead of the network, and
the digests make that safe. A session then opens with no network at all.

**Having a bundle does not publish the plugin.** The IRI in it still belongs to whoever minted
it. A host MUST NOT treat a bundle as authority for what is served at that IRI, and MUST NOT
write it anywhere that would make it look like the origin's answer.

## 4. Verification

A host MUST verify every resource against its `jig:integrity` before instantiating anything,
from a bundle exactly as from a server. Contract section 3.2 already requires this and there
is no skip path for local files: a file that arrived by email is no more trustworthy than one
that arrived over HTTP, and rather less.

A host MUST refuse a bundle in which a declared resource is absent, and MUST say which.

## 5. What is deliberately absent

**No manifest.** The profile is the manifest. A second list of the files would be a second
answer to the question the profile already answers, and the two would drift.

**No version inside the bundle.** A plugin's version belongs in its profile, where it is the
same statement whether the plugin arrived as a bundle or as a URL.

**No signature, yet.** Every file in a bundle is tamper-evident, because every one of them
carries a digest that the profile states. The profile itself is not: someone who rewrites it
can rewrite the digests with it. Closing that needs a digest of the profile published
somewhere the bundle is not, and a decision about who is trusted to publish it. A bundle digest
can be added later without changing the format, which is why this is recorded rather than
invented now.

Until then, and this MUST be said to a person rather than assumed: **opening a bundle runs code
from whoever made the bundle**, and the digests prove only that it is the code that person
put in it.

## 6. Making one

`bin/bundle.js <plugin-directory>` writes both forms beside each other. It reads the profile,
walks the four declared resource properties, and refuses a plugin whose declaration is
incomplete rather than making a bundle that will fail on the other machine.
