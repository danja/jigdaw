# How a plugin gets its interface

**Rust writes the sound and takes no part in the interface.** A Jig's panel is built by the host, in
JavaScript, from the plugin's profile and, optionally, a skin. This document follows that path from
the Rust crate to the pixels, and says where each piece lives. The normative text is
[host-plugin-contract.md](host-plugin-contract.md) sections 5 and 9, and
[svg-skins.md](svg-skins.md) is the skin format in full.

## Where Rust sits

Rust is one of several ways to produce the WebAssembly module that does the signal processing, and
nothing more. A plugin crate such as `plugins/pulse/` or `plugins/cascade/` compiles to
`wasm32-unknown-unknown` as a `cdylib`, `no_std`, with no allocator, and exports a small C ABI
([module-abi.md](module-abi.md)):

```rust
#[no_mangle] pub extern "C" fn jig_init(sample_rate: f32) { /* ... */ }
#[no_mangle] pub extern "C" fn jig_set_param(index: u32, value: f32) { /* ... */ }
#[no_mangle] pub extern "C" fn jig_process(frames: u32) { /* ... */ }
```

The only thing the module knows about the interface is `jig_set_param(index, value)`: a number
arrives for a parameter index. It does not know whether the number came from a generated dial, a
skin, a `jig:ui` page, automation, a saved session or an agent. It draws nothing, names nothing and
has no idea what a unit is.

| Layer | Language | Does | Knows about the interface |
|---|---|---|---|
| Module | Rust, C++ or hand-written wasm | DSP, in `process()` | Parameter indexes and values only |
| Processor | JavaScript, in the AudioWorklet | Wires the module to Web Audio, reads `parameters[name]` | Parameter names |
| Profile | Turtle (`profile.ttl`) | Declares every `lv2:port` | Everything: name, range, unit, scale points |
| Panel | JavaScript, on the message thread (`src/ui/`) | Draws and operates controls | Reads the profile |
| Skin | SVG and Turtle, no code | Optional artwork and bindings | Port symbols and element ids |

Not every plugin is Rust. The same list of layers applies to the C++ plugins (`boost`, `parameq`),
the JavaScript-only ones (`tremolo`, `dice`) and the JSFX conversions, which is why the interface
cannot depend on the language. Of the seven plugins that ship a skin today, `cascade` (SVG), `canticle` and `drumkit` (HTML) are Rust, and `quartet` (HTML) is C++.

The native adapter (`native/jigdaw-adapter/`) is C++, built on DPF and WAMR, and is the other place
an interface is made. It follows the same rule without sharing the code: its editor
(`src/dpf/JigdawUI.cpp`) generates a panel from the same `lv2:port` statements, because a `jig:ui`
is a web page and a native host has no engine to run it.

## One declaration, three copies

**A parameter is declared once, in the profile, and the interface is derived from it.** Contract
section 5.1 requires the host to derive both the processor's `parameterDescriptors` and the generated
control from the single `lv2:port`. For a hand-built plugin the author still has to keep three places
agreeing: the profile, the processor and the module's parameter indexes. `tests/host/*.test.js` bind
the three, and `lv2:symbol` is the name that ties them together on the wire
([messaging.md](messaging.md)).

The profile is not written by hand. Each plugin has a `profile.json`, and `build.sh` runs
`bin/write-profile.js`, which writes `profile.ttl` with the digest of every file the build produced.
For Rust that is `cargo build --release --target wasm32-unknown-unknown`, a copy of the `.wasm`, then
the profile writer. The same writer emits `skin.ttl` from the `skin` key of `profile.json`, so the
bindings and the digests cannot drift from the files on disk.

## The generated panel

**Every plugin gets a panel built from its ports, whether or not it has a skin.** Contract section 9.1
makes this the expected case. The code is `createPanel` in `src/ui/Panel.js`, and it is the
project's whole accessibility story: one accessible generator makes every plugin accessible.

The widget is chosen from the shape of the declaration, never from a name the plugin supplies
(contract section 5.3, `widgetFor` in `src/rdf/ProfileReader.js`):

| The port declares | The host draws |
|---|---|
| `lv2:toggled`, or an enumeration of exactly two scale points | A switch |
| An enumeration of more than two scale points | A selector naming every option |
| Anything else | A dial (`src/ui/Dial.js`) |

