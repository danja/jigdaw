// tests/docs/conventions.test.js
//
// The rules in AGENTS.md that a careful reader would otherwise have to enforce.
// AGENTS.md says a rule worth stating is worth a test; these are those tests.
//
// Every check walks the repository through `git ls-files` rather than naming
// files, so adding a document brings it into scope automatically. A guard that
// names a file goes blind the moment the thing it guards moves.
import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { resolve, join, dirname, extname } from 'node:path'

const root = resolve(import.meta.dirname, '../..')

// Tracked files AND new ones that are not ignored.
//
// `git ls-files` alone lists only what is committed, so every new file was
// invisible to every guard below until it was staged. That is precisely when
// the checks are wanted: a convention is easiest to break in code that has just
// been written. Found by adding inline SPARQL to a new module and watching the
// guard pass.
//
// Files that still exist, because a rename leaves git listing the old path
// until it is staged, and linting a path that is not there reports ENOENT
// instead of the thing the guard is for.
const tracked = execFileSync(
  'git', ['ls-files', '--cached', '--others', '--exclude-standard'],
  { cwd: root, encoding: 'utf8' }
).split('\n').filter(Boolean).filter(f => existsSync(join(root, f)))

const read = p => readFileSync(join(root, p), 'utf8')

// Generated output. Listed explicitly rather than matched by a pattern, so that
// adding a build artefact is a deliberate act and a stray file does not quietly
// exempt itself from every rule below.
const GENERATED = new Set(['web/app.bundle.js', 'web/app.bundle.js.map'])

const byExt = (...exts) =>
  tracked.filter(f => exts.includes(extname(f)) && !GENERATED.has(f))

