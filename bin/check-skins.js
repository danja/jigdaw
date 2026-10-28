// bin/check-skins.js
//
// Runs the skin builder in a real Chrome. docs/svg-skins.md, contract 9.4.
//
// The unit tests build their artwork from hand-made trees, because linkedom's
// DOMParser gives every element the XHTML namespace and accepts malformed XML,
// which a browser does not. So whether parseSvg and buildArtwork hold up against
// a real parser, with real namespaces and a real parsererror, is only answered
// here. It also runs the cross-file check on every plugin that declares a skin,
// with the element ids Chrome found in the artwork.
//
// JIG_CHECK_VERBOSE=1 also prints the overflow measured at every width of the sweep.
//
// A second page does the same for HTML skins (docs/html-skins.md): hostile markup through Chrome's own HTML parser, and the
// built panel mounted in a real shadow root, where the host's rules must beat the author's in the cascade.
//
//   npm run check:skins        exit 0 all agree, 1 something failed,
//                              3 Chrome is not available (nothing was checked)
//
// Exit 3 is deliberate. A check that cannot run and reports success looks like
// coverage; set CHROME_BIN, or run it where Chrome is.
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseText } from '../src/rdf/parse.js'
import { readProfile } from '../src/rdf/ProfileReader.js'
import { readSkin, checkSkin } from '../src/rdf/SkinReader.js'
import { isMain } from './is-main.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const chrome = process.env.CHROME_BIN ?? '/usr/bin/google-chrome'
const SVG = 'xmlns="http://www.w3.org/2000/svg"'

// Each hostile case is an artwork a plugin author could ship. `refuse` is what the
// error must say; null means it must build, and then `absent` must not survive into the output.
const CASES = [
  { name: 'a plain artwork builds (positive control)', svg: `<svg ${SVG} viewBox="0 0 10 10"><g id="a"><circle r="1"/></g></svg>`, refuse: null, absent: [] },
  { name: 'script', svg: `<svg ${SVG}><script>alert(1)</script></svg>`, refuse: '<script> is not an allowed element' },
  { name: 'foreignObject with HTML', svg: `<svg ${SVG}><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject></svg>`, refuse: '<foreignObject> is not an allowed element' },
  { name: 'onload on the root', svg: `<svg ${SVG} onload="alert(1)"/>`, refuse: 'event attribute onload' },
  { name: 'an external use', svg: `<svg ${SVG}><use href="https://evil.example/x.svg#a"/></svg>`, refuse: 'leaves the file' },
  { name: 'an external url() in a style', svg: `<svg ${SVG}><rect style="fill:url(https://evil.example/a)"/></svg>`, refuse: 'leaves the file' },
  { name: 'an image', svg: `<svg ${SVG}><image href="#a"/></svg>`, refuse: '<image> is not an allowed element' },
  { name: 'an HTML root', svg: '<html xmlns="http://www.w3.org/1999/xhtml"><body/></html>', refuse: 'not an svg element in the SVG namespace' },
  { name: 'malformed XML', svg: `<svg ${SVG}><g></svg>`, refuse: 'not well formed XML' },
  { name: 'no namespace on the root', svg: '<svg><circle r="1"/></svg>', refuse: 'not an svg element in the SVG namespace' },
  {
    name: 'editor data and xlink are dropped, not carried',
    svg: `<svg ${SVG} xmlns:i="http://www.inkscape.org/namespaces/inkscape" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:o="urn:other"><o:meta><circle r="9"/></o:meta><g id="g" i:label="knob"><use xlink:href="https://evil.example/x"/></g></svg>`,
    refuse: null,
    absent: ['inkscape', 'xlink', 'evil.example', 'urn:other', '<circle']
  }
]

// JSON in an inline script: a literal </script> in a case would end the script, so < is escaped.
const inline = value => JSON.stringify(value).replace(/</g, '\\u003c')

