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
  provenance.ttl
  pulse.wasm
  pulse-processor.js
  ir/hall.flac
```

The extension is `.jig` and the media type is `application/vnd.jigdaw.plugin+zip`.

`profile.ttl` MUST be at the root, not in a directory inside the archive, so that finding it
does not require guessing. Every `jig:location` in it MUST be relative, and MUST resolve to a
path inside the archive.

The archive root reserves exactly two names, `profile.ttl` and `provenance.ttl`, and a
resource MUST NOT be called either of them. Apart from those two, an archive MUST NOT contain
a file no resource names. `provenance.ttl` is section 5 and is the only thing in an archive
that is not the plugin.

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

## 5. Provenance

A bundle arrives by hand. It did not come from the origin that minted the IRI inside it, and
that is the one fact about it the profile cannot state. So a bundle carries a record of its
own making, and a tool that writes a bundle MUST write one.

The record is a separate document, `provenance.ttl`, at the root of an archive or beside a
profile on a server. The flattened form is one file by definition, so its record is appended
to that file. Every node in it is named absolutely, so the same triples mean the same thing in
all three places. [examples/reference-provenance.ttl](../examples/reference-provenance.ttl) is
a worked one.

It says four things.

**What this is a copy of.** `jig:Bundle`, with `prov:wasDerivedFrom` naming the plugin. The
bundle is a separate node from the plugin on purpose: section 3 says holding a bundle does not
make the holder the authority for the IRI in it, and two nodes is how that is written down.

**Who made it and when.** A `jig:Bundling` activity with `prov:endedAtTime`,
`prov:wasAssociatedWith` the tool, and `prov:wasAttributedTo` whoever is claiming it.
Attribution is OPTIONAL and is an IRI when present, never a name: a name is not something a
signature can be checked against. An anonymous bundle is a real thing and a host MUST report
it as anonymous rather than refusing it.

`prov:atLocation` MAY say where the bytes were read from. It is for a mirror recording an
origin it fetched from. A local filesystem path is somebody's machine and MUST NOT be written
into a published record.

**The canonical digest.** `jig:canonicalDigest`, which is the part that closes the hole this
document used to record as open.

Every file in a bundle is already tamper evident, because the profile states its digest. The
profile was not: whoever rewrites it rewrites the digests with it. A digest of the profile's
bytes would not have closed that, because the same plugin is legitimately three different byte
sequences, flattened, archived and served, and a value that changes between them tells a
recipient nothing.

So it is a digest over the graph, not over the document, in a canonical form defined by three
rules:

1. Serialise as [N-Triples](https://www.w3.org/TR/n-triples/) and sort the lines in code point
   order. This is [RDFC-1.0](https://www.w3.org/TR/rdf-canon/) restricted to graphs with no
   blank nodes, which is what it reduces to when there are none. A profile MUST NOT contain a
   blank node, which the RDF conventions already required, and a canonicaliser MUST refuse one
   rather than labelling it.
2. Omit every `jig:location`. A bundle is a retrieval origin and not an identity, which is the
   rule `rebaseLocation` already implements for mirrors. This is safe precisely because
   `jig:integrity` is not omitted: a rewritten location can only point at bytes that match the
   signed digest, or the load fails at section 4.
3. Omit the provenance record itself, and every proof. The record carries this value, and a
   digest cannot contain itself.

The result is one value for one plugin, whichever way it was delivered. Two people holding a
plugin from different places can compare one string.

Unsigned, all of this is a claim by whoever handed you the file, and a host MUST present it as
one.

## 6. Signing

A signature turns the claim into something only the holder of one key could have made.

A proof is a [Data Integrity](https://www.w3.org/TR/vc-data-integrity/) proof, expressed in
the W3C security vocabulary, attached to the plugin with `sec:proof` and carried in the same
provenance document. The key is a `sec:Multikey`: multibase base58btc of an Ed25519 public key
behind its multicodec prefix, which is why one begins `z6Mk`.

```turtle
<https://strandz.it/jigdaw/plugins/pulse/> sec:proof <#proof> .

<#proof>
    a sec:DataIntegrityProof ;
    sec:cryptosuite "jigdaw-eddsa-2026" ;
    sec:proofPurpose sec:assertionMethod ;
    sec:verificationMethod <https://strandz.it/jigdaw/keys/danja#ed25519> ;
    dcterms:created "2026-09-18T11:00:00.000Z"^^xsd:dateTime ;
    sec:proofValue "z3yF..." .
