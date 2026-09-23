# Message protocol

**Version:** 0.1.0-draft
**Status:** normative. Read with [host-plugin-contract.md](host-plugin-contract.md), which
states the rules this document gives the wire format for.

Requirement keywords (MUST, MUST NOT, SHOULD, MAY) are used in the
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) sense.

Three parties exchange messages, over two channels that never meet.

```
   sandboxed UI  <--- iframe postMessage --->  HOST  <--- MessagePort --->  processor
       (frame)                             (main thread)              (audio thread)
```

The host is always in the middle. A user interface MUST NOT be given the
`AudioWorkletNode`, its port, or any part of the project model, for the reasons in contract
section 9. Everything a UI wants from a processor passes through the host, which is what
makes the sandbox meaningful rather than decorative.

Every message is a plain object with a `type` field. Unknown message types MUST be ignored
rather than treated as errors, so that a newer host and an older plugin interoperate as far
as they are able.

---

## 1. Host and processor

The channel is the `AudioWorkletNode`'s `port`. Both ends MUST treat it as lossy in one
specific sense: a message posted to the processor is delivered, but not at a predictable
time relative to any particular render quantum. Nothing may depend on a message arriving
before a given `process()` call, which is why every timed thing carries a frame.

### 1.1 The clock

All positions are absolute frames since the `AudioContext` started, as
`currentFrame` reports inside the worklet. A frame is a JavaScript number, which is exact to
2^53 and therefore exact for any session length that will ever occur.

There is no other clock. A message MUST NOT carry an offset within a block, a block index,
or a wall-clock time.

### 1.2 Host to processor

| `type` | Payload | Notes |
|---|---|---|
| `init` | `{ module, assets, capabilities, sampleRate, quantum, state? }` | `module` is an `ArrayBuffer` of WebAssembly bytes, transferred. Sent once |
| `events` | `{ events: [{ frame, bytes }] }` | `bytes` is a `Uint8Array` of one MIDI message |
| `transport` | `{ playing, frame, beat, beatsPerFrame, tempo, timeSignature, loop? }` | Sent when anything in it changes, and at least once before playback |
| `stateRequest` | `{ token }` | The processor replies with `state` carrying the same token |
| `loadAsset` | `{ key, bytes }` | Replace a `jig:asset` the profile marked `jig:userReplaceable`, after `init`. `bytes` is an `ArrayBuffer`, transferred |
| `dispose` | `{}` | Release everything. No further messages will be sent |

`init` carries bytes rather than a compiled `WebAssembly.Module` or a URL.

Bytes because a `WebAssembly.Module` posted to an `AudioWorklet` is silently never delivered:
`postMessage` does not throw, nothing arrives, and the load fails on a timeout. A `Module` is
serializable only within an agent cluster and a worklet is outside the page's. Measured in
Chrome, 2026-09-17.

Not a URL because `AudioWorkletGlobalScope` has no `fetch`, and because the host has already
verified these exact bytes against the profile's digest. Fetching again would verify one
response and execute another.

The processor compiles them synchronously with `new WebAssembly.Module(bytes)`. The 4 KB
limit on synchronous compilation applies to the main thread, not to a worklet.

`capabilities` is the resolved set from contract section 2, as an array of capability IRIs.
A plugin that declared `jig:prefers` reads its fallback decision from here rather than
probing for features.

`assets` is an object keyed by the fragment of each declared `jig:asset` resource's own IRI
(`<#script>` becomes `"script"`), each value an `ArrayBuffer`, transferred, of that asset's
verified bytes. Present and empty when the profile declares none. Delivered the same way as
`module` and for the same reason: `AudioWorkletGlobalScope` has no `fetch`, so a resource the
host has already fetched and integrity-checked has no other path to the processor that needs
it. The worked case is `plugins/_jsfx-runtime/`, whose processor writes a converted JSFX
effect's compiled script into the module's memory from `assets.script` before running it; a
future plugin wanting a wavetable or an impulse response uses the same field.

`state`, when present, is whatever a `state` reply (section 1.3) most recently returned for
this node, restored from a saved project's `jig:nodeState`. Absent on a plugin's first ever
load, and on any load where nothing was saved. A processor that receives it applies it after
`assets`, overriding whichever of a `jig:userReplaceable` asset's bytes it would otherwise
default to, exactly as a value restored from a save overrides a fresh install's shipped one.

`loadAsset` replaces one `jig:asset` the profile marked `jig:userReplaceable`, after the
plugin is already running: a person choosing a different file from the generated panel
(contract section 9.1), not part of the load sequence. `key` is the same fragment name
`assets` in `init` uses. A processor MUST accept this at any time and MUST NOT require a
reload to take effect. Contract section 8.2's rule about state applies here too: the new
bytes belong in what a later `stateRequest` returns, not duplicated anywhere else, or a
restore disagrees with what is actually loaded.

A file that fails to parse is an `error` with `phase: "asset"` and `fatal: false`: the plugin
keeps running on whatever it had loaded before, unlike a failure during `init`, because
rejecting a bad file the person just chose is a smaller event than the plugin itself being
broken and contract section 10.2's "does not stop the music" applies here at the scale of one
asset rather than the whole node.

### 1.3 Processor to host

| `type` | Payload | Notes |
|---|---|---|
| `ready` | `{ latencyFrames, tailFrames? }` | The plugin is instantiated and every buffer exists |
| `error` | `{ phase, message, fatal }` | `phase` is one of `instantiate`, `process`, `state`, `asset` |
| `events` | `{ events: [{ frame, bytes }] }` | Outgoing MIDI |
| `state` | `{ token, state }` | In reply to `stateRequest` |
| `latency` | `{ latencyFrames, fromFrame }` | Latency changed. See [latency.md](latency.md) |
| `dropped` | `{ count, since }` | Events discarded on queue overflow |

