# HTML skins

**Status:** implemented in Jiggy and seen working in Chrome for range, checkbox and select controls, with
Canticle, Drumkit and Quartet, with 16, 75 and 59 controls, as the first plugins to ship one. It extends [svg-skins.md](svg-skins.md), which should be read first, and the
requirement it adds is [host-plugin-contract.md](host-plugin-contract.md) section 9.4. The text below was a proposal first
and is kept in that shape; "What was built" says where the build differs from it.

An HTML skin is a plugin interface made of data, like an SVG skin, but laid out by the browser instead of drawn at
fixed coordinates: a fragment of HTML and a stylesheet, with no script. It would let a plugin author write a
responsive panel (a row of sliders that wraps on a phone, a section that collapses to one column) and have the host
draw it in its own document, with the host's accessibility and none of the code an editor needs.

It does not replace `jig:ui`. A transfer curve, an XY pad or a waveform needs code and stays an editor, built with
[the bridge](plugin-ui.md). An HTML skin is for the plugins whose interface is controls and labels, which is most of
them.

| The plugin declares | The host shows |
|---|---|
| `jig:skin` with an SVG artwork | Artwork at fixed coordinates, drawn and operated by the host |
| `jig:skin` with an HTML artwork | A laid-out panel of native controls, styled by the author's stylesheet, drawn by the host |
| no skin, or a skin that fails | The generated panel |
| `jig:ui`, as well as any of these | An editor beside the panel, in a sandboxed frame |

## Why consider it

SVG skins fit a phone badly. Their layout is one `viewBox`, so a dense drawing is put away below a width and replaced
by generated controls, and Parameq's six bands fall back below about 520 pixels ([svg-skins.md](svg-skins.md),
"A phone"). A designer cannot say "two columns above 600 pixels, one below". HTML and CSS say exactly that, and a native
`input` under every control means the platform already provides the role, the value, the keys and the focus order.

The cost is a larger attack surface. An SVG skin can draw only inside its own box. CSS can position things anywhere,
fetch resources through `url()` and `@import`, and probe the page with selectors. So the proposal is only as good as
its list of what is refused, and that list is the main part of this document.

## The artwork

The skin is a single HTML file. The profile points at it directly, and `jig:mediaType "text/html"` tells the host which
kind of skin it has:

```turtle
<> jig:skin <#skin> .

<#skin>
    a jig:Skin ;
    jig:location <skin.html> ;
    jig:mediaType "text/html" ;
    jig:integrity "sha384-..." .
```

There is no `skin.ttl`. SVG skins keep their bindings in a separate Turtle file so that the picture stays ordinary
artwork a drawing program can rewrite (svg-skins.md, "Why not RDFa in the SVG"). That reason does not apply here. The
HTML is written for this purpose, and in HTML the structure and the binding are the same fact: a slider inside a
labelled row is bound by the attribute on the slider. A second file would repeat the structure in Turtle. This is a
real divergence from the SVG format and is an open question below.

```html
<section class="comp">
  <h2>Compressor</h2>
  <div class="row">
    <label for="th" data-param-name="threshold"></label>
    <input id="th" type="range" data-param="threshold">
    <output data-param-text="threshold"></output>
  </div>
  <div class="row">
    <label for="ra" data-param-name="ratio"></label>
    <input id="ra" type="range" data-param="ratio">
    <output data-param-text="ratio"></output>
  </div>
</section>
<style>
  @layer skin {
    .comp { display: grid; gap: 8px; }
    .row  { display: grid; grid-template-columns: 6rem 1fr 5rem; align-items: center; }
    @media (max-width: 360px) { .row { grid-template-columns: 1fr; } }
  }
</style>
```

The attributes are the ones the bridge uses (plugin-ui.md), so a page can move between an editor and a skin by
deleting its script. Controls are native: `input type="range"` for a continuous port, `input type="checkbox"` for a
two-position port, `select` for an enumeration, whose options the host fills from the port's scale points. The widget
follows the shape of the port (contract section 5.3), and a control of the wrong kind for its port is dropped and
reported, not drawn disabled.

## What the host does

