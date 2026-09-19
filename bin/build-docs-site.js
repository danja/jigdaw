// bin/build-docs-site.js
//
// Render docs/*.md into a static site for GitHub Pages.
//
// The specification is markdown in docs/ so it reads the same way whether
// someone opens it in an editor, browses it on GitHub, or reads it here.
// This script only renders it; it does not restate it. The nav is built from
// the files that are actually there, not a hand-kept list, because a hand-kept
// list is the one that goes stale the day a document is added and nobody
// remembers to add the link.
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsDir = join(root, 'docs')
const outDir = join(root, 'docs-site')

const REPO = 'https://github.com/danja/jigdaw'

marked.use({ gfm: true })

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
  if (!block) return ''
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

const navFor = current => names.map(name =>
  `<a href="${name}.html"${name === current ? ' aria-current="page"' : ''}>${escapeHtml(titles.get(name))}</a>`
).join('\n    ')

function escapeHtml (s) {
  return String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
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
<div class="bar"><div class="inner">
  <a class="brand" href="index.html">JigDAW</a>
  <nav>
    ${navFor(name)}
    <a href="${REPO}">GitHub</a>
  </nav>
</div></div>
<main>
${bodyHtml}
</main>
<footer><div class="inner">
  <p>Generated from <code>docs/${name}.md</code> by <code>bin/build-docs-site.js</code>. The
  markdown in the repository is authoritative; this page is a rendering of it.</p>
</div></footer>
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
