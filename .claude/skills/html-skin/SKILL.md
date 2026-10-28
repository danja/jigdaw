---
name: html-skin
description: Give a Jig plugin an HTML skin, a laid-out panel of its controls drawn by the host. Use when a plugin has many ports and no editor, when asked to skin or lay out a plugin's controls, or before writing a skin by hand. Covers deciding whether a skin is the right kind of interface, drafting one from profile.json, the layout traps found so far, and the checks that must pass.
---

# Giving a plugin an HTML skin

An HTML skin is one file of markup bound to ports with `data-param`, and one stylesheet, with no script. The host builds it from
an allowlist and draws it in its own document. Read [docs/html-skins.md](../../../docs/html-skins.md) for the rules and why, and
[docs/ui.md](../../../docs/ui.md) for how it fits with the generated panel, SVG skins and a `jig:ui`. This file is the procedure.

## 1. Decide that a skin is the right interface

- **Controls and labels only:** a skin. Canticle (16 ports), Drumkit (75 ports) and Quartet (59 ports) are skins.
- **A curve, an XY pad, a meter, a spectrum, a drag-on-a-plot:** it needs code, so a `jig:ui` built with the bridge
  ([docs/plugin-ui.md](../../../docs/plugin-ui.md)). Octet's plot and Dynamix's transfer curve are editors. A plugin may have both, a skin for
  the controls and an editor beside it, but do not build the skin unless someone wants the panel replaced.
- **Few controls:** do nothing. The generated panel is accessible and costs the author nothing. Tremolo-sized plugins do not
  need a skin.

## 2. Draft it

```sh
node bin/skin-from-profile.js plugins/<name>
```

It writes `plugins/<name>/skin/skin.html` with a card for each port group, and adds the `skin` key to `profile.json`. If it says
it left `profile.json` alone, add `"skin": { "html": "skin/skin.html" }` by hand, next to `resources`. It refuses to overwrite a
skin that exists. The draft is a starting point: after this the file is edited by hand and the script is not run over it again.

Then `bash plugins/<name>/build.sh`, which writes the skin's digest into `profile.ttl`. Run it again after every edit to the skin,
or the plugin is refused for a digest that does not match. Never edit `profile.ttl`.

## 3. Tune it by hand

This is the judgement the script cannot make. Look at the result in a browser first (step 5), then decide:

- **Which groups sit together and in what order.** Repeated groups (four operators, eight bands) go first and side by side.
- **What belongs in a card's header.** Drumkit puts each voice's mute there. A switch that governs the whole card is a header.
- **Labels.** They are the port's name less the words its group shares, so "Op A Waveform" reads "Waveform". Every label must be
  part of its port's accessible name (WCAG 2.5.3), and the panel reports one that is not. Do not rename a label to something
  that is not in the port's name.
- **Palette.** The draft is dark. If you change it, keep `color-scheme: dark` for a dark skin, or native checkboxes and selects
  stay light on a dark card.

## 4. Rules the host enforces, so the skin cannot

A skin with any of these is refused whole, and the message names the element or rule. See "What the markup may contain" and "Style"
in docs/html-skins.md for the full lists.

- No script, no `img`, `a`, `button`, `form`, `table`, `svg`, no custom elements, no `style` attribute, no `tabindex`.
- Every rule in `@layer skin`. No `url()`, `@import`, `!important`, quotes or backslashes, `position: fixed`, `display: none`,
  `opacity`, `transform`, `var()`.
- Selectors: type, class, id, `[data-param...]`, `:hover`, `:focus-visible`, `:checked`, `:first-child`, up to four parts.
  **`input[type=range]` is refused**: use a class or a descendant selector such as `.row input`.
- Use `@container`, not `@media`: a panel is narrower than the window.

## 5. Check it

```sh
npx vitest run tests/ui/html-skins.test.js tests/bin/check-skins.test.js tests/bin/skin-from-profile.test.js
npm run check:skins
```

`html-skins.test.js` finds every skin on its own and holds it to the real builder and panel: every port bound once, the right kind
of control for each, the digest right, descriptions for each commented port. `npm run check:skins` runs in real Chrome and sweeps
the width from 200 to 1600 pixels in steps of 50, failing on overflow or a target under 44 pixels. If Chrome is missing it exits
3 and has checked nothing: that is not a pass.

Then look at it for real. The tests cannot see layout, the pointer or the focus.

1. Build the bundle (`npm run build:web`), start `node bin/serve.js`, and open `http://127.0.0.1:8748/` with the window in front.
2. Unregister the service worker and delete its caches, and discard the "unsaved work" banner, which moves the layout.
3. Load the plugin **by its local IRI** in "Load by IRI", `http://127.0.0.1:8748/plugins/<name>/`. A plugin loaded from the
   catalogue search is the deployed copy at strandz.it, which has no skin.
4. Count, do not glance: focus a slider, press an arrow key five times, and the value must have moved five steps with the focus
   still in the skin. Drag a slider across its length with a real pointer. Change a select by key twice. Click a checkbox.
5. Read the layout at several panel widths, not one: `host.style.width` on `.html-skin-host`, and compare each drawn element's right
   edge with the host's.

## 6. Traps already found

- **Overflow at some widths and not others.** A range input is about 129px wide in any column, so a row in a narrow card spills.
  Keep `.row input { width: 100%; min-width: 0; }` and `.card { min-width: 0; }`, and a card minimum its rows can live in.
- **Measure positions, not `scrollWidth`.** A scroll width did not report a spilled value readout. The sweep measures every drawn
  element against the host's box.
- **A readout wraps** if its column is too narrow for its units: "20000 Hz" needs about 4.5rem and `white-space: nowrap`.
- **A switch row** wants its label to take the room and the checkbox at the end (`.flip`), not the same columns as a slider.
- **The native drag and keyboard** survive the rack redrawing on every edit only because of `src/ui/SliderDrag.js` and
  `src/ui/Focus.js`. A new kind of control needs the same care, and the same real-browser test.

## 7. Finish

Add the plugin's name to `docs/html-skins.md` where it lists the skins shipped, say what it needed that the others did not, and
update `TODO.md`. Run the whole suite and read its `Test Files` line, not only the count.