The host never inserts the file, as for SVG. It parses it with `DOMParser` as `text/html`, which produces an inert
document in which no script runs, then builds new nodes from an allowlist into a shadow root. It never serialises
the markup back to a string, which is what makes mutation-based sanitiser bypasses (markup that parses differently the
second time) a non-issue: the markup is read once and copied, never re-parsed. The stylesheet is the one thing written
out as text, and only from rules the host recognised (see "Style").

The host supplies everything a person or a tool relies on, and the artwork supplies none of it:

- **Name and value.** The accessible name is the port's `lv2:name` and the value text is the value with its unit,
  taken from the port. Author text in an `aria-label` is dropped.
- **Label in name.** WCAG 2.5.3 wants the visible label to be part of the accessible name. `data-param-name` makes that
  true by construction. A hand-written `label` whose text is not contained in the port's name is reported to the
  console, since the host cannot fix it.
- **Tab order.** Document order. A `tabindex` is refused, since a positive one reorders focus (WCAG 2.4.3).
- **Focus and size.** The host's own rules give every control a visible focus indicator and a target of at least
  44 CSS pixels, and a `select` a font size of at least 16 pixels, which is what stops iOS zooming the page on focus. They sit outside the author's cascade layer, so a
  stylesheet cannot remove them (see "Style").
- **Help.** A port's `rdfs:comment` says what it does. The host makes it the control's description, said by a screen
  reader on focus, and shows it on a help line that follows the pointer and the focus, as the generated panel does
  (WCAG 1.4.13: Escape puts it away, and it stays while the pointer is over it). The author writes none of this. An
  element with `data-param-help` marks where the line goes, so a layout can place it; without one, the host draws the
  line after the skin. The line is hidden from assistive technology, since the controls carry the words already.
- **Operations.** Each gesture becomes the same operation the generated panel issues (contract section 9.3), so undo,
  automation recording and the WebMCP surface see a skin and a panel identically.
- **Echo.** A control shows the value the host applied, never the one it asked for (messaging.md section 2.3).

## What the markup may contain

| Allowed | Notes |
|---|---|
| `section`, `div`, `span`, `header`, `footer`, `p`, `h1` to `h6`, `ul`, `ol`, `li`, `fieldset`, `legend` | Structure |
| `label`, `output` | `for` must name an `id` in the same file |
| `input` of type `range` or `checkbox`, and `select` | Only with `data-param`. No `option` is accepted: the host makes them |
| `svg` and its allowlist from svg-skins.md | Not in the first build: an `svg` is refused for now, see "What was built" |
| `style` | At most one, parsed as described under "Style" |
| `class`, `id`, `lang`, `title`, `aria-hidden`, `data-param`, `data-param-name`, `data-param-text`, `data-param-help` | Everything else is dropped |

Refused, and the whole skin with it: `script`, `link`, `meta`, `base`, `iframe`, `object`, `embed`, `img`, `picture`,
`video`, `audio`, `canvas`, `form`, `button`, `a`, `template`, `slot`, `noscript`, `math`, any custom element, any
`input` type other than `range` and `checkbox`, any `on*` attribute, any `href`, `src`, `srcset`, `action`, `style`
attribute with a disallowed property, `is`, `contenteditable`, `draggable`, `autofocus`, `accesskey` and
`tabindex`. A refusal names the element and its position in the tree. The host falls back to the generated panel
(contract section 10.2).

Limits, which a host may raise: 256 KiB for the file and 2000 elements.

`id`s are prefixed by the host and every same-file reference (`for`, SVG `href`) is rewritten, so two skins on one page
cannot collide. Inside a shadow root they could not reach the host's ids anyway; the prefix keeps `for` and `use`
working as written.

## Style

The stylesheet is the new surface. The host does not hand the author's text to the browser. It parses the `style` element
with its own parser (`src/ui/HtmlSkinCss.js`), checks every rule and declaration, and writes a new sheet from what it
recognised. A rule it does not recognise refuses the skin. The characters a value or a selector may hold are limited too:
no quote, no backslash and no `!`, so there is no string to hide `url(` in, no escape to spell it with, and no
`!important` to put an author declaration above the host's own, which in a lower cascade layer it otherwise would.

**Scope.** The skin lives in a shadow root, so its selectors cannot match anything in the host. The host sets
`contain: layout paint style` and `isolation: isolate` on the root, so nothing the skin draws can overflow the box the
host gave it or sit over the host's own controls.

