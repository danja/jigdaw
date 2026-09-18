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

A WAM cannot be loaded by a JigDAW host, and the reason is structural rather than a rule
anyone chose.

A JigDAW plugin declares every file it fetches, each with a digest. A WAM is an ESM that may
import whatever it likes, and its audio-thread dependencies arrive through `addFunctionModule`
and `getModuleScope`, which the WAM documentation describes as the alternative to `import`
statements on the audio thread. **A WAM's file set is not knowable before running it**, so it
cannot be profiled, digested, bundled or verified.

JigDAW's format is declarative and WAM's is imperative: a profile describes the plugin
exhaustively before any of its code runs, where a WAM is a constructor that tells you what it
is once you call it. A description converts to another description. A program does not.

It remains possible per plugin, by writing a profile for one specific WAM and pinning its
digests, which is what plugin-universe already does for VST3s. The trust then rests on
whoever minted the profile rather than on the author.

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
