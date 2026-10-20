// bin/docs-catalogue.js
//
// The example plugin catalogue page for the documentation site, generated from
// plugins/index.json so it cannot list a plugin that is not there or miss one
// that is. Sections and their blurbs come from bin/build-gallery.js, the other
// catalogue, so the two group plugins the same way.
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { categoryFor, CATEGORIES, BLURBS } from './build-gallery.js'

const REPO = 'https://github.com/danja/jigdaw'
const LIVE = 'https://strandz.it/jigdaw/'

const escapeHtml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]))
const nameOf = iri => iri.replace(/\/$/, '').split('/').pop()

function card (entry, hasShot) {
  const name = nameOf(entry.iri)
  const label = escapeHtml(entry.label)
  const shot = hasShot
    ? `<a class="shot" href="${LIVE}plugins/${name}/"><img src="shots/${name}.png" alt="${label} panel" loading="lazy"></a>`
    : ''
  const accepts = (entry.accepts ?? []).join(', ') || 'nothing'
  const produces = (entry.produces ?? []).join(', ') || 'nothing'
  return `<article class="card">
${shot}
<h3>${label}</h3>
<p>${escapeHtml(entry.comment ?? '')}</p>
<p class="meta">${(entry.parameters ?? []).length} controls. Accepts ${escapeHtml(accepts)}, produces ${escapeHtml(produces)}.</p>
<p class="links"><a href="${LIVE}plugins/${name}/">Profile</a> <a href="${LIVE}plugins/${name}/profile.ttl">Turtle</a> <a href="${REPO}/tree/main/plugins/${name}/">Source</a></p>
</article>`
}

/** The page body, and the names of the screenshots it refers to so the build can copy them. */
export async function renderCatalogue (root) {
  const { plugins } = JSON.parse(await readFile(join(root, 'plugins/index.json'), 'utf8'))
  const shotsDir = join(root, 'web/gallery/shots')
  const shots = []
  const sections = CATEGORIES.map(category => {
    const entries = plugins.filter(p => categoryFor(p) === category)
    if (entries.length === 0) return ''
    const cards = entries.map(entry => {
      const name = nameOf(entry.iri)
      const hasShot = existsSync(join(shotsDir, `${name}.png`))
      if (hasShot) shots.push(name)
      return card(entry, hasShot)
    }).join('\n')
    return `<h2>${category}</h2>\n<p>${escapeHtml(BLURBS[category])}</p>\n<div class="cards">\n${cards}\n</div>`
  }).join('\n')
  const body = `<h1>Example plugins</h1>

<p>${plugins.length} worked plugins, each a Jig that loads by its IRI. Every control shown is generated from the plugin's own
parameter declarations. A panel links to the live profile, where the same IRI answers with Turtle for a program and a
page for a person. To hear one, open the <a href="${LIVE}simple.html">demo</a>. To write one, read
<a href="for-plugin-authors.html">building and publishing a plugin</a>.</p>
${sections}`
  return { body, shots }
}