**Rules allowed.** Style rules, and `@container` and `@media` with width and height conditions only. Prefer
`@container`: a panel sits in a column of a rack, narrower than the window, and `@media` measures the window. The host
sets `container-type: inline-size` on the skin's root, so a skin's `@container` rules query the box it was given.
`container-type` is otherwise allowed only with the value `inline-size`. All of it must sit
inside `@layer skin`, and the host's own rules are unlayered, which makes them win over any layered declaration
regardless of selector weight. A skin cannot therefore out-specify the focus ring or the 44 pixel minimum.

**Rules refused.** `@import`, `@font-face`, `@keyframes`, `@property`, `@namespace`, `@supports` and every other at-rule.

**Selectors allowed.** Type, class and `#id` selectors, descendant and child combinators, the attribute selector
`[data-param]` family, and the pseudo-classes `:hover`, `:focus-visible`, `:checked` and `:first-child`. A selector may
have at most four compound parts. `:has`, `:not`, `:is`, `:where`, `:visited`, `:target` and every pseudo-element are
refused: `:has` and `:visited` are the two that let a stylesheet learn things about the page, and the rest are not
needed.

**Properties allowed.** Layout (`display` limited to `block`, `inline`, `inline-block`, `flex`, `grid` and `contents`;
`flex-*`, `grid-*`, `gap`, `row-gap`, `column-gap`, `align-*`, `justify-*`, `order`, `width`, `height`, `min-*`, `max-*`, `margin`, `padding`,
`box-sizing`, `overflow`), paint (`color`, `background-color`, `accent-color`, `color-scheme`, `border*` except `border-image`,
`border-radius`, `box-shadow` with a blur of at most 16 pixels, `outline` with `outline-style`), and text (`font-family` from the generic families only, `font-size`,
`font-weight`, `font-style`, `line-height`, `letter-spacing`, `text-align`, `text-transform`, `white-space`).

**Properties refused.** `position: fixed` and `sticky` (`absolute` stays allowed, since the containing box clips it), `z-index` above 10, `display: none`, `visibility`, `opacity`, `clip`, `clip-path`, `pointer-events`,
`content`, `filter`, `backdrop-filter`, `transform`, `transition`, `animation`, `cursor`, `resize`, `appearance`,
`-webkit-*` and any custom property. The ones that hide a control or make it unreachable (`display: none`,
`visibility`, `opacity`, `clip`, `pointer-events`) are refused because a skin must not make a port unreachable.

**Values refused.** `url()`, `image-set()`, `attr()`, `env()`, `var()` and `expression()`. No stylesheet can then cause
a request, and no value depends on anything outside the file. Math and layout functions (`min()`, `max()`, `clamp()`,
`calc()`, `repeat()`, `minmax()`) are allowed, and one of them, `min()`, turned out to be needed (see the first step below).

After layout the host measures the skin. If a control has no size, falls outside the root, or the content is wider than
the root and would scroll horizontally, the skin is put away and the generated panel is drawn, and the skin returns when
the width allows. This is the fallback svg-skins.md describes for a cramped drawing, with the check made on the result
rather than on sizes worked out in advance.

## Ports the skin does not bind

As in svg-skins.md. A skin may bind a subset, may not make a port unreachable, and the host draws every unbound port as
the generated panel would, in a group after the skin. A binding to a port the profile does not declare is left out and
reported.

## Threats and what answers them

| Threat | Answer |
|---|---|
| Markup that runs code | Parsed inert, copied from an allowlist, never inserted or serialised |
| A control drawn over the host's own (clickjacking) | Shadow root, `contain: paint`, no `fixed` or `sticky`, `z-index` capped |
| A request out of the page (tracking, data sent in a URL) | No `url()`, `@import`, `@font-face`, `img`, `link`, `a` or `form` |
| Learning about the page or the person | No `:has`, `:visited`, `:target`, no custom fonts, generic families only |
| A control that cannot be reached | No hiding properties, host-owned focus and 44 pixel target, unbound ports always drawn |
| A skin that makes the page slow | Size and element limits, selector depth, no `filter`, bounded `box-shadow` |
| A skin that cannot be told what is wrong | Whole-skin refusal with the element or rule named |

## Validation