```

### 6.1 The cryptosuite

`jigdaw-eddsa-2026`. Ed25519 over WebCrypto, which a browser and a command line both
implement, so one signature is checked by the same code in both.

The signature is over 96 bytes: the SHA-384 digest of the proof's own configuration, followed
by the SHA-384 digest of the document. This is the construction `eddsa-rdfc-2022` uses and for
the same reason: a proof states its own time and key, and a signature cannot cover a graph it
is inside. Hashing the configuration separately covers them anyway.

**The proof configuration** is the canonical form of the proof node's own statements with
`sec:proofValue` removed. Without it, the created time and the verification method would be
decoration that anybody could rewrite.

**The document** is the canonical form of the profile and the provenance record together, with
`jig:location` omitted as in section 5, and with every proof and every verification method
omitted. The provenance is inside the signature deliberately: a record of who made a bundle
that anybody could rewrite without breaking the signature would be worse than no record,
because it would look checked. Proofs and keys are outside it so that one signature does not
depend on any other, which is what lets a second person countersign a bundle without
invalidating the first signature.

The suite is deliberately not called `eddsa-rdfc-2022`, which signs the whole canonicalised
graph. A proof made here would fail a conforming verifier of that suite, and worse, a proof
made there would look checkable here. A suite that differs needs a name that differs.

### 6.2 What a host MUST report

A verifier answers three questions and MUST NOT collapse them into one, because each can hold
while another fails and a person acting on the wrong one acts wrongly.

| Question | Answered by |
|---|---|
| Are these the files the profile names? | `jig:integrity`, section 4 |
| Is this the profile that was bundled? | `jig:canonicalDigest`, section 5 |
| Who says so? | the proof, this section |

A host MUST refuse a bundle in which a file digest fails or the canonical digest disagrees
with the profile, and MUST refuse a proof naming a cryptosuite it cannot check. An unchecked
proof is worse than no proof, because it looks like a checked one.

### 6.3 Trust is the person's

**A valid signature by a key nobody has heard of proves that one holder of that key made this
bundle, and nothing whatever about who that is.** A host MUST say so in those terms rather
than showing a tick.

The key in a bundle is a copy, never authority. A host that can reach the network SHOULD
dereference the `sec:verificationMethod` IRI and compare, and MUST refuse the proof if the two
disagree: that is somebody claiming a key they do not hold. A host that cannot reach the
network reports that the key was not checked against anything.

Where the key IRI is on the same origin as the plugin IRI, the plugin's origin is signing its
own work, which is the strongest thing a bundle can say without anybody else being involved.
Where it is not, a third party is vouching, and who that party is matters and is not something
this format can decide.

JigDAW does not ship a list of trusted keys and will not. Whose signature means something is a
question about people.

## 7. Making one

`bin/bundle.js <plugin-directory>` writes both forms beside each other. It reads the profile,
walks the four declared resource properties, and refuses a plugin whose declaration is
incomplete rather than making a bundle that will fail on the other machine.

```
node bin/keys.js create https://strandz.it/jigdaw/keys/danja#ed25519
node bin/bundle.js plugins/pulse --by https://danny.example/#me --key ~/.config/jigdaw/keys/ed25519.json
node bin/verify.js plugins/pulse/pulse.jig --online
```

`bin/keys.js` refuses to write a private key anywhere inside a git working tree, and prints the
document to serve at the verification method IRI. `bin/verify.js` prints the three answers of
section 6.2 separately and exits non-zero if any of them fails.

A bundle is reproducible apart from its provenance record, which states when it was made.
`--date` pins that, and two bundles of one plugin made at the same stated time are the same
bytes.

## 8. What is still deliberately absent

**No manifest.** The profile is the manifest, which is also why signing the profile is enough:
it names every file and states every digest, so a signature over it reaches all of them. A
second list of the files would be a second answer to a question the profile already answers,
and the two would drift.

**No version inside the bundle.** A plugin's version belongs in its profile, where it is the
same statement whether the plugin arrived as a bundle or as a URL.

**No revocation.** A signature says a key signed this, and nothing here can say that the key
was later withdrawn. Closing it needs somewhere to publish a withdrawal and a reason to
believe that place, which is the same unanswered question as trust and is not made easier by
inventing a format for it.

**No trusted key list.** Section 6.3.

And the one thing that MUST be said to a person rather than assumed, which signing narrows
rather than removes: **opening a bundle runs code from whoever made the bundle.** A signature
tells you which key that was. It does not tell you that the code is safe.
