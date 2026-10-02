# Nested plugins

**Status:** normative for a host that supports composite plugins and for a tool that makes one. Support is optional for a host
(contract section 14), and a host that supports none of it conforms.
**Extends:** [host-plugin-contract.md](host-plugin-contract.md) sections 1 to 3, 5, 8 and 14, [plugin-profiles.md](plugin-profiles.md),
[project-format.md](project-format.md), [latency.md](latency.md) and [plugin-bundles.md](plugin-bundles.md).

Requirement keywords (MUST, MUST NOT, SHOULD, MAY) are used in the [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) sense.

A composite plugin is a plugin made of other plugins: a guitar effects rack of a boost, a tremolo and a reverb, wired in a fixed order,
with the few controls that matter. It is declared, exchanged and installed as one plugin, and a person uses it as one.

## 1. A composite is a plugin

**A composite plugin is a plugin whose profile declares members and the wiring between them in place of a module and a processor.**
It has its own IRI, its own profile, its own audio ports and its own parameters. In a project it is one node, and its `jig:plugin` names
it as it would any other.

That is what makes it a unit. Identity, discovery, packaging, signing and installation already belong to the plugin, so a composite
inherits all of them: it is found by its IRI, listed in a [collection](plugin-collections.md) like any plugin, bundled and signed by
[plugin-bundles.md](plugin-bundles.md), and installed by having fetched it. Section 13 gives the designs this replaced.

A composite is a `jig:CompositePlugin`. It is not a `jig:WebPlugin`, because `jig:WebPluginShape` requires a processor. A host that does
not support composites therefore finds nothing to load, and MUST say that the plugin is a composite and that it cannot run one, in
place of reporting a missing file.

## 2. Declaring one

This is a complete composite. It is checked against the shapes by `tests/docs/nested-plugins.test.js`, so it cannot drift from them.
Its pins are placeholders (section 9 says how to get real ones).

```turtle
@base <https://example.org/racks/stomp/> .

@prefix jig:  <http://purl.org/stuff/jigdaw/> .
@prefix trn:  <http://purl.org/stuff/transmissions/> .
@prefix lv2:  <http://lv2plug.in/ns/lv2core#> .
@prefix rdfs: <http://www.w3.org/2000/01/rdf-schema#> .
@prefix foaf: <http://xmlns.com/foaf/0.1/> .

<>
    a jig:CompositePlugin , trn:PluginProfile ;
    rdfs:label "Stomp rack" ;
    rdfs:comment "A boost into a tremolo." ;
    foaf:homepage <> ;
    trn:role trn:AudioEffect ;
    trn:accepts trn:Audio ;
    trn:produces trn:Audio ;
    trn:format trn:Jig , trn:WebAudio ;
    jig:audioInputs 1 ;
    jig:audioOutputs 1 ;
    jig:member <#boost> , <#trem> ;
    jig:connection <#c-in> , <#c-mid> , <#c-out> ;
    lv2:port <#drive> , <#depth> .

<#boost> a jig:Member ;
    jig:plugin <https://strandz.it/jigdaw/plugins/boost/> ;
    jig:pinnedDigest "sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" .

<#trem> a jig:Member ;
    jig:plugin <https://strandz.it/jigdaw/plugins/tremolo/> ;
    jig:pinnedDigest "sha384-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" ;
    jig:setting <#trem-rate> .

<#trem-rate> a jig:ParameterSetting ; jig:symbol "rate" ; jig:value 4.5 .

<#c-in> a jig:Connection ; jig:from <#c-in-from> ; jig:to <#c-in-to> ; jig:signalKind trn:Audio .
<#c-in-from> a jig:Endpoint ; jig:endpointNode <> ;      jig:portIndex 0 .
<#c-in-to>   a jig:Endpoint ; jig:endpointNode <#boost> ; jig:portIndex 0 .

<#c-mid> a jig:Connection ; jig:from <#c-mid-from> ; jig:to <#c-mid-to> ; jig:signalKind trn:Audio .
<#c-mid-from> a jig:Endpoint ; jig:endpointNode <#boost> ; jig:portIndex 0 .
<#c-mid-to>   a jig:Endpoint ; jig:endpointNode <#trem> ;  jig:portIndex 0 .

<#c-out> a jig:Connection ; jig:from <#c-out-from> ; jig:to <#c-out-to> ; jig:signalKind trn:Audio .
<#c-out-from> a jig:Endpoint ; jig:endpointNode <#trem> ; jig:portIndex 0 .
<#c-out-to>   a jig:Endpoint ; jig:endpointNode <> ;      jig:portIndex 0 .

<#drive>
    a lv2:InputPort , lv2:ControlPort ;
    lv2:symbol "drive" ; lv2:name "Drive" ;
    lv2:default 1 ; lv2:minimum 0 ; lv2:maximum 2 ;
    jig:drives <#drive-target> .
<#drive-target> a jig:Endpoint ; jig:endpointNode <#boost> ; jig:portSymbol "gain" .

<#depth>
    a lv2:InputPort , lv2:ControlPort ;
    lv2:symbol "depth" ; lv2:name "Tremolo depth" ;
    lv2:default 0.5 ; lv2:minimum 0 ; lv2:maximum 1 ;
    jig:drives <#depth-target> .
<#depth-target> a jig:Endpoint ; jig:endpointNode <#trem> ; jig:portSymbol "depth" .
```

