# Building and publishing a plugin

Three files at a URL. A profile saying what it is, a processor that runs on the audio
thread, and the WebAssembly that does the work.

Publishing is putting them somewhere a browser can fetch them. There is no store, no review
and nobody to ask.

## 1. The profile

The subject is an IRI you control, normally the plugin's own page. That is the convention
already published at
[plugin-universe.com/about/profiles](https://plugin-universe.com/about/profiles), and it is
what makes the profile yours to version alongside the code.

```turtle
@base <https://example.org/plugins/cascade/> .

@prefix jig:   <http://purl.org/stuff/jigdaw/> .
@prefix trn:   <http://purl.org/stuff/transmissions/> .
@prefix lv2:   <http://lv2plug.in/ns/lv2core#> .
@prefix units: <http://lv2plug.in/ns/extensions/units#> .
@prefix rdfs:  <http://www.w3.org/2000/01/rdf-schema#> .
@prefix foaf:  <http://xmlns.com/foaf/0.1/> .

<>  a jig:WebPlugin , trn:PluginProfile ;
    rdfs:label "Cascade" ;
    rdfs:comment "Schroeder plate reverb with a freeze that holds the tail." ;
    trn:vendor "danja" ;
    foaf:homepage <> ;

    trn:role trn:AudioEffect ;
    trn:accepts trn:Audio ;
    trn:produces trn:Audio ;

    jig:audioInputs 1 ; jig:inputChannels 2 ;
    jig:audioOutputs 1 ; jig:outputChannels 2 ;

    jig:module <#module> ;
    jig:processor <#processor> ;
    lv2:port <#mix> .

<#module>    a jig:Module ;
    jig:location <cascade.wasm> ; jig:mediaType "application/wasm" ;
    jig:integrity "sha384-..." .

<#processor> a jig:Processor ;
    jig:location <cascade-processor.js> ; jig:mediaType "text/javascript" ;
    jig:registeredName "cascade" ;
    jig:integrity "sha384-..." .

<#mix> a lv2:InputPort , lv2:ControlPort ;
    lv2:symbol "mix" ; lv2:name "Mix" ;
    lv2:default 0.3 ; lv2:minimum 0.0 ; lv2:maximum 1.0 .
```

> **Set an explicit `@base`.** Without it, a profile whose subject is `.../cascade/` but
> which is served at `.../cascade/profile.ttl` resolves every relative location one
> directory off, silently.

### Declare parameters once

An `lv2:port` becomes both the `AudioParam` your processor receives and the control a host
draws. Do not name a widget: the host picks one from the shape of your declaration.
`lv2:portProperty lv2:toggled` gives a switch, an enumeration with `lv2:scalePoint`s gives a
selector with every option named, anything else is a dial. So if you want a switch, declare
a switch's shape.

`lv2:symbol` is what automation and saved projects key on. Changing one is introducing a
new parameter, not renaming an old one.

### Say what you need

`trn:requires` for what you cannot run without, `jig:prefers` for what improves you. A host
answers both before fetching your code, so a plugin that cannot work somewhere is refused
cleanly rather than loaded and found wanting.

If you accept or produce MIDI you **must** declare `trn:requires jig:MidiEvents`. The Web
Audio graph carries no MIDI, so it is a host service; without the declaration your MIDI
silently goes nowhere. The shapes enforce this.

## 2. The processor

One JavaScript module calling `registerProcessor`. This is the only code of yours on the
audio thread, and the real-time rules are absolute there.

```js
class CascadeProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors () {
    return [{ name: 'mix', defaultValue: 0.3, minValue: 0, maxValue: 1 }]
  }

  constructor (options) {
    super(options)
    this.ready = false
    this.port.onmessage = event => {
      if (event.data?.type !== 'init') return
      try {
        // Bytes, compiled here. A compiled Module cannot be posted into a
        // worklet at all: it is silently never delivered.
        const module = new WebAssembly.Module(event.data.module)
        const instance = new WebAssembly.Instance(module, {})
        instance.exports.jig_init(event.data.sampleRate)
        // Every view and buffer exists before ready is posted.
        this.out = new Float32Array(instance.exports.memory.buffer,
                                    instance.exports.jig_output_ptr(0), 128)
        this.exports = instance.exports
        this.ready = true
        this.port.postMessage({ type: 'ready', latencyFrames: 0 })
      } catch (error) {
        // Reported, not thrown: the rest of the graph keeps playing.
        this.port.postMessage({ type: 'error', phase: 'instantiate',
                                fatal: true, message: String(error.message) })
      }
    }
  }

  process (inputs, outputs, parameters) {
    if (!this.ready) { outputs[0].forEach(c => c.fill(0)); return true }
    // ... copy in, set parameters that changed, call jig_process, copy out
    return true
  }
}

registerProcessor('cascade', CascadeProcessor)
```

> **Inside `process()`: no allocation of any kind**, no array, object, closure or string; no
> `WebAssembly.Memory.grow()`, which detaches every view you hold and turns your output
> silent with no exception; no storage, no network, no unbounded logging, no lock; and never
> throw.
>
> Allocate everything before you post `ready`. A processor that is not ready outputs silence
> and is not audible.

### Things worth knowing

- Write *every* frame of every output you declared, zeroes included. An untouched buffer is
  not specified to be silent.
- A disconnected input arrives as an empty array. That is silence, not an error.
- `parameters[name]` has length 1 when the value is constant across the quantum and 128 when
  it is not. Handle both.
- Derive musical timing from the beat position the host sends, never by counting `process()`
  calls. Counting desynchronises the moment the transport is repositioned or looped.
- `performance` does not exist in an `AudioWorkletGlobalScope`.

## 3. The WebAssembly

Any language that targets `wasm32`. Every plugin in this repository is Rust, `no_std` with
no allocator at all, so nothing can allocate on the audio thread even by accident. Pulse is
3 KB and avoids transcendental functions entirely: pitch comes from a twelve entry semitone
table and an octave shift rather than `powf`.

```rust
#[no_mangle] pub extern "C" fn jig_init(sample_rate: f32) { /* ... */ }
#[no_mangle] pub extern "C" fn jig_output_ptr(channel: u32) -> *mut f32 { /* ... */ }
#[no_mangle] pub extern "C" fn jig_set_param(index: u32, value: f32) { /* ... */ }
#[no_mangle] pub extern "C" fn jig_process(frames: u32) { /* ... */ }
```

That ABI is a convention between your module and your processor, not part of the host
contract. The host only knows your processor module. Use whatever shape suits you.

**You do not have to build a module of your own.** `plugins/_jsfx-runtime/` is a WebAssembly
interpreter for a restricted subset of the EEL2 language REAPER JSFX effects are written in.
`bin/jsfx-import.js yourplugin.jsfx a-name` parses the effect's sliders and script, compiles
the script to the bytecode that interpreter runs, and writes the profile around a copy of
it. See `plugins/_jsfx-runtime/README.md` for what the subset does and does not cover.

## 4. Digests

Every resource needs a `jig:integrity` digest, and a host will refuse your plugin without
one. **Generate them; never write one by hand.** A hand-written digest goes stale on the
next build, silently, and the symptom is a plugin nobody can load.

```sh
printf 'sha384-%s\n' "$(openssl dgst -sha384 -binary cascade.wasm | openssl base64 -A)"
```

Better, generate the whole profile from a template as part of your build, so it always
describes the artefacts that exist. That is what
[bin/write-profile.js](https://github.com/danja/jigdaw/blob/main/bin/write-profile.js) does
here, and a test fails if a profile drifts from its files.

## 5. Publishing

Put the files in one directory and serve it. The directory *is* the plugin.

| Requirement | Why |
|---|---|
| `Access-Control-Allow-Origin` on everything | Not optional. `addModule()` fetches cross-origin in CORS mode, so a response without it is unreadable rather than merely untrusted. Exactly one such header; two and browsers reject it. |
| `Cross-Origin-Resource-Policy: cross-origin` | So a host that opts into cross-origin isolation can still load you. |
| `application/wasm` and `text/javascript` | Streaming compilation refuses anything else. |
| Content negotiation on the directory IRI | Turtle to a machine, a page to a person, HTML by default. |
| `https` | Except on loopback, which browsers already treat as a secure context, so you can develop without deploying. |

A static host works if it can do the above. If you cannot negotiate content, serve the
profile at `profile.ttl` and point people at that; it is less elegant and it works.

### Sending it to somebody

Publishing needs a server, which is not always what you have and never what a recipient
has. A **bundle** is the same plugin as a file, carrying the same IRI and the same digests.
`node bin/bundle.js yourplugin/` writes both forms:

| Form | What it is for |
|---|---|
| `yourplugin.ttl` | A profile with every file inlined as a `data:` URI. One file to send, and it is an ordinary profile, so any host already loads it with no special handling. About a third larger than the files it carries. |
| `yourplugin.jig` | A zip with `profile.ttl` at the root. Keeps the bytes as bytes, so it compresses and streams, and unpacking it into a web root gives a working plugin origin. |

Both are only as complete as your profile. **Declare every file your plugin fetches**, as
`jig:module`, `jig:processor`, `jig:ui` or `jig:asset`; a processor that fetches something
the profile does not name cannot be bundled, and the bundler refuses rather than making one
that fails on the other machine. It also checks every declared digest against the file
beside it, so a stale profile is caught here rather than by whoever you sent it to.

A bundle is tamper evident but not signed: the digests prove the files are the ones the
profile names, and nothing yet proves who wrote the profile. Opening one runs their code.

### Being found

Listing is separate from publishing: your plugin works the moment it is fetchable. To be
findable, add it to [plugin-universe](https://plugin-universe.com/about/profiles), which
indexes profiles in this format and holds several hundred already.

## Checklist

- The profile validates against the shapes.
- Every digest matches the file on disk, and is generated by your build.
- Every port has a symbol, a name and a range, and the default is inside it.
- You declare `jig:MidiEvents` if you touch MIDI.
- `process()` allocates nothing and never throws.
- You write every output channel every quantum.
- CORS headers are present, and there is exactly one of each.
- Loading it in a host actually makes the sound you expect.

## Plugins you can read

[Cascade](../plugins/cascade/) and [Pulse](../plugins/pulse/) are complete and small:
[the reverb](https://github.com/danja/jigdaw/tree/main/plugins/cascade) is about 250 lines
of Rust and 150 of JavaScript, and
[the synth](https://github.com/danja/jigdaw/tree/main/plugins/pulse) is a little less.
[Dynamix](https://github.com/danja/jigdaw/tree/main/plugins/dynamix) is a longer worked
example, a three-stage dynamics processor with a side chain input. The three plugins under
[plugins/jsfx-\*](https://github.com/danja/jigdaw/tree/main/plugins) show the conversion
path instead of a hand-written module.

---

[Back to the documentation index](index.md) &middot;
[Writing a host instead](for-hosts.md)