A dial is an `<input type="range">` underneath, with the knob drawn over it. That keeps the role, the
value text ("4200 Hz", not "4200"), every key and the focus order, whatever the pixels look like.
Pads (`src/ui/Pad.js`) set two ports at once as a pointer shortcut, and the two ports remain as
controls for keyboard and screen reader. A `jig:userReplaceable` text asset gets a text area
(contract section 5.5).

A change is never applied by the control. `createPanel` takes `onChange(symbol, value)` and the host
answers with the value it actually applied, which the control then draws (messaging.md section 2.3).
That round trip is why a clamped or automated value cannot leave the screen disagreeing with the
sound. The call goes to the operation dispatcher in `src/ops/`, so undo, automation recording and
the WebMCP surface see the same edit whichever surface produced it (contract section 9.3).

## Skins

**A skin replaces the look of the generated panel and keeps everything else about it.** It is two
data files and no code, so the host may draw it in its own document, which it may not do for a
`jig:ui`.

```
profile.ttl ──jig:skin──▶ skin.ttl ──jig:artwork──▶ panel.svg
                              │
                              └─ jig:boundSymbol "rate"   (a port name, not a reference)
```

`panel.svg` is ordinary artwork with ids on the parts that move, drawn at rest: a knob pointing
straight up, a thumb at the low end of its slot. `skin.ttl` says which id sets which port and how.
For example, from `plugins/tremolo/skin/skin.ttl`:

```turtle
<#rate>
    a jig:RotaryControl ;
    jig:boundSymbol "rate" ;
    jig:element "rate-knob" ;
    jig:pivotElement "rate-hub" ;
    jig:angleMin -135 ; jig:angleMax 135 .
```

There are five control classes: rotary, linear, toggle, selector and readout. The class decides
how the host moves the element (turn it about a pivot, slide it along a track, show one of two child
groups, show the group for the current step, set the text of a label).

### How the host draws one

The path from a profile to a drawn skin is split between three files, so that fetching happens once
per plugin and building once per panel:

1. **`src/host/SkinLoader.js` `loadSkin`** fetches `skin.ttl` and then the artwork through
   `fetchVerified`, which throws unless each file matches the digest the profile or skin gives. It
   parses the Turtle (`src/rdf/SkinReader.js`) and the SVG as `image/svg+xml`. A skin that fails here
   is reported and the generated panel stays.
2. **`src/ui/SkinArtwork.js` `buildArtwork`** does not insert the file. It copies the nodes an
   allowlist recognises into new nodes belonging to the host document, prefixes every `id` so two
   skins cannot collide, and refuses the whole skin on a script, `foreignObject`, event attribute,
   animation, or any reference that leaves the file. This is what makes drawing plugin-supplied
   artwork in the host document safe (contract section 9.4).
3. **`src/host/SkinLoader.js` `prepareSkin`** then runs `checkSkin`, which drops a binding to an
   element that is not in the artwork or a port the profile does not declare, and reports it by name.
   `web/app/Skins.js` keeps what has been fetched and asks for a redraw once a skin that was loading
   is ready.

`createSkinPanel` in `src/ui/SkinPanel.js` then operates it. For each control it lays an invisible
but focusable `<input>` over the element's hit area, the same trick as the generated dial, so the
artwork supplies pixels and the platform supplies the role, name, value, keys and focus. The
accessible name is the port's `lv2:name`, and a name written inside the SVG is ignored. Hit areas are
padded to 44 CSS pixels. Dragging uses `attachDrag` from the dial, so a drag that leaves the element
continues until release.

### Ports the skin does not cover, and a skin that is too small

**A skin can show some of the ports and can never make one unreachable.** `createPanel` draws the
skin first, then a generated group (`skin-others`) holding every port the skin does not bind. A port
that gains a place in the profile later appears there until the skin learns about it.

On a narrow screen the host measures the padded hit areas in the drawing's own units. If two would
overlap by more than a quarter of the smaller one, a tap would often land on the wrong control, so
the host puts the drawing away and draws a generated control for every port, and brings the drawing
back when the width allows. The decision is made from sizes, so it holds while the drawing is hidden.

### What a skin is checked against

The artwork and the bindings are two files that must agree, and nothing else connects them. Three
checks do:

- `vocabs/shapes.ttl` checks the skin document alone.
- The host checks at load that each named element id exists in the artwork and each bound symbol is a
  port the plugin declares.
