# Plugin collections

**Status:** normative for a host that opens a collection and for anyone publishing one.
**Extends:** [host-plugin-contract.md](host-plugin-contract.md) sections 1 and 3.

A collection is a list of plugins published as one Turtle file at one URL. It gives a person
something to hand a host that means "these", whether that is a set of reverbs, the plugins
from one author, or the ones a tutorial uses. A host given the URL can list the plugins,
check each one, and offer the ones that will run.

**A collection is an opinion, not a registry.** Contract section 1.1 says a plugin is
published by publishing its IRI, and a collection does not change that. Including a plugin
in a collection confers no trust on it and needs no permission from its author, and leaving
a plugin out of every collection does not make it any less loadable.

## 1. What a collection says

A collection states four things and no more: its own name, a description, and the IRI and
name of each plugin it includes.

```turtle
@base <https://example.org/collections/reverbs> .

@prefix jig:     <http://purl.org/stuff/jigdaw/> .
@prefix rdfs:    <http://www.w3.org/2000/01/rdf-schema#> .
@prefix dcterms: <http://purl.org/dc/terms/> .

<>
    a jig:PluginCollection ;
    rdfs:label "Reverbs" ;
    rdfs:comment "Rooms, plates and springs, from small to very large." ;
    dcterms:hasPart <https://example.org/plugins/reference/> ,
                    <https://plugins.example.net/plate/> .

<https://example.org/plugins/reference/> rdfs:label "Reference" .
<https://plugins.example.net/plate/> rdfs:label "Plate" .
```

| Term | Subject | Required | Meaning |
|---|---|---|---|
| `a jig:PluginCollection` | the collection | exactly one per document | what a host looks for |
| `rdfs:label` | the collection | exactly one | its name, shown in place of the URL |
| `rdfs:comment` | the collection | at most one; SHOULD be present | what it is for |
| `dcterms:hasPart` | the collection | at least one | a plugin's IRI |
| `rdfs:label` | each plugin | exactly one | the plugin's name, as the collection gives it |

A document MUST contain exactly one `jig:PluginCollection`. The collection MUST be named by
an IRI, either the document's own (`<>`) or a fragment of it, never a blank node
([CLAUDE.md](../CLAUDE.md), RDF conventions).

Each `dcterms:hasPart` value MUST be a plugin IRI as contract section 1.1 defines it: `https:`,
or `http:` on loopback only. It is the same IRI a host would be given to load the plugin by
hand.

Each included plugin MUST have an `rdfs:label` in the collection document. This is a copy of
the name, and it exists so that a host can draw the list before any profile has arrived. The
profile's own `rdfs:label` governs once it has (section 3.3).

A collection states no order. RDF has none to give without `rdf:List`, which this project
does not use for anything addressable, and a host sorts by name.

Anything else in the document is permitted and ignored: `dcterms:creator`, `prov:` metadata, a
`foaf:homepage`. A collection MUST NOT carry the plugins' profiles, resources or digests. The
profile at each IRI is the only statement of what a plugin is, and a second copy is one that
can be out of date.