const PAGE = (builderSource, skins) => `<!doctype html><meta charset="utf-8"><body><pre id="result">pending</pre>
<script>
  ${builderSource}
  const cases = ${inline(CASES)}
  const skins = ${inline(skins)}
  const out = { cases: [], skins: {} }
  try {
    for (const c of cases) {
      const r = { name: c.name }
      try {
        const doc = parseSvg(c.svg)
        const built = buildArtwork(doc, { document, prefix: 't-', size: c.svg.length })
        r.built = true
        r.output = built.svg.outerHTML
      } catch (e) {
        r.built = false
        r.isSkinError = e instanceof SkinError
        r.message = e.message
      }
      out.cases.push(r)
    }
    for (const s of skins) {
      const text = s.text
      const built = buildArtwork(parseSvg(text), { document, prefix: 's-', size: text.length })
      out.skins[s.name] = [...built.ids]
    }
  } catch (e) {
    out.error = String(e && e.stack || e)
  }
  document.getElementById('result').textContent = JSON.stringify(out)
</script>`


// ---- HTML skins -------------------------------------------------------------------------------------------------------
// Ports the corpus is built against, in the shape ProfileReader gives them.
const PORTS = [
  { symbol: 'tone', name: 'Tone', widget: 'dial', minimum: 0, maximum: 1, unit: null, scalePoints: [], comment: 'How bright it is.' },
  { symbol: 'mute', name: 'Mute', widget: 'switch', minimum: 0, maximum: 1, unit: null, scalePoints: [], comment: null },
  { symbol: 'model', name: 'Model', widget: 'selector', minimum: 0, maximum: 2, unit: null, scalePoints: [{ label: 'Keys', value: 0 }, { label: 'Reed', value: 1 }, { label: 'Pad', value: 2 }], comment: null }
]
const SLIDER = '<input type="range" data-param="tone">'
const page = (body, head = '') => `<!doctype html><html><head>${head}</head><body>${body}</body></html>`

