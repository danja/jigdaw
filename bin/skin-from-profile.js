// bin/skin-from-profile.js
//
// A first draft of an HTML skin (docs/html-skins.md) for a plugin, written from its profile.json: one card for each group of
// ports, a row for each port, a slider, a switch or a select by the shape of the port, and the stylesheet the committed skins
// settled on. It is a draft to edit by hand and not a source: the skin is committed as markup, and this is not run again over it.
//
//   node bin/skin-from-profile.js plugins/quartet           writes plugins/quartet/skin/skin.html, adds the skin key
//   node bin/skin-from-profile.js plugins/quartet --force   replaces a skin that is already there
//
// It does not run the plugin's build.sh, which is what writes the digest into profile.ttl. Run that next. It refuses a plugin that
// has an SVG skin, since a plugin has at most one, and leaves profile.json alone, saying so, if rewriting it would change anything
// but the one key.
//
// What it decides, and why:
// - A row's label is the port's name less the words every port in its group begins with, when the group has three or more ports and
//   every port keeps a word. "Op A Waveform" in "Operator A" becomes "Waveform". The accessible name stays the full name, which
//   contains the label, as WCAG 2.5.3 asks, and the skin panel reports a label that does not.
// - Ports with no group go in a last card, "Controls".
// - The widget comes from the host's own rule (ProfileReader.widgetFor), so the skin and the generated panel agree.
import { readFile, writeFile, mkdir, access } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { widgetFor } from '../src/rdf/ProfileReader.js'
import { isMain } from './is-main.js'

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** The widget the host draws for a port as profile.json writes it. An enumeration is a port with scale points. */
export const widgetOf = port => widgetFor({ toggled: Boolean(port.toggled), enumeration: Boolean(port.scalePoints?.length), scalePoints: port.scalePoints ?? [] })

/** The words every name in `names` starts with, as a string with its trailing space, or '' when there are fewer than three. */
export function sharedPrefix (names) {
  if (names.length < 3) return ''
  const words = names.map(n => n.split(' '))
  let shared = 0
  while (words.every(w => w.length > shared + 1 && w[shared] === words[0][shared])) shared++
  return shared ? `${words[0].slice(0, shared).join(' ')} ` : ''
}

function rowOf (port, prefix) {
  const label = escape(prefix && port.name.startsWith(prefix) ? port.name.slice(prefix.length) : port.name)
  const s = port.symbol
  const widget = widgetOf(port)
  if (widget === 'selector') return `      <div class="row pick"><label for="${s}">${label}</label><select id="${s}" data-param="${s}"></select></div>`
  if (widget === 'switch') return `      <div class="row flip"><label for="${s}">${label}</label><input id="${s}" type="checkbox" data-param="${s}"></div>`
  return `      <div class="row"><label for="${s}">${label}</label><input id="${s}" type="range" data-param="${s}"><output data-param-text="${s}"></output></div>`
}

const STYLE = `  <style>
    @layer skin {
      .panel { container-type: inline-size; color-scheme: dark; background-color: #1a1e24; color: #e6e8eb; padding: 12px; font-family: sans-serif; font-size: 16px; }
      h1 { font-size: 14px; margin: 0 0 10px; color: #9aa3ad; font-weight: 600; letter-spacing: 0.04em; }
      h2 { font-size: 14px; margin: 0 0 6px; color: #e6e8eb; font-weight: 600; }
      .help { margin: 0 0 8px; min-height: 3em; color: #9aa3ad; font-size: 14px; }
      .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(18rem, 100%), 1fr)); gap: 12px; }
      .card { min-width: 0; background-color: #0e1116; border: 1px solid #2c333c; border-radius: 8px; padding: 8px 12px; }
      .row { display: grid; grid-template-columns: 5.5rem 1fr 4.5rem; align-items: center; column-gap: 10px; min-height: 44px; }
      .row input { width: 100%; min-width: 0; }
      .flip { grid-template-columns: 1fr auto; }
      .flip input { width: auto; justify-self: end; }
      .pick select { grid-column: 2 / 4; min-width: 0; font-size: 16px; background-color: #1a1e24; color: #e6e8eb; border: 1px solid #2c333c; border-radius: 6px; }
      label { color: #9aa3ad; }
      output { text-align: right; white-space: nowrap; }
      input { accent-color: #3d8bfd; }
      @container (max-width: 360px) {
        .row { grid-template-columns: 1fr 4.5rem; }
        .flip { grid-template-columns: 1fr auto; }
        .row input { grid-column: 1 / 3; }
        .flip input { grid-column: 2; }
        .pick select { grid-column: 1 / 3; }
      }
    }
  </style>`

