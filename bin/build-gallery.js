// bin/build-gallery.js
//
// Build the downspout-style plugin catalogue page: one headless-Chrome
// screenshot per plugin panel, plus web/gallery.html grouping them the way
// https://danja.github.io/downspout/ groups its own (Generative, MIDI,
// Instruments, Processors).
//
// Usage:
//   node bin/build-gallery.js [--shots|--no-shots] [--width N] [--height N]
//
// --no-shots rebuilds the page from the screenshots already on disk, so text
// edits do not need a browser. The default takes fresh screenshots.
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pluginDirs } from '../src/catalogue/PluginDirectories.js'
import { parseText } from '../src/rdf/parse.js'
import { readProfile } from '../src/rdf/ProfileReader.js'
import {
  escapeHtml, listLocalPlugins, dirNameOf, renderPanelHTML, shotPanel
} from './jig.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const galleryDir = join(root, 'web/gallery')
const panelsDir = join(galleryDir, 'panels')
const shotsDir = join(galleryDir, 'shots')

const compact = value => String(value).split('/').pop()

/**
 * Which downspout-style section a plugin belongs under. First match wins, in
 * the order the page shows them, so a plugin is never in two sections and
 * never in none without saying so.
 */
export function categoryFor (entry) {
  const roles = (entry.roles ?? []).map(compact)
  if (roles.includes('MidiGenerator')) return 'Generative'
  if (roles.includes('MidiProcessor')) return 'MIDI'
  if (roles.includes('Instrument') || roles.includes('AudioInstrument') || roles.includes('DrumInstrument')) return 'Instruments'
  if (roles.includes('AudioEffect')) return 'Processors'
  return 'Other'
}

export const CATEGORIES = ['Generative', 'MIDI', 'Instruments', 'Processors', 'Other']

const BLURBS = {
  Generative: 'Sources of musical material: melody, bass, drum and harmony generators playing in time with the session.',
  MIDI: 'Processors shaping MIDI before it reaches an instrument.',
  Instruments: 'Playable sound sources: synths and drum instruments.',
  Processors: 'Audio effects shaping sound.',
  Other: 'Anything the sections above do not cover.'
}

async function loadEntry (name) {
  const file = join(root, 'plugins', name, 'profile.ttl')
  const profile = readProfile(await parseText(await readFile(file, 'utf8'), `file://${file}`))
  return profile
}

export function card (entry, shot) {
  const name = dirNameOf(entry.iri)
  const img = shot
    ? `<a class="shot" href="gallery/shots/${name}.png" data-full="gallery/shots/${name}.png" data-label="${escapeHtml(entry.label)}" aria-haspopup="dialog" aria-label="View full-size ${escapeHtml(entry.label)} panel"><img src="gallery/shots/${name}.png" alt="${escapeHtml(entry.label)} panel" loading="lazy"></a>`
    : `<div class="no-shot">No screenshot yet. Run <code>node bin/build-gallery.js</code>.</div>`
  return `<article class="card">
${img}
<h3>${escapeHtml(entry.label)}</h3>
<p>${escapeHtml(entry.comment ?? '')}</p>
<p class="meta">${escapeHtml((entry.roles ?? []).join(', '))} . ${(entry.parameters ?? []).length} controls . accepts ${escapeHtml((entry.accepts ?? []).join(', ') || 'nothing')} &rarr; produces ${escapeHtml((entry.produces ?? []).join(', ') || 'nothing')}</p>
<p class="links"><a href="plugins/${name}/">Profile</a> <a href="plugins/${name}/profile.ttl">Turtle</a></p>
</article>`
}

/**
 * The full-size viewer: one dialog for the whole page, filled in from the
 * thumbnail's data attributes when it opens. A thumbnail is a plain link to
 * its PNG, so without script it still opens the image; with script the click
 * is intercepted and the dialog shows it in place instead. Escape and the
 * Close button are native dialog behaviour, not reimplemented.
 */
export function lightboxMarkup () {
  return `<dialog id="shot-viewer" aria-labelledby="shot-viewer-title">
<h2 id="shot-viewer-title"></h2>
<img class="viewer-img" src="" alt="">
<form method="dialog"><button value="close">Close</button></form>
</dialog>
<script>
document.querySelector('main').addEventListener('click', event => {
  const link = event.target.closest('a.shot');
  if (!link) return;
  const viewer = document.getElementById('shot-viewer');
  if (!viewer || typeof viewer.showModal !== 'function') return;
  event.preventDefault();
  const img = viewer.querySelector('img');
  img.src = link.dataset.full;
  img.alt = link.dataset.label + ' panel, full size';
  viewer.querySelector('h2').textContent = link.dataset.label;
  viewer.showModal();
});
document.getElementById('shot-viewer').addEventListener('click', event => {
  if (event.target.id === 'shot-viewer') event.target.close();
});
</script>`
}