The terms are `jig:PluginCollection`, a subclass of
[`dcmitype:Collection`](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/Collection/),
and [`dcterms:hasPart`](https://www.dublincore.org/specifications/dublin-core/dcmi-terms/terms/hasPart/)
and `rdfs:label`, reused unchanged. `vocabs/shapes.ttl` enforces this section as
`jig:PluginCollectionShape`, `examples/reference-collection.ttl` is a valid collection and
`examples/counterexample-collection.ttl` breaks each constraint once.

### 1.1 Relative IRIs name plugins served beside the collection

A profile states an explicit `@base` so it means the same thing wherever it is read. A
collection MAY omit `@base`. Relative references then resolve against the URL the collection
was fetched from, so a collection published next to its plugins names them as
`<../plugins/pulse/>` and keeps working on every host that serves the pair, including
`localhost`. `web/collections/jigdaw.ttl` is written this way.

A collection of plugins served from somewhere else names them absolutely.

## 2. Publishing one

A collection MUST be served as Turtle, with `Access-Control-Allow-Origin` permitting the host's
origin, for the reason contract section 1.3 gives: without that header a browser host
cannot read the response at all.

The media type SHOULD be `text/turtle`. A host MUST accept `text/plain`, which is what most
static hosts and GitHub's raw view return for a `.ttl` file, and determines the syntax by
reading the content. The file extension SHOULD be `.ttl`.

A collection is an ordinary cacheable resource. Contract section 1.4 applies to it as it does
to a profile.

## 3. Opening one

A host opening a collection MUST do the following in order.

### 3.1 The document is refused whole or not at all

1. Fetch the collection URL, sending `Accept: text/turtle`.
2. Parse it, resolving relative IRIs against the URL fetched.
3. Validate it against `vocabs/shapes.ttl`.
4. Find exactly one `jig:PluginCollection`.

A failure at any of these MUST refuse the whole collection, before any member is fetched, and
MUST name the step that failed. A host that fetched members of a document it could not read
would be acting on a guess about what the document said.

A result of `sh:Warning` severity, such as a missing description, MUST NOT refuse the
collection. A host SHOULD report it.

### 3.2 Each member is checked, and no code is fetched

For each included plugin, a host MUST perform steps 1 and 2 of contract section 3.1 against
its IRI: fetch the profile, parse it, validate it, and evaluate `trn:requires` and
`jig:wasmFeature` against the capabilities the host offers.

A host MUST NOT fetch any `jig:module`, `jig:processor`, `jig:ui` or `jig:asset` while opening a
collection. Those are fetched and verified against their `jig:integrity` digests when a person
loads the plugin, and a host MUST perform the whole of contract section 3.1 again at that
point. Two reasons:

- Verifying the code now proves nothing about the bytes fetched later. The digests are
  checked on the bytes that are about to run, so the check has to happen then regardless.
- A collection of forty plugins would download forty plugins' code to show a list from which
  a person picks one. Contract section 2.1 exists to avoid running or fetching code for no
  reason, and the same argument applies.

This is the check worth doing at collection time: it finds everything that can be known
without code. A dead link, a moved plugin, a profile that no longer validates, and a plugin
this host cannot run all show up before a person chooses, rather than after.

Members are independent. A member that fails MUST NOT stop the others from being checked or
shown, and MUST be reported with the step of contract section 3.1 at which it failed and the
reason, in the same terms a failed load would give. A host SHOULD limit how many profiles it
fetches at once.

### 3.3 The profile governs

Where a collection and a profile disagree, the profile is right.

- **Name.** A host MUST show the profile's `rdfs:label` for a member whose profile has
  arrived, and SHOULD report a difference from the collection's name to the person, since it
  usually means the collection is out of date.
- **Identity.** A member's IRI is where its profile is fetched from, and the subject of the
  profile is the plugin's identity. They differ legitimately for a mirror or a local
  checkout, where the profile's explicit `@base` names the canonical origin (see
  [plugin-profiles.md](plugin-profiles.md)). A host SHOULD report the difference and MUST NOT
  refuse the member for it.

### 3.4 What a host shows

A host MUST offer to load each member that passed section 3.2, by the IRI the collection
gives. A host MUST NOT offer a load control for a member that failed; it shows the member's
name and the reason instead. A disabled control reads the same as an enabled one to a screen
reader, so leaving it out is the version of this that carries the information
([CLAUDE.md](../CLAUDE.md), interface rules).

Loading a member is loading a plugin, with no shortcut. Being in a collection does not skip
consent for a foreign plugin (contract section 12.4), integrity verification (section 3.2), or
anything else.

## 4. In the browser host

`src/rdf/CollectionReader.js` reads a parsed collection into a plain object.
`src/catalogue/CollectionLoader.js` implements section 3, taking the member check as an
injected function; the page passes `PluginLoader.loadProfile`, which is steps 1 and 2 of
contract section 3.1 and nothing after.

The page has an "Open a collection" form under "Load by IRI", and opens one given in the query
string, so a collection can be shared as a link:

```
https://strandz.it/jigdaw/?collection=https://example.org/collections/reverbs
```

`web/collections/jigdaw.ttl` is the collection of every plugin in this repository, and is what
the form offers by default. Published, it is
[strandz.it/jigdaw/collections/jigdaw.ttl](https://strandz.it/jigdaw/collections/jigdaw.ttl):

```sh
curl -H "Accept: text/turtle" https://strandz.it/jigdaw/collections/jigdaw.ttl
```

`tests/catalogue/CollectionLoader.test.js` opens it against the real profiles on disk, fails
if it and `plugins/` disagree in either direction, and checks that opening it fetches the
document and the profiles and nothing else.

A foreign plugin (contract section 12) is refused by `loadProfile`, which reads native
profiles only, so a collection that includes one shows it as not loadable here. Loading it
through the foreign path by hand still works.