/**
 * @param {{ label: string, ports: object[] }} template a plugin's profile.json
 * @returns {string} the skin as one HTML file
 */
export function generateSkin (template) {
  const groups = []
  for (const port of template.ports) {
    const name = port.group ?? null
    let group = groups.find(g => g.name === name)
    if (!group) { group = { name, ports: [] }; groups.push(group) }
    group.ports.push(port)
  }
  // Ports with no group come last, whatever order they were declared in.
  groups.sort((a, b) => (a.name === null) - (b.name === null))

  const cards = groups.map(group => {
    const prefix = sharedPrefix(group.ports.map(p => p.name))
    return [
      '    <section class="card">',
      `      <h2>${escape(group.name ?? 'Controls')}</h2>`,
      ...group.ports.map(p => rowOf(p, prefix)),
      '    </section>'
    ].join('\n')
  })

  return `<!doctype html>
<!--
  skin/skin.html

  ${escape(template.label)}'s skin: an HTML skin (docs/html-skins.md). One card for each group of ports. Markup bound with
  data-param and one stylesheet, no script, built by the host from an allowlist and drawn in its own document.

  Started by bin/skin-from-profile.js and then edited by hand: it is not generated again over this file.
-->
<html lang="en">
<head></head>
<body>
<div class="panel">
  <h1>${escape(template.label)}</h1>
  <p class="help" data-param-help></p>
  <div class="cards">
${cards.join('\n')}
  </div>
${STYLE}
</div>
</body>
</html>
`
}

/** Writes the draft and adds the skin key to profile.json. Returns what it did, in words. */
export async function writeSkin (dir, { force = false } = {}) {
  const profilePath = join(dir, 'profile.json')
  const text = await readFile(profilePath, 'utf8')
  const template = JSON.parse(text)
  if (template.skin?.artwork) throw new Error(`${dir} has an SVG skin, and a plugin has at most one skin`)
  const target = join(dir, 'skin/skin.html')
  const exists = await access(target).then(() => true, () => false)
  if (exists && !force) throw new Error(`${target} exists; pass --force to replace it`)

  await mkdir(join(dir, 'skin'), { recursive: true })
  await writeFile(target, generateSkin(template))
  const done = [`wrote ${target}`]

  if (template.skin?.html === 'skin/skin.html') return done
  // Rewriting the file would also reformat anything it holds differently, so it is rewritten only when that changes the one key.
  const rewritten = JSON.stringify({ ...template, skin: { html: 'skin/skin.html' } }, null, 2) + '\n'
  const expected = JSON.stringify(template, null, 2) + '\n'
  if (expected !== text) {
    done.push(`left ${profilePath} alone, since rewriting it would change more than one key: add "skin": { "html": "skin/skin.html" } to it by hand`)
  } else {
    await writeFile(profilePath, rewritten)
    done.push(`added "skin": { "html": "skin/skin.html" } to ${profilePath}`)
  }
  return done
}

if (isMain(import.meta.url)) {
  const args = process.argv.slice(2)
  const dir = args.find(a => !a.startsWith('--'))
  if (!dir) {
    console.error('usage: node bin/skin-from-profile.js <plugin-directory> [--force]')
    process.exit(2)
  }
  try {
    for (const line of await writeSkin(resolve(dir), { force: args.includes('--force') })) console.log(line)
    console.log('next: edit the skin, then run the plugin\'s build.sh, which writes its digest into profile.ttl')
  } catch (error) {
    console.error(`skin-from-profile: ${error.message}`)
    process.exit(1)
  }
}
