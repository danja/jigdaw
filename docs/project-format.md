# Project format

**Version:** 0.1.0-draft
**Status:** normative for the graph model. The serialisation is Turtle or JSON-LD.

A JigDAW project says which tracks there are, which plugins are loaded on them, how they are
wired, what their parameters are set to, what the tracks play against the transport, and what
the transport is doing. It is RDF, it validates against
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
    jig:track <#track-1> , <#track-2> ;
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

## Tracks

**Every node is on exactly one track, and the track is where its sound goes.** A track is a
mixer strip and a line of the arrangement:

```turtle
<#track-1> a jig:Track ;
    rdfs:label "Pad" ;
    jig:gain 0.8 ; jig:pan -0.25 ;
    jig:midiInput <#pad> ;
    jig:clip <#clip-1> .

<#pad> a jig:Node ; jig:onTrack <#track-1> ; jig:plugin <…> .
```

A node's audio that feeds no other node's audio input arrives at its track's fader, then its
pan, then the master. So a chain on a track needs no connection to the fader: the end of the
chain is found from the connections, the same way processing order is. A connection between
nodes on different tracks is allowed and is how a send or a sidechain is expressed.

`jig:gain`, `jig:pan`, `jig:muted` and `jig:soloed` are the track's channel strip. They are
host services, not plugin parameters: no `lv2:port` declares them, and solo is a property of
the whole mix. If any track is soloed, every track that is not is silent, and a muted track is
silent whether or not it is soloed. Absent means unity, centre, heard.

Membership is stated on the node with `jig:onTrack`, not listed on the track, so that moving a
node between tracks is one triple and nothing about it is an ordering.

**Where clips enter a track is named, not inferred.** `jig:midiInput` names the node a track's
MIDI clips play into, and `jig:audioInput` the node its audio clips play into. Both are
optional and both MUST name a node on that track. A track with no `jig:midiInput` plays its
MIDI clips into nothing, and a host SHOULD say so where it draws them; the clips are kept,
because removing the instrument they were written for must not delete the music. A track with
no `jig:audioInput` plays its audio clips straight into its fader,
which is the ordinary case for a track of recorded audio. Inferring either from the chain
would mean guessing which of two instruments, or which side of a MIDI effect, the notes were
meant for, and a wrong guess is silent.

## Clips

**The arrangement is keyed by beat, like the tempo map, and needs no list.** This is the test
the keying argument above was owed, and it survives: a clip is at a beat on a track, and a note
is at a beat within its clip and at a pitch. Inserting one note touches that note's triples
and nothing else.

```turtle
<#clip-1> a jig:MidiClip ;
    trn:startBeat 0.0 ; trn:lengthBeats 8.0 ;
    jig:note <#clip-1-n1> .

<#clip-1-n1> a jig:Note ;
    trn:startBeat 0.0 ; trn:lengthBeats 2.0 ; trn:pitch 57 ; trn:velocity 96 .

<#clip-2> a jig:AudioClip ;
    trn:startBeat 16.0 ; trn:lengthBeats 8.0 ;
    jig:source <media/loop.wav> ; jig:offsetSeconds 0.5 .
```

Placement reuses transmission's `trn:startBeat` and `trn:lengthBeats`, and a note reuses
`trn:pitch` and `trn:velocity`. transmission declares all four for this purpose; it lists its
clips and notes as `rdf:List`, and here each is a named resource on its own arc instead.

- A clip's `trn:startBeat` is in beats of the transport, at or after zero. Its
  `trn:lengthBeats` is greater than zero.
- A note's `trn:startBeat` is relative to the start of its clip, as transmission defines it, so
  moving a clip moves its notes without rewriting them. A note that runs past the end of its
  clip is cut off at the end of the clip.
- A note's pitch is a MIDI note number from 0 to 127 and its velocity is 1 to 127, because MIDI
  reads a note on of velocity 0 as a note off.
- A clip belongs to its track. Removing the track removes its clips, unless the removal moves
  the track's nodes to another track, in which case the clips move with them.
- An audio clip refers to its audio by `jig:source` and never embeds it. A session is a
  description, and one file placed ten times is still one file. A relative `jig:source`
  resolves against the session document, so a session saved beside a `media/` folder is
  portable as a folder. `jig:offsetSeconds` is where in the file the clip begins, in seconds
  rather than beats, because a recording does not change length when the tempo does.

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

- No blank nodes. Every track, node, connection, endpoint, setting, clip, note and tempo point
  is skolemised as a fragment of the project IRI. The rationale is in [plugin-profiles.md](plugin-profiles.md)
  and is the same: diffable, re-ingestable, queryable.
- Set an explicit `@base`.
- Serialisation is deterministic. The same project produces byte-identical output, so a diff
  shows what changed rather than how it was written.

## Opening a session saved before tracks

A session written before tracks existed has no `jig:Track`, and states `jig:gain`, `jig:pan`,
`jig:muted` and `jig:soloed` on its nodes. A reader MUST fold such a session into tracks rather
than refuse it, as follows, and a writer MUST NOT write that older form:

1. Nodes joined by any connection, of any signal kind, in either direction, are one group. A
   node joined to nothing is a group of its own.
2. Each group becomes one track, labelled with the label of the first node in the group that
   is the source of no connection, which is the end of its chain, or failing that the group's
   first node, both in the order the nodes are listed after sorting by IRI.
3. That same node's channel strip, if it had one, becomes the track's. The other nodes'
   strips are dropped, because a track has one fader. In the sessions this rule was written
   for the only strip ever moved was the last in the chain.
4. No `jig:midiInput` or `jig:audioInput` is set, since a folded session has no clips.

## Open

- Whether a project embeds the profiles of the plugins it uses, as a cache, or always
  refetches. Embedding makes a project self-contained offline and makes it possible for the
  cached copy to be stale.
