# Web Audio Modules

**Status:** describes `bin/wam.js` and `src/wam/WamModule.js`. Not normative: the normative
document for a JigDAW plugin is [host-plugin-contract.md](host-plugin-contract.md), and
nothing here changes it.

[Web Audio Modules](https://www.webaudiomodules.com/) is the existing standard for web-native
audio plugins. JigDAW was specified without reference to it, which was an omission rather than
a decision. This is the bridge, and it runs in one direction.

## What it does

```sh
node bin/wam.js plugins/pulse
```

Reads the profile, refuses a plugin it cannot package, and writes a directory a WAM 2.0 host
can load:

```
plugins/pulse/wam/
  descriptor.json      the WamDescriptor
  index.js             default-exports the WebAudioModule constructor
  pulse.wasm           the plugin's own bytes, unchanged
  pulse-processor.js
```

**The plugin does not change.** Same profile, same WebAssembly, same processor. What is
generated is the packaging, which JigDAW does not have because it answers the same questions
in RDF instead.

The profile is resolved at build time and baked into `index.js`, rather than fetched and
parsed at load. A Turtle parser in a browser costs 1.7 MB and two shims for node's `stream`
and `util`; the emitted package is 21 kB and reaches no builtin. `--rebase <iri>` leaves the
module and processor at their origin instead of copying them in.

## What survives that a WAM would not otherwise have

**Integrity.** The WAM API has no concept of it: no digest, no hash, nothing, across the whole
of `@webaudiomodules/api`. The digests come from the profile, travel inside `index.js`, and are
checked before anything is registered or instantiated, exactly as contract section 3.2
requires. A WAM host gets verification it cannot express and did not ask for.

**A sandboxed interface.** `createGui` must return an `Element`, and an iframe is an Element,
so the cross-origin sandbox of contract section 9.1 and the WAM contract are satisfied by the
same object. A plugin with no `jig:ui` returns null and the host draws its own controls from
`getParameterInfo`, which is what WAM hosts do anyway.

## The mapping

| WAM | JigDAW |
|---|---|
| `identifier` | the plugin IRI, which is already globally unique and dereferenceable |
| `name`, `vendor`, `description`, `website` | `rdfs:label`, `trn:vendor`, `rdfs:comment`, `foaf:homepage` |
| `version` | `doap:revision` |
| `keywords`, `isInstrument` | `trn:genre`, `trn:role` |
| `hasAudioInput` / `hasAudioOutput` | `jig:audioInputs` / `jig:audioOutputs` |
| `hasMidiInput` / `hasMidiOutput` | `trn:accepts` / `trn:produces trn:Midi` |
| `WamParameterInfo` | `lv2:port`, `lv2:scalePoint`, `units:unit` |
| `wam-midi` | `events { frame, bytes }`, seconds converted to frames |
| `wam-transport` | the `transport` message |
| `getState` / `setState` | `stateRequest` / `state` |
| `getCompensationDelay` | `latencyFrames` from `ready` |

A parameter's WAM type follows the shape of its declaration, the same rule contract section
5.3 uses to choose a widget: `lv2:toggled` is `boolean`, scale points make a `choice`, and
everything else is `float`. **Nothing infers `int` from the bounds happening to be whole
numbers.** Cutoff is declared 100 to 18000 Hz and is continuous; typing it `int` from that
would quantise it to 1 Hz steps in every WAM host. That was the first version and it was wrong.

## What does not survive

**A-rate automation.** WAM has no a-rate concept: parameters arrive as `wam-automation`
events, and a `WamProcessor`'s `process()` is specified to ignore its `parameters` argument.
JigDAW parameters are `AudioParam`s and [messaging.md](messaging.md) section 1.5 forbids
sending them as messages. The bridge converts, and a port declared `jig:ARate` degrades to
k-rate steps when driven from a WAM host.

**Audio-thread event connections.** `connectEvents` routes between `WamProcessor`s inside a
`WamGroup` on the audio thread. The packaged plugin's processor is the author's own
`AudioWorkletProcessor`, not a `WamProcessor`, so there is nothing for a group to route to and
`connectEvents` throws with a message saying so. Appearing to connect would be worse. Closing
this means a second packaging route in which the WAM shell drives the module through
[module-abi.md](module-abi.md) instead of the processor, which is what
`native/jigdaw-adapter` already does for VST3.

## The other direction

A JigDAW host can load a WAM, under contract section 12, and what that costs is stated there
rather than worked around.

### Why it needed a contract change

The obstacle is not the one this document first claimed. `addFunctionModule` stringifies a
function already in the loaded bundle and blobs it into the worklet, fetching nothing, which
the SDK source confirms. The unenumerable part is a plugin's runtime assets, which is a
narrower problem and a solvable one. **15 of the 23 example plugins fetch at run time**:
their own `descriptor.json`, GUI templates, preset banks, `patches.json`. No manifest written
beforehand would have listed those, which is exactly why the container is what gets verified. **Verify the container instead of enumerating the contents.** One archive, one digest,
and everything the plugin loads afterwards resolves inside the verified bytes or is refused.
That is the same answer section 2.2 of [plugin-bundles.md](plugin-bundles.md) already gives
for a `.jig`.

The real obstacle is that **a WAM's entry point is a module the host imports into its own
document and calls.** It runs with the host's origin and the host's privileges. Contract
section 9.1 forbids exactly that, for reasons it spells out, and no amount of packaging
changes it: it is what a WAM is.

So section 12 defines a separate class rather than relaxing section 9.1. A foreign plugin is
declared `jig:ForeignPlugin`, never `jig:WebPlugin`, the two are disjoint, and a host must
verify the container, obtain consent bound to that container's digest, and mark the plugin
wherever it appears. Support is optional and refusing everything still conforms.

### What is built

| | |
|---|---|
| `src/rdf/ProfileReader.js` | `kindOf`, and `readForeignProfile` as a separate reader |
| `src/host/ForeignTrust.js` | consent, bound to the plugin and the container digest |
| `src/host/ForeignLoader.js` | fetch, verify, unpack, and the boundary |
| `examples/reference-foreign.ttl` | a worked declaration, and a counterexample beside it |

Consent is bound to the digest rather than to the plugin, because an IRI serves whatever is at
it today and consenting to a plugin would consent once to everything its author ever publishes
there. There is no blanket setting, and a stored project naming a foreign plugin does not load
it on open: a project is data from wherever it came from, and treating it as authority to run
code would make the consent meaningless.

### What is not built, and is not verified

**The virtual origin is built and has been run.** `web/foreign/sw.js` serves a verified
container from a scoped path and never calls `fetch`; `src/host/ForeignOrigin.js` registers it
and installs a container. `web/foreign/probe.html` is the check, because none of this is
reachable from a test in this repository: open it and press the button.

Its two inputs are built rather than committed, because they come from
`webaudiomodules/wam-examples`, which is MIT and not ours to ship, and a vendored build
artefact goes stale silently. So the page is published and its inputs are not:

```sh
git clone --recurse-submodules https://github.com/webaudiomodules/wam-examples ~/wam-examples
npm run wam:fixtures
```

The probe checks for them before it uses them and prints those two lines when they are
absent. It shipped once without that check and answered 404 at its first fetch on the live
server, which is the "contact page that 404s" failure this project has a guard against for
every other page.

Measured in Chrome on 2026-09-18, against `pingpongdelay` from `webaudiomodules/wam-examples`
bundled and zipped into a 351 kB container: 14 of 14. The container verifies, the plugin is
refused before consent, imports from the virtual origin, fetches its own `descriptor.json`
through the worker, instantiates, and passes audio at peak 1.0000.

It must be a service worker and not blob URLs, and that is measured rather than preferred.
**22 of the 23 plugins in `webaudiomodules/wam-examples` locate themselves with
`import.meta.url`**, typically `new URL('.', import.meta.url)` to build a base and then fetch
against it. A blob URL has no directory, so that base is useless and every one of those
plugins breaks. `tests/host/ForeignLoader.test.js` asserts the count against the checkout
when it is present, so the decision stays tied to the evidence.

**Two things the browser found that review had not.**

The host must inject the WAM runtime into its **own** worklet before any WAM can be
instantiated: `WamEnv` and a `WamGroup`, through the SDK's `initializeWamHost`. It is shared
by every plugin in the context and is in no container, so it is the host's code and not a
plugin's. Without it the plugin's own `AudioWorkletNode` fails with *the node name … is not
defined in AudioWorkletGlobalScope*, which is exactly how the probe failed first. Contract
section 12.3a is that requirement.

And a `..` path never reaches the worker at all: the browser normalises the URL first, so it
leaves the worker's scope and becomes an ordinary same-origin request. Contract section 12.3
originally said a host MUST refuse any request resolving outside the container, which no host
can do; it now says what is actually enforceable and states the limit.

**The adapter is written.** `src/wam/WamAdapter.js` is the exact mirror of
`src/wam/WamModule.js`: that one puts a WAM face on a JigDAW plugin, this one puts a JigDAW
face on a WAM, so everything above the engine works on one shape.

The engine asks a node for four things and a `WamNode` answers none of them the same way.
`connect` and `disconnect` come free, because a `WamNode` is an `AudioNode`. The other three
are translated: `node.parameters.get(symbol)` returns an `AudioParam`-shaped view that calls
`setParameterValues`, and `node.port` is a `MessagePort`-shaped translator turning `events`
into `wam-midi`, `transport` into `wam-transport`, `stateRequest` into `getState`, and
`dispose` into `destroy`, with a `wam-midi` the plugin emits coming back as an `events`
message.

The panel is drawn from `getParameterInfo()` rather than from the ports the profile declares,
because the plugin is the authority on its own parameters and a profile is a claim about them.
Widgets follow contract section 5.3's rule, so a foreign panel and a native one come out of one
set of decisions.

Measured in Chrome on 2026-09-18, in `web/foreign/probe.html`: 18 of 18, ending with a real
Web Audio Module adopted as an engine node, four parameters found, a parameter moved through
the engine's own path and read back from the plugin, and audio still passing through the
adopted node.

**What it cannot translate, said rather than hidden.** WAM's `setParameterValues` takes no time
argument, so a JigDAW automation curve becomes a series of immediate writes:
`linearRampToValueAtTime` lands now. That is the a-rate loss from the other direction, and it
is asserted as a test rather than left as a comment.

**Enforcement against a hostile plugin.** The boundary defeats substitution, which is the
threat section 3.2 names. It does not defeat a plugin that wants out: code in the host's
document can reach the network by means the host does not mediate. Section 12.3 says so.

### One kind of plugin the boundary correctly breaks

`PedalBoard-WAC2022` fetches `repositories.json`, fetches whatever URLs it finds there, and
imports those as Web Audio Modules. It is a plugin that is itself a plugin host, and its
reachable code is not a set anybody can know.

Under section 12.3 every one of those fetches resolves outside the container and is refused,
so the plugin does not work. That is the right outcome and not a gap to close: a container
whose contents can load arbitrary remote code is not a container, and consenting to it would
be consenting to whatever it decides to fetch later. A host should say that plainly rather
than appear to support it.

## Testing
## Testing

`tests/wam/WamModule.test.js` instantiates the package through
[src/testing/OfflineHost.js](../src/testing/OfflineHost.js), which registers the plugin's real
processor and calls its real `process()`. A `wam-midi` event scheduled through the WAM
interface produces audio out of Pulse's WebAssembly, with the digests verified on the way.

The interface is checked against `@webaudiomodules/api`'s own type definitions where that
checkout is present, by reading the members off `WamNode` and `WebAudioModule` and asserting
each exists on an instantiated one. It skips loudly where it is absent. An earlier version
grepped the source instead and passed for members that were only inherited from `EventTarget`,
which the offline node is not.