`vocabs/shapes.ttl` checks the profile's `jig:skin` node as before, with `jig:mediaType` allowed to be either media
type. There is no cross-file check, since there is one file. The host checks, at load, that every `data-param` names a
port the profile declares and that the control's kind fits the port's shape.

`npm run check:skins` runs the builder in a real Chrome over every HTML skin in `plugins/`, and over a corpus of hostile
skins, one per refusal above, expecting each to be refused for its stated reason. It has to run in Chrome because a DOM
without a renderer accepts markup and CSS a browser refuses: the real parser moves a `div` out of a `table`, ends a stylesheet
at a stray `</style>` and puts an `svg`'s script in the SVG namespace, and what the checker sees is what it made. It also
mounts a built panel in a real shadow root and holds the cascade to what this document says: an author who shrinks a slider
to 1 pixel, sets a select's text to 3 pixels, removes the focus ring or throws an element 4000 pixels away is not obeyed.

## First step: Canticle

The proposal asked whether an interface of only controls and labels needs code. Canticle, a Rust instrument with sixteen
ports, was given an editor to find out. It was written with no script of its own, in the rules above, and then held to them by
the host's own checker. It needed none, and it became the first HTML skin (`plugins/canticle/skin/skin.html`).

| Editor | Own script | What would not fit a skin |
|---|---|---|
| Canticle | 0 lines | Nothing |
| Dynamix | 80 lines | The transfer curve and the gain reduction meter. Its fourteen controls would fit |
| Tremolo | 122 lines | Almost all of the script is the message handshake the bridge now supplies |

What came out of it:

- **A controls-only plugin needs no code.** Four sections, sixteen bound controls and a layout that goes from one column
  to four, in about 30 lines of markup and under 20 of CSS. Beside it the generated panel shows three controls and folds the
  rest under "More controls", which is the case for the proposal.
- **Dynamix splits cleanly.** A plugin is one or the other, not half of each, because an editor is a frame and a skin is not.
- **The writing found gaps in this document's lists**, now corrected above: `accent-color` and `color-scheme` (without them a
  dark skin on native sliders looks wrong), `row-gap` and `column-gap`, and `min()`, which stops a card minimum from
  overflowing a narrow panel.
- **Measuring in a browser found one bug the checker could not.** At 240 pixels the first version overflowed sideways, since
  its card minimum was wider than the space. After the fix there is no horizontal overflow from 200 to 1200 pixels, with one,
  two, three and four columns at the widths in between and every row at least 44 pixels tall.
- **`@media` is the wrong query.** The first version used it and reflowed at the window's width. Hence `@container`.
- **Help text was a gap, and is closed.** The frame's `init` profile did not carry a port's comment. It does now, and the
  host makes the comment each control's description and shows it on a help line (see "What the host does"). Six of
  Canticle's sixteen ports have one.

## What was built

| What | Where |
|---|---|
| The CSS parser and checker | `src/ui/HtmlSkinCss.js` |
| The markup checker and builder, and `HtmlSkinError` | `src/ui/HtmlSkin.js` |
| The panel, with the same interface as an SVG skin's | `src/ui/HtmlSkinPanel.js`, drawn by `Panel.js` |
| A drag that survives a redraw, and the keyboard put back inside a shadow root | `src/ui/SliderDrag.js`, `src/ui/Focus.js` |
| Loading: one file, chosen by the profile's `jig:mediaType` | `src/host/SkinLoader.js` |
| The profile: `"skin": { "html": "skin/skin.html" }` in `profile.json` | `bin/write-profile.js` |
| The Chrome check and its hostile corpus | `bin/check-skins.js` |
| A first draft from `profile.json` | `bin/skin-from-profile.js` |
| The skins | `plugins/canticle/skin/skin.html`, `plugins/drumkit/skin/skin.html`, `plugins/quartet/skin/skin.html` |
| The procedure, for an agent | `.claude/skills/html-skin/SKILL.md` |

Where the build differs from the proposal above:

- **No inline `svg` yet.** It is refused. An SVG inside a skin would need the SVG skin's builder run on a subtree the HTML
  parser put in the SVG namespace, and nothing needed it. The proposal's table still lists it, with this note.
- **Position and `z-index` are allowed in a narrow form.** `position` may be `static`, `relative` or `absolute`, and
  `z-index` a whole number from 0 to 10. The proposal's lists did not include them, and an author needs `absolute` for a badge
  on a control. `fixed` and `sticky` stay refused, and the box clips what it holds.
