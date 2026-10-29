# Jig profiles

A Jig is a plugin conforming to the JigDAW specification.

A plugin profile is a machine-readable description of a plugin: what it is, what it does
musically, and what a browser needs in order to run it.

JigDAW does not invent this format. It extends one that is already published and already in
use, at [plugin-universe.com/about/profiles](https://plugin-universe.com/about/profiles),
over a catalogue of hundreds of plugins. A profile written for that catalogue stays valid here. A
profile written for a Jig is also a valid catalogue entry. There is one format, and JigDAW
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
`~/github/transmission/vocabs/profile.ttl` and published at
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

## Who wrote it

`trn:vendor` is a plain string, a display name a catalogue shows beside a plugin. It is not
an identity: nothing can be checked against a string, and two authors can share one.

`doap:developer` is the IRI to use when that matters, reusing DOAP the way LV2 itself
describes a plugin project rather than minting a `jig:` term:

```turtle
<https://example.org/plugins/cascade/>
    trn:vendor "Example Author" ;
    doap:developer <https://example.org/people/author> ;
    doap:revision "1.0.0" .
```

Both are optional, and `doap:developer` is checked only for shape when present
(`sh:nodeKind sh:IRI`), never dereferenced by a host. It exists so that a tool with a reason
to follow authorship, rather than merely display it, has an IRI to follow.

This lives on the profile itself, whether the plugin is served from its own canonical origin
or found some other way, because it answers "who wrote this plugin", not "who copied this
file". [plugin-bundles.md](plugin-bundles.md) section 5 covers the second question, which
only a bundle or a mirror needs to answer: nothing is copied when a profile is served from
the origin that minted its IRI, so nothing there says who wrote it, and a `doap:developer`
statement is where that answer belongs instead.

`doap:revision`, `major.minor.patch`, is also undeclared here for the same reason: optional
on a plugin served from one IRI, which can be versionless, and required by anything that
packages the plugin for a format that demands one, such as `bin/wam.js`.

## `jig:WebPlugin` is a subclass, not a replacement

A Jig declares itself both `trn:PluginProfile` and `jig:WebPlugin`.

The subclass matters. `vocabs/shapes.ttl` targets `jig:WebPlugin` and never
`trn:PluginProfile`, so the profiles already published there are untouched by JigDAW's rules.
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

A `file:` URL is read the same way by a host that has a filesystem, and one naming a
directory reads `profile.ttl` inside it, because an http plugin IRI ends in a slash and
serves the profile by content negotiation while a filesystem has no such thing. That is what
makes the `@base` rule below usable: a profile read from a checkout during development means
what it means when it is published. A browser host cannot do this, and does not need to.

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

## A pad for two controls

**A plugin can offer a square pad that sets two of its controls at once.** Someone who drags across it moves one control with the
left to right position and the other with the bottom to top position, which is how a player thinks about "simpler or busier, steadier
or more varied" and not how a row of knobs asks for it. It is a shortcut: both controls stay on the panel, so a keyboard and a screen
reader use those, and a host that does not draw pads loses nothing.

A pad is a resource of type `jig:ControlPad` with a name and two ports of the same profile:

```turtle
<> jig:pad <#feel> .

<#feel>
    a jig:ControlPad ;
    rdfs:label "Feel" ;
    jig:padX <#density> ;
    jig:padY <#variation> .
```

- `jig:padX` is set by the pointer's left to right position, its minimum at the left edge and its maximum at the right. `jig:padY` is
  set bottom to top, its minimum at the bottom. The mapping is linear across each port's own range.
- Both must be continuous controls, drawn as dials. A switch or a selector has no range to drag across, and the profile is refused
  naming the pad. The two must be different ports, and each must be declared in this profile with a symbol.
- Under the pad, in words, the panel says which control is across and which is up, so the pad is never explained by position alone.
- The puck follows the two controls, whatever moves them: a knob, a preset, automation, an agent.
- A pad may carry a word for each end of each axis, `jig:padXLow`, `jig:padXHigh`, `jig:padYLow` and `jig:padYHigh`, each one short string
  of at most 24 characters ("simple", "busy"). They are drawn at the ends of the axes inside the square and said in the caption, which then
  reads "Across is Density, from simple to busy". Each is optional, and an axis with one end named says only that one.
- A pad may name a selector with `jig:padChoice`: a style or a genre to choose before playing across it. The panel draws that port's own
  control beside the pad and not in the grid, so it is one control with one name and not a copy. It must be a selector (an enumeration), and not
  one of the pad's axes. Under a plugin skin, which draws its own controls, the choice stays where the skin puts it.
- A plugin may have several pads. DrumGen, BassGen and MelGen each offer one called Feel: density across, and variation, hold or leap up, with
  the genre (or, for MelGen, the scale) beside it.

Nine terms are ours, in the vocabulary first: `jig:ControlPad`, `jig:pad`, `jig:padX`, `jig:padY`, the four end labels and `jig:padChoice`. Nothing in LV2 describes a pad
(its port groups combine ports that carry one stream, and say nothing about layout).

## What a control does

**A port can say in one sentence what its control does, and the panel shows it when the control is hovered or focused.** Give the
port an `rdfs:comment`, a single string of at most 240 characters. The shape rejects two of them and a longer one, because the
panel has one line for it.

```turtle
<#cutoff>
    a lv2:InputPort , lv2:ControlPort ;
    lv2:symbol "cutoff" ; lv2:name "Cutoff" ;
    lv2:default 6000 ; lv2:minimum 100 ; lv2:maximum 18000 ;
    rdfs:comment "A lowpass filter, so lower is darker and duller and higher is brighter." .
```

- The sentence appears in one line under the plugin's heading, after the control's name in bold, while the pointer is over the control
  or the control has the focus. A keyboard and a touch get exactly what a pointer gets. Escape puts it away and moves nothing.
- The same sentence is the control's description, which a screen reader reads after the value when the control takes the focus.
  The line itself is hidden from a screen reader so it is not said twice.
- A port with no comment gets nothing, and a plugin with no comments gets no help line at all. Say what the control does to the
  sound, in words a player uses, and leave out what its name already says ("Gain: how loud the synth is" is worth writing;
  "Gain: the gain" is not).
- Pulse and DrumKit were the first worked examples. BassGen, DrumGen, MelGen, Moka, Monochord, Canticle and Mop now rank and explain their main controls too, each sentence taken from what the plugin's own source does, and a test over every profile in the repository checks that a ranked control has a sentence, that a ranking puts something away and keeps to a few, and that each sentence is finished.

## Which controls come first

**A plugin with many parameters can say which few matter most, and the generated panel shows those first.** Give a port
`pprops:displayPriority`, a nonnegative integer from [LV2's port properties extension](https://drobilla.net/files/lv2_docs/ns/ext/port-props.html),
where a higher number means the control matters more for playing the plugin. No term of ours is involved.

```turtle
@prefix pprops: <http://lv2plug.in/ns/ext/port-props#> .

<#master_gain>
    a lv2:InputPort , lv2:ControlPort ;
    lv2:symbol "master_gain" ; lv2:name "Master Gain" ;
    lv2:default 0.8 ; lv2:minimum 0 ; lv2:maximum 1 ;
    pprops:displayPriority 100 .
```

What the host does with it, in Jiggy:

- The ports that have a priority are drawn first, highest first. Ports of equal priority keep the order the profile gives them.
- The other ports are drawn under a disclosure called "More controls", with a count. They are all there, every one still has a
  label, and a person, a keyboard or an agent can reach any of them. A priority hides nothing from anything but the first look.
- A profile that gives no port a priority is drawn whole, as it always was. So is one that gives every port a priority, since
  there is nothing to put away.
- Groups (`jig:controlGroup`) apply inside the disclosure. The first view is one flat grid in priority order with no group headings,
  since a heading over a single knob is no help; name the voice in the control's own name, as DrumKit does ("Kick Level").
- A priority is only compared with the priorities in the same plugin. A priority below zero, or one that is not a whole number,
  makes the profile invalid.

It is a hint. A host with room for every control, or one that draws the plugin's own interface, is free to ignore it. DrumKit is the
worked example: of its 75 ports it ranks the three master controls and each voice's level (14 in all), and the other 61 are under
"More controls". Choose the few a person reaches for when they first play the plugin, not the ones you built it around.

## A frequency or a time is drawn on a log scale

**A port that spans a ratio, such as 20 to 20000 Hz, can say so, and the generated panel's knob then turns evenly in ratio.** Give
the port `lv2:portProperty pprops:logarithmic`, from [LV2's port properties extension](https://drobilla.net/files/lv2_docs/ns/ext/port-props.html).
No term of ours is involved.

```turtle
<#cutoff>
    a lv2:InputPort , lv2:ControlPort ;
    lv2:symbol "cutoff" ; lv2:name "Cutoff" ;
    lv2:default 1000 ; lv2:minimum 20 ; lv2:maximum 20000 ;
    units:unit units:hz ;
    lv2:portProperty pprops:logarithmic .
```

- The knob's middle is the geometric middle of the range (632 Hz for 20 to 20000), and an arrow key or a drag changes the value by the
  same ratio at the bottom as at the top. On a linear knob the whole range below 1 kHz is a few degrees of turn.
- The values the plugin receives, the readout, the saved session and automation are unchanged: they are the port's own values.
  Only the position of the knob and the size of a step differ.
- The minimum must be above zero, since a logarithmic scale has no zero. A profile that marks a port logarithmic with a minimum of zero
  or below is invalid, and the shape and the reader both refuse it.
- It is a hint for the generated panel's knob. An HTML skin, an SVG skin or a plugin's own editor draws its own control and is free to
  ignore it. Octet and Quartet mark their frequency ports.

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

## A plugin made of plugins

A profile can describe a plugin that is made of others instead of one that has code of its own: a guitar rack of three pedals, with the few
controls worth exposing. It is a `jig:CompositePlugin`, and it lists its members by IRI, the wiring between them, and the parameters it
offers, each saying which member parameter it moves. It is a plugin like any other: it has an IRI, it is fetched by it, a collection lists it,
a bundle carries it and a signature covers it. It declares no module or processor, so it is deliberately not a `jig:WebPlugin`. The
full description, with an example that is checked against the shapes, is [nested-plugins.md](nested-plugins.md).

## Getting one

The quickest route is to copy `examples/reference-profile.ttl` and edit it. It is a complete
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

## Sending one to somebody

A profile and the files it names make a plugin, and a plugin is normally reached by
dereferencing its IRI. [plugin-bundles.md](plugin-bundles.md) defines the two ways to hand the
same plugin over as a file instead, for archiving, mirroring, offline installation, or simply
sending it to a person: a flattened profile, which inlines every resource and which any host
already reads, and a `.jig` archive, which unpacks into a working plugin origin.

Both depend on the profile naming every file the plugin uses. **A plugin that fetches a
resource its profile does not declare cannot be bundled**, and `bin/bundle.js` refuses rather
than making one that will fail on the machine it is sent to.