Everything reused keeps its meaning. A member is a `jig:plugin` with `jig:setting`s, as a project node is. A wire is a `jig:Connection`
between `jig:Endpoint`s, as in a project. A parameter is addressed by `jig:portSymbol`, as a modulation edge addresses one. A
composite's controls are `lv2:port`s, so contract section 5.1 holds unchanged: one declaration, from which the host derives the panel
and the automation names. The terms new to composites are `jig:CompositePlugin`, `jig:Member`, `jig:member`, `jig:pinnedDigest` and
`jig:drives`, defined in `vocabs/jigdaw.ttl` and checked by `jig:CompositePluginShape` and its companions in `vocabs/shapes.ttl`.

| Statement | On | Required | Meaning |
|---|---|---|---|
| `a jig:CompositePlugin` | the composite | yes | what a host looks for. Also `trn:PluginProfile`, so a catalogue reads it |
| `rdfs:label`, `foaf:homepage`, `trn:role`, `trn:produces` | the composite | yes | the same catalogue statements a Jig makes |
| `jig:audioInputs`, `jig:audioOutputs` | the composite | yes | the counts an outer graph sees before any member is read |
| `jig:member` | the composite | at least one | a member, by an IRI that is a fragment of the composite's |
| `jig:connection` | the composite | at least one | a wire between members, or between a member and the boundary |
| `lv2:port` | the composite | any number | a control the composite offers, with `jig:drives` |
| `jig:processor`, `jig:module`, `jig:ui`, `jig:latencyFrames`, `jig:tailFrames` | the composite | MUST NOT appear | a composite has no code of its own, and its latency and tail are derived (section 7.4) |

A composite MUST NOT contain a blank node, for the reason the rest of the format gives (CLAUDE.md, RDF conventions): a graph with one
has no canonical form and cannot be signed.

## 3. Members

A member is one instance of a plugin inside a composite. It is the counterpart of a project node and has no track, because the
composite is what is on a track.

- A member MUST name its plugin with `jig:plugin`, by an `https:` IRI, or `http:` on loopback, as contract section 1.1 requires of
  any plugin.
- A member MAY be a composite. Its exposed ports are all the enclosing composite sees of it.
- One plugin MAY be used by several members. Each is an instance with its own state.
- A member MAY carry `jig:setting`s. They are the author's voicing: the value a parameter has when the composite loads, which a person
  using the composite cannot change. A parameter a person should be able to change is exposed (section 5).
- A member MAY carry `jig:pinnedDigest` (section 9). A composite whose members are not all pinned is valid and loads, and cannot be
  bundled.
- A member MUST NOT carry `jig:onTrack`.

## 4. The boundary

**A connection whose endpoint names the composite itself is a connection to its boundary.** From the composite is an input at that
index, and to the composite is an output. Direction says which side, so input 0 and output 0 do not collide, and a plain wire from input
to output is one connection from the composite to the composite.