// `refuse` is what the HtmlSkinError must say; null means it must build, and then `absent` must not survive into the output.
// Every one goes through Chrome's own HTML parser, which is the point: it moves, drops and re-nests markup in ways a test
// parser does not (a <table> with a <div> in it, a style ended by a stray </style>), and what the checker sees is what that
// parser made.
const HTML_CASES = [
  { name: 'a plain skin builds (positive control)', html: page(`<div><label for="t" data-param-name="tone"></label>${SLIDER.replace('<input', '<input id="t"')}</div>`, '<style>@layer skin { div { color: red } }</style>'), refuse: null, absent: [] },
  { name: 'script', html: page('<script>alert(1)</script>'), refuse: '<script> is not an allowed element' },
  { name: 'script in the head', html: page(SLIDER, '<script>alert(1)</script>'), refuse: 'head > script is not allowed' },
  { name: 'an image with an error handler', html: page('<img src=x onerror=alert(1)>'), refuse: '<img> is not an allowed element' },
  { name: 'a javascript: link', html: page('<a href="javascript:alert(1)">x</a>'), refuse: '<a> is not an allowed element' },
  { name: 'a form', html: page('<form action="https://evil.example/"><input name=a></form>'), refuse: '<form> is not an allowed element' },
  { name: 'an iframe with srcdoc', html: page('<iframe srcdoc="<script>alert(1)</script>"></iframe>'), refuse: '<iframe> is not an allowed element' },
  { name: 'an object', html: page('<object data="https://evil.example/x"></object>'), refuse: '<object> is not an allowed element' },
  { name: 'svg with script, which the parser puts in the SVG namespace', html: page('<svg><script>alert(1)</script></svg>'), refuse: '<svg> is not an allowed element' },
  { name: 'math, which is where mutation attacks hide', html: page('<math><mi><style><img src=x onerror=alert(1)></style></mi></math>'), refuse: '<math> is not an allowed element' },
  { name: 'a template holding a script', html: page('<template><script>alert(1)</script></template>'), refuse: '<template> is not an allowed element' },
  { name: 'a noscript holding markup', html: page('<noscript><img src=x onerror=alert(1)></noscript>'), refuse: '<noscript> is not an allowed element' },
  { name: 'a table with a div in it, which the parser moves out', html: page('<table><div></div></table>'), refuse: '<table> is not an allowed element' },
  { name: 'a base that would retarget every relative URL', html: page(SLIDER, '<base href="https://evil.example/">'), refuse: 'head > base is not allowed' },
  { name: 'a meta refresh', html: page(SLIDER, '<meta http-equiv="refresh" content="0;url=https://evil.example/">'), refuse: 'head > meta is not allowed' },
  { name: 'a linked stylesheet', html: page(SLIDER, '<link rel="stylesheet" href="https://evil.example/x.css">'), refuse: 'head > link is not allowed' },
  { name: 'an image input', html: page('<input type="image" src="https://evil.example/x" data-param="tone">'), refuse: '<input type=image> is not allowed' },
  { name: 'a button with a formaction', html: page('<button formaction="https://evil.example/">x</button>'), refuse: '<button> is not an allowed element' },
  { name: 'an event attribute on an allowed element', html: page('<div onmouseover="alert(1)"></div>'), refuse: 'onmouseover is not an allowed attribute' },
  { name: 'a style attribute', html: page('<div style="position:fixed;inset:0"></div>'), refuse: 'style is not an allowed attribute' },
  { name: 'a positive tabindex', html: page('<div tabindex="1"></div>'), refuse: 'tabindex is not an allowed attribute' },
  { name: 'a custom element', html: page('<x-knob></x-knob>'), refuse: '<x-knob> is not an allowed element' },
  { name: 'an is attribute', html: page('<div is="x-knob"></div>'), refuse: 'is is not an allowed attribute' },
  { name: 'a stylesheet closed early, so the rest is markup the parser makes', html: page(SLIDER + '<style>@layer skin { div { color: red } }</style><script>alert(1)</script><style>'), refuse: '<script> is not an allowed element' },
  { name: 'an import', html: page(SLIDER, '<style>@import url(https://evil.example/x.css);</style>'), refuse: '@import is refused' },
  { name: 'a url with a scheme, refused by the characters it needs', html: page(SLIDER, '<style>@layer skin { div { background-color: url(https://evil.example/x) } }</style>'), refuse: 'character a value may not hold' },
  { name: 'a relative url, refused as a function', html: page(SLIDER, '<style>@layer skin { div { background-color: url(x.png) } }</style>'), refuse: 'refused function' },
  { name: 'an escaped url, spelled so the word is never written', html: page(SLIDER, '<style>@layer skin { div { background-color: u\\72l(https://evil.example/x) } }</style>'), refuse: 'character a value may not hold' },
  { name: '!important, which beats the host from a lower layer', html: page(SLIDER, '<style>@layer skin { input { min-height: 1px !important } }</style>'), refuse: 'character a value may not hold' },
  { name: 'fixed positioning over the host', html: page(SLIDER, '<style>@layer skin { div { position: fixed; top: 0; left: 0; width: 100vw; height: 100vh } }</style>'), refuse: 'position fixed is not allowed' },
  { name: 'a rule outside the skin layer', html: page(SLIDER, '<style>input { min-height: 1px }</style>'), refuse: 'outside @layer skin' },
  { name: 'text that looks like markup is carried as text', html: page('<p>&lt;img src=x onerror=alert(1)&gt;</p>'), refuse: null, absent: ['<img'] }
]