The host MUST NOT connect the node into the audio graph until `ready` arrives. Before then
the processor MUST output silence.

`error` with `fatal: true` means the plugin cannot continue. The host MUST mute and
disconnect it, MUST report it, and MUST leave the rest of the graph running, per contract
section 10.2.

### 1.4 Events

Events are batched into an array rather than posted one at a time, because each
`postMessage` costs a structured clone and a task, and a dense MIDI passage produces
hundreds of events per second.

A processor MUST maintain a bounded, preallocated event queue. On overflow it MUST discard
events and report the count in a `dropped` message on its next outgoing send. It MUST NOT
grow the queue, allocate, or block.

The host MUST post events in non-decreasing `frame` order. It SHOULD post them at least one
quantum ahead of the frame they apply to, and MUST accept that a late event is applied in
the quantum it arrives in rather than dropped, because dropping it is worse than moving it.
A processor MUST apply an event in the quantum containing its frame, or immediately if that
frame has already passed.

The `bytes` array is transferred, not copied, where the host has no further use for it. A
transferred `Uint8Array` is detached at the sender, so the host MUST NOT retain a reference
to anything it transfers.

### 1.5 Parameters are not messages

Parameter values travel as `AudioParam`s and reach the processor through the `parameters`
argument of `process()`. They MUST NOT be sent as messages.

Sending them as messages would give two paths for one value, arriving at different times,
with no defined precedence, and would discard sample-accurate automation. This is the same
reasoning as contract section 8.2: a parameter is not state.

---

## 2. Host and user interface

The channel is `postMessage` between the host document and the plugin's sandboxed frame.

### 2.1 Origin checking

The host MUST verify `event.origin` against the UI's expected origin on every message
received, and MUST pass an explicit `targetOrigin` on every message sent. It MUST NOT use
`"*"` for either.

The UI frame is cross-origin by construction, so `event.source` comparison is available and
SHOULD also be used. A host that accepts a message from any origin has a sandbox that any
page can reach into.

### 2.2 Host to UI

| `type` | Payload | Notes |
|---|---|---|
| `init` | `{ profile, parameters, capabilities, state? }` | `profile` is the plugin's own profile as JSON-LD. Sent once, after the frame reports `ready` |
| `parameter` | `{ symbol, value }` | A parameter changed, from automation, a generated panel, or another surface |
| `state` | `{ state }` | The processor's state, after a restore or on request |
| `plugin` | `{ payload }` | Opaque, relayed from the processor |

### 2.3 UI to host

| `type` | Payload | Notes |
|---|---|---|
| `ready` | `{}` | The frame has loaded and will accept `init` |
| `parameter` | `{ symbol, value }` | Set a parameter |
| `gesture` | `{ symbol, phase }` | `phase` is `begin` or `end`. Brackets a drag so automation records one gesture |
| `resize` | `{ width, height }` | Requested size in CSS pixels. The host MAY refuse |
| `plugin` | `{ payload }` | Opaque, relayed to the processor |

A `parameter` message from the UI is a request, not an assignment. It goes through the
host's operation dispatcher like any other edit, per contract section 9.3, so that undo,
automation recording and the WebMCP surface all see it. The UI MUST NOT assume its requested
value took effect and MUST render from the `parameter` message it receives back.

That round trip is deliberate. A UI that renders optimistically from its own input disagrees
with the host the first time a value is clamped, rejected or overridden by automation.

### 2.4 The opaque relay

`plugin` messages carry a payload the host does not interpret, relayed between the UI and
the processor in both directions. This is how a plugin sends a spectrum to its own display,
or a waveform to its own editor.

The host MUST NOT parse, validate or act on the payload, and MUST NOT allow it to reach any
other plugin. It MUST apply the same bounds as any other message: a payload arriving from
the processor is subject to the same rate limiting as `events`, and a UI that floods the
relay MUST be throttled rather than allowed to starve the main thread.

The payload is data. It is never markup and never code, and a host that inserts any part of
it into a document has made the sandbox pointless.

---

## 3. Sequence: loading a plugin

```
host                      processor                 UI frame
 |                            |                        |
 | addModule(), construct     |                        |
 |--------- init ------------>|                        |
 |                            | instantiate wasm       |
 |                            | allocate buffers       |
 |<-------- ready ------------|                        |
 | connect into graph         |                        |
 |                            |                        |
 | create sandboxed frame     |                        |
 |<-------------------- ready -------------------------|
 |--------------------- init ------------------------->|
 |                            |                        |
 |--------- transport ------->|                        |
```

The processor is ready and connected before the frame is created. A plugin makes sound
whether or not its editor is open, and a UI that fails to load MUST NOT prevent the plugin
from running.

## 4. What is deliberately absent

**No request and response framing beyond `stateRequest`.** Adding a general
correlation-identifier mechanism invites the message layer to become a remote procedure call
layer, and every operation that belongs in the dispatcher would migrate into it.

**No versioning field.** Unknown types are ignored, which covers forward compatibility
without a negotiation nobody would exercise. If that proves insufficient, a version belongs
in `init`, where it can be answered once.

**No direct UI to processor channel.** It would be faster and it would remove the host from
the middle, which is exactly the property that makes running someone else's code reasonable.
