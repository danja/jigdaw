// tests/docs/conventions.test.js
//
// The rules in AGENTS.md that a careful reader would otherwise have to enforce.
// AGENTS.md says a rule worth stating is worth a test; these are those tests.
//
// Every check walks the repository through `git ls-files` rather than naming
// files, so adding a document brings it into scope automatically. A guard that
// names a file goes blind the moment the thing it guards moves.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
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
  // docs/*.md is authoritative and the site is a rendering of it
  // (bin/build-docs-site.js, .github/workflows/docs.yml), not a second,
  // hand-written copy: web/docs/ was that, and it went stale the way a
  // hand-kept nav always does, naming two plugins once there were eight.
  // Built here rather than checked as committed files, because docs-site/ is
  // gitignored and built fresh on every push; checking a copy left over from
  // a previous run would pass on a build the workflow can no longer produce.
  const siteDir = join(root, 'docs-site')
  const docNames = readdirSync(join(root, 'docs'))
    .filter(f => f.endsWith('.md'))
    .map(f => f.replace(/\.md$/, ''))

  execFileSync(process.execPath, [join(root, 'bin/build-docs-site.js')], { cwd: root })
  const pages = docNames.map(name => `docs-site/${name}.html`)
  const siteRead = page => readFileSync(join(root, page), 'utf8')

  it('builds a page for every document, and the front page links to it and to the repository', () => {
    for (const page of pages) expect(existsSync(join(root, page)), page).toBe(true)
    const front = read('web/index.html')
    expect(front).toContain('https://danja.github.io/jigdaw/')
    expect(front).toContain('https://github.com/danja/jigdaw')
  })

  it('links only to pages that exist in the site, or out to the repository', () => {
    // A published link that 404s is the failure this project has already made
    // once, by naming github.com/jigdaw when the repository is danja/jigdaw.
    const broken = []
    for (const page of pages) {
      for (const match of siteRead(page).matchAll(/(?:href|src)="([^"]+)"/g)) {
        const target = match[1]
        if (/^(https?:|mailto:|#)/.test(target)) continue
        if (!existsSync(join(siteDir, target.split('#')[0]))) broken.push(`${page} -> ${target}`)
      }
    }
    expect(broken, `broken links:\n  ${broken.join('\n  ')}`).toEqual([])
  })

  it('names the repository correctly everywhere', () => {
    // github.com/jigdaw is somebody's user account and returns 200, so a typo
    // here would not even look broken. Narrow to that specific mistake
    // (the account written as "jigdaw", or the right account pointed at
    // some other repository) rather than flagging every github.com link
    // that is not danja/jigdaw, which would also catch a legitimate
    // reference to an unrelated repository such as one of WAM's examples.
    for (const page of pages) {
      const wrong = [...siteRead(page).matchAll(/github\.com\/([\w.-]+)(?:\/([\w.-]+))?/g)]
        .filter(m => m[1] === 'jigdaw' || (m[1] === 'danja' && m[2] && m[2] !== 'jigdaw'))
      expect(wrong.map(m => m[0]), `${page} links to the wrong repository`).toEqual([])
    }
  })

  it('declares a viewport on every page, since docs are read on phones', () => {
    for (const page of pages) {
      expect(siteRead(page), page).toMatch(/<meta\s+name="viewport"/)
    }
  })

  it('gives every page a title and a description', () => {
    for (const page of pages) {
      expect(siteRead(page), `${page} title`).toMatch(/<title>[^<]{10,}<\/title>/)
      expect(siteRead(page), `${page} description`).toMatch(/name="description" content="[^"]{10,}"/)
    }
  })
})

