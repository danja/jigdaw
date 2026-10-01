# A livecoding language

**Status:** design. Nothing described here is built. It records the decisions to make before code, with a
recommendation for each.

A person types a few lines, and Jiggy changes a plugin parameter, ramps a filter over two bars, adds a plugin to a
track or plays a pattern. This note decides what the language is, where it runs, and how it reaches the model.

## The language is a thin layer over the Ops

**Every statement is an Op or a schedule of Ops, and the language has no other way to change the project.** The
agent surface already lists the operations (`src/mcp/tools.js`: `parameter_set`, `plugin_load`, `connection_add`,
`envelope_add`, `transport_configure` and the rest), and [webmcp.md](webmcp.md) says there are no agent-only
operations. A script is a third adapter over the one dispatcher, after the editor and the agent surface, and it
gets undo, revision conflicts and validation from there. Anything the language could do that an Op cannot is a
missing Op, and the fix is the Op.

## A small language of our own, not embedded JavaScript

**Recommendation: a small line-oriented language interpreted in this repository, with no `eval` and no host
objects.** The alternatives were weighed against three constraints from [CLAUDE.md](../CLAUDE.md): plugin and script
code is untrusted, there are no inline fallbacks, and everything runs in the browser.

| Option | Why not, or why |
|---|---|
| JavaScript run with `eval` or `new Function` | Ambient authority: network, storage and the DOM are all reachable. Hardening it is a project in itself, and a hole is a hole in the host page. |
| JavaScript in a sandboxed worker or frame | Contained, but a worker can still fetch unless a CSP says otherwise, and every call crosses a message boundary. Workable, and the likely second step if people want full JavaScript. |
| An embedded interpreter (QuickJS or similar, in WebAssembly) | A real language and a real sandbox, at the cost of a dependency, a binary to serve and integrity-check, and a second language runtime in the page. |
| **A small language of our own** | A few hundred lines of interpreter, and no capability that is not in the table below. The cost is that people learn it. |

The decision is reversible because the language is defined by its Op table. A later host can accept JavaScript that
calls the same table without changing what a script means.

## What it looks like

A sketch to fix the shape, not a grammar. Names resolve against the project: a track or plugin by its label, a
parameter by its `lv2:symbol`, a plugin to load by its IRI.

```
load reverb = https://example.org/plugins/cascade     # plugin_load, on the current track
reverb.mix = 0.35                                     # parameter_set, now
at 4.1 reverb.mix = 0.6                               # at bar 4, beat 1
ramp filter.cutoff 200Hz -> 8000Hz over 2 bars        # envelope_add
every 1 bar: bass.cutoff = pick(400Hz, 800Hz, 1600Hz)
connect lead -> reverb                                # connection_add
```

Values carry units where the profile declares them, so `8000Hz` is checked against the port's `units:` and range,
and `0.35` against a port with none. A control that does not exist is an error naming the nearest symbols. It is
never ignored.

## Time is stream position

**A scheduled statement is located by transport position in beats, converted to stream frames, and never by a
timer or a block index.** This is the real-time rule in [CLAUDE.md](../CLAUDE.md) applied to a new caller, and
`setTimeout` is the failure it describes. Two kinds of statement result:

- **A statement the engine can time itself** becomes data the engine already plays at a stream position: an
  automation envelope (`ramp`, and `at` on a parameter) or a note event the scheduler sends ahead of time. These
  are sample accurate, because the processor fires them in the block that contains them.
- **A statement that only the message thread can perform**, such as loading a plugin or adding a connection, runs
  from a lookahead tick, the way `src/engine/Scheduler.js` sends notes. It is accurate to the tick, not to the
  sample, and the language says so: such a statement is quantised to the next bar by default, and `at` on one is
  an error unless it is given a quantum.

A statement scheduled in the past when it is reached fires once in the tick that finds it. It is not dropped and
it is not replayed.

## Where it runs

**On the message thread, never in `process()`.** The interpreter is plain JavaScript on the page. It allocates
freely, which is why it must not be near the processor. It reaches the engine only through the dispatcher.

Evaluation is in two steps. The first is pure: it parses the script, resolves every name and unit, checks every
value, and produces a plan, a list of Ops and timed schedules, without touching the project. The second dispatches
the plan. A script that fails in the first step changes nothing, which is the rule that a failed load leaves the
previous graph playing.

## Live changes

**Evaluating a new version replaces the previous script's schedule at the next boundary, atomically.** A person
edits a line and re-evaluates; the old `every` loops stop and the new ones start at the next bar line, so the music
does not stutter or double. State a script keeps (a counter, a random generator's position) is carried across
only if the person names it, because silently carrying it makes an edit behave differently from a fresh start.

One evaluation is one undo group, so a single undo reverses what one run did. `src/ops/UndoHistory.js` records
snapshot to snapshot, and whether it can group a run of Ops that dispatch over time is the first thing to check
before building.

## The sandbox

The interpreter has a capability table and nothing else. Each entry names an Op, its argument schema and whether it
is timeable. There is no network, no storage, no clock other than the transport, no `import` and no access to a
plugin's own code. Resource limits are part of the language and not an afterthought:

- a step budget per evaluation, and a tighter one per tick for `every` bodies, so a loop that never ends fails
  with an error instead of freezing the page;
- a depth limit on nesting and a cap on the size of the plan;
- randomness from a seeded generator the script can set, so a performance can be repeated.

A script is untrusted input in the same way a plugin is. A script arriving from a link or a session file never runs
on load. A person presses run, or the host asks.

## Surfaces

- **The editor.** A text panel in Jiggy with run, stop and a log, built to the interface rules: labelled, reachable
  by keyboard, usable at phone width, errors announced to a screen reader and not shown by colour alone.
- **The agent surface.** One tool, `script_run`, taking source and returning the plan as data, so an agent can
  write a script and see what it will do before it does it. It is not a way round the other tools. It dispatches
  exactly their Ops.
- **A session.** A script is saved in the session graph as its own node with `prov:` metadata, in its own named
  graph, and is not executed when the session opens. The vocabulary change goes in `vocabs/` first, and
  `vocabs/shapes.ttl` changes in the same commit, per CLAUDE.md.

## Tests

- Parsing and evaluation are deterministic and run offline in Vitest: valid scripts, invalid ones, and each limit
  tripping.
- A plan is checked against the Ops it names. A guard binds the capability table to `src/mcp/tools.js`, so a new
  tool is either exposed to scripts or excluded on purpose, and a test fails when a tool is in neither list.
- Timing is checked with an `OfflineAudioContext` render: a ramp scheduled at beat 4 starts in the block containing
  that frame, at a tempo where beat 4 is not a block multiple.
- A deliberately hostile script (an endless loop, a huge plan, a reference to a missing name) fails with an error and
  leaves the project, and the audio, as they were.

## Open decisions

1. **Whether patterns are in the first version.** `pick` and `every` give generative behaviour. A pattern notation
   in the style of TidalCycles or Strudel is a larger design and is better added once the Op table works.
2. **The name of the language and its file extension**, and the media type if it becomes a bundle member.
3. **Whether a script may call `plugin_load`.** Loading fetches over the network, which the sandbox otherwise
   denies. The proposal is that it may name only an IRI already in the session or the catalogue, so a script cannot
   make the host fetch an arbitrary address.
4. **Grouping in `UndoHistory`**, as above.
