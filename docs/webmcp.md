# The agent surface

**Version:** 0.1.0-draft
**Status:** design. The tool surface below is specified; the browser API it binds to is not
settled, and this document says so where it matters.

JigDAW exposes its operations to an agent running in the browser, through
[WebMCP](https://github.com/webmachinelearning/webmcp). The tools are the same operations
the editor uses, through the same dispatcher, per contract section 9.3. There is no second
implementation and there are no agent-only operations.

## What is settled and what is not

The **tool surface** is a design decision this project makes, and it is specified here.

The **binding** is not. WebMCP is an emerging proposal for how a page declares tools to a
user agent, and the shape of that API is still moving. This document therefore specifies
tool names, arguments and semantics, and deliberately does not specify how they are
registered. When the API settles, one adapter module binds these tools to it, and nothing
else in the project changes. Treat any code that reaches past that adapter as a defect.

Everything below is also reachable without WebMCP, because the tools are the dispatcher's
operations. transmission's MCP server exposes the same kind of surface for the native host,
and Jiggy has a local bridge that exposes this one over ordinary MCP.

## The local bridge

**An MCP client on the same machine can drive an open Jiggy page through `npm run
mcp-bridge`.** The session lives in the browser tab, with its audio, and a tab cannot accept a
connection, so the bridge (`bin/mcp-bridge.js`, `src/mcp/BridgeServer.js`) holds a Streamable
HTTP endpoint at `http://127.0.0.1:8749/mcp` and the page connects out to it
(`src/mcp/BridgeClient.js`). Each tool call goes down to the tab over a server-sent event
stream, runs through the same surface WebMCP and the console use, and its result comes back by
POST. The bridge lists its tools from `src/mcp/tools.js` and implements none of them.

```sh
npm run mcp-bridge                     # prints a token
claude mcp add --transport http jiggy http://127.0.0.1:8749/mcp
```

Paste the token into the page's Agent bridge section and press Connect. The page writes each
call an agent makes to its log.

It is local by construction, and each of these is checked by `tests/mcp/BridgeServer.test.js`:

- It listens on loopback only, and refuses a request whose `Host` is not loopback, which is what
  stops a web page reaching it by DNS rebinding.
- It refuses a browser request from any page not itself on loopback, on both endpoints.
- A tab must present the token the bridge printed when it started. Other pages on the machine
  can reach loopback; they cannot know the token. A person pastes it, which is the pairing.
- One tab at a time: a tab presenting the token replaces the one before, as a reload does.
- A call waits `bridgeCallTimeoutMs` from `web/host.json` for the page, then fails and says so.
  With no page connected, a call fails at once, saying how to connect one.

It is a development tool and is never deployed: it needs the MCP SDK, a dev dependency, and the
deployment runs no `npm install`. `bridgePort` in `web/host.json` is read by both ends, so they
cannot disagree about where the bridge is.

## Search is demand-driven

The catalogue holds hundreds of plugins and an agent cannot read them all. So discovery is
two steps, following transmission's design:

1. `plugins_search` returns candidates matched on role and signal semantics, with just
   enough to choose between them.
2. `plugin_describe` returns everything about one plugin, and is called only for the few
   that matter.

The reason is that an agent picking a reverb does not need the parameter list of every
delay. Returning it anyway spends the context that the agent needs for the actual task.

`plugin_validate_chain` answers the question that search does not: given an ordered list of
plugins, do adjacent ones agree? That is a type check of `trn:produces` against
`trn:accepts`, and it reports the curated pairings from `trn:recommendedBefore` and
`trn:recommendedAfter` along with any `trn:caution`.

## Resources

| URI | Content |
|---|---|
| `jigdaw://project` | The current project as JSON |
| `jigdaw://project/turtle` | The same project as Turtle |
| `jigdaw://plugins` | The catalogue, merged curated and discovered |
| `jigdaw://plugins/profiles` | Curated profiles, as Turtle |
| `jigdaw://plugins/inspections` | Discovered evidence, as Turtle, including load failures |
| `jigdaw://diagnostics` | Engine state, transport, buffer health, recent errors |

A resource is a read. A read never changes anything and never needs a revision.

## Tools

### Discovery

| Tool | Arguments | Returns |
|---|---|---|
| `plugins_search` | `role?`, `accepts?`, `produces?`, `requires?`, `text?`, `limit?` | Candidate IRIs with name, role, signals |
| `plugin_describe` | `iri` | The full profile, plus any inspection |
| `plugin_validate_chain` | `iris[]` | Per-adjacency verdict, pairings, cautions |
| `collection_open` | `iri` | Every listed plugin, checked, with per-member notes and any load failure |
| `plugin_load` | `iri`, `track?` | Fetches, validates and instantiates. Returns the node id and its track id, or a located failure |

`plugin_load` is the one tool that reaches the network. It performs contract section 3 in
order and reports which step failed, so an agent gets "no CORS header on the processor"
rather than "could not load". Without `track` the plugin gets a new track of its own, named
after it, and a plugin that accepts MIDI becomes that new track's MIDI input.

`collection_open` is [plugin-collections.md](plugin-collections.md) section 3, the same read
the page's own "Open a collection" form performs: it reaches the network to fetch the
collection document and check each member's profile and capabilities, but fetches no module,
processor or asset, and changes nothing. It is a catalogue read beside `plugins_search`, not
an Op, for the same reason: an agent choosing between plugins should not need to load one
first to find out whether it will run here. Load a chosen member afterwards with
`plugin_load`.

### The graph

| Tool | Arguments | Returns |
|---|---|---|
| `graph_apply_changes` | `changes[]`, `expectedRevision`, `dryRun?` | New revision, or a conflict |
| `node_add` | `pluginIri`, `position?` | Node id |
| `node_remove` | `nodeId` | |
| `connection_add` | `from`, `to`, `fromPort`, `toPort`, `kind` | |
| `connection_remove` | `from`, `to`, `fromPort`, `toPort` | |

`graph_apply_changes` is the primitive and the rest are conveniences over it. Every
changeset is atomic: all of it applies or none does.

**Optimistic concurrency.** A changeset carries `expectedRevision`, the revision the caller
last observed, and is rejected if the project has moved on. This is transmission's design
and it exists because an agent and a person editing the same project is the normal case
here, not an exotic one. A rejected changeset returns the current revision and what changed,
so the caller can retry against it.

`dryRun` validates a changeset and reports what it would do without committing. An agent
building a signal chain should use it before applying, because a graph that fails validation
halfway is worse than one that was never touched.

### Tracks

| Tool | Arguments | Returns |
|---|---|---|
| `track_add` | `label?` | Track id |
| `track_remove` | `trackId`, `moveNodesTo?` | |
| `track_set` | `trackId`, `label?`, `midiInput?`, `audioInput?` | |
| `track_set_channel` | `trackId`, `gain?`, `pan?`, `muted?`, `soloed?` | The whole strip, as applied |
| `node_move_to_track` | `nodeId`, `trackId` | |

### Clips

| Tool | Arguments | Returns |
|---|---|---|
| `clip_add` | `trackId`, `startBeat`, `lengthBeats`, `notes?` | Clip id |
| `clip_add_audio` | `trackId`, `source`, `startBeat`, `lengthBeats`, `offsetSeconds?` | Clip id |
| `clip_set_notes` | `clipId`, `notes[]` | |
| `clip_move` | `clipId`, `startBeat?`, `lengthBeats?`, `trackId?` | |
| `clip_remove` | `clipId` | |

A note is `{ startBeat, lengthBeats, pitch, velocity }`, its start counted from the clip's.
`clip_set_notes` replaces every note at once, so a phrase is one edit and one undo. A MIDI clip
plays into its track's MIDI input and into nothing on a track with none. An audio clip names its
file by absolute IRI and plays into the track's audio input, or straight to its fader.

A track is a mixer strip and a line of the arrangement, per
[project-format.md](project-format.md) "Tracks". Every plugin is on exactly one, and whatever
a track's chain produces reaches its fader before the master. `track_remove` is refused while
plugins are on the track unless `moveNodesTo` says where they go, so removing a track never
removes plugins as a side effect. `track_set` names the node a track's MIDI clips or audio
clips play into, and refuses one that is not on that track.

### Parameters and transport

| Tool | Arguments | Returns |
|---|---|---|
| `parameter_set` | `nodeId`, `symbol`, `value`, `atFrame?` | |
| `parameters_set_batch` | `settings[]` | |
| `transport_play` | | |
| `transport_stop` | | |
| `transport_configure` | `tempo?`, `timeSignature?`, `loop?`, `position?` | |

Parameters are addressed by `lv2:symbol`, never by index. An index is a property of a
build; a symbol is a property of the plugin, and contract section 5.1 requires it to be
stable across versions.

`parameters_set_batch` exists because setting twenty parameters as twenty calls is twenty
round trips and twenty revisions.

### Project and diagnostics

| Tool | Arguments | Returns |
|---|---|---|
| `project_get` | | The project and its revision |
| `project_new` | | |
| `project_open` | `source` | |
| `project_save` | | |
| `status` | | Revision, track, node and clip counts, transport, whether anything is failing |
| `diagnostics` | | Engine detail, including the last error per node |

`status` is deliberately small and cheap. An agent should call it before making changes,
which is transmission's instruction to its own clients and the reason its server states it
in the server description rather than hoping.

## Errors are located

A tool failure names what failed, where, and what would fix it. A validation failure carries
the focus node and the constraint. A load failure carries the step from contract section 3.
A conflict carries both revisions.

An agent cannot inspect a stack trace or read a log. The error message is the entire
interface to the failure, so a message that says only that something went wrong has failed
twice.

## What agents must not be able to do

The tool surface is not a general capability. An agent using it MUST NOT be able to:

- reach a plugin's user interface frame, or any origin, directly;
- bypass profile validation or integrity verification when loading a plugin;
- read or write host storage or credentials;
- construct an audio node other than through `plugin_load`.

Those are not omissions to be filled in later. A tool that offered any of them would
undo the isolation that contract sections 3.2, 9.1 and 11 exist to create, and an agent
acting on a profile fetched from an arbitrary origin is exactly the situation they were
written for.

## Open

- Whether a changeset can span a plugin load. Loading reaches the network and can fail
  slowly, which does not sit well inside an atomic operation. Probably load first, then
  apply, with the node id as the join.
- Whether `jigdaw://plugins` should federate to the catalogue live or serve only what the
  local store holds. See `docs/architecture.md`.
