# Project format

**Version:** 0.1.0-draft
**Status:** normative for the graph model. The serialisation is Turtle or JSON-LD.

A JigDAW project says which plugins are loaded, how they are wired, what their parameters
are set to, and what the transport is doing. It is RDF, it validates against
`vocabs/shapes.ttl`, and the worked example is `examples/session-project.ttl`.

## The inherited conflict, and how it is resolved

transmission's projects are the precedent for this format, and they use `rdf:List` for
ordered pipes and for connections:

```turtle
:main a :Transmission ;
    :pipe ( :system-input :system-output :plugin-1 :plugin-2 ) ;
    :connections ( [ :from :plugin-1 ; :to :plugin-2 ; :kind "midi" ] ) .
```

valis went the other way and forbids it: topology is modelled with explicit arcs, "so the
graph is a faithful picture of the dataflow". `AGENTS.md` here inherits valis's rule. So the
precedent and the rule disagree, and the disagreement had to be settled rather than
inherited.

**It is settled in valis's favour, and more strongly.** There is no `rdf:List` anywhere in a
JigDAW project.

The reasoning is that a project contains two things that look ordered, and neither one is.

**Processing order is derived, not declared.** Web Audio determines processing order from
the connections. A declared order would be a second answer to a question the graph already
answers, and when the two disagree there is no rule for which wins. transmission needs its
pipe list because it schedules its own graph; JigDAW does not, because the platform does.

**Everything else that looks ordered is keyed.** A tempo change happens at a beat. A scale
point has a value. Keying it explicitly is better than a list on three counts: inserting in
the middle touches one node instead of rewriting a chain, a diff of one edit is one edit,
and selecting it is one triple pattern instead of a recursive walk. `rdf:List` in SPARQL is
genuinely unpleasant, and that is not a small consideration for a format whose whole point
is being queried.

## Shape

```turtle
<> a jig:Project ;
    jig:revision 7 ;
    jig:node <#pad> , <#verb> ;
    jig:connection <#c1> ;
    jig:transport <#transport> .
```

**Nodes are instances, not plugins.** A node names the plugin it instantiates with
`jig:plugin`, as a dereferenceable `https:` IRI. Two instances of one plugin are two nodes
with the same `jig:plugin` and different settings.

That IRI is what makes a project portable. A project opened on a machine that has never seen
these plugins carries everything needed to fetch them, which is the whole premise of the
system applied to its own file format.

**Connections are explicit and directed**, with named endpoints:

```turtle
<#c1> a jig:Connection ;
    jig:from <#c1-from> ; jig:to <#c1-to> ;
    jig:signalKind trn:Audio .

<#c1-from> a jig:Endpoint ; jig:endpointNode <#pad>  ; jig:portIndex 0 .
<#c1-to>   a jig:Endpoint ; jig:endpointNode <#verb> ; jig:portIndex 0 .
```

`jig:signalKind` is required. An audio edge and a host-routed MIDI edge look identical in
the graph and are handled by entirely different machinery, one by Web Audio and one by the
host's message routing, so the kind cannot be inferred from the endpoints.

**An endpoint names its port exactly one way.** `jig:portIndex` for an audio or MIDI port,
which Web Audio numbers, or `jig:portSymbol` for a parameter, which `lv2:symbol` names.
Never both and never neither. Modulating a parameter is an edge to a named thing; carrying
audio is an edge to a numbered one. An endpoint carrying both is ambiguous in a way nothing
downstream can resolve, and `vocabs/shapes.ttl` rejects it with `sh:xone`.

## Parameters are settings, state is state

```turtle
<#verb> a jig:Node ;
    jig:plugin <https://example.org/plugins/cascade/> ;
    jig:setting <#verb-mix> ;
    jig:nodeState "eyJtb2RlIjoicGxhdGUi…" .

<#verb-mix> a jig:ParameterSetting ; jig:symbol "mix" ; jig:value 0.34 .
```

`jig:nodeState` is opaque to the host: whatever the plugin returned when asked. Parameter
values are not part of it, per contract section 8.2. Storing them in both places means the
two disagree on restore and nothing defines which wins.

Settings are addressed by `lv2:symbol`. An index is a property of a build and changes when
the plugin is rebuilt; a symbol is a property of the plugin and contract section 5.1
requires it to be stable.

## Revision

`jig:revision` increments on every committed change. A changeset names the revision its
author last observed and is rejected if the project has moved on, per
[webmcp.md](webmcp.md).

This is transmission's design and it is here for the same reason plus one more: an agent and
a person editing the same project is the normal case in a system with a built-in agent
surface, not an exotic one.

## Two graphs

Editor metadata, `jig:x` and `jig:y`, lives in a different named graph from the project
itself.

Dragging a node on screen must not invalidate a compiled audio graph. If position and
topology are in one graph, every layout change looks like a project change: it bumps the
revision, invalidates caches, and conflicts with a concurrent edit that has nothing to do
with it. Separating them is valis's rule and the cost of ignoring it is paid continuously.

## Serialisation rules

- No blank nodes. Every node, connection, endpoint, setting and tempo point is skolemised as
  a fragment of the project IRI. The rationale is in [plugin-profiles.md](plugin-profiles.md)
  and is the same: diffable, re-ingestable, queryable.
- Set an explicit `@base`.
- Serialisation is deterministic. The same project produces byte-identical output, so a diff
  shows what changed rather than how it was written.

## Open

- Clips, regions and an arrangement. The format above describes a patch, not a timeline.
  Adding one is where a genuinely ordered structure might finally be needed, and the keying
  argument above should be tested against it rather than assumed to survive.
- Whether a project embeds the profiles of the plugins it uses, as a cache, or always
  refetches. Embedding makes a project self-contained offline and makes it possible for the
  cached copy to be stale.
