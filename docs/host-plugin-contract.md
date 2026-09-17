# JigDAW Host and Plugin Contract

**Version:** 0.1.0-draft
**Status:** normative. An implementation claiming conformance follows this document exactly.
**Host identifier string:** `jigdaw-host/0.1.0`

Requirement keywords (MUST, MUST NOT, SHOULD, SHOULD NOT, MAY) are used in the
[RFC 2119](https://www.rfc-editor.org/rfc/rfc2119) sense.

This document specifies what a JigDAW host guarantees and what a JigDAW plugin must do
in return. It is the web-native equivalent of a plugin API such as
[VST3](https://steinbergmedia.github.io/vst3_dev_portal/) or
[LV2](https://lv2plug.in/), and it assumes the
[Web Audio API](https://www.w3.org/TR/webaudio/) and
[WebAssembly](https://webassembly.org/) rather than a native binary interface.

The vocabulary the profile is written in is `vocabs/jigdaw.ttl`. The profile format is
described in [plugin-profiles.md](plugin-profiles.md). The messages exchanged between host,
processor and user interface are specified in [messaging.md](messaging.md), and latency
compensation in [latency.md](latency.md). Where this document and the vocabulary disagree,
this document governs and the vocabulary is a defect.

---

## 1. Identity and discovery

### 1.1 A plugin is a URL

A plugin MUST be identified by an absolute `https:` IRI. That IRI MUST be dereferenceable
and MUST return the plugin's profile. There is no separate registry, no identifier scheme
and no install step: the IRI is the name, the metadata is what the name returns, and
installation is having fetched it.

`http:` IRIs MUST NOT be used, **except on loopback**, where `http://localhost`,
`http://127.0.0.1` and `http://[::1]` MUST be accepted.

Away from loopback, a page serving a JigDAW host is served over TLS and a browser refuses
mixed content, so an `http:` plugin is unreachable in practice as well as unsafe in
principle.

The loopback exception is not a relaxation. A browser already treats `http://localhost` as a
secure context, because it cannot be intercepted, and grants it every other secure-context
feature for that reason. Refusing it would mean the only way to develop a plugin is to deploy
it, which is the opposite of what a local host is for. This was found by running the host on
localhost and watching it refuse its own plugins.

Rationale, since a registry is the reflex and will be proposed again: a registry makes the
registry's operator the arbiter of what exists. Dereferenceable IRIs mean a plugin author
publishes by publishing, and a catalogue becomes one opinion about what is worth finding
rather than the precondition for being found at all.

### 1.2 What the IRI returns

A plugin IRI MUST support content negotiation and MUST serve:

| `Accept` | Response |
|---|---|
| `text/turtle` | the profile as Turtle |
| `application/ld+json` | the profile as JSON-LD |
| `text/html` | a page a person can read |

`text/html` MUST be the default when no `Accept` header expresses a preference, so that
pasting a plugin IRI into a browser shows something useful.

A host MUST send `Accept: text/turtle, application/ld+json;q=0.9`. A host MUST accept a
profile served as `text/plain`, which is what most static hosts and GitHub's raw view
return for a `.ttl` file, and MUST determine the syntax by examining the content rather
than by trusting the media type.

### 1.3 CORS is mandatory

A plugin's profile, processor, module, user interface and every declared asset MUST be
served with `Access-Control-Allow-Origin` permitting the host's origin, whether by `*` or
by explicit echo.

This is not a recommendation that can be relaxed. `AudioWorklet.addModule()` fetches
cross-origin in CORS mode; a response without the header is not merely untrusted, it is
unreadable. A plugin without CORS cannot be loaded by any host on any origin but its own,
and a host MUST report that as a hosting defect naming the missing header, not as a
generic load failure.

### 1.4 Caching

A host SHOULD cache a profile and its resources by IRI, and MUST revalidate according to
ordinary HTTP cache semantics. A host MUST NOT treat a profile as immutable unless the
response says so. A plugin author changing a plugin's behaviour without changing its IRI
MUST change its resources' integrity digests, which invalidates the host's cached copy by
construction.

---

## 2. Capability negotiation

### 2.1 Answered before anything is fetched

A plugin declares what it needs with `trn:requires`, and what it can use but does without
with `jig:prefers`. A host MUST evaluate every `trn:requires` before fetching any code. If
any required capability is unavailable, the host MUST NOT fetch the module and MUST report
which capability was missing.

Rationale: the alternative is to load and instantiate a plugin, then discover it cannot
work. That wastes a download, runs untrusted code for no reason, and produces a failure
whose cause is several steps removed from the thing that caused it.

### 2.2 Capabilities

| Capability | Meaning |
|---|---|
| `trn:HostTransport` | The host provides tempo and beat position |
| `jig:MidiEvents` | The host delivers and accepts MIDI |
| `jig:SharedMemory` | `SharedArrayBuffer` is available |
| `jig:CrossOriginIsolation` | The page is cross-origin isolated |
| `jig:OfflineRender` | The plugin may run faster than real time |
| `jig:Persistence` | The host saves and restores plugin state |

A host MUST pass the resolved set of available capabilities to the processor in its
`processorOptions` at construction, so a plugin that declared `jig:prefers` can choose its
fallback without probing.

### 2.3 Shared memory is negotiated, never assumed

`SharedArrayBuffer` requires the page to be cross-origin isolated, which requires
`Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`
on the host document. Under `require-corp`, **every** cross-origin subresource must opt in
with `Cross-Origin-Resource-Policy: cross-origin` or it fails to load.

A host therefore MUST NOT require cross-origin isolation of itself as a baseline. Doing so
would impose `Cross-Origin-Resource-Policy` on every server hosting any plugin anywhere,
which contradicts section 1.1: a plugin author would publish by publishing and then find
that publishing was not enough.

A host MAY offer an isolated mode, in which case it MUST offer `jig:SharedMemory` only
there, and plugins requiring it are available only in that mode. A plugin SHOULD prefer
rather than require shared memory, and SHOULD fall back to transferring buffers over its
message port.

---

## 3. Instantiation

### 3.1 Order

A host MUST perform the following in order, and MUST abort at the first failure:

1. Fetch the profile. Parse it. Validate it against `vocabs/shapes.ttl`.
2. Evaluate `trn:requires` (section 2.1).
3. Resolve `jig:location` on each resource against the profile's base IRI.
4. Fetch the module and the processor, verifying each against its `jig:integrity`.
5. `await audioContext.audioWorklet.addModule(processorUrl)`.
6. Construct an `AudioWorkletNode` using the processor's `jig:registeredName`, with
   `numberOfInputs`, `numberOfOutputs` and `outputChannelCount` taken from the profile.
7. Post the module's **bytes** to the processor and await its ready message (section 3.3).
8. Only then connect the node into the graph.

A plugin MUST NOT be connected into the audio graph before step 7 completes. A processor
whose WebAssembly instance is not ready MUST output silence, MUST NOT throw, and MUST NOT
be audible.

### 3.2 Integrity is verified, not declared

A host MUST verify every fetched resource against the `jig:integrity` digest in the
profile before executing or instantiating it, and MUST refuse the plugin on mismatch.

For the processor module, a host SHOULD use the `integrity` option of `addModule()` where
the browser supports it. Where it does not, the host MUST fetch the resource itself, verify
the digest with `crypto.subtle.digest`, and pass a blob URL to `addModule()`.

A profile that omits `jig:integrity` on any resource is invalid (`vocabs/shapes.ttl`) and
MUST be refused. A host MUST NOT offer an option to skip verification. The profile and the
code it names need not share an origin, and an unverified profile is an instruction to
execute whatever currently sits at a URL.

### 3.2a A module MAY declare a portable ABI

The processor is JavaScript, so only a browser can run a plugin through it. A module MAY
additionally declare `jig:abi`, and a host with a WebAssembly runtime and no JavaScript
engine MAY then load the module directly and ignore the processor entirely.

This is optional for a plugin and optional for a host. A browser host SHOULD continue to use
the processor, which is the plugin author's own code and may do more than the ABI exposes.
See [module-abi.md](module-abi.md).

### 3.3 WebAssembly is compiled inside the worklet

The host MUST post the module's bytes, as an `ArrayBuffer`, and SHOULD transfer rather than
copy them. The processor MUST compile them synchronously with `new WebAssembly.Module(bytes)`
and instantiate with `new WebAssembly.Instance(module)`, and MUST post a ready message once
its instance and all its buffers exist.

**A host MUST NOT post a compiled `WebAssembly.Module` to an `AudioWorklet`.** An earlier
version of this document required exactly that, on the reasoning that a `Module` carries
already-compiled code and would keep compilation off the audio thread. It does not work.
Measured in Chrome on 2026-09-17: `port.postMessage({ module })` does not throw, and the
message is never delivered. The processor waits for an `init` that never arrives and the load
fails ten seconds later with a timeout that names nothing useful. A `WebAssembly.Module` is
serializable only within an agent cluster, and an `AudioWorklet` is outside the page's.

The synchronous compile is deliberate and is allowed here. The 4 KB limit on
`new WebAssembly.Module()` applies to the main thread, not to a worklet: a 227 KB module
compiles synchronously inside one without complaint, measured the same day.

The `init` and `ready` messages are specified in [messaging.md](messaging.md) section 1.

A host MAY call `WebAssembly.validate()` on the bytes before posting them, which is cheap and
gives a precise error naming the module rather than a generic instantiation failure from
inside the worklet.

A processor MUST NOT call `fetch()`, `import()` or any other network operation, and SHOULD
NOT await anything on the path to becoming ready. `AudioWorkletGlobalScope` deliberately has no `fetch`,
and a plugin discovering this at run time is a plugin that was written against the wrong
model.

### 3.4 Memory is allocated before the plugin is audible

A processor MUST allocate every buffer it will ever use before it posts its ready message:
its WebAssembly memory, its event queue, its scratch arrays. `process()` MUST NOT allocate.

`WebAssembly.Memory.grow()` MUST NOT be called from `process()`. It detaches every existing
`ArrayBuffer` view on that memory, so any `Float32Array` the processor is holding becomes
zero-length without warning, and the symptom is silence rather than an exception.

---

## 4. The process contract

### 4.1 Real-time rules

Inside `process()` a plugin MUST NOT:

- allocate, including creating any array, object, closure or string;
- call `WebAssembly.Memory.grow()`;
- touch the filesystem, the network or any storage API;
- log through an unbounded sink;
- take a lock whose hold time is not bounded;
- throw.

These are not style preferences. `process()` runs on a thread with a hard deadline of one
render quantum. Missing it produces an audible glitch, and a garbage collection pause
produces a run of them.

A plugin MUST communicate with everything outside the audio thread through preallocated
buffers and bounded lock-free queues.

### 4.2 Shape

`process(inputs, outputs, parameters)` follows the Web Audio API. Additionally:

- A plugin MUST write every frame of every channel of every output it declared, writing
  zeroes where it has nothing to say. An untouched output buffer's contents are not
  specified to be silent.
- A plugin MUST NOT assume `inputs[n]` has the channel count it declared. A disconnected
  input arrives as an empty array, and a plugin MUST treat that as silence rather than
  reading index 0 of nothing.
- A plugin MUST NOT write to its input buffers.
- A plugin MUST return `true` while it is producing or may yet produce output, and MAY
  return `false` only when it is permanently finished. A plugin with a `jig:tailFrames`
  greater than zero MUST keep returning `true` for at least that many frames after its
  input falls silent.

Latency, tails and feedback are specified in [latency.md](latency.md).

### 4.3 Render quantum

The render quantum is 128 frames. A plugin MUST NOT hardcode that figure where the code
would be wrong if it changed; it MUST read `outputs[0][0].length` or the equivalent. A
plugin that cannot work at another quantum MUST declare `jig:renderQuantum 128`, so that a
host running at a different quantum refuses it rather than corrupting its buffers.

---

## 5. Parameters

### 5.1 One declaration

A parameter is declared once, as an `lv2:port` on the profile, with `lv2:symbol`,
`lv2:name`, `lv2:default`, `lv2:minimum`, `lv2:maximum` and optionally `units:unit`.

From that one declaration the host MUST derive both the processor's
`parameterDescriptors` and the control drawn on the generated panel. They cannot disagree,
because there is nothing for them to disagree about.

`lv2:symbol` becomes the `AudioParam` name. It is what automation and the saved project key
on, and a plugin MUST NOT change a symbol between versions without treating it as a new
parameter.

### 5.2 Automation rate

A port declaring `jig:automationRate jig:ARate` becomes an a-rate `AudioParam`; anything
else is k-rate. k-rate is the default, and a plugin SHOULD declare a-rate only for
parameters meant to be audio-modulated: an a-rate parameter costs a 128-element
`Float32Array` per parameter per quantum whether or not anything is modulating it.

A processor MUST handle a `parameters[name]` array of length 1, which is what Web Audio
passes when a value is constant across the quantum, as well as one of length 128.

### 5.3 Widgets follow shape

The control the host draws is determined by the shape of the declaration and never by the
plugin naming a widget:

- a port with `lv2:portProperty lv2:toggled`, or an enumeration with exactly two
  `lv2:scalePoint`s, is a two-position switch;
- an enumeration with more scale points is a selector with every option named;
- anything else is a dial.

An author wanting a switch declares a switch's shape. Rationale: a widget name in a profile
is a second source of truth about a port that the port already describes, and the two drift.
This rule is inherited from valis, where no view is permitted to test `toggled` itself.

### 5.4 Every position must mean something

A parameter position that collapses onto another for some settings of the plugin is worse
than no position at all. A plugin SHOULD NOT declare a mode whose behaviour is identical to
another mode under any reachable configuration.

---

## 6. Events

### 6.1 MIDI is a host service

The Web Audio graph carries audio and nothing else. MIDI and other events reach a plugin
over the `AudioWorkletNode`'s `MessagePort`, provided by the host. The wire format is
specified in [messaging.md](messaging.md).

A plugin that accepts or produces any MIDI signal type MUST declare
`trn:requires jig:MidiEvents`. `vocabs/shapes.ttl` enforces this, because a plugin that
declares `trn:produces trn:Midi` and does not require the service is a plugin whose output
silently goes nowhere.

### 6.2 Events are located by stream position

Every event MUST carry an absolute stream position in frames, as a `frame` field, and a
processor MUST apply an event in the quantum that contains it, comparing by range:

```
if (event.frame >= blockStart && event.frame < blockStart + quantum)
```

A plugin MUST NOT locate an event by its index within the current block, and MUST NOT test
a stream position for equality against a block boundary.

Rationale, stated at length because this bug is written twice in valis's `MISTAKES.md` from
opposite directions: an event's offset within a block is meaningless once the block has
passed, and an event whose position is not exactly a multiple of the quantum is never equal
to a boundary and so never fires at all. Both failures are silent, intermittent, and
present as "the timing is slightly off" rather than as an error.

### 6.3 Ordering and bounds

The host MUST deliver events in non-decreasing `frame` order. The processor's event queue
MUST be bounded and preallocated, and on overflow the processor MUST drop events and report
the count on its next outgoing message. It MUST NOT grow the queue.

---

## 7. Transport

A plugin declaring `trn:requires trn:HostTransport` receives, for each quantum, the tempo
in BPM, the transport state, the position in beats at the start of the quantum, the time
signature, and the loop points where a loop is active.

A plugin MUST derive musical timing from the supplied beat position and MUST NOT derive it
by counting `process()` calls. Counting blocks desynchronises the moment the transport is
repositioned, looped or retempoed, and produces a plugin that is correct only while nothing
happens.

The host MUST advance the beat position continuously within a quantum where a plugin needs
sub-quantum musical phase, by supplying the position at the start of the quantum and the
beats per frame.

---

## 8. State

### 8.1 The contract comes before the editor

A plugin's state serialisation contract MUST be settled before any user interface work
begins. A plugin MUST be able to load state written by any earlier version of itself, and
MUST supply defaults for anything a stored state does not mention.

### 8.2 Shape

State MUST be a structured-cloneable JavaScript value, obtained from the plugin through its
message port and restored through it. A plugin MUST NOT store state that only makes sense
on the machine that produced it, such as a local file path.

Parameter values are not state: they are `AudioParam`s and the host already saves them. A
plugin MUST NOT duplicate a parameter's value into its state, because on restore the two
disagree and it is not defined which wins.

---

## 9. User interface

### 9.1 Sandboxed

A plugin's user interface MUST be loaded into an `iframe` with a `sandbox` attribute, and
that frame MUST NOT be same-origin with the host document. A host MUST NOT load plugin UI
code into its own document by any means.

A plugin is code fetched from an origin the host does not control. Any UI script running in
the host's document could read the project, the user's storage, any credentials present and
every other plugin, and could rewire the audio graph directly. The sandbox is what makes
section 1.1 a reasonable thing to propose.

A plugin with no `jig:ui` gets a panel generated from its port declarations. This is the
expected case, not a degraded one: a generated panel is consistent with every other plugin,
it is accessible, and it costs the author nothing.

### 9.2 The UI never touches the graph

A user interface MUST communicate only by `postMessage` with the host, using the protocol in
[messaging.md](messaging.md) section 2. It MUST NOT be given a reference to the
`AudioContext`, the `AudioWorkletNode`, the processor's message port, or any part of the
project model.

Changes go from the UI, to the host's operation layer, to the model, to the compiled graph.
A UI that mutates the running graph directly is a second implementation of every operation,
and the two diverge.

### 9.3 One operation layer

The host's UI, its WebMCP surface and any other control surface MUST all be thin adapters
over a single operation dispatcher. An operation MUST NOT be implemented twice.

---

## 10. Errors

### 10.1 Located and recoverable

Every failure a host reports MUST name what failed, where, and what would fix it. A parse
failure MUST carry a line and column. A validation failure MUST carry the focus node and
the constraint. A capability failure MUST name the capability.

### 10.2 A failed plugin does not stop the music

Loading a plugin that fails at any step MUST leave the existing audio graph running and
unchanged. A plugin that throws in `process()` MUST be muted and disconnected by the host,
MUST be reported, and MUST NOT take down the context.

Plugin code is untrusted and imperfect. A host whose failure mode is silence for the whole
project is a host nobody will load an unfamiliar plugin into, which would defeat the point.

### 10.3 Failure is a result

A host SHOULD record load outcomes as `jig:Inspection` records, including failures. Which
plugins work in which browsers is a fact about the ecosystem, and it is only discoverable
if unsuccessful loads are written down rather than merely reported and forgotten.

---

## 11. Security

A host MUST:

- serve itself over TLS, with a Content Security Policy that permits WebAssembly
  compilation and frames only the sandboxed plugin UI origin;
- verify every resource against its declared integrity digest (section 3.2);
- sandbox all plugin user interfaces cross-origin (section 9.1);
- treat every value arriving from a plugin, a profile or a catalogue as data and never as
  markup or as code.

A host MUST NOT:

- offer to skip integrity verification;
- execute a profile's contents in any way, including evaluating a string from one;
- grant a plugin access to the host's storage, credentials, or any capability not listed in
  section 2.2.

Profiles are fetched from arbitrary origins. A catalogue listing is data. A plugin's name,
description and caution are strings written by someone else, and they reach a page.

---

## 12. Conformance

A host conforms if it implements sections 1 through 11 as written.

A plugin conforms if its profile validates against `vocabs/shapes.ttl` and its processor
obeys sections 3.3, 3.4, 4, 5.2, 6.2 and 8.

A plugin profile that validates but whose processor violates section 4.1 is not conformant
and will not be reported as such by any automated check. That is a known gap, and it is why
section 10.2 exists.