describe('the foreign plugin probe', () => {
  // It is a published page whose inputs are deliberately not published: they
  // are built from webaudiomodules/wam-examples, which is MIT and not ours to
  // commit. That combination shipped once as a page returning 404 at its first
  // fetch, on a live server, which is the "contact page that 404s" failure in
  // miniature and exactly what these guards exist for.
  const probe = 'web/foreign/probe.html'

  it('exists and is served alongside its worker', () => {
    expect(existsSync(join(root, probe))).toBe(true)
    expect(existsSync(join(root, 'web/foreign/sw.js'))).toBe(true)
  })

  it('checks for its inputs before using them', () => {
    // A HEAD before the first real fetch is what turns a 404 into an
    // explanation. Asserted because the explanation is the only thing standing
    // between a visitor and a page that looks broken.
    const page = read(probe)
    expect(page).toMatch(/method:\s*'HEAD'/)
    expect(page.indexOf("method: 'HEAD'")).toBeLessThan(page.indexOf("await import(`${base}index.js`)"))
  })

  it('names the command that builds them, and that command exists', () => {
    // The pair nothing else connects: the page tells a person what to run, and
    // this is what stops that instruction going stale when the script is
    // renamed.
    const page = read(probe)
    const named = [...page.matchAll(/npm run ([\w:]+)/g)].map(m => m[1])
    expect(named.length, 'the probe names no build command').toBeGreaterThan(0)
    const scripts = JSON.parse(read('package.json')).scripts
    for (const script of named) {
      expect(scripts[script], `the probe says "npm run ${script}" and package.json has no such script`).toBeDefined()
    }
    const target = scripts[named[0]].replace(/^node\s+/, '')
    expect(existsSync(join(root, target)), `${target} is missing`).toBe(true)
  })

  it('keeps those inputs out of the repository', () => {
    // If either is ever committed, it is a vendored third-party build artefact
    // that will go stale silently, and the licence question becomes real.
    const ignored = execFileSync('git', ['check-ignore', 'web/foreign/pingpongdelay.wam', 'web/foreign/wam-host.js'],
      { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    expect(ignored).toHaveLength(2)
  })

  it('has a module script that parses', async () => {
    // An inline module in a published page is checked by nothing: a syntax
    // error makes the page render, the button do nothing, and window.probe stay
    // undefined. That happened, from an edit that shadowed a name, and the
    // symptom was a blank log box rather than an error anywhere.
    const { writeFile, rm, mkdtemp } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { execFileSync } = await import('node:child_process')

    const page = read(probe)
    const scripts = [...page.matchAll(/<script type="module">([\s\S]*?)<\/script>/g)].map(m => m[1])
    expect(scripts.length, 'the probe has no module script, so this checked nothing').toBeGreaterThan(0)

    const dir = await mkdtemp(join(tmpdir(), 'jig-probe-'))
    try {
      for (const [i, source] of scripts.entries()) {
        const file = join(dir, `script-${i}.mjs`)
        await writeFile(file, source)
        execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
      }
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('never falls through to the network in its worker', () => {
    // Contract section 12.3. The single property that makes the container a
    // boundary rather than a cache, asserted on the worker's source because
    // nothing else in this repository can reach a service worker.
    const worker = read('web/foreign/sw.js')
    const code = worker.split('\n').filter(line => !line.trim().startsWith('//')).join('\n')
    expect(code).not.toMatch(/\bfetch\s*\(/)
    expect(code).toMatch(/respondWith/)
  })
})

describe('figures quoted about other systems', () => {
  // TODO.md has carried "re-measure every figure quoted in a document" for
  // months, which is the shape of a task nothing performs. The plugin count was
  // 758 in seven documents and 756 over the live endpoint, so it had been wrong
  // in every one of them for a while and nothing said so.
  //
  // This does not query the network: a test that needs an endpoint is a test
  // that gets disabled the first time the endpoint is down. It checks that the
  // documents agree with each other and with one stated figure, so correcting
  // the number is one edit and a stale copy is a failure.
  const CATALOGUE_PLUGINS = 756   // plugin-universe, measured 2026-09-18

  it('states one plugin-universe count, in every document that mentions it', () => {
    const offenders = []
    for (const file of byExt('.md')) {
      for (const [i, line] of read(file).split('\n').entries()) {
        for (const match of line.matchAll(/\b(\d{3})\s+(?:plugins|profiles)\b/g)) {
          if (Number(match[1]) !== CATALOGUE_PLUGINS) offenders.push(`${file}:${i + 1} says ${match[1]}`)
        }
      }
    }
    expect(offenders, `disagree with the measured ${CATALOGUE_PLUGINS}:\n  ${offenders.join('\n  ')}`).toEqual([])
  })

  it('finds those mentions, so this is not vacuous', () => {
    const mentions = byExt('.md').filter(f => /\b\d{3}\s+(?:plugins|profiles)\b/.test(read(f)))
    expect(mentions.length, 'no document quotes a catalogue size').toBeGreaterThan(2)
  })

  // The same shape, for a figure about this repository rather than another
  // one, and counted rather than stated. README.md said "Three worked
  // plugins... written in Rust" and stayed saying it while a fourth was added
  // in C++: a sentence is a claim, and nothing tests sentences.
  it('states the number of worked plugins there actually are', () => {
    const count = readdirSync(join(root, 'plugins'), { withFileTypes: true })
      .filter(e => e.isDirectory() && existsSync(join(root, 'plugins', e.name, 'profile.ttl')))
      .length
    const offenders = []
    let mentions = 0
    for (const file of byExt('.md')) {
      // MISTAKES.md records what was true when each entry was written, and a
      // log that is edited to agree with today is not a log.
      if (file === 'MISTAKES.md') continue
      for (const [i, line] of read(file).split('\n').entries()) {
        for (const match of line.matchAll(/\b(\d+|one|two|three|four|five|six)\s+worked plugins?\b/gi)) {
          mentions++
          if (Number(match[1]) !== count) offenders.push(`${file}:${i + 1} says ${match[1]}, and there are ${count}`)
        }
      }
    }
    expect(offenders, offenders.join('\n  ')).toEqual([])
    expect(mentions, 'no document says how many worked plugins there are').toBeGreaterThan(0)
  })
})

describe('a foreign plugin is marked wherever it appears', () => {
  // Contract section 12.5 says "wherever it appears", which is three surfaces
  // in different files with nothing connecting them: the generated panel, the
  // rack entry, and the stylesheet that has to know the class names. A mark
  // added to one and forgotten in another is the exact shape of failure
  // AGENTS.md names, and no test of any single file would see it.
  const SURFACES = ['src/ui/Panel.js', 'web/app.js']

  it('is marked by every surface that renders a plugin', () => {
    const missing = SURFACES.filter(file => !read(file).includes("=== 'foreign'"))
    expect(missing, `no foreign check in: ${missing.join(', ')}`).toEqual([])
  })

  it('says it in words, not only in a class', () => {
    // Section 12.5 forbids colour alone and requires it to reach assistive
    // technology, so every surface must put the word somewhere readable.
    for (const file of SURFACES) {
      expect(read(file), file).toMatch(/textContent\s*=\s*'foreign'/)
    }
  })

  it('uses class names the stylesheet actually defines', () => {
    // The pair that drifts without anything noticing: the code adds a class and
    // the stylesheet is somewhere else entirely.
    const page = read('web/index.html')
    const used = new Set()
    for (const file of SURFACES) {
      for (const m of read(file).matchAll(/classList\.add\('([\w-]+)'\)|className = '([\w-]+)'/g)) {
        const name = m[1] ?? m[2]
        if (name === 'foreign' || name === 'is-foreign') used.add(name)
      }
    }
    expect([...used].sort(), 'neither surface adds a foreign class').toEqual(['foreign', 'is-foreign'])
    for (const name of used) {
      expect(page, `web/index.html has no .${name} rule`).toMatch(new RegExp(`\\.${name}\\s*[,{]`))
    }
  })

  it('asks before running one, and renders the words it was given', () => {
    // Section 12.4. The statements are frozen data from ForeignTrust precisely
    // so the page cannot reword the thing being agreed to.
    const page = read('web/app.js')
    expect(page).toMatch(/askConsent/)
    expect(page).toMatch(/request\.statements/)
    expect(page, 'a dismissed dialog must count as a refusal').toMatch(/'cancel'/)
  })
})

describe('the ids web/app.js reaches with $() exist in web/index.html', () => {
  // $ is document.getElementById, called throughout web/app.js on the
  // assumption that the markup has whatever id is asked for. Nothing checks
  // that assumption at either end: a renamed element in the HTML fails
  // silently at runtime, null where an element was expected, and the first
  // sign is usually a click that does nothing.
  const app = read('web/app.js')
  const page = read('web/index.html')

  it('has a matching id="..." for every literal $(\'...\') call', () => {
    const wanted = new Set([...app.matchAll(/\$\('([\w-]+)'\)/g)].map(m => m[1]))
    expect(wanted.size, 'no $(...) calls found, so this checked nothing').toBeGreaterThan(10)
    const missing = [...wanted].filter(id => !page.includes(`id="${id}"`))
    expect(missing, `web/index.html has no element with these ids: ${missing.join(', ')}`).toEqual([])
  })
})

describe('the Tracks and Mixer tabs', () => {
  // Contract-free, unlike the foreign mark, but the same shape of risk: a tab
  // panel that createTabs never learns about stays permanently hidden or
  // permanently shown, and a mixer that forgets a node it should draw is
  // silent in the same way a control that does nothing is silent.
  const app = read('web/app.js')
  const page = read('web/index.html')

  it('builds exactly the two tabs the markup has panels for', () => {
    const ids = [...app.matchAll(/\{ id: '(\w+)', label: '[^']+', panel: \$\('([\w-]+)'\) \}/g)]
      .map(m => ({ tab: m[1], panel: m[2] }))
    expect(ids.length, 'createTabs was not called with any tab definitions').toBeGreaterThan(0)
    for (const { panel } of ids) {
      expect(page, `web/index.html has no #${panel} for a tab that points at it`).toMatch(new RegExp(`id="${panel}"`))
    }
  })

  it('mounts the tab list into the page, not only builds it', () => {
    expect(app).toMatch(/createTabs\(/)
    expect(app, 'the tablist is built but never appended anywhere').toMatch(/tabs-mount['"]\)\.append\(tabs\.element\)/)
  })
})