- A boundary connection MUST name its port by `jig:portIndex`. `jig:signalKind` says whether it carries audio or MIDI.
- Every output the composite declares MUST have at least one connection arriving at it. An input need not be used.
- No connection MAY use an input or output index at or above the declared count.
- One boundary input MAY feed several members, and several members MAY feed one boundary output, in which case they sum, as any fan-in does.
- A connection MUST NOT name anything that is neither a member nor the composite.
- A composite MUST NOT be a member of itself.
- A connection to the composite with a `jig:portSymbol` is a modulation source for one of its exposed ports, and the symbol MUST be one it
  exposes.

The shapes cannot say these rules, because they need `sh:sparql`, which the validator throws on. `src/rdf/CompositeReader.js` checks them,
and a host MUST refuse a composite that breaks one.

A composite whose members speak MIDI declares `trn:requires jig:MidiEvents`, as any plugin does. MIDI crosses the boundary the same way
audio does.

## 5. Controls

**A composite's parameters are the `lv2:port`s it declares, and only those.** Each MUST carry `jig:drives`, naming the member
parameters it sets, as `jig:Endpoint`s with a `jig:portSymbol`. One port MAY drive several.

- The value is passed through unchanged. There is no scaling in this version (section 12).
- When the driven member is itself a composite, the symbol is one of its exposed ports, and the host follows the chain to the plugin that
  has the parameter.
- A host MUST check, once the members' profiles are fetched and before fetching any code, that every driven parameter exists on its
  member and that the port's `lv2:minimum` and `lv2:maximum` lie within the driven parameter's. A range wider than its target asks a
  member for a value it declares it cannot take, and the host MUST refuse the composite.
- A member's own `jig:setting` on a parameter an exposed port drives is an error, because there would be two answers to one question.
  Contract section 8.2 gives the same argument for not saving a value in two places.
- A port's `lv2:default` is applied to what it drives when the composite loads.

What is not exposed is not the person's to change. That is the point of a rack and the same as an author leaving a knob off a panel.

## 6. Loading

A host that supports composites MUST do the following, and contract section 3.1 applies to each member as to any plugin.

1. Fetch and validate the composite's profile against `vocabs/shapes.ttl`.
2. Read it, and refuse it if section 4 or section 5 is broken.
3. Fetch and validate the profile of each member, and of each member's members, recursively. **No module, processor, user interface or
   asset is fetched yet.**
4. Evaluate `trn:requires` and `jig:wasmFeature` over the composite and every member, and refuse naming what is missing and which member
   needs it. This is contract section 2.1, applied to the whole tree.
5. Check each `jig:pinnedDigest` against the canonical digest of the profile just fetched for that member
   ([plugin-bundles.md](plugin-bundles.md) section 5). A mismatch MUST refuse the composite, naming the member and both digests.
6. Check the drive targets (section 5).
7. Only then perform contract section 3.1 steps 3 to 8 for each member, once per use.

Code is not fetched before step 7 for the reason [plugin-collections.md](plugin-collections.md) gives for not fetching it to draw a list.
The bytes checked early are not the bytes that run, and a composite of forty members would otherwise download forty plugins to find
that one needs a capability the host lacks.

**A composite loads whole or not at all.** A member that fails fails the composite, and the error MUST name the composite, the member
and the step at which it failed. A host MUST NOT load the composite without that member, which would produce a different sound with
nothing saying so. Members already instantiated are released, and contract section 10.2 holds: the previous graph keeps playing.

**A composite MUST NOT contain itself**, directly or through its members. A host follows the chain of composite IRIs as it descends,
refuses at the first repeat, and names the chain. A host MAY limit depth, MUST support at least four levels of composite inside
composite, and MUST say its limit when it refuses for it.

**A host SHOULD list a composite's members and their origins before the first load.** A pin and a signature prove who assembled the
composite and that the members are the ones named. They say nothing about the members' code, and loading a composite runs code from every
origin it names (section 10).

A host MUST fetch a profile once for however many members use it.

## 7. Running one

### 7.1 The model keeps one node and the compiler is given the flat graph

A composite is one node in the project. Its connections, bypass, track membership, undo and the Op that adds it are those of any node.
The compiler and the engine are given the graph with each composite replaced by its members. This is the architecture rule that the
interface never mutates the running graph, and `src/ops/Bypass.js` already works the same way: the model holds every connection as
written, and a pure function hands the engine a rewritten list, so that nothing is lost and undo costs nothing.