describe('repository conventions', () => {
  it('finds the tracked files it is meant to check', () => {
    // Otherwise every assertion below passes vacuously, which is the failure
    // mode these guards exist to prevent in the first place.
    expect(tracked.length).toBeGreaterThan(20)
    expect(byExt('.md').length).toBeGreaterThan(10)
  })

  // AGENTS.md, documentation rules: "Technical plain English. No em dashes."
  //
  // The character is assembled at run time rather than written here, for the
  // same reason plugin-universe assembles secret-shaped test fixtures from
  // their prefix: a guard that must contain the thing it forbids will match
  // itself. Written as the escape \u2014 it was normalised to a literal on the
  // way to disk, and the test failed on its own source.
  it('uses no em dashes', () => {
    const emDash = String.fromCharCode(0x2014)
    const offenders = []
    for (const f of byExt('.md', '.ttl', '.js')) {
      read(f).split('\n').forEach((line, i) => {
        if (line.includes(emDash)) offenders.push(`${f}:${i + 1}`)
      })
    }
    expect(offenders, `em dashes at:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  // A published link that does not resolve is the "contact page that 404s"
  // failure from plugin-universe's table, in miniature.
  it('has no broken internal markdown links', () => {
    const broken = []
    for (const f of byExt('.md')) {
      const body = read(f)
      for (const m of body.matchAll(/\]\(([^)#\s]+\.md)(#[^)\s]*)?\)/g)) {
        const target = m[1]
        if (/^https?:/.test(target)) continue
        const candidates = [join(root, dirname(f), target), join(root, target)]
        if (!candidates.some(existsSync)) broken.push(`${f} -> ${target}`)
      }
    }
    expect(broken, `broken links:\n  ${broken.join('\n  ')}`).toEqual([])
  })

  // A document nothing links to is reachable only by knowing it is there.
  it('leaves no document unreferenced', () => {
    const docs = tracked.filter(f => f.startsWith('docs/') && f.endsWith('.md'))
    const orphans = docs.filter(doc => {
      const name = doc.slice('docs/'.length)
      return !tracked
        .filter(f => f.endsWith('.md') && f !== doc)
        .some(f => read(f).includes(name))
    })
    expect(orphans, `unreferenced: ${orphans.join(', ')}`).toEqual([])
  })

  // AGENTS.md, repository conventions: "Every source file opens with a path
  // comment, as `// src/rdf/Vocabulary.js`."
  it('opens every source file with its own path', () => {
    const wrong = []
    for (const f of byExt('.js')) {
      const first = read(f).split('\n')[0].trim()
      if (first !== `// ${f}`) wrong.push(`${f} starts with ${JSON.stringify(first)}`)
    }
    expect(wrong, `path comments:\n  ${wrong.join('\n  ')}`).toEqual([])
  })
})

describe('generated deployment artefacts', () => {
  // These are generated but committed, because the server runs them without a
  // build step. That makes them exactly the kind of pair that drifts silently:
  // nothing connects vocabs/jigdaw.ttl to the copy nginx serves.
  it('serves the same vocabulary it defines', () => {
    const source = join(root, 'vocabs/jigdaw.ttl')
    const deployed = join(root, 'deploy/vocab/jigdaw.ttl')
    expect(existsSync(deployed), 'deploy/vocab/jigdaw.ttl is missing; run npm run build:vocab').toBe(true)
    expect(
      readFileSync(deployed, 'utf8'),
      'deploy/vocab is stale; run npm run build:vocab and commit the result'
    ).toBe(readFileSync(source, 'utf8'))
  })

  it('describes every term on the generated page', () => {
    // The page is built from the vocabulary, so a term missing from it means
    // the generator stopped seeing a whole category of term.
    const page = readFileSync(join(root, 'deploy/vocab/index.html'), 'utf8')
    for (const term of ['module', 'processor', 'integrity', 'WebPlugin', 'renderQuantum', 'MidiEvents']) {
      expect(page, `jig:${term} is not on the page`).toContain(`jig:${term}`)
    }
  })
})

describe('no inline SPARQL', () => {
  // AGENTS.md states this rule, and a rule worth stating is worth a test.
  // plugin-universe's version of it sat in prose from Phase 0 and reached
  // seventeen violations across eight files before anyone counted.
  it('keeps every query in a file under sparql/queries/', () => {
    const KEYWORDS = /\b(SELECT|CONSTRUCT|INSERT DATA|DELETE WHERE)\b[\s\S]*\bWHERE\b/
    const offenders = []
    for (const file of tracked.filter(f => f.startsWith('src/') || f.startsWith('bin/'))) {
      if (!file.endsWith('.js')) continue
      for (const [i, line] of read(file).split('\n').entries()) {
        // Template literals and ordinary strings both count.
        const literals = [...line.matchAll(/`([^`]*)`|'([^']*)'|"([^"]*)"/g)]
          .map(m => m[1] ?? m[2] ?? m[3] ?? '')
        if (literals.some(text => KEYWORDS.test(text))) offenders.push(`${file}:${i + 1}`)
      }
    }
    expect(offenders, `inline SPARQL at:\n  ${offenders.join('\n  ')}`).toEqual([])
  })
})

/** Follow relative imports from an entry point, reporting bare specifiers. */
function importGraph (entry) {
  const seen = new Set()
  const packages = new Set()
  const builtins = new Set()

  const walk = file => {
    if (seen.has(file) || !existsSync(join(root, file))) return
    seen.add(file)
    for (const match of readFileSync(join(root, file), 'utf8').matchAll(/^import\s[^'"]*['"]([^'"]+)['"]/gm)) {
      const specifier = match[1]
      if (specifier.startsWith('node:')) { builtins.add(specifier); continue }
      if (!specifier.startsWith('.')) { packages.add(`${file} imports ${specifier}`); continue }
      walk(join(dirname(file), specifier).replace(/\\/g, '/'))
    }
  }

  walk(entry)
  return { seen, packages, builtins }
}

describe('the server', () => {
  // bin/serve.js runs on a machine with no npm install. The wasm, the profiles,
  // the browser bundle and plugins/index.json are all committed, so the
  // deployment is a git pull and a restart.
  //
  // This was broken once by importing an RDF parser into the server to read
  // profiles at runtime. The deployment had no node_modules, the service failed
  // to start, and the site answered 502 until it was reverted. The property is
  // load bearing and nothing but this guards it.
  it('reaches no package, only node builtins', () => {
    const { seen, packages } = importGraph('bin/serve.js')
    expect(seen.size, 'serve.js reached nothing, so this checked nothing').toBeGreaterThan(3)
    expect(packages, `bin/serve.js needs an npm install because:\n  ${[...packages].join('\n  ')}`).toEqual(new Set())
  })
})

describe('the browser bundle', () => {
  // Twice now a browser-bound module has imported a node-bound one and the
  // build failed: once ShapeValidator reaching node:fs, once Catalogue.js doing
  // the same through QueryService. esbuild catches it, but only when someone
  // runs the build, and `npm test` passed happily both times.
  it('reaches no node builtin from web/app.js', () => {
    const { seen, builtins } = importGraph('web/app.js')
    expect(seen.size, 'app.js reached nothing, so this checked nothing').toBeGreaterThan(5)
    expect([...builtins], 'node builtins are reachable from the browser entry').toEqual([])
  })
})

describe('the published documentation', () => {
  const pages = ['web/docs/index.html', 'web/docs/hosts.html', 'web/docs/plugins.html']

  it('exists, and the front page links to it and to the repository', () => {
    for (const page of pages) expect(existsSync(join(root, page)), page).toBe(true)
    const front = read('web/index.html')
    expect(front).toContain('href="docs/"')
    expect(front).toContain('https://github.com/danja/jigdaw')
  })

  it('links only to pages and files that are there', () => {
    // A published link that 404s is the failure this project has already made
    // once, by naming github.com/jigdaw when the repository is danja/jigdaw.
    const broken = []
    for (const page of [...pages, 'web/index.html']) {
      for (const match of read(page).matchAll(/(?:href|src)="([^"]+)"/g)) {
        const target = match[1]
        if (/^(https?:|mailto:|#)/.test(target)) continue
        const from = dirname(page)
        const raw = join(from, target).replace(/\\/g, '/')

        // A plugin IRI is not a file. bin/serve.js answers /plugins/<name>/ by
        // negotiating that plugin's profile, so the check is whether the
        // profile exists, which is exactly what the route requires.
        const plugin = /(?:^|\/)plugins\/([^/]+)\/$/.exec(raw)
        if (plugin) {
          if (!existsSync(join(root, 'plugins', plugin[1], 'profile.ttl'))) {
            broken.push(`${page} -> ${target} (no such plugin)`)
          }
          continue
        }

        // A directory reference resolves to its index, which bin/serve.js serves
        // for any path ending in a slash. The file existing is not enough on
        // its own: /docs/ answered 404 for a while with the file right there,
        // because the server had no directory handling.
        const resolved = target.endsWith('/') ? join(raw, 'index.html') : raw
        // Paths that leave web/ are served from the repository root.
        const candidates = [join(root, resolved), join(root, resolved.replace(/^web\//, ''))]
        if (!candidates.some(existsSync)) broken.push(`${page} -> ${target}`)
      }
    }
    expect(broken, `broken links:\n  ${broken.join('\n  ')}`).toEqual([])
  })

  it('names the repository correctly everywhere', () => {
    // github.com/jigdaw is somebody's user account and returns 200, so a typo
    // here would not even look broken.
    for (const page of pages) {
      const wrong = [...read(page).matchAll(/github\.com\/([\w.-]+)(?:\/([\w.-]+))?/g)]
        .filter(m => !(m[1] === 'danja' && m[2] === 'jigdaw'))
      expect(wrong.map(m => m[0]), `${page} links to the wrong repository`).toEqual([])
    }
  })

  it('declares a viewport on every page, since docs are read on phones', () => {
    for (const page of pages) {
      expect(read(page), page).toMatch(/<meta\s+name="viewport"/)
    }
  })

  it('gives every page a title and a description', () => {
    for (const page of pages) {
      expect(read(page), `${page} title`).toMatch(/<title>[^<]{10,}<\/title>/)
      expect(read(page), `${page} description`).toMatch(/name="description"/)
    }
  })
})
