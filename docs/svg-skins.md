# SVG skins

**Status:** draft. Implemented in Jiggy for rotary, linear and readout controls and seen working
in Chrome; toggle and selector controls are tested only without a browser. The requirement it
adds to the contract is [host-plugin-contract.md](host-plugin-contract.md) section 9.4.

A skin is a plugin interface made of data: a picture in SVG and a Turtle file saying which
part of the picture sets which port. It has no code, so a host can draw it in its own
document, which a plugin interface otherwise may not be. It is a better-looking panel, not a
replacement for the editor a plugin may also have.

| The plugin declares | The host shows |
|---|---|
| `jig:skin` | The panel is the author's artwork, drawn and operated by the host. Ports it does not bind follow, generated |
| no skin, or a skin that fails | The panel is generated from the port declarations |
| `jig:ui`, as well as either | An editor beside the panel: the author's page, in a sandboxed frame on another origin |

The panel is always there and always accessible, so a `jig:ui` never has to be. A skin that is
refused or fails to load leaves the generated panel, and the editor, where there is one, is
unaffected.

## Three files and one arc

The skin is a sidecar. The profile holds one pointer and learns nothing else about it.

```
profile.ttl ──jig:skin──▶ skin.ttl ──jig:artwork──▶ panel.svg
                              │
                              └─ jig:boundSymbol "rate"   (a name, not a reference)
```

| File | Knows about | Does not know about |
|---|---|---|
| `profile.ttl` | That a skin exists, and the two files it ships, with their digests | What the artwork is for, the bindings, any element id |
| `skin.ttl` | Port symbols, element ids, the behaviour of each control | The processor, the module, the profile's other terms |
| `panel.svg` | Nothing outside itself | JigDAW |

So a designer can redraw `panel.svg` without touching a binding that still names the same
ids. A port can gain a unit in the profile without the skin changing. The processor and the
module are never in the picture at all. Each of the three has its own `jig:integrity` digest.
Redrawing the artwork changes the artwork's digest, the skin's, which carries it, and the profile's,
which lists both (see "The profile side").

The binding names a port by its `lv2:symbol` rather than its IRI. The symbol is what the wire
format already uses ([messaging.md](messaging.md)), and the profile's port IRIs are fragments
of an IRI that moves with the plugin.

## The profile side

```turtle
<> jig:skin <#skin> .

<#skin>
    a jig:Skin ;
    jig:location <skin.ttl> ;
    jig:mediaType "text/turtle" ;
    jig:integrity "sha384-..." .
```

At most one skin per plugin. A composite has none.

The profile also lists the skin document and the artwork as `jig:asset`s. That is what the term
is for: a bundle, a verifier and an offline copy know a plugin is complete by walking the
asset list, and the artwork is named only inside `skin.ttl`, where none of them look. It is the
one place the profile mentions the artwork, as a file the plugin ships and not as one that has a
role, so redrawing the artwork changes the artwork's digest, the skin's (which carries it) and
the profile's (which lists both).

A flattened bundle carries both files as `data:` locations in the profile. The skin document
still names its artwork by the absolute IRI its `@base` gives, so a flat copy reads the skin
from the file and fetches the artwork from that IRI, verified against the digest as always.

## The skin document

Its subject is its own IRI. It names the artwork and lists the controls.

```turtle
@base <https://example.org/jigdaw/plugins/tremolo/skin.ttl> .

<>
    jig:artwork <#art> ;
    jig:control <#rate>, <#depth> .

<#art>
    a jig:Artwork ;
    jig:location <panel.svg> ;
    jig:mediaType "image/svg+xml" ;
    jig:integrity "sha384-..." .

<#rate>
    a jig:RotaryControl ;
    jig:boundSymbol "rate" ;
    jig:element "rate-knob" ;
    jig:pivotElement "rate-hub" ;
    jig:angleMin -135 ; jig:angleMax 135 .

<#depth>
    a jig:LinearControl ;
    jig:boundSymbol "depth" ;
    jig:element "depth-thumb" ;
    jig:trackElement "depth-slot" .
```

Controls are named resources, never blank nodes, like everything else addressable.

## What a control does

Every control binds one port to one element of the artwork. The behaviour comes from the
class, and the host does all of it.

| Class | The host moves the element by | Role |
|---|---|---|
| `jig:RotaryControl` | Turning it about the centre of `jig:pivotElement` (default: its own centre), measured as drawn and before any turn, from `jig:angleMin` at the port minimum to `jig:angleMax` at the maximum, in degrees clockwise | `slider` |
| `jig:LinearControl` | Sliding it along the longer side of the bounding box of `jig:trackElement`. It is drawn at the low end, and the host moves it by the track's length for the full range | `slider` |
| `jig:ToggleControl` | Drawing the first child group when the port is off and the second when it is on | `switch` |
| `jig:SelectorControl` | Drawing only the child group for the current step of an enumerated or integer port | `slider`, with the step's label as its value text |
| `jig:ReadoutControl` | Setting the content of an SVG `text` element to the value and unit | none: the text is hidden from assistive technology, because the control beside it already reports its value |

Values map the way the generated panel maps them: linearly between the port's minimum and
maximum, and by scale point for a selector. `jig:hitElement` names the element that takes the pointer where
that is not the moving element, as for a small thumb on a long slot. The host pads the target
to 44 CSS pixels either way.

## What the host adds