Expansion runs after bypass, on the message thread with the rest of graph compilation, never in `process()`, and is defined by:

- Each composite node is replaced by its members as nodes, with the composite's internal connections.
- A connection into the composite's input *n* is joined to each inner connection that leaves the boundary at *n*. A connection out of
  output *n* is joined from each inner connection that enters the boundary at *n*. A pass-through joins the outside source to the
  outside destination directly. A side with nothing behind it inside means the connection ends at the boundary and is dropped.
- A connection to an exposed parameter goes to each member parameter that port drives.
- The rule is applied until no composite is left.

### 7.2 Identity inside

A member in the flat graph has an id that is an opaque key, and a `path`: the chain of member IRIs from the outermost node inward.
Anything that needs to know where a member sits MUST read the path, and nothing MAY take the id apart. A diagnostic names the path, so a
feedback loop that crosses a composite's boundary is reported at the composite and the member in it.

### 7.3 Bypass, tracks and MIDI

- **Bypass** applies to the composite as one node: what arrives at input 0 goes to output 0, a composite with no audio input makes
  nothing, and its members keep their state. Its members are marked bypassed and MUST NOT be heard.
- **Track.** Every member is on the track of the composite.
- **MIDI into a composite** reaches whatever its boundary MIDI input is wired to inside.
- **Sinks.** A member that feeds nothing in the flat graph is where the signal has arrived, and is linked to the track, as any last node
  is.

### 7.4 Latency and tails are derived

A composite MUST NOT declare `jig:latencyFrames` or `jig:tailFrames`. Both are computed from the members and move when a member's `latency`
message moves them, so a declared figure could only be wrong.

**Compensation is exact, because it is done on the flat graph.** [latency.md](latency.md) section 3 aligns the paths in a graph by the
greatest latency accumulated to each node. With the members in that graph, a dry path outside the composite and a wet path through it
are aligned by what is actually on each, rather than by one number that hides which path was slow. A host MUST compensate across a
composite's boundary exactly as it would between the same members wired by hand.

The composite's reported latency, for track alignment and for a recording, is the greatest accumulated latency from any boundary input
to any boundary output. Its tail, for offline render length, is the greatest tail among the members that can reach an output, and is
unbounded if one of them is. A cycle is found after expansion, so a loop through a composite is a loop, and the rule that it needs a
`DelayNode` applies to it.

## 8. Settings and state

**A node's settings are keyed by the symbols of the ports it exposes.** Automation, the generated panel and the agent tools address a
composite's parameters as they address any plugin's, and see one that has as many parameters as it has ports.

**State is assembled by the host**, since a composite has no processor to ask (contract section 8.2). It is:

```
{ "members": { "<member IRI>": <that member's state>, … } }
```

A member that is itself a composite contributes an object of the same shape. The result is stored as the node's `jig:nodeState`.

- State is keyed by member IRI, never by position.
- A member declaring `jig:stateless` is not asked and has no key. A composite none of whose members has state saves none.
- On restore, a key that names no member MUST be ignored, and a member with no key MUST get its defaults. This is contract section 8.1's
  rule for loading an older state, and it lets an author add a member in a later version without invalidating saved sessions.
- Parameter values are not in it.

A preset of a composite is therefore what a preset of any plugin is: its exposed settings and its state.

## 9. Pins, and exchanging a composite

### 9.1 What a pin is

`jig:pinnedDigest` on a member is the canonical digest of that member's profile at the time the composite was made, as
`sha384-` and a base64 value. It is the [canonical digest](plugin-bundles.md) taken over the member's own triples: those whose subject is
the member plugin's IRI or begins with it followed by `#`, with the same omissions as any canonical digest. The IRI is the one the
member's profile states as its subject, which is not the URL it was fetched from when the member is a mirror or a local copy
([plugin-profiles.md](plugin-profiles.md), "Set an explicit `@base`"). A composite is pinned to a plugin and not to a place, so one
pinned against the published members can be tried against a local copy of them.

