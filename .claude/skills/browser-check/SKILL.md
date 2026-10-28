---
name: browser-check
description: Check a change to Jiggy in a real Chrome, by driving the page with the Claude in Chrome tools. Use when a change touches the interface, a plugin panel or skin, the pointer or the keyboard, layout or the focus, or when a test passed but the thing was never seen. Covers building and serving, getting a clean page, loading a plugin the right way, counted keyboard and drag checks, a width sweep, and the traps that cost time before.
---

# Checking a change in a real browser

A DOM under test has no layout, no pointer, no native drag and no focus, so a whole class of bugs passes every unit test: a drag that
stops after one step, a control that takes one arrow key, a row that overflows between two widths. They were all found here, in
Chrome, after the tests passed. The rule is in [CLAUDE.md](../../../CLAUDE.md) ("Interface rules"): drive the real thing, and
count. This is the procedure, with the traps already paid for.

## 0. Before anything

- **The tools.** If the `mcp__claude-in-chrome__*` tools are not loaded, load them in one `ToolSearch` call (`select:` the
  names you need: `tabs_context_mcp`, `navigate`, `computer`, `javascript_tool`, `read_console_messages`, `browser_batch`).
  Call `tabs_context_mcp` first and work in your own tab. If there is no browser connection, **stop and ask**: do not fall back to
  reasoning about the DOM, which would stand in for a check that was never run.
- **The window must be in front.** A hidden tab gets no user activation, so `AudioContext.resume()` never settles and a scripted
  click is not activation either. Read `document.visibilityState` and `navigator.userActivation.hasBeenActive` before concluding
  anything from a hang. A screenshot that times out (`Page.captureScreenshot timed out`) usually means a hidden or frozen tab.
- **What this cannot show:** sound (no activation, no ears), touch, and a screen reader. Say so when you report, as "not checked".

## 1. Build and serve

```sh
npm run build:web            # rebuilds web/*.bundle.js and the precache; do it after any change under src/ or web/
node bin/serve.js            # http://127.0.0.1:8748/, or set PORT
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8748/     # a real request, not an assumption
```

`web/app.bundle.js` is rebuilt immediately before a check, or the check measures the old code. Plugin files (skins, profiles,
editors) are served from `plugins/` and need no bundle, but do need their `build.sh` run so the profile's digest matches the file.
Stop the server by port when done, never with `pkill -f`: `fuser -k 8748/tcp`.

## 2. A clean page, every time

A service worker serves the old code, and an "Unsaved work" banner from the last session moves the whole layout down, so a click
aimed at a fixed coordinate misses. In one `javascript_tool` call on the page, then navigate again (**do not reload inside the
same script**: the call dies with "Inspected target navigated"):

```js
for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister()
for (const k of await caches.keys()) await caches.delete(k)
;[...document.querySelectorAll('button')].filter(b => /discard/i.test(b.textContent)).forEach(b => b.click())
```

## 3. Load the plugin the right way

Open the Plugins tab, open the browser with the puzzle-piece button, and use **Load by IRI** with the local address,
`http://127.0.0.1:8748/plugins/<name>/`. A plugin loaded from the catalogue search fetches the canonical `https://strandz.it/...`
copy, which is the deployed one and has none of your change. Take a screenshot before clicking after anything that could move the
layout, and prefer reading and setting things with `javascript_tool` to clicking coordinates.

**Coordinates are scaled.** A screenshot says its frame (`1568x755`); the page's `innerWidth` is larger (1920 here). A CSS pixel
is the screenshot pixel times `innerWidth / frameWidth`. Convert before aiming at an element you measured with
`getBoundingClientRect()`.

## 4. Where things are

- A plugin panel is `.panel` in the Plugins tab. An HTML skin is `.html-skin-host`, an **open shadow root**: reach its controls
  with `document.querySelector('.html-skin-host').shadowRoot`, and note that `document.activeElement` is the host, not the control.
- A plugin's own editor (`jig:ui`) is an `iframe` on the plugin's origin, same-origin when the host serves the plugin
  (`iframe.contentDocument` works), and opened with "Open editor".

## 5. Counted checks

Do not glance. Make a prediction, act, read the number.

**Keyboard.** Focus a control, press a key five times, and the value must have moved five steps with the focus still on it. This
is the check that found a control that could be nudged once:

```js
const sr = document.querySelector('.html-skin-host').shadowRoot
const s = sr.querySelector('input[data-param=tone]'); s.focus(); window.__before = Number(s.value)
```
then `computer` `key` `ArrowRight` with `repeat: 5`, then

```js
const sr = document.querySelector('.html-skin-host').shadowRoot
const s = sr.querySelector('input[data-param=tone]')
JSON.stringify({ moved: +(Number(s.value) - window.__before).toFixed(3), expected: 0.025, focused: sr.activeElement === s })
```

Each `javascript_tool` call has its own scope: a `const` from one call is not there in the next, so look the element up again, and
keep anything that must survive on `window`.

**Drag.** Use `left_click_drag` with real screenshot coordinates from the control's rect, and predict the end value from the
geometry. A drag that lands one step in is the redraw detaching the control: attach a `MutationObserver` on `document.body`
(`childList`, `subtree`) before the drag and read what was removed and added.

**Widths.** The panel is narrower than the window, so test the panel's width, and many widths, not three:

```js
const host = document.querySelector('.html-skin-host'), sr = host.shadowRoot, bad = []
for (let w = 200; w <= 1600; w += 50) {
  host.style.width = host.style.maxWidth = w + 'px'
  await new Promise(r => setTimeout(r, 60))
  const edge = host.getBoundingClientRect().right
  const over = [...sr.querySelectorAll('.html-skin *')].filter(e => !e.classList.contains('visually-hidden') && e.getBoundingClientRect().right > edge + 0.5)
  if (over.length) bad.push(w)
}
host.style.width = host.style.maxWidth = ''
JSON.stringify(bad)
```

Measure where every drawn element sits against the box, not `scrollWidth`: it did not report a value readout that had spilled out
of its card. `npm run check:skins` does this for every HTML skin in headless Chrome, and exits 3, having checked nothing, if Chrome
is missing.

**Console.** `read_console_messages` with a `pattern`, for errors and for the page's own `[jigdaw]` log lines (a skin that fails
is reported there, naming the element). The tab keeps its console history across navigations and sessions, so a bare read returns
hours-old lines (177 of them, found by following this skill): read once with `clear: true` before the action under test, act, then
read again.

## 6. Traps already found

- **The catalogue loads the deployed plugin** (section 3). If the panel looks like the old one, check which IRI was fetched.
- **`:focus-visible` is not reliable in a headless page**: it needs the window to have the focus. Do not build a check on it matching.
- **A plugin editor in a frame answers asynchronously.** Its value reaches the host and comes back by `postMessage`, so wait about half
  a second before reading it, or a working round trip looks broken. An HTML skin is drawn by the host itself and answers at once.
- **A click at a remembered coordinate misses** after the banner or the sidebar changes the layout. Re-screenshot.
- **`javascript_tool` returns the last expression** and cannot see across a navigation. Keep one navigation per call.
- **Report symptoms, then the likely cause.** "A hang" was a hidden tab, and an error that blamed CORS was `Illegal invocation`.
- **A fake that is more permissive than the real thing hides the bug.** If a test was green and this was red, the fix is in the code,
  and the lesson is in the fake. Say which.

## 7. Finish

Stop the server, leave the tab as you found it or close the one you opened, and report what was checked and what was not,
with the numbers (the five arrow presses moved the value by 0.025, the sweep found nothing from 200 to 1600). A claim about
the page is a claim, so take its figures from the page.
