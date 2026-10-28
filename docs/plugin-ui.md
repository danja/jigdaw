# Building a plugin editor with the bridge

**A `jig:ui` page binds to ports with attributes, and a small script does the messaging.** Without it, an
editor has to implement the whole handshake in [messaging.md](messaging.md) section 2 by hand, which is about a
hundred lines before the first slider (`plugins/tremolo/ui/index.html` is that version). With it, a slider is

```html
<input type="range" data-param="threshold">
```

and the script reads the port's range and unit from the profile, sends the gestures, and draws the value the
host sends back. The idea comes from [APF](https://github.com/mihasm/apf), a Rust plugin framework whose
editors are HTML pages bound the same way. The sandbox, the message protocol and the contract are unchanged:
this is a convenience for the author of a page, not a new kind of interface.

An editor is still optional and still sits beside the generated panel, which reaches every port
([host-plugin-contract.md](host-plugin-contract.md) section 9.1). Use it for what a skin cannot draw: curves,
displays, anything that needs code. Dynamix's editor is the worked example, a compressor transfer curve with a
live dot on it ([plugins/dynamix/ui/src.html](../plugins/dynamix/ui/src.html)).

## Attributes

| Attribute | On | Effect |
|---|---|---|
| `data-param="symbol"` | `input` range, `input` checkbox, `select` | The control follows the port, both ways. Range, step and, for a `select`, the options come from the port |
| `data-param-name="symbol"` | any | Its text becomes the port's `lv2:name` |
| `data-param-text="symbol"` | any | Its text becomes the value with its unit, as `-18 dB` |
| `data-param-help` | any | Shows what the hovered or focused control does, from the port's `rdfs:comment`. Hidden from assistive technology |

The symbol is the port's `lv2:symbol`, the same name the wire format uses. A binding to a symbol the plugin
does not declare is hidden and reported to the console, not left disabled.

What the bridge does for a bound control, so the page does not:

- A port with a comment gets it as the control's description, said on focus, whether or not the page has a help line.
  The help line follows the pointer and the focus, returns to the focused control when the pointer leaves, and Escape
  puts it away, as the generated panel's does.
- A drag is one `gesture` begin and end, and each move is a `parameter` request. A key press or a tap has no
  pointer to bracket it and is sent as one whole gesture.
- The control draws the value in the host's `parameter` reply and never the one it asked for, so a clamped or
  automated value cannot leave the page disagreeing with the sound (messaging.md section 2.3).
- The value text is set as `aria-valuetext`, in words: "-18 decibels", not "-18". A control with no label gets
  the port's name as its `aria-label`.
- The host's origin is learnt from `init` and every later message is addressed to it. A message from another
  window or origin is ignored.
- The frame asks the host for the height its content needs whenever that changes.

## Script

The script defines `jig`.

| Call | Purpose |
|---|---|
| `jig.ready` | A promise, resolved with `{ ports, parameters }` once the host has sent `init` |
| `jig.on(symbol, fn(value, text))` | Called now if the value is known and on every change. `text` is `{ text, spoken }` |
| `jig.value(symbol)` | The last value the host applied |
| `jig.begin(symbol)`, `jig.set(symbol, value)`, `jig.end(symbol)` | For a control the page draws itself, such as a point on a curve |
| `jig.change(symbol, value)` | One whole edit |
| `jig.bind(root)` | Bind `data-param*` elements the page added later |
| `jig.onPlugin(fn(payload))`, `jig.sendPlugin(payload)` | The opaque relay to and from the processor (messaging.md section 2.4) |

## Building a page

The page ships as one HTML file with its script inline, because the profile's `jig:integrity` digest covers one
file and a script fetched separately would be code the digest does not cover. So the author writes
`ui/src.html`, marks the place for the bridge with `<script data-jig-bridge></script>`, and
`bin/inline-ui.js` writes `ui/index.html`:

```sh
node bin/inline-ui.js plugins/dynamix
```

Run it in the plugin's `build.sh` before `bin/write-profile.js`, which digests the result. The generated file
says so at the top. `tests/bin/inline-ui.test.js` fails when a committed `index.html` is not what the tool makes
of its `src.html` and the current bridge, so a change to the bridge cannot leave a plugin quietly running the
old one.

The bridge is `src/plugin-ui/JigUi.js`. It shares the unit text with the generated panel
(`src/ui/PortText.js`), so a port reads the same in both.

## What the frame is given

The `init` profile is the plugin's own, as JSON-LD, and carries what an editor draws from: each port's
`symbol`, `name`, `minimum`, `maximum` and `default`, and also its `comment`, its `unit`, its `portProperty` values (so a
toggle is known to be one) and its `scalePoint`s (so an enumeration has its names). The widget rule is the host's
([host-plugin-contract.md](host-plugin-contract.md) section 5.3). Built by `src/rdf/ProfileJsonLd.js`.

## Worked example: Dynamix

Dynamix is a compressor/expander, limiter and clipper in Rust. Its module exports two optional meters,
`jig_gain_reduction_db` and `jig_detector_db`, written once per block. The processor posts them about 23 times a
second as a `plugin` message, reusing one object so the audio path allocates nothing. The page draws the transfer
curve from the threshold, ratio, knee, make-up gain and mode, puts a dot on it at the live level, and shows the
gain reduction as text and a bar.

The curve is held to the module. `tests/ui/dynamix-ui.test.js` gives the same settings to the wasm and to the
page's curve function, for a compressor above and inside its knee, below its threshold with make-up gain, and an
expander on both sides, and requires the levels to agree within 0.3 dB. A curve that draws a law the compressor
does not apply would be worse than none.

The gain reduction text is not a live region. Twenty updates a second would drown everything else a screen
reader has to say.

## Second example: Canticle, which needed no script and became a skin

[Canticle](../plugins/canticle/skin/skin.html), a Rust instrument with sixteen ports, was given an editor made only of
markup bound with `data-param` and a stylesheet, to find out whether an interface of controls and labels needs code. It did
not, so it ships as an [HTML skin](html-skins.md), which the host draws in its own document, and has no `jig:ui`. A plugin
whose interface needs code, such as Dynamix with its curve, stays an editor.

## Not done

- **Meters in skins.** [svg-skins.md](svg-skins.md) still has no way to name a signal. The relay above is the
  interim answer for a page.
- **Reset by double click and MIDI learn** on bound controls, which APF gives for free. The host has a context
  menu and a MIDI map; the bridge has no message to ask for either.
