// bin/build-docs-site.js
//
// Render docs/*.md into a static site for GitHub Pages.
//
// The specification is markdown in docs/ so it reads the same way whether
// someone opens it in an editor, browses it on GitHub, or reads it here.
// This script only renders it; it does not restate it. The nav's contents
// are built from the files that are actually there, not a hand-kept list,
// because a hand-kept list is the one that goes stale the day a document is
// added and nobody remembers to add the link. Only which GROUP a document
// falls into is curated (GROUP_OF below), and a document not named there
// still appears, filed under "Background", so a forgotten one is
// miscategorised rather than missing.
//
// Output goes to docs-site/, gitignored: a GitHub Actions workflow builds it
// fresh on every push and deploys it, the same reason web/app.bundle.js is
// committed but this is not. There is nothing here that needs to be readable
// without running the build, unlike web/app.bundle.js, which the production
// server serves with no build step of its own.
import { readdir, readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, basename } from 'node:path'
import { marked } from 'marked'
import hljs from 'highlight.js'
import { turtle } from './highlight-turtle.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = join(root, 'docs')
const outDir = join(root, 'docs-site')

const REPO = 'https://github.com/danja/jigdaw'

hljs.registerLanguage('turtle', turtle)
hljs.registerAliases(['ttl'], { languageName: 'turtle' })

// Which sidebar group a document sits in. "index" is the home page and is
// not itself a nav entry. Everything not listed here falls to "Background"
// rather than being left out, so a new document is always reachable even
// before someone decides where it best belongs.
const GROUP_OF = {
  'host-plugin-contract': 'Specification',
  'plugin-profiles': 'Specification',
  messaging: 'Specification',
  latency: 'Specification',
  'project-format': 'Specification',
  webmcp: 'Specification',
  namespace: 'Specification',
  architecture: 'Specification',
  'module-abi': 'Specification',
  'plugin-bundles': 'Specification',
  wam: 'Specification',
  'for-hosts': 'Guides',
  'for-plugin-authors': 'Guides',
  plan: 'Background',
  'first-thoughts': 'Background',
  'local-references': 'Background',
  deployment: 'Background'
}
const GROUP_ORDER = ['Specification', 'Guides', 'Background']

marked.use({
  gfm: true,
  renderer: {
    code ({ text, lang }) {
      const language = (lang || '').split(/\s+/)[0].toLowerCase()
      const known = language && hljs.getLanguage(language)
      const highlighted = known
        ? hljs.highlight(text, { language }).value
        : escapeHtml(text)
      return `<pre><code class="hljs${known ? ` language-${language}` : ''}">${highlighted}</code></pre>`
    }
  }
})

const names = (await readdir(docsDir))
  .filter(f => f.endsWith('.md'))
  .map(f => basename(f, '.md'))
  .sort()

if (!names.includes('index')) {
  console.error('build-docs-site: docs/index.md is missing; it is the site home page')
  process.exit(1)
}

/** The first `# Heading` in a document, for its <title> and its nav entry. */
function titleOf (markdown, fallback) {
  const match = /^#\s+(.+)$/m.exec(markdown)
  return match ? match[1].trim() : fallback
}

/** The first ordinary paragraph, for <meta name="description">: paragraph
 * blocks (split on blank lines), skipping the heading, a `**Version:**`
 * metadata block if the document opens with one, and anything that is a
 * heading, a blockquote, code or a list rather than prose. Markdown syntax
 * is stripped so the description reads as plain text. Truncated, because a
 * description is a summary, not the document. */
function descriptionOf (markdown) {
  const blocks = markdown.trim().split(/\n{2,}/)
  const isMeta = block => /^\*\*Version:\*\*/.test(block.trim())
  const isProse = block => {
    const t = block.trim()
    return t.length > 0 && !/^[#>`|-]/.test(t)
  }
  const block = blocks.slice(1).find(b => !isMeta(b) && isProse(b))
  // A document with no prose paragraph yet, such as one only just created
  // and not written, still needs a page: the title on its own is a fine
  // description of a document that is otherwise empty.
  if (!block) return titleOf(markdown, 'A JigDAW specification document')
  const text = block.replace(/\n/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .trim()
  return text.length > 160 ? `${text.slice(0, 157)}...` : text
}

const titles = new Map()
const descriptions = new Map()
for (const name of names) {
  const text = await readFile(join(docsDir, `${name}.md`), 'utf8')
  titles.set(name, titleOf(text, name))
  descriptions.set(name, descriptionOf(text))
}

/**
 * A link to another document (`foo.md` or `foo.md#section`) becomes a link
 * to the page this build produces for it (`foo.html`). A link leaving docs/
 * (`../HUMANS.md`, `../plugins/cascade/`) has nothing published alongside
 * this site to point at, so it goes to the file, or the directory, at its
 * usual place in the repository. GitHub's own URL scheme has one path for
 * each: `blob` for a file, `tree` for a directory, and a link mistaken for
 * the other 404s, which a trailing slash is enough to tell apart here.
 */
function rewriteLinks (html) {
  return html
    .replace(/href="([a-zA-Z0-9_-]+)\.md(#[^"]*)?"/g, 'href="$1.html$2"')
    .replace(/href="\.\.\/([^"#]+)(#[^"]*)?"/g, (_, path, hash = '') =>
      `href="${REPO}/${path.endsWith('/') ? 'tree' : 'blob'}/main/${path}${hash}"`)
}

function escapeHtml (s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
}

function sidebar (current) {
  const groups = new Map(GROUP_ORDER.map(g => [g, []]))
  for (const name of names) {
    if (name === 'index') continue
    const group = GROUP_OF[name] ?? 'Background'
    groups.get(group).push(name)
  }
  const section = (label, docs) => docs.length === 0 ? '' : `
    <div class="nav-group">
      <h2>${escapeHtml(label)}</h2>
      ${docs.map(name =>
        `<a href="${name}.html"${name === current ? ' aria-current="page"' : ''}>${escapeHtml(titles.get(name))}</a>`
      ).join('\n      ')}
    </div>`
  return GROUP_ORDER.map(g => section(g, groups.get(g))).join('\n')
}

function page ({ name, title, description, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} : JigDAW</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="stylesheet" href="docs.css">
</head>
<body>
<div class="shell">
  <aside class="sidebar">
    <a class="brand" href="index.html"${name === 'index' ? ' aria-current="page"' : ''}>JigDAW</a>
    <p class="tagline">A plugin format native to the web</p>
    <nav aria-label="Documentation">
${sidebar(name)}
    </nav>
    <a class="github" href="${REPO}">Source on GitHub &#8599;</a>
  </aside>
  <main>
    <article>
${bodyHtml}
    </article>
    <footer>
      <p>Generated from <code>docs/${name}.md</code> by <code>bin/build-docs-site.js</code>.
      The markdown in the repository is authoritative; this page is a rendering of it.</p>
    </footer>
  </main>
</div>
</body>
</html>
`
}

await mkdir(outDir, { recursive: true })

for (const name of names) {
  const text = await readFile(join(docsDir, `${name}.md`), 'utf8')
  const bodyHtml = rewriteLinks(marked.parse(text))
  const html = page({ name, title: titles.get(name), description: descriptions.get(name), bodyHtml })
  await writeFile(join(outDir, `${name}.html`), html)
}

await copyFile(join(root, 'bin/docs-site.css'), join(outDir, 'docs.css'))
await writeFile(join(outDir, '.nojekyll'), '')

console.log(`docs-site/: ${names.length} page(s) (${names.join(', ')})`)
