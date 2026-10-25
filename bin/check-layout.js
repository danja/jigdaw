// bin/check-layout.js
//
// Measures the page's layout in a real Chrome at phone and desktop widths. The unit tests run in linkedom, which has no
// layout, so "no horizontal scrolling" and "touch targets of at least 44px" (CLAUDE.md, interface rules) cannot be
// asserted there. For each width this loads the studio, and for each tab, and with the Browser and the Keys list open, it
// compares `documentElement.scrollWidth` with `innerWidth` and names what sticks out.
//
//   npm run check:layout      exit 0 every view fits, 1 something overflows or the page failed,
//                             3 Chrome is not available (nothing was checked)
//
// It starts bin/serve.js on a free port and drives Chrome over the DevTools protocol with Node's own WebSocket, so it needs
// nothing installed. Touch-target sizes are reported for the controls named in TARGETS, as warnings, not failures.
import { fileURLToPath } from 'node:url'
import { withChrome, sleep } from './chrome-session.js'

export const WIDTHS = Object.freeze([320, 360, 390, 720, 1280])
// ?studio asks for the studio at any width: below 720px the bare address redirects to the simple page (web/view.js).
export const PAGES = Object.freeze(['/?studio', '/simple.html'])
const SETTLE_MS = 3500

// The Mixer with a track holding three plugins and the lists of the channel and the master open: the widest the mixer gets. The
// audio runtime starts on a click, as for a person, so this runs with a user gesture.
const MIXER_WITH_LISTS = `(async () => {
  [...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Add track').click()
  for (let i = 0; i < 150 && !window.__jigdaw?.dispatcher; i++) await new Promise(done => setTimeout(done, 100))
  const d = window.__jigdaw.dispatcher
  for (const name of ['boost', 'tremolo', 'cascade']) await d.addPlugin(location.origin + '/plugins/' + name + '/', { track: 'track-1' })
  const link = (id, a, b) => ({ op: 'addConnection', id, from: { node: a, portIndex: 0 }, to: { node: b, portIndex: 0 }, signalKind: 'http://purl.org/stuff/transmissions/Audio' })
  d.apply([link('c1', 'node-1', 'node-2'), link('c2', 'node-2', 'node-3')])
  d.apply([{ op: 'setNode', id: 'node-2', bypassed: true }])
  ;[...document.querySelectorAll('[role=tab]')].find(t => t.textContent.trim() === 'Mixer').click()
  await new Promise(done => setTimeout(done, 300))
  for (const id of ['strip-track-1-fx', 'strip-master-fx']) document.getElementById(id).click()
  return document.querySelectorAll('.fx-list:not([hidden]) li').length
})()`

// Run inside the page. Returns what overflows the viewport, and the touch targets that are too small.
const MEASURE = `(() => {
  const width = innerWidth
  const doc = document.documentElement
  const name = el => el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/)[0] : '')
  const out = []
  for (const el of document.body.querySelectorAll('*')) {
    if (el.getClientRects().length === 0) continue
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.right > width + 0.5) out.push(name(el) + ' right=' + Math.round(r.right))
    if (out.length >= 6) break
  }
  return { scrollWidth: doc.scrollWidth, innerWidth: width, overflowing: out }
})()`

async function measureAll ({ send, session, base, evaluate }) {
  const results = []
  for (const page of PAGES) {
    for (const width of WIDTHS) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 1, mobile: width < 720 }, session)
      await send('Page.navigate', { url: `${base}${page}` }, session)
      await sleep(SETTLE_MS)
      const views = [{ view: 'as loaded', before: '' }]
      const tabs = await evaluate(`[...document.querySelectorAll('[role=tab]')].map(t => t.id || t.textContent)`)
      for (const id of tabs) views.push({ view: `tab ${id}`, before: `[...document.querySelectorAll('[role=tab]')].find(t => (t.id || t.textContent) === ${JSON.stringify(id)}).click()` })
      if (page === '/?studio') {
        views.push({ view: 'Browser open', before: `document.getElementById('toggle-browser')?.click()` })
        views.push({ view: 'Keys list open', before: `document.getElementById('toggle-keys')?.click()` })
        views.push({ view: 'Mixer with plugin lists open', before: MIXER_WITH_LISTS, gesture: true, needs: 3 })
      }
      for (const { view, before, gesture = false, needs = null } of views) {
        if (before) {
          const made = await evaluate(before, { gesture })
          // A view that sets something up says how much it made, so a setup that quietly did nothing is a failure, not a pass.
          if (needs !== null && made < needs) throw new Error(`${view}: expected ${needs} plugins listed, found ${made}`)
          await sleep(300)
        }
        const m = await evaluate(MEASURE)
        results.push({ page, width, view, ...m, fits: m.scrollWidth <= m.innerWidth })
      }
    }
  }
  // A positive control: a deliberately wide element must be reported, or "everything fits" would mean the measure is blind.
  await send('Emulation.setDeviceMetricsOverride', { width: 360, height: 800, deviceScaleFactor: 1, mobile: true }, session)
  await send('Page.navigate', { url: `${base}/simple.html` }, session)
  await sleep(SETTLE_MS)
  await evaluate(`document.body.insertAdjacentHTML('beforeend', '<div id="wide-control" style="width:2000px;height:4px"></div>')`)
  const control = await evaluate(MEASURE)
  results.push({ page: 'control', width: 360, view: 'a 2000px element is added', ...control, fits: control.scrollWidth > control.innerWidth, control: true })
  return results
}

export async function checkLayout () {
  return withChrome(async page => {
    const results = await measureAll(page)
    const lines = []
    let failed = false
    for (const r of results) {
      const where = `${r.page} at ${r.width}px, ${r.view}`
      if (r.control) {
        if (r.fits) lines.push(`ok   control: an added 2000px element is seen as overflow`)
        else { failed = true; lines.push('FAIL control: an added 2000px element was not seen, so the measure is blind') }
      } else if (r.fits) lines.push(`ok   ${where}`)
      else { failed = true; lines.push(`FAIL ${where}: scrollWidth ${r.scrollWidth} > innerWidth ${r.innerWidth}; ${r.overflowing.join(', ') || 'no single element found'}`) }
    }
    lines.push(`${results.length} views measured at ${WIDTHS.join(', ')}px`)
    return { code: failed ? 1 : 0, lines }
  })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, lines } = await checkLayout()
  for (const l of lines) console.log(l)
  process.exit(code)
}