A pin does two jobs. At load it says that the author meant these bytes, and a host MUST refuse a member whose profile has another digest,
with no way past it in the host: a pin that could be clicked through would be a warning that people click through. A person who wants a
changed member keeps their own copy of the composite, re-pinned, at an IRI of their own, which is a different plugin and says so.

In a bundle it carries a signature down to the members (plugin-bundles.md section 9). A signature covers the composite's profile, a pin
inside it names a member's profile, and that profile states the digest of every file it names, so the signature reaches every byte.

**An author SHOULD pin every member of a published composite.** The price is that a member's author cannot fix a member under a composite
without the composite's author re-pinning. Without pins a composite can change underneath whoever holds it.

### 9.2 Getting the pins

```sh
node bin/pin.js racks/stomp-rack --members plugins
node bin/pin.js racks/stomp-rack --members plugins --check
```

`--members` names a directory holding one plugin directory per member, named as the end of its IRI, as `plugins/` is. The tool prints, for
each member, whether the pin in the profile is `current`, `stale` or `missing`, and the line to write when it is not. It does not
rewrite the profile, because the pin has to be in the profile as published and a tool editing it on the way to a bundle would be making a
different plugin. With `--check` it exits 1 if any member is not current, which is the check to run before publishing and again whenever a
member is rebuilt.

### 9.3 Exchanging one

- **By IRI.** A composite is served as a profile at its IRI with the requirements of contract section 1, and its members are fetched from
  theirs. A collection lists it as any plugin: `dcterms:hasPart` takes a plugin IRI.
- **As a file.** A bundle of a composite holds the composite and, recursively, every member, in both forms. The rules are
  [plugin-bundles.md](plugin-bundles.md) section 9. A composite with an unpinned member cannot be bundled, and `bin/bundle.js` refuses it
  naming the member.
- **Opening a flattened file.** A host looks for a member's profile in the document it is reading before it goes to the network, so a
  flattened composite opens with no network at all.

## 10. Security

A composite adds no trust boundary. Each member is a plugin the host loaded, verified by its own digests and isolated by the rules it
already has, and a composite is never a single processor holding several modules. What it adds is a way for one author to cause code from
several origins to run, and the host MUST NOT hide that.

- A signature on a composite is a claim about who assembled it. It does not say that any member's code is safe.
- A pin makes the claim precise: these members, as they were.
- A member's origin is whatever its IRI says, which may be none of the composite author's.

## 11. Conformance

A host supports composites if it does everything in sections 4 to 8 and section 6's loading order. It MAY do so without any of section 9's
tools, and a host that supports none of this conforms (contract section 13).

A tool that makes a composite conforms if its output validates against `jig:CompositePluginShape` and passes the checks in sections 4 and 5.
A tool that bundles one MUST refuse an unpinned or mismatched member.

Each rule above has a test. This table names the test, so that a rule changed in this document and not in the code, or the reverse, is a
failure rather than a surprise.