- `npm run check:skins` (`bin/check-skins.js`) repeats both over every skin in `plugins/`, in a real
  Chrome, and feeds the builder hostile artwork through the browser's own XML parser. The unit tests
  cannot do this, because a DOM without a renderer accepts malformed XML a browser refuses.

### HTML skins

**A skin can also be laid out by the browser.** An HTML skin is one file of markup and a stylesheet, with no script, bound to
ports with the same `data-param` attributes the editor bridge uses ([html-skins.md](html-skins.md)). It suits a plugin whose
interface is controls and labels, and it reflows where an SVG skin has one fixed drawing: Canticle's sixteen controls go from
one column to four. The host builds it the way it builds SVG artwork, from an allowlist and never by inserting the file, and
draws it in a shadow root with `src/ui/HtmlSkinPanel.js`. Its stylesheet is parsed and rewritten, not passed through
(`src/ui/HtmlSkinCss.js`), and the host's own rules, which give every control a 44 pixel target and a focus ring, sit outside
the layer the author's are confined to, so a skin cannot remove them. `npm run check:skins` holds that in a real Chrome.

## `jig:ui`, the editor beside the panel

**A plugin's own page is offered beside the panel and never instead of it.** `jig:ui` points at a web
page, which `src/ui/PluginFrame.js` loads into an `iframe` with a `sandbox` attribute and never into
the host document. The frame keeps `allow-scripts` and `allow-same-origin` and nothing else, so every
message can be addressed to its real origin. It is given the profile and the current values and may
only `postMessage` back. It cannot see the `AudioContext`, the worklet node or the project model
(contract section 9.2), and what it asks for goes to the dispatcher like any other edit.

A page does not have to implement the message protocol by hand: `src/plugin-ui/JigUi.js` binds elements to ports
by attribute (`<input type="range" data-param="threshold">`) and does the messaging, see
[plugin-ui.md](plugin-ui.md). `dynamix` uses it for a transfer curve with a live gain reduction dot.

Five plugins declare an editor today: `conductor`, `dynamix`, `octet`, `parameq` and `tremolo`. The generated panel is
still drawn for each, so an editor a person cannot use costs them nothing.

## Choosing between them

| You want | Use | Why |
|---|---|---|
| Nothing, or to get started | Nothing | The generated panel is accessible, phone friendly and consistent |
| Your own look on dials, sliders, switches and selectors | A skin | Data only, so the host draws it with its own accessibility and can verify it |
| Curves, XY pads, waveform displays, anything that needs code | A `jig:ui`, built with the bridge ([plugin-ui.md](plugin-ui.md)) | Needs a sandbox, which is why it sits beside the panel |

Skins do not yet cover meters, since a meter binds a signal and not a port, nor separate layouts for
narrow and wide screens, animation or theming ([svg-skins.md](svg-skins.md) lists them).

## Where to read the code

| To see | Read |
|---|---|
| The ABI a Rust module exports | [module-abi.md](module-abi.md), `plugins/pulse/src/lib.rs` |
| How a Rust plugin is built and its profile written | `plugins/pulse/build.sh`, `bin/write-profile.js` |
| Port to widget | `widgetFor` in `src/rdf/ProfileReader.js`, `src/ui/Panel.js` |
| The dial and the drag | `src/ui/Dial.js` |
| Fetch and verify a skin | `src/host/SkinLoader.js`, `src/rdf/SkinReader.js` |
| An HTML skin | `src/ui/HtmlSkin.js`, `src/ui/HtmlSkinCss.js`, `src/ui/HtmlSkinPanel.js` |
| The SVG allowlist | `src/ui/SkinArtwork.js` |
| Operating a skin | `src/ui/SkinPanel.js` |
| The page's skin cache | `web/app/Skins.js` |
| A Rust plugin with an SVG skin | `plugins/cascade/skin/` |
| A Rust plugin with an HTML skin | `plugins/canticle/skin/skin.html`, `plugins/drumkit/skin/skin.html` |
| A first draft of an HTML skin | `bin/skin-from-profile.js`, then `.claude/skills/html-skin/SKILL.md` |
| The sandboxed editor | `src/ui/PluginFrame.js` |
| The page-side bridge | `src/plugin-ui/JigUi.js`, `bin/inline-ui.js` |
| The native panel | `native/jigdaw-adapter/src/dpf/JigdawUI.cpp` |