The artwork supplies pixels. The host supplies everything a person or a tool relies on:

- **Name and value.** The accessible name is the port's `lv2:name`. The value text is the
  value with its unit, such as "5 Hz", not "5". A name written inside the SVG is ignored.
- **Tab order.** Rows from the top of the picture, and left to right along a row, whatever order
  the skin document lists the controls in, since a set of triples has no order (WCAG 2.4.3).
- **Keyboard before pointer.** Arrow keys, Home, End and Page keys on a slider, Space on a
  switch, all of them the platform's own, because the host lays a native `input` over each hit
  area, invisible but focusable, as `src/ui/Dial.js` does. All with a visible focus indicator drawn around the
  hit area, which the artwork cannot remove.
- **Pointer.** A drag that continues outside the element and ends on release wherever it
  occurs, as the generated dial does.
- **Operations.** Each gesture issues the same operation the generated panel does, so undo,
  automation recording and the WebMCP surface see a skin and a generated panel identically
  (contract section 9.3).
- **Echo.** The control is drawn from the value the host applied, never from the pointer's own
  position (messaging.md section 2.3).
- **Size.** The `viewBox` width is the artwork's natural size in CSS pixels. It shrinks to fit a narrow
  panel and is never drawn larger than that.
- **A phone.** The artwork scales with its `viewBox` to the width available. A target smaller
  than 44 CSS pixels at that scale is padded to 44. Where two padded targets would cover more
  than a quarter of the smaller one, a tap would often land on the wrong control, so the host
  puts the drawing away and draws every port as a generated control instead, and draws the
  skin again when the width allows. It works this out from the sizes in the drawing's own units
  and the width it is given, so it holds while the drawing is put away. A skin is not invalid
  for being dense: Parameq's six bands are comfortable from about 520 pixels up and fall back
  below that, where Tremolo, Cascade and Boost keep their skins down to 240.

## Ports the skin does not bind

A port has at most one control that sets it, plus any number of readouts, which only show the value and do not make the port reachable. A skin may show a subset of the ports, and it may not make a port unreachable. The host draws
every unbound port as the generated panel would, in a group after the artwork. This is also
the answer when a profile gains a port the skin has not heard of.

The reverse also holds. A binding whose port symbol is not declared by the profile is left out
and reported, not drawn disabled: a control nobody can use is not shown.

## What the artwork may contain

The host never inserts the file. It parses it as `image/svg+xml` and builds new nodes from an
allowlist, so the file is read rather than adopted.

| Allowed | Notes |
|---|---|
| `svg`, `g`, `defs`, `title`, `desc` | `title` and `desc` are kept for the picture and never used as the control's name |
| `path`, `rect`, `circle`, `ellipse`, `line`, `polyline`, `polygon` | Geometry |
| `text`, `tspan` | Static labels and readouts |
| `linearGradient`, `radialGradient`, `stop`, `clipPath` | Paint and clipping |
| `use` | Only with an `href` that is a fragment of the same file |
| Geometry and presentation attributes, and a `style` attribute | The style attribute is parsed property by property. `url()` is accepted only as `url(#id)` |

Refused, and the whole skin with it: any element in the SVG namespace not listed (`script`,
`foreignObject`, `image`, `style`, `filter`, `a`, `animate`, `set` and the rest), any `on*`
attribute, and any `href` or `url()` that leaves the file. Elements and attributes in other
namespaces, which is how Inkscape stores its editor data, are dropped silently, since they
cannot do anything. Limits apply as well: 512 KiB and 5000 elements, which a host may raise.

On insertion the host prefixes every `id` and rewrites the same-file references that name
it, so two skins on one page, or a skin and the host's own ids, cannot collide. The ids in
`skin.ttl` are the author's; the ids in the document are not.

## Validation

`vocabs/shapes.ttl` checks the skin document on its own: one artwork, at least one control,
and the properties each class needs. Two checks cross files and so cannot be shapes:

1. Every `jig:element`, `jig:hitElement`, `jig:pivotElement` and `jig:trackElement` exists in
   the artwork.
2. Every `jig:boundSymbol` is a port the plugin declares, no port has two controls that set it, and a
   `jig:SelectorControl` or `jig:ToggleControl` has as many child groups as its port has steps.

The first is a host check at load, which reports each missing id by name. Both are also run
over every skin in `plugins/` by `npm run check:skins`, in a real Chrome, because the artwork and
the bindings are two files that must agree and nothing else connects them. The same command
feeds the builder hostile artwork through the browser's own XML parser.

## Not in this version

- **Meters.** A meter binds a signal, not a port, and the host's meter feed is not yet a
  named thing a skin can point at. This waits for that.
- **Layouts for narrow and wide screens.** One `viewBox` first. Two artworks selected by width
  is the obvious extension, and the `jig:skin` arc would not change.
- **Curves, XY pads, waveform displays.** They need code. They are what `jig:ui` is for.
- **Animation.** None. Controls move because the host sets an attribute.
- **Theming.** A skin is drawn as authored. A host that wants dark mode draws a different
  skin, or none.

## Why not RDFa in the SVG

An SVG could carry its own bindings as attributes. That would tie the picture to JigDAW, put
the binding in a file a drawing program rewrites, and make the SVG the thing a digest on the
profile has to track. A separate Turtle file keeps the artwork ordinary, and keeps the
anchoring in RDF where the rest of the plugin is.
