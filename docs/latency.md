# Latency and feedback

**Version:** 0.1.0-draft
**Status:** normative. Read with [host-plugin-contract.md](host-plugin-contract.md), whose
sections 4 and 7 this extends.

Requirement keywords (MUST, MUST NOT, SHOULD, MAY) are used in the
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) sense.

Two plugins fed from one source and mixed back together must arrive aligned. If one of them
delays its output by 512 frames and the other does not, the mix is wrong by 512 frames and
nothing reports it: it sounds like a phase problem, or like nothing at all until something
cancels.

## 1. Declaring latency

A plugin declares `jig:latencyFrames`: the number of frames by which its output lags its
input. A plugin that does not declare it is assumed to have none.

A plugin MUST declare latency that matches the delay it actually introduces. A declared
value that is wrong is worse than no declaration, because the host compensates for it and
the error is applied rather than merely present.

Latency is a property of the signal path, not of the algorithm's cost. A plugin that takes a
long time to compute a block has no latency. A plugin that buffers 1024 frames before
emitting anything has 1024 frames of latency however fast it runs.

## 2. Reporting a change

Latency is not always constant. A plugin with a lookahead limiter, a linear-phase filter or
a variable-size FFT changes its latency when those settings change.

A processor MUST report its current latency in its `ready` message, and MUST send a
`latency` message whenever it changes.

| `type` | Payload | Direction |
|---|---|---|
| `latency` | `{ latencyFrames, fromFrame }` | processor to host |

`fromFrame` is the absolute stream position from which the new value applies. The host
cannot act on a latency change instantaneously, so the plugin says when it takes effect and
the host schedules its compensation against that frame rather than against the moment the
message happened to arrive.

A plugin SHOULD NOT change its latency during playback if it can avoid it. Recompensating a
running graph means changing delay lines while audio flows through them, and no way of doing
that is free of artefacts. A plugin that can pad to its worst case SHOULD do so and declare
that instead.

## 3. How the host compensates

For each node, the host computes the greatest accumulated latency along any path from a
source to that node. Where a node has several inputs whose accumulated latencies differ, the
host inserts delay on the shorter ones so that all inputs arrive aligned with the longest.

The host MUST apply this to every node with more than one input path, and MUST report the
resulting total latency of the graph so that a recording can be aligned against it.

Compensation is delay added to the fast paths. It cannot remove delay from the slow one.
A graph containing a plugin with 4096 frames of latency has at least 4096 frames of latency,
and a host that claims otherwise is wrong.

## Between tracks

Compensation in section 3 aligns the paths inside one graph, joined by connections. Tracks are
not joined by connections: each track's output goes to its own fader and then to the master. So
a track holding a plugin that declares 2047 frames of latency arrives at the master 2047 frames
later than a track with none, unless the host does something about it.

A host SHOULD delay each track that has less latency than the slowest by the difference, at the
track's output, so parallel tracks arrive together, and SHOULD let the person turn this off. A
track's latency is the longest latency along its chain, counting what section 3 found ahead of
each plugin. The delay is applied at the end of the track, after its fader, so what a take
recorder hears from a track is the track as it was made. The host MUST say how much each track
was delayed, and what the setting is.

Jiggy does this by default. `alignTracks` in `web/host.json` is the starting value, the
checkbox on the Mixer tab changes it and is remembered in the person's browser, and each
track's header says its own latency and how much it was delayed to line up. The largest
delay it can give is `maxTrackDelayMs` in the same file; a difference beyond that is reported
in the console and that track is left as it was. `OpDispatcher.trackLatencies()` reports both
figures.

### MIDI loops

The delay rule above is about audio. A MIDI connection carries no delay and no frame count, so
there is nothing to declare that would make a loop of them safe: events would pass round it for
ever, and a plugin that answers each note with another would make a storm. A host MUST refuse
a set of MIDI connections that forms a loop, including a plugin connected to itself, and
SHOULD say which plugins are in it. Jiggy refuses it with the error kind `midi-cycle`.

## 5. Tails

`jig:tailFrames` is how long a plugin keeps producing output after its input falls silent.

It is not latency and MUST NOT be compensated. It matters in exactly one place: an offline
render MUST continue for at least the greatest tail in the graph after the last input event,
or every reverb is cut off at the end of the bounce.

A plugin whose tail is unbounded, such as a freeze or an infinite reverb, MUST declare no
`jig:tailFrames` rather than declaring a very large one. The host then ends an offline
render at the point the user asked for, rather than at a number the plugin invented.

## 6. What a host must not do

- Report a graph's latency as zero because it compensated internally. Compensation aligns
  paths; it does not abolish delay.
- Silently drop a cycle. Section 4.
- Compensate a connection on a cycle. Section 4.
- Treat a `latency` message as applying from the moment it arrived rather than from its
  `fromFrame`.