| Rule | Section | Tested by |
|---|---|---|
| The shapes accept a valid composite and refuse each broken one | 2 | `tests/validate/ShapeValidator.test.js`, "counterexample-composite.ttl" |
| The reader refuses what the shapes cannot say | 4, 5 | `tests/rdf/CompositeReader.test.js`, "finds every rule the shapes cannot say" |
| No code is fetched before the whole tree is checked | 6 | `tests/host/CompositeResolver.test.js`, "fetches profiles only" |
| A pin mismatch is refused, naming the member and both digests | 6, 9 | `tests/host/CompositeResolver.test.js`, "refuses a pin that does not match" |
| A composite containing itself is refused, naming the chain | 6 | `tests/host/CompositeResolver.test.js`, "refuses a composite that contains itself through another" |
| Depth has a floor and a named limit | 6 | `tests/host/CompositeResolver.test.js`, "refuses beyond its limit" |
| A port wider than what it drives is refused before any code | 5, 6 | `tests/ops/CompositeDispatcher.test.js`, "refuses a composite that asks a member for a value it cannot take" |
| A composite loads whole or not at all | 6 | `tests/ops/CompositeDispatcher.test.js`, "loads whole or not at all" |
| The author's settings and each port's default apply at load | 5 | `tests/ops/CompositeDispatcher.test.js`, "voicing at load" |
| An exposed port moves exactly the parameters it drives | 5, 8 | `tests/ops/CompositeDispatcher.test.js`, "sets an exposed port on the model and on the member it drives" |
| A composite sounds as its members wired by hand | 7 | `tests/ops/CompositeDispatcher.test.js`, "makes the same sound as the same three plugins wired by hand" |
| Compensation across the boundary is exact | 7.4 | `tests/ops/CompositeExpansion.test.js`, "gives the same arrival, total and delays as the flat graph" |
| Bypass is applied to the composite as one node | 7.3 | `tests/ops/CompositeDispatcher.test.js`, "takes a bypassed rack out of the signal as one node" |
| State is keyed by member IRI, and an unknown key is ignored | 8 | `tests/host/CompositeState.test.js`, "ignores a key that names no member" |
| A session saves a composite as one node and reopens it | 8 | `tests/ops/CompositeDispatcher.test.js`, "saves and reopens as one node" |
| A bundle holds every member | 9.3 | `tests/host/compositeBundle.test.js`, "holds every member" |
| A bundle of an unpinned member is refused | 9.3 | `tests/host/compositeBundle.test.js`, "a member with no pin" |
| A flattened composite opens with no network | 9.3 | `tests/host/compositeBundle.test.js`, "opens through the resolver from the flattened file alone" |
| `bin/pin.js` reports a pin as current only when it is | 9.2 | `tests/bin/pin.test.js`, "calls the placeholder pins stale" |

## 12. Not in this version

- **Scaling and macros.** One knob that sets two parameters over different ranges needs a mapping, and a mapping is a modulation source.
  It fits a Jig with a control output (TODO.md, "Modulation sources") used as a member, so that a composite stays a graph and this
  document grows no formula language.
- **A composite's own interface.** A composite has the generated panel. A `jig:ui` that talks to its members would need
  [messaging.md](messaging.md) to address a member through the host. Every plugin without one gets the generated panel.
- **Packing and unpacking.** Turning a selection of nodes on a track into a composite, and a composite instance back into its members as
  ordinary nodes, are Ops over what is specified here and need no rule of their own.
- **Revealing an unexposed parameter on one instance.** The author's voicing is fixed.
- **A native host.** `native/jigdaw-adapter` runs Jigs as a serial chain and has no graph to expand a composite into. It MUST say that the
  plugin is a composite and that it cannot run one, and the sibling class (section 1) makes that possible. A later step can run a
  linear composite, one input to one output with no branch, because that is a chain already.

## 13. Why it is shaped this way

**Why a plugin, and not a feature of the project.** A group of nodes saved with a session is useful for tidying a track and is the
natural way to author a composite, but it has no IRI, so nothing can refer to it, search for it or sign it, and it travels only inside a
session.

**Why not a collection.** A collection is one publisher's opinion about which plugins go together. It says nothing about how they are
wired or which controls the set offers, and it is deliberately not a thing a host instantiates.

**Why not one processor running several modules.** It would save some graph overhead and need a second contract for what happens inside
a processor: latency between members, state, and the real-time rules applied to code the host never sees as separate. Flattening gives the
same sound with every member still a plugin the host loaded, verified and isolated by rules it already has.

**Why a boundary is the composite itself.** A connection to the composite's own IRI reuses `jig:Endpoint` and `jig:Connection` exactly,
needs no second vocabulary for ports, and makes a pass-through an ordinary connection.

**Why a composite is not a `jig:WebPlugin`.** The class carries a shape that requires a processor, and a profile that merely omitted one
would fail it. A sibling class also means that a host which does not know composites fails by name.

**Why a pin has no override.** A pin says the author meant these bytes. A host that offered to run others anyway would turn it into a
prompt people dismiss. The person who wants a different member has a straightforward route, which is their own composite.

**Why the depth limit has a floor and no ceiling.** Four is a guess at more than anybody will build. It is there so that a host cannot
refuse a composite of composites of composites for want of a rule, and no larger number is proposed because it would be invented.

**Why the checks live where they do.** Shapes catch what SHACL Core can. The rules that need to compare two parts of one document are
in `CompositeReader`, and the rules that need the members' profiles are in the loader, because that is where those profiles are first
in hand. The three are not interchangeable and a composite needs all of them.