const HTML_PAGE = (builderSource, cases, skins) => `<!doctype html><meta charset="utf-8"><body><pre id="result">pending</pre><div id="stage"></div>
<script>
  ${builderSource}
  const ports = ${inline(PORTS)}
  const cases = ${inline(cases)}
  const skins = ${inline(skins)}
  const out = { cases: [], skins: {}, mounted: null }
  const parse = text => parseHtml(text)
  try {
    for (const c of cases) {
      const r = { name: c.name }
      try {
        const doc = parse(c.html)
        const built = buildHtmlSkin(doc, { ports }, { document, prefix: 't-', size: c.html.length })
        r.built = true
        r.output = built.root.outerHTML + built.css
      } catch (e) {
        r.built = false
        r.isHtmlSkinError = e instanceof HtmlSkinError
        r.message = e.message
        r.problems = e.problems
      }
      out.cases.push(r)
    }
    for (const s of skins) {
      try {
        const built = buildHtmlSkin(parse(s.text), { ports: s.ports }, { document, prefix: 's-', size: s.text.length })
        out.skins[s.name] = { ok: true, controls: built.controls.map(c => c.port.symbol), omitted: built.omitted }
        // Every width a panel might be given, not a few. A card's minimum can be wider than its track's, and the skin then
        // overflows only between two widths: found by hand at 1100 and 1500 pixels in Drumkit, passing at the sizes first tried.
        const sweepBuilt = buildHtmlSkin(parse(s.text), { ports: s.ports }, { document, prefix: 'w-', size: s.text.length })
        const sweepPanel = createHtmlSkinPanel(document, sweepBuilt, s.ports, () => {}, { scope: 'sweep' })
        document.getElementById('stage').append(sweepPanel.element)
        const inner = sweepPanel.element.shadowRoot
        const overflow = []
        const small = []
        const widths = []
        for (let w = 200; w <= 1600; w += 50) {
          sweepPanel.element.style.width = w + 'px'
          void sweepPanel.element.offsetWidth
          // Where the controls are, not scrollWidth: a row that spills out of a card is not always reported by the scroll width of the
          // skin's root, as the first version of this sweep found by passing on the very skin it was written for.
          const edge = sweepPanel.element.getBoundingClientRect()
          // Everything the skin draws, not only its controls: it was the value readout in the third column that spilled, and a sweep
          // of the inputs alone passed the broken skin. The hidden descriptions are 1px clipped boxes and are not drawn.
          const drawn = [...inner.querySelectorAll('.html-skin *')].filter(e => !e.classList.contains('visually-hidden'))
          const controls = [...inner.querySelectorAll('input, select')]
          const spilled = drawn.filter(c => { const b = c.getBoundingClientRect(); return b.right > edge.right + 0.5 || b.left < edge.left - 0.5 })
          const scroll = inner.querySelector('.html-skin').scrollWidth - sweepPanel.element.clientWidth
          const over = Math.max(scroll, spilled.length ? Math.round(Math.max(...spilled.map(c => c.getBoundingClientRect().right)) - edge.right) : 0)
          widths.push(w + ':' + over)
          if (over > 0) overflow.push(w + ':' + over)
          for (const c of inner.querySelectorAll('input, select')) {
            const b = c.getBoundingClientRect()
            if (b.height < 43.5 || (c.type === 'checkbox' && b.width < 43.5)) small.push(w + ':' + c.getAttribute('data-param'))
          }
        }
        sweepPanel.element.remove()
        out.skins[s.name].sweep = { overflow, small: small.slice(0, 5), smallCount: small.length, widths }
      } catch (e) {
        out.skins[s.name] = { ok: false, message: e.message }
      }
    }

    // The built panel, in a real shadow root. The author's stylesheet tries to shrink a target, remove the focus ring and
    // throw a control out of the box; the host's own rules are written outside the author's layer and must win.
    const hostile = '<div class="a"><input id="t" type="range" data-param="tone"><select id="s" data-param="model"></select><input id="m" type="checkbox" data-param="mute"><span class="far"></span></div>' +
      '<style>@layer skin { input { height: 1px; min-height: 1px; outline: none } select { font-size: 3px; height: 2px } input:focus-visible { outline: none; outline-offset: 0px } .far { position: absolute; top: 4000px; left: 0px; width: 9px; height: 9px } .a { background-color: red } }</style>'
    const built = buildHtmlSkin(parse('<!doctype html><html><head></head><body>' + hostile + '</body></html>'), { ports }, { document, prefix: 'h-' })
    const changes = []
    const panel = createHtmlSkinPanel(document, built, ports, (s, v) => changes.push([s, v]), { scope: 'check' })
    panel.element.style.width = '300px'
    document.getElementById('stage').append(panel.element)
    const sr = panel.element.shadowRoot
    const t = sr.getElementById('h-t')
    const sel = sr.getElementById('h-s')
    // The ring is written for :focus-visible, which a headless page cannot be relied on to match: it needs the window to have the
    // focus, and under load it does not. So the check is of the cascade, which is what could fail: the real sheet is kept as it
    // is, and a copy has :focus-visible swapped for :enabled, which is always true, in the author's rule and the host's alike.
    // The swap changes the state and nothing else, so the same layers and the same specificity decide.
    const realSheet = sr.querySelector('style').textContent
    const ringRuleInSheet = realSheet.indexOf('input:focus-visible,select:focus-visible{outline:2px solid') > realSheet.indexOf('}}')
    sr.querySelector('style').textContent = realSheet.replace(/:focus-visible/g, ':enabled')
    const cs = getComputedStyle(t)
    const host = getComputedStyle(panel.element)
    out.mounted = {
      shadow: Boolean(sr),
      rangeMinHeight: cs.minHeight,
      rangeHeight: t.getBoundingClientRect().height,
      selectHeight: sel.getBoundingClientRect().height,
      selectFont: getComputedStyle(sel).fontSize,
      ringRuleInSheet,
      outlineStyle: cs.outlineStyle,
      outlineWidth: cs.outlineWidth,
      hostContain: host.contain,
      hostIsolation: host.isolation,
      hostContainer: host.containerType,
      // The box the host gave it, and where the throwaway element the author put 4000px down ended up: clipped, not visible.
      hostHeight: panel.element.getBoundingClientRect().height,
      documentScrollHeight: document.documentElement.scrollHeight,
      authorColourReachedPage: getComputedStyle(document.body).backgroundColor,
      authorClassOnPage: document.querySelectorAll('.a').length
    }
  } catch (e) {
    out.error = String(e && e.stack || e)
  }
  document.getElementById('result').textContent = JSON.stringify(out)
</script>`

