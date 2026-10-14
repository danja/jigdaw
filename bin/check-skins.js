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

async function plugins () {
  const found = []
  for (const name of (await readdir(join(root, 'plugins'))).sort()) {
    const jsonPath = join(root, 'plugins', name, 'profile.json')
    if (!existsSync(jsonPath)) continue
    const template = JSON.parse(await readFile(jsonPath, 'utf8'))
    if (template.skin) found.push({ name, dir: join(root, 'plugins', name), template })
  }
  return found
}

export async function checkSkins () {
  if (!existsSync(chrome)) return { code: 3, lines: [`no Chrome at ${chrome}; set CHROME_BIN. Nothing was checked.`] }
  const withSkins = await plugins()
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
  } finally {
    if (profile) await rm(profile, { recursive: true, force: true })
  }
  return { code: failed ? 1 : 0, lines }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { code, lines } = await checkSkins()
  for (const l of lines) console.log(l)
  process.exit(code)
}