- **The host's rules are unlayered and the author's sit in `@layer skin`.** As proposed, and it is what makes the host's
  44 pixel targets, 16 pixel select text and focus ring beat any author declaration. The Chrome check holds it.
- **Wrong kind of control: left out, not refused.** A range bound to a switch, or a binding to a port the plugin does not
  declare, is dropped and reported, and the skin still draws. The label stays, since it is text.
- **A visible label that is not part of the port's name is reported** (WCAG 2.5.3) and not changed.
- **A skin too wide for its room is put away, judged on the result.** The panel measures after layout, shows itself for the
  measurement and hides again in the same task, so nothing is painted between.

Drumkit, the second skin, is eleven voice cards each with a mute in its header, and a master card, all 75 ports. It was
generated once from `profile.json` to avoid mistyping 75 rows, and is committed as ordinary markup to edit by hand. Its row
labels are short ("Pitch") because the accessible name is the port's ("Kick Pitch"), which contains them. Writing it found two
more things:

- **A skin can overflow at some widths and not at others.** A grid track's minimum is not its card's content minimum: a range
  input is about 129 pixels wide whatever its column, so a row inside a 260 pixel card spilled 59 pixels out of it, and the
  skin overflowed by 38 pixels at 1100 and 12 at 1500, and at nine other widths, while fitting at the few sizes first tried.
  The cure is to let the slider shrink (`min-width: 0` and `width: 100%`) and give the grid a track minimum the rows can
  live in. `npm run check:skins` now sweeps every width from 200 to 1600 pixels in steps of 50, for every HTML skin, and
  measures where every drawn element sits against the box the host gave. The first version of that sweep measured the
  skin's `scrollWidth` and then only the controls, and passed the broken skin both times: reverting the fix is what showed it.
- **A dark skin must ask for dark controls.** The host's 44 pixel checkbox was a large white square on a dark card until the
  skin set `color-scheme: dark`, which the allowlist already permits.

Quartet, the third skin, was the first made with the script, which drafted all 59 ports into nine cards without a hand edit
and passed every check as written. The look is what needed tuning: a switch row (`Fixed Frequency`) wrapped in the same narrow
label column as a slider and wanted its label to take the room and its checkbox the end; a value readout such as "2400 Hz"
wrapped in a 3.5rem column, and needs about 4.5rem and `white-space: nowrap`; and the card minimum grew to 18rem so the
sliders stay usable. Those went back into the script's stylesheet. Four operators with ten identical controls each sit side by
side at the top, as an FM synth's panel does, and the algorithm select works through the host with the focus kept.

Two bugs that no unit test could have found, both found by a real drag and counted arrow keys in Chrome, and both a result of
the rack being redrawn on every edit (`web/app/Runtime.js`):

- **A native slider stopped following the pointer after one step.** The redraw detaches the slider, which ends the browser's
  drag. The generated dial is immune because it listens on the document. `SliderDrag.js` does the same for a slider, taking
  the value from where the pointer is, and keeps the thumb under the pointer when it is grabbed.
- **The keyboard could nudge a slider once.** `preserveFocus` reads `document.activeElement`, which for a control in a
  shadow root is the host, which has no id. It now sees through the shadow root, and the skin's host has a stable id.

## Open questions

- **Inline `svg`.** Worth adding when a plugin wants a drawn meter beside its controls, and not before.
- **Native hosts.** The native adapter has no web engine and ignores `jig:skin`, as the contract permits, so an HTML
  skin changes nothing there. If it ever embeds a web view, this is a smaller thing to host than a `jig:ui`, since it
  has no script and no messages.
- **Theming.** svg-skins.md draws a skin as authored. `prefers-color-scheme` would be a one-line addition here, and it
  leaks a preference to a stylesheet that cannot send it anywhere, so it is probably safe, but it is not in this version.
- **Whether it earns its cost.** The case is strong for plugins like Canticle and weak for Tremolo-sized ones, which a
  generated panel already serves. It is built, so the question is now which further plugins should have one.

Settled by building it: one file and no `skin.ttl`, since the structure and the binding are the same fact in HTML; container
queries, not media queries, since a panel is narrower than the window; and help, which the host supplies.
