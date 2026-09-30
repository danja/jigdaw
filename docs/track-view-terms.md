# Terms the track view needs

**Status:** accepted 2026-09-30, every recommendation as written except the changes
below. The terms are in `vocabs/jigdaw.ttl`, the model, the file format, undo and the shapes
carry them, and [project-format.md](project-format.md) is now the normative statement. Behaviour
in the compiler and scheduler is not done: see TODO.md, T3, T5 and T6. The editor graph is
decided separately, in the same document.

Changes made in building it:

- A region reuses `trn:startBeat` and `trn:lengthBeats`, as clips do, rather than minting
  `jig:startBeat` and `jig:lengthBeats`. Reuse before inventing.
- An envelope point's value is `jig:pointValue`, because `jig:value` already belongs to a
  parameter setting.
- `jig:atBeat`, `jig:beatsPerBar` and `jig:beatUnit` lost their single `rdfs:domain`, since a
  tempo point, a signature point, a marker and an envelope point share the first and the
  transport and a signature point share the others. Blank nodes are not allowed in the
  vocabulary, so a union domain was not an option.
- Marker and region colour is editor metadata, as said below, and is not built yet.

The rule applied throughout: a fact about the sound goes in the project graph, and a fact about
how the page draws it goes in the editor graph. A wrong answer here is expensive because an
audio fact in the editor graph is lost when a session is opened without it, and a drawing fact
in the project graph bumps the revision every time someone resizes a lane.

## Master

**Decision needed:** where the master level lives.

Recommended: one `jig:Master` individual, `<#master>`, linked from the project by
`jig:master`, carrying `jig:gain`, `jig:pan` and `jig:muted` with the meaning they have on a
track. Absent means unity, centred, unmuted, so every existing session opens unchanged. Exactly
one, so the shape says `sh:maxCount 1`. Every track's output reaches the master gain before the
destination. Automation of it uses the envelope term below with the master as target.

## Sends and returns

**Decision needed:** whether a send is a `jig:Connection` or a new thing.

Recommended: a new `jig:Send`. A connection joins ports on nodes; a send joins a track to
another track and has a level and a tap point, neither of which a connection has. Terms:
`jig:sendFrom` and `jig:sendTo` (both `jig:Track`), `jig:level` (decimal, as gain), and
`jig:tap` with two individuals, `jig:PreFader` and `jig:PostFader`. A return is an ordinary
track that is the target of at least one send; nothing marks it. Cycles are refused the way
connection cycles are, over the track graph. Latency through a send is accounted by the
compiler as through any other path.

## Markers and regions

**Decision needed:** project graph or editor graph.

Recommended: project graph. A marker is a musical fact a collaborator and an agent both need,
and a loop region feeds the transport. `jig:Marker` with `jig:atBeat` and `rdfs:label`;
`jig:Region` with `jig:startBeat`, `jig:lengthBeats` and `rdfs:label`. Colour of either is
editor metadata, as for tracks.

## Time signature changes

**Decision needed:** where signature changes sit relative to tempo points.

Recommended: alongside them, as `jig:SignaturePoint` with `jig:atBeat`, `jig:beatsPerBar` and
`jig:beatUnit`, listed from the transport. The transport's own `jig:beatsPerBar` stays as the
value before the first point, so existing sessions are unchanged. A change takes effect at the
start of a bar: a point that does not fall on a bar line is refused, because a half bar of
one signature and a half of another has no reading a musician would accept.

## Automation

**Decision needed:** what an envelope is and what it may target.

Recommended: `jig:Envelope` with a target and a list of points. The target is a node and a
parameter symbol (`jig:targetNode`, `jig:targetSymbol`), or one of the three project-level
targets, `jig:MasterGain`, `jig:MasterPan` and `jig:Tempo`, named by `jig:targetKind`. A point
is `jig:EnvelopePoint` with `jig:atBeat`, `jig:value` in the parameter's own units and
`jig:curve`, one of `jig:Step`, `jig:Linear` or `jig:Smooth`. An envelope belongs to the track
of its node. The scheduler renders it by stream position, never by block index, and a value
outside the parameter's declared range is refused when the point is written, not clamped when
it is heard.

## Folders and buses

**Decision needed:** which of the two changes the audio.

Recommended: a folder is editor metadata only, `jig:parent` on a track in the editor graph, and
never changes the sound. A bus is audio: a track whose audio input is fed by other tracks'
outputs, stated by `jig:output` on the feeding track (a track, defaulting to the master).
Folding a bus's children under it in the view is then a drawing choice that happens to line up.
`jig:output` cycles are refused like sends.

## What each accepted term costs

Each accepted term needs, in the same commit: its entry in `vocabs/jigdaw.ttl`, a constant in
`src/rdf/Vocabulary.js`, a shape in `vocabs/shapes.ttl`, a violation of it in
`examples/counterexample-project.ttl` that the test proves fires, a writer and reader case in
`tests/rdf/ProjectRoundTrip.test.js`, an Op with its undo, and a WebMCP tool.
