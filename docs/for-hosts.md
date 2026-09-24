# Loading plugins in your own host

You have a web DAW and want to load plugins you did not write. This is what that takes, in
what order, and which parts the browser will refuse outright.

The normative version is [host-plugin-contract.md](host-plugin-contract.md). This page is
the working summary, with the parts that cost real time called out.

**Using an AI coding assistant to build this?** Point it at
[README.agents.md](https://github.com/danja/jigdaw/blob/main/README.agents.md) first. It is
the dense entry point: the vocabularies, the normative contract, a minimal profile, and where
the SHACL shapes and the counterexample files live, so a generated host can be checked against
something other than prose. `host-plugin-contract.md` is what actually governs; this page and
`messaging.md` are the working detail under it.

## The sequence

In this order, aborting at the first failure. The order is the specification, not a
suggestion: two of these steps exist to avoid running untrusted code you did not need to
fetch.

1. **Fetch the profile** from the plugin's IRI, sending
   `Accept: text/turtle, application/ld+json;q=0.9`.
2. **Parse it**, deciding the syntax by looking at the content rather than trusting the
   media type. A `.ttl` served as `text/plain` is what most static hosts return.
3. **Validate it** against the SHACL shapes. A profile from an origin you do not control is
   not trustworthy input.
4. **Check capabilities**, before fetching any code. If the plugin requires something you do
   not offer, stop here.
5. **Fetch the processor and the module**, resolving their locations against the URL you
   actually fetched the profile from.
6. **Verify every digest** against `jig:integrity`. There is no continue-anyway path.
7. **Register and construct**: `addModule()`, then an `AudioWorkletNode` using the declared
   `jig:registeredName`.
8. **Send `init` and wait for `ready`**. Only then connect the node into the graph.

> **Post the module's bytes, never a compiled `WebAssembly.Module`.** A `Module` posted to an
> `AudioWorklet` is silently never delivered. `postMessage` does not throw, nothing arrives,
> and your load fails on a timeout that names nothing useful. A `Module` is serializable only
> within an agent cluster and a worklet is outside the page's.
>
> Send the bytes, transferred, and let the processor compile them with
> `new WebAssembly.Module(bytes)`. That is synchronous and allowed there: the 4 KB limit on
> synchronous compilation applies to the main thread, not to a worklet. A 227 KB module
> compiles inside one without complaint.

A profile may also declare `jig:asset` resources: further files a plugin needs beyond its
module and its processor, such as a wavetable, an impulse response, or the compiled script a
converted JSFX effect runs under. Fetch and verify each one exactly like the module, and post
their bytes alongside it in the `init` message, keyed by the fragment of the resource's own
IRI. See [messaging.md](messaging.md) section 1.2.

## Capability negotiation

A plugin says what it needs with `trn:requires` and what it can use but does without with
`jig:prefers`. You answer both before fetching any code, and pass the resolved set to the
processor in `processorOptions` so a plugin that expressed a preference can pick its own
fallback rather than probing.

| Capability | Means |
|---|---|
| `trn:HostTransport` | You supply tempo and beat position |
| `jig:MidiEvents` | You deliver and accept MIDI |
| `jig:SharedMemory` | `SharedArrayBuffer` is available |
| `jig:OfflineRender` | The plugin may run faster than real time |
| `jig:Persistence` | You save and restore plugin state |

**Do not require cross-origin isolation of yourself as a baseline.** `SharedArrayBuffer`
needs `COOP: same-origin` and `COEP: require-corp`, and under `require-corp` every
cross-origin subresource must opt in with `Cross-Origin-Resource-Policy`. Requiring it would
impose that header on every server hosting any plugin anywhere, which defeats the point of a
plugin being a URL. Offer it as a mode if you want it, and treat shared memory as negotiated.

## Identity and retrieval are different questions

A profile states an explicit `@base`, so `<cascade.wasm>` is absolute against the plugin's
canonical IRI. But a host fetching from a mirror, a local checkout or a staging host must
fetch the module from where it got the profile.

So: keep the canonical IRI as the identity, and rebase any resource location that sits under
it onto the URL you actually fetched from. Leave a location pointing at another origin
exactly as written, because that is not a relative reference and its author meant that host.
Without this, only the origin named in a profile can ever serve that plugin.

## Parameters come from the profile

Each `lv2:port` yields both an `AudioParamDescriptor` and the control you draw. One
declaration, so they cannot disagree.

```js
{ name: port.symbol,          // lv2:symbol, what automation keys on
  defaultValue: port.default, // lv2:default
  minValue: port.minimum,
  maxValue: port.maximum,
  automationRate: port.aRate ? 'a-rate' : 'k-rate' }
```

Choose the widget from the *shape* of the declaration, never from the plugin naming one:
`lv2:portProperty lv2:toggled` or a two-point enumeration is a switch, a larger enumeration
is a selector, anything else is a dial. A widget name in a profile would be a second source
of truth about a port the port already describes, and the two drift.

## MIDI is a service you provide

The Web Audio graph carries audio and nothing else. A MIDI connection is not an audio edge:
it is you carrying messages from one processor's port to another's. That is why a plugin
speaking MIDI must declare `trn:requires jig:MidiEvents` rather than simply being wired up.

Every event carries an **absolute stream position in frames**. Deliver in non-decreasing
order, and apply an event in the quantum that contains it, compared by range. Never by an
offset within a block, which is meaningless once the block has passed, and never by equality
against a block boundary, which an event not exactly on one never meets.

## Latency and feedback

Where several paths meet, delay the fast ones so everything arrives aligned with the
longest. Compensation adds delay; it cannot remove it, so report the latency your graph
really has.

**A cycle must carry at least one render quantum of delay.** This is not a JigDAW rule you
could relax: the Web Audio API permits a cycle only if a `DelayNode` lies within it, and a
cycle without one outputs silence. Refusing the graph and naming the cycle is strictly
better than the platform's own failure, which is to go quiet. And never compensate an edge
inside a cycle: the delay in a feedback loop is the effect the user asked for.

## What will bite you

| Symptom | Cause |
|---|---|
| Load times out, processor never replies | You posted a `WebAssembly.Module`. Post bytes. |
| Fetch fails with a network error, headers look fine | The profile or a resource lacks `Access-Control-Allow-Origin`, or you called `fetch` detached from the window. |
| Two `Access-Control-Allow-Origin` headers | A proxy adding one the upstream already sent. Browsers reject that outright. |
| Everything silent, no error | A feedback cycle with no delay in it, or a processor writing fewer channels than it declared. |
| Intermittently late notes | Events located by block index rather than stream position. |

## Checklist

- The eight steps under "The sequence" above run in order, and a failure at any step aborts
  rather than continuing with a default.
- You send the bytes of a module, never a compiled `WebAssembly.Module`, to an `AudioWorklet`.
- Every fetched resource is verified against its `jig:integrity` digest, with no
  continue-anyway path, before it is compiled or run.
- Locations are resolved against the URL you actually fetched the profile from, not against
  the IRI in it: a mirror serves the same profile from a different origin.
- `trn:requires` is checked before fetching any code, not after.
- A plugin's own user interface, if it has one, loads cross-origin into a sandboxed frame,
  never into your own document.
- A failed plugin is muted and disconnected. The rest of the graph keeps running.
- Every string arriving from a profile or a catalogue (a name, a description, a caution) is
  treated as data. None of it is evaluated or inserted as markup.
- You have run [`bin/host.js`](https://github.com/danja/jigdaw/blob/main/bin/host.js) or your
  own implementation against a real worked plugin and heard real audio, not only passed a
  test suite against a fake `AudioWorklet`.

## Security posture

A plugin is arbitrary WebAssembly plus arbitrary JavaScript from an origin you do not
control. Verify every digest. Load plugin user interfaces cross-origin into a sandboxed
frame, never into your own document. Treat every value from a profile or a catalogue as data
and never as markup. A failed plugin must be muted and disconnected, leaving the rest of the
graph running: a host whose failure mode is silence for the whole project is one nobody will
load an unfamiliar plugin into.

## A reference implementation

This host is one, and it is small enough to read.
[PluginLoader.js](https://github.com/danja/jigdaw/blob/main/src/host/PluginLoader.js)
performs the sequence above with every dependency injected, so the same code runs against a
real `AudioContext` and against an offline stand-in in the tests.

**A minimal one you can run.**
[`bin/host.js`](https://github.com/danja/jigdaw/blob/main/bin/host.js) is a standalone host in
under a hundred lines: load a chain of plugins by IRI, in Node, no browser, and render real
audio to a WAV file. It talks to `PluginLoader` and a plugin's own `port` directly, posting
MIDI as `{ type: 'events', events }` per [messaging.md](messaging.md) section 6, the same way
a host written from scratch would, rather than through Jiggy's own convenience layer.

```sh
node bin/host.js https://strandz.it/jigdaw/plugins/cascade/ --out tail.wav
node bin/host.js https://strandz.it/jigdaw/plugins/pulse/ --note 69@0:0.3 --out note.wav
```

A chain, not a graph: each plugin's output feeds the next, with no branching and no mixing.
[`src/host/ReferenceHost.js`](https://github.com/danja/jigdaw/blob/main/src/host/ReferenceHost.js)
has the reasoning for why. Its `--root PREFIX=DIR` lets you point at a local plugin directory,
so one you have not published yet renders the same way one already live does.

---

[Back to the documentation index](index.md) &middot;
[Building a plugin instead](for-plugin-authors.md)