export async function buildGallery ({ shots = true, width = 1100, height = null } = {}) {
  const entries = await listLocalPlugins()
  const names = await pluginDirs(join(root, 'plugins'))
  const byIri = new Map(entries.map(e => [dirNameOf(e.iri), e]))
  for (const name of names) {
    if (!byIri.has(name)) throw new Error(`plugins/${name}/ has no entry in plugins/index.json; run npm run build:index`)
  }

  await mkdir(panelsDir, { recursive: true })
  await mkdir(shotsDir, { recursive: true })

  const taken = {}
  for (const entry of entries) {
    const name = dirNameOf(entry.iri)
    const profile = await loadEntry(name)
    const panel = await renderPanelHTML(profile)
    await writeFile(join(panelsDir, `${name}.html`), panel)
    if (shots) {
      try {
        // Taller panels need a taller viewport or the shot crops them:
        // about one row of knobs per 22px over a 520px header, within reason.
        const auto = Math.min(2600, Math.max(800, 520 + profile.ports.length * 22))
        await shotPanel(name, { out: join(shotsDir, `${name}.png`), width, height: height ?? auto })
        taken[name] = true
      } catch (error) {
        console.warn(`shot ${name}: ${error.message}`)
        taken[name] = existsSync(join(shotsDir, `${name}.png`))
      }
    } else {
      taken[name] = existsSync(join(shotsDir, `${name}.png`))
    }
  }

  const sections = CATEGORIES.map(category => ({
    category,
    blurb: BLURBS[category],
    entries: entries.filter(e => categoryFor(e) === category)
  })).filter(section => section.entries.length > 0)

  const nav = sections.map(section => `<a href="#${section.category.toLowerCase()}">${section.category}</a>`).join(' ')
  const body = sections.map(section => `<h2 id="${section.category.toLowerCase()}">${section.category}</h2>
<p>${escapeHtml(section.blurb)}</p>
<div class="grid">
${section.entries.map(entry => card(entry, taken[dirNameOf(entry.iri)])).join('\n')}
</div>`).join('\n')

  const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Jigs: plugin gallery</title>
<style>
:root{color-scheme:dark;--bg:#101216;--panel:#181b21;--fg:#e8eaed;--dim:#8b93a1;--line:#2a2f38;--accent:#3182ce}
*{box-sizing:border-box}
body{margin:0;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg)}
main{max-width:1100px;margin:0 auto;padding:24px 16px 64px}
nav{display:flex;gap:14px;flex-wrap:wrap;margin:12px 0 24px}
nav a{color:var(--dim)}
h1{font-size:28px;margin:8px 0}
h2{font-size:20px;margin:40px 0 4px}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));margin-top:12px}
.card{background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:12px;overflow:hidden}
.shot{display:block;padding:0;border:1px solid var(--line);border-radius:4px;background:#0e1013;cursor:zoom-in}
.shot img{display:block;width:100%;height:220px;object-fit:cover;object-position:top;border:0}
.card h3{margin:10px 0 4px;font-size:16px}
.card p{margin:6px 0}
.meta{color:var(--dim);font-size:12px}
.links{display:flex;gap:12px;font-size:13px}
.links a{color:var(--accent)}
.no-shot{height:220px;display:flex;align-items:center;justify-content:center;color:var(--dim);border:1px dashed var(--line);border-radius:4px;text-align:center;padding:12px}
#shot-viewer{max-width:min(1100px,96vw);background:var(--panel);color:var(--fg);border:1px solid var(--line);border-radius:8px;padding:16px}
#shot-viewer::backdrop{background:rgba(0,0,0,.7)}
#shot-viewer h2{margin:0 0 8px;font-size:18px}
.viewer-img{display:block;width:100%;height:auto;max-height:76vh;object-fit:contain;background:#0e1013}
#shot-viewer form{margin:12px 0 0;text-align:right}
#shot-viewer button{min-height:44px;padding:8px 18px;font-size:15px;background:#242a33;color:var(--fg);border:1px solid var(--line);border-radius:5px;cursor:pointer}
@media (max-width:720px){main{padding:16px 12px 48px}.shot img{height:180px}}
</style>
</head>
<body>
<main>
<p><a href="./">Jiggy</a> / plugin gallery</p>
<h1>Jigs</h1>
<p>Every plugin in this repository, with its generated control panel. Panels are drawn by the same generator the host uses, so what you see here is what you get in Jiggy. Screenshots are refreshed by <code>node bin/build-gallery.js</code>; panels by <code>node bin/jig.js panel &lt;name&gt;</code>.</p>
<nav aria-label="Sections">${nav}</nav>
${body}
</main>
${lightboxMarkup()}
</body>
</html>
`
  await writeFile(join(root, 'web/gallery.html'), page)
  const shotCount = Object.values(taken).filter(Boolean).length
  console.log(`web/gallery.html: ${entries.length} plugin(s), ${shotCount} screenshot(s)`)
  return { entries: entries.length, shots: shotCount }
}

const invoked = process.argv[1] === fileURLToPath(import.meta.url)
if (invoked) {
  const args = process.argv.slice(2)
  const shots = !args.includes('--no-shots')
  const width = Number(args[args.indexOf('--width') + 1] ?? 1100) || 1100
  const heightIndex = args.indexOf('--height')
  const height = heightIndex === -1 ? null : (Number(args[heightIndex + 1]) || null)
  await buildGallery({ shots, width, height })
}
