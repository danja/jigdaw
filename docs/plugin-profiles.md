# JigDAW plugin profiles

A plugin profile is a machine-readable description of a plugin: what it is, what it does
musically, and what a browser needs in order to run it.

JigDAW does not invent this format. It extends one that is already published and already in
use, at [plugin-universe.com/about/profiles](https://plugin-universe.com/about/profiles),
over a catalogue of 758 plugins. A profile written for that catalogue stays valid here. A
profile written for JigDAW is also a valid catalogue entry. There is one format, and JigDAW
adds the part about running in a browser.

The vocabulary is `vocabs/jigdaw.ttl`. The rules are `vocabs/shapes.ttl`. The behaviour a
profile promises is specified in [host-plugin-contract.md](host-plugin-contract.md).

---

## The idea

A plugin is a URL. Dereference it and you get its profile. The profile says what the plugin
is and links to the code. There is no registry, no identifier scheme, and no install step
distinct from having fetched it.

This makes three things one thing: the plugin's identity, its metadata, and its delivery. A
plugin author publishes by publishing.

## Three layers

A profile is written in three vocabularies, and it matters which statement belongs to which.

**What the plugin is, musically.** The transmissions vocabulary, `trn:`, used unchanged:
`trn:PluginProfile`, the role taxonomy, the signal types, and the routing properties
`trn:accepts`, `trn:produces`, `trn:requires`, `trn:recommendedBefore`,
`trn:recommendedAfter`, `trn:companion`. Defined in
`/home/danny/github/transmission/vocabs/profile.ttl` and published at
[plugin-universe.com/ns](https://plugin-universe.com/ns).

**What it takes to run it in a browser.** The JigDAW vocabulary, `jig:`: the WebAssembly
module, the AudioWorklet processor, the user interface, integrity digests, host
capabilities, and the audio and parameter port shape.

**Its parameters.** LV2, `lv2:` and `units:`, exactly as valis declares them. No bespoke
terms, which is why an LV2 plugin's existing port descriptions map in without translation.

A term general enough to belong to `trn:` is proposed upstream to the transmission
repository rather than redefined in `jig:`. That rule comes from plugin-universe and it is
what keeps four projects speaking one language.

## The subject is an IRI you control

The subject of a profile is normally the plugin's homepage:

```turtle
<https://example.org/plugins/cascade/>
    a jig:WebPlugin , trn:PluginProfile ;
    rdfs:label "Cascade" ;
    foaf:homepage <https://example.org/plugins/cascade/> .
```

This is the convention the published spec already uses, and it is precisely what JigDAW
needs: an IRI the author controls, that resolves, and that can be fetched. If you prefer
your own namespace, use it, and keep the `foaf:homepage` statement so the two can be joined
up.

## `jig:WebPlugin` is a subclass, not a replacement

A JigDAW-loadable plugin declares itself both `trn:PluginProfile` and `jig:WebPlugin`.

The subclass matters. `vocabs/shapes.ttl` targets `jig:WebPlugin` and never
`trn:PluginProfile`, so the 758 profiles already published are untouched by JigDAW's rules.
An existing profile becomes loadable by adding statements, never by being rewritten, and a
profile that describes a native-only plugin stays valid and stays findable. It is simply
not installable here.

That claim is checked rather than asserted: a live profile fetched from
`plugin-universe.com` validates clean against `vocabs/shapes.ttl`.

## Content negotiation

A plugin IRI serves Turtle to `Accept: text/turtle`, JSON-LD to
`Accept: application/ld+json`, and a human-readable page by default. JigDAW hosts send
`Accept: text/turtle, application/ld+json;q=0.9`.

A `.ttl` file served as `text/plain`, which is what most static hosts and GitHub's raw view
return, is read as a profile. The syntax is determined by looking at the content, not by
trusting the media type.

**CORS is not optional.** The profile and every resource it names must be served with
`Access-Control-Allow-Origin`. `AudioWorklet.addModule()` fetches cross-origin in CORS
mode, so a response without the header is not merely untrusted, it is unreadable. This is
the one hosting requirement JigDAW cannot relax, and section 1.3 of the contract explains
why.

## Resources are named, never blank

Each fetchable file gets its own IRI, skolemised as a fragment of the profile's:

```turtle
<#processor>
    a jig:Processor ;
    jig:location <cascade-processor.js> ;
    jig:mediaType "text/javascript" ;
    jig:registeredName "cascade" ;
    jig:integrity "sha384-ggOyR3iMd5o6dRsuOBsWl2VgVBq1TVwNNNXlKOJ6rPGxwsMiBfPGZBpQXKDzHGfz" .
```

Blank nodes are not used for anything addressable. The rationale is taken from downspout's
sample descriptor specification, and is worth repeating because the shortcut is tempting:
blank nodes are not diffable in version control, they duplicate rather than replace
themselves when a document is re-ingested into a triplestore, and they make queries over a
corpus needlessly awkward. Skolemising costs nothing and removes all three problems.

`jig:integrity` is required on every resource. A profile without it is invalid and is
refused. The profile and the code it names need not come from the same origin, and an
unverified profile is an instruction to execute whatever currently sits at a URL.

## Set an explicit `@base`

Write `@base` at the top of the file rather than relying on the document's own URL. A
profile then means the same thing wherever it is read from, including from a file on disk
during development, and `jig:location` stays readable as a relative path.

Without it, a profile whose subject is `.../cascade/` but which is served at
`.../cascade/profile.ttl` resolves `<#processor>` against the wrong base, and every
resource IRI is quietly one directory off.

## Capabilities, not assumptions

A plugin says what it needs with `trn:requires` and what it can use but does without with
`jig:prefers`. The host answers before fetching any code.

`jig:SharedMemory` is the one to think about. `SharedArrayBuffer` needs the page to be
cross-origin isolated, which forces every cross-origin subresource anywhere to opt in with
`Cross-Origin-Resource-Policy`. Requiring it would mean a plugin author publishes by
publishing and then discovers publishing was not enough. Prefer it; do not require it.

A plugin that speaks MIDI must declare `trn:requires jig:MidiEvents`. The Web Audio graph
carries audio and nothing else, so MIDI is a host service over a message port rather than a
property of an audio connection. `vocabs/shapes.ttl` enforces this, because the failure is
otherwise silent: the plugin loads, runs, and its MIDI goes nowhere.

## Parameters are declared once

A parameter is an `lv2:port` on the profile. From that single declaration the host derives
both the processor's `parameterDescriptors` and the control drawn on the panel. They cannot
disagree, because there is nothing for them to disagree about.

The widget follows the shape of the declaration and is never named by the author:

| Declaration | Control |
|---|---|
| `lv2:portProperty lv2:toggled`, or an enumeration with two scale points | two-position switch |
| an enumeration with more scale points | selector, every option named |
| anything else | dial |

An author who wants a switch declares a switch's shape. This rule comes from valis, where
no view is permitted to test `toggled` itself. A widget name in a profile would be a second
source of truth about a port that the port already describes, and the two drift.

A plugin with no `jig:ui` gets a generated panel from these declarations. That is the
expected case rather than a degraded one: it is consistent with every other plugin, it is
accessible, and it costs the author nothing.

## Discovered and curated

JigDAW keeps two kinds of knowledge about a plugin, and inherits the distinction from
transmission:

- **Curated**, the profile: what the plugin is for, what its signals mean, what it pairs
  with, what to watch out for.
- **Discovered**, a `jig:Inspection`: what a host observed when it actually loaded the
  module, including failures.

Discovery is authoritative for technical facts. The profile is authoritative for
behavioural meaning. The distinction earns its keep, and transmission's example is the one
to remember: DrumGen's two audio output channels are intentionally silent compatibility
outputs, while its meaningful output is MIDI. No amount of inspecting the binary tells you
that, and no amount of curation tells you the real port count of a module that has been
rebuilt.

Load failures are recorded too. Which plugins work in which browsers is a fact about the
ecosystem, and it is discoverable only if unsuccessful loads are written down.

## Getting one

The quickest route is to copy `examples/cascade-profile.ttl` and edit it. It is a complete
profile exercising most of the vocabulary, and it validates.

`examples/counterexample-profile.ttl` is the opposite: a profile in which every constraint
is violated once. It exists so the shapes are known to fire. A shape that has never
rejected anything is indistinguishable from one that does not run, and two of these did not
run until that file was written.

## Validating

```sh
rapper -i turtle -c yourplugin/profile.ttl        # syntax
npm run validate -- yourplugin/profile.ttl        # shapes
```

Validation is a gate, not a diagnostic. A profile that does not validate is not written to
the store, because JigDAW ingests profiles from origins it does not control.