/** Runs `html` in headless Chrome and returns the JSON the page wrote to #result, or { error }. */
async function runInChrome (html) {
  let dir = null
  try {
    // A throwaway profile, or Chrome hands the URL to an already running instance and prints nothing.
    dir = await mkdtemp(join(tmpdir(), 'jig-skins-'))
    const pagePath = join(dir, 'page.html')
    await writeFile(pagePath, html)
    const result = await new Promise(done => execFile(chrome, [
      '--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${dir}`, '--virtual-time-budget=5000',
      '--dump-dom', `file://${pagePath}`
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => done({ error, stdout, stderr })))
    if (result.error) return { failure: `Chrome failed: ${String(result.error.message).slice(0, 300)} ${result.stderr.slice(0, 300)}` }
    const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(result.stdout)
    if (!m || m[1] === 'pending') return { failure: `the page produced no result ${result.stdout.slice(0, 600)}` }
    return { out: JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&')) }
  } finally {
    if (dir) await rm(dir, { recursive: true, force: true })
  }
}

/** The HTML builder and its panel as one classic script: modules in dependency order, imports and exports removed. */
async function htmlBuilderSource () {
  const files = ['src/ui/HtmlSkinCss.js', 'src/ui/HtmlSkin.js', 'src/ui/PortText.js', 'src/ui/SliderDrag.js', 'src/ui/HtmlSkinPanel.js']
  const parts = []
  for (const f of files) {
    const text = await readFile(join(root, f), 'utf8')
    parts.push(text.split('\n').filter(line => !/^import\s.*from\s/.test(line)).map(line => line.replace(/^export\s+/, '')).join('\n'))
  }
  return parts.join('\n').replace(/<\/script/gi, '<\\/script')
}

/** The HTML half of the check. Returns the lines to print and whether anything failed. */
async function checkHtmlSkins (htmlPlugins) {
  const lines = []
  let failed = false
  const fail = message => { failed = true; lines.push(`FAIL ${message}`) }
  const skins = []
  for (const p of htmlPlugins) {
    const profile = readProfile(await parseText(await readFile(join(p.dir, 'profile.ttl'), 'utf8'), p.template.iri))
    skins.push({ name: p.name, text: await readFile(join(p.dir, p.template.skin.html), 'utf8'), ports: profile.ports })
  }
  const ran = await runInChrome(HTML_PAGE(await htmlBuilderSource(), HTML_CASES, skins))
  if (ran.failure) return { failed: true, lines: [ran.failure] }
  const { out } = ran
  if (out.error) return { failed: true, lines: [`the HTML page threw: ${out.error}`] }

  for (const c of HTML_CASES) {
    const r = out.cases.find(x => x.name === c.name)
    if (c.refuse === null) {
      if (!r.built) fail(`${c.name}: expected it to build, got "${r.message}"`)
      else {
        const survived = (c.absent ?? []).filter(bad => r.output.includes(bad))
        if (survived.length) fail(`${c.name}: ${survived.join(', ')} survived into ${r.output}`)
        else lines.push(`ok   html: ${c.name}`)
      }
    } else if (r.built) fail(`${c.name}: expected a refusal containing "${c.refuse}", but it built`)
    else if (!r.isHtmlSkinError || !r.problems.some(x => x.includes(c.refuse))) fail(`${c.name}: expected a refusal containing "${c.refuse}", got ${JSON.stringify(r.problems ?? r.message)}`)
    else lines.push(`ok   html: ${c.name}`)
  }

  for (const p of htmlPlugins) {
    const r = out.skins[p.name]
    const profile = skins.find(s => s.name === p.name)
    if (!r.ok) fail(`${p.name}: the skin is refused in Chrome: ${r.message}`)
    else if (r.omitted.length) for (const o of r.omitted) fail(`${p.name}: ${o.element} would be left out: ${o.reason}`)
    else {
      const unbound = profile.ports.map(x => x.symbol).filter(sym => !r.controls.includes(sym))
      lines.push(`ok   ${p.name}: html skin builds in Chrome with ${r.controls.length} controls; unbound ports: ${unbound.join(', ') || 'none'}`)
      if (r.sweep.overflow.length) fail(`${p.name}: the skin overflows its box at (width:pixels) ${r.sweep.overflow.join(', ')}`)
      else if (r.sweep.smallCount) fail(`${p.name}: ${r.sweep.smallCount} controls are under 44px (width:control) ${r.sweep.small.join(', ')}`)
      else if (process.env.JIG_CHECK_VERBOSE) lines.push(`sweep ${p.name} (width:overflow) ${r.sweep.widths.join(' ')}`)
      if (!r.sweep.overflow.length && !r.sweep.smallCount) lines.push(`ok   ${p.name}: no overflow and every target at least 44px, from 200 to 1600px in steps of 50`)
    }
  }

  // What only a real cascade can say.
  const m = out.mounted
  const expect = (name, ok, detail) => ok ? lines.push(`ok   html: ${name}`) : fail(`${name}: ${detail}`)
  expect('the skin is in a shadow root', m.shadow, 'it is not')
  expect('the author cannot shrink a slider below 44px', m.rangeMinHeight === '44px' && m.rangeHeight >= 44, `min-height ${m.rangeMinHeight}, height ${m.rangeHeight}`)
  expect('the author cannot shrink a select below 44px, or its text below 16px', m.selectHeight >= 44 && m.selectFont === '16px', `height ${m.selectHeight}, font ${m.selectFont}`)
  expect('the host\'s focus ring is in the sheet, after and outside the author\'s layer', m.ringRuleInSheet, 'it is not')
  expect('the author cannot remove the focus ring (the cascade, with :enabled standing in for :focus-visible)', m.outlineStyle === 'solid' && m.outlineWidth === '2px', `outline ${m.outlineStyle} ${m.outlineWidth}`)
  expect('the host contains and isolates what it draws', /(layout|content)/.test(m.hostContain) && m.hostIsolation === 'isolate' && m.hostContainer === 'inline-size', `contain ${m.hostContain}, isolation ${m.hostIsolation}, container-type ${m.hostContainer}`)
  expect('an element thrown 4000px away does not stretch the page', m.documentScrollHeight < 2000, `the document is ${m.documentScrollHeight}px tall`)
  expect('the author\'s styles do not reach the page', m.authorClassOnPage === 0 && m.authorColourReachedPage !== 'rgb(255, 0, 0)', `${m.authorClassOnPage} .a in the page, body ${m.authorColourReachedPage}`)
  return { failed, lines }
}

async function plugins () {
  const found = []
  for (const name of (await readdir(join(root, 'plugins'))).sort()) {
    const jsonPath = join(root, 'plugins', name, 'profile.json')
    if (!existsSync(jsonPath)) continue
    const template = JSON.parse(await readFile(jsonPath, 'utf8'))
    if (template.skin) found.push({ name, dir: join(root, 'plugins', name), template, html: Boolean(template.skin.html) })
  }
  return found
}

export async function checkSkins () {
  if (!existsSync(chrome)) return { code: 3, lines: [`no Chrome at ${chrome}; set CHROME_BIN. Nothing was checked.`] }
  const everything = await plugins()
  const withSkins = everything.filter(p => !p.html)
  const htmlPlugins = everything.filter(p => p.html)
  // The builder is inlined as a classic script, because a file: page cannot import a module and a
  // local server made Chrome wait about 25 s (found by timing it; a data: page took 0.7 s).
  const source = await readFile(join(root, 'src/ui/SkinArtwork.js'), 'utf8')
  if (/^import\s/m.test(source)) throw new Error('SkinArtwork.js imports something, so it cannot be inlined into the check page')
  const builderSource = source.replace(/^export /gm, '').replace(/<\/script/gi, '<\\/script')
  const skins = []
  for (const p of withSkins) skins.push({ name: p.name, text: await readFile(join(p.dir, p.template.skin.artwork), 'utf8') })
  const lines = []
  let profile = null
  let failed = false
  const fail = message => { failed = true; lines.push(`FAIL ${message}`) }
  try {
    // A throwaway profile, or Chrome hands the URL to an already running instance and prints nothing.
    profile = await mkdtemp(join(tmpdir(), 'jig-skins-'))
    const pagePath = join(profile, 'page.html')
    await writeFile(pagePath, PAGE(builderSource, skins))
    const result = await new Promise(done => execFile(chrome, [
      '--headless=new', '--no-sandbox', '--disable-gpu', `--user-data-dir=${profile}`, '--virtual-time-budget=5000',
      '--dump-dom', `file://${pagePath}`
    ], { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => done({ error, stdout, stderr })))
    if (result.error) return { code: 1, lines: [`Chrome failed: ${String(result.error.message).slice(0, 300)} ${result.stderr.slice(0, 300)}`] }
    const m = /<pre id="result">([\s\S]*?)<\/pre>/.exec(result.stdout)
    if (!m || m[1] === 'pending') return { code: 1, lines: ['the page produced no result', result.stdout.slice(0, 600)] }
    const out = JSON.parse(m[1].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
    if (out.error) return { code: 1, lines: [`the page threw: ${out.error}`] }

    for (const c of CASES) {
      const r = out.cases.find(x => x.name === c.name)
      if (c.refuse === null) {
        if (!r.built) fail(`${c.name}: expected it to build, got "${r.message}"`)
        else {
          const survived = c.absent.filter(bad => r.output.includes(bad))
          if (survived.length) fail(`${c.name}: ${survived.join(', ')} survived into ${r.output}`)
          else lines.push(`ok   ${c.name}`)
        }
      } else if (r.built) fail(`${c.name}: expected a refusal containing "${c.refuse}", but it built`)
      else if (!r.isSkinError || !r.message.includes(c.refuse)) fail(`${c.name}: expected a SkinError containing "${c.refuse}", got "${r.message}"`)
      else lines.push(`ok   ${c.name}`)
    }

    for (const p of withSkins) {
      const ids = out.skins[p.name]
      const skinPath = join(p.dir, p.template.skin.file)
      const iri = new URL(p.template.skin.file, p.template.iri).href
      const skin = readSkin(await parseText(await readFile(skinPath, 'utf8'), iri))
      const profile = readProfile(await parseText(await readFile(join(p.dir, 'profile.ttl'), 'utf8'), p.template.iri))
      const checked = checkSkin(skin, { ids: new Map(ids) }, profile.ports)
      if (checked.omitted.length) for (const o of checked.omitted) fail(`${p.name}: ${o.control} would be left out: ${o.reason}`)
      else lines.push(`ok   ${p.name}: ${checked.keep.length} controls agree with the artwork and the profile; unbound ports: ${checked.unbound.join(', ') || 'none'}`)
    }

    const html = await checkHtmlSkins(htmlPlugins)
    lines.push(...html.lines)
    if (html.failed) failed = true
  } finally {
    if (profile) await rm(profile, { recursive: true, force: true })
  }
  return { code: failed ? 1 : 0, lines }
}

if (isMain(import.meta.url)) {
  const { code, lines } = await checkSkins()
  for (const l of lines) console.log(l)
  process.exit(code)
}
