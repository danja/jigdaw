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

## 4. Feedback

A path that returns to its own source has no accumulated latency, because the computation
does not terminate. So section 3 cannot be applied to a cycle, and the question is what
happens instead.

**A cycle MUST contain at least one explicit delay of at least one render quantum.** A host
MUST refuse a graph with a cycle that does not, and MUST report which connections form the
cycle.

This is not a JigDAW invention and cannot be worked around. The Web Audio API permits a
cycle only if a `DelayNode` lies within it; a cycle without one outputs silence. So a graph
that violates this rule does not fail loudly, it simply stops making sound, which is the
worst available outcome. Refusing it and naming the cycle is strictly better.

valis reaches the same rule from the other direction: a feedback path must pass through a
`val:UnitDelay` or the circuit is rejected, and a circuit that will not compile leaves the
previous one playing.

**Latency inside a cycle is not compensated.** The host MUST NOT attempt to compensate any
connection that lies on a cycle, and MUST exclude cycles when computing accumulated latency
for section 3.

The delay in a feedback loop is the thing the user is asking for. It is the delay time, the
comb filter, the resonator. Compensating it away would remove the effect, and there is no
coherent alternative: to align a cycle with itself is to ask for the signal before it
exists.

The consequence, which MUST be documented to the user rather than hidden: a plugin with
declared latency placed inside a feedback loop adds that latency to the loop time. A 1024
frame lookahead limiter in a delay loop makes the delay 1024 frames longer. That is correct
behaviour and it will be reported as a bug.

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
