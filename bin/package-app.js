// bin/package-app.js
//
// Stage the Jiggy app on its own, as a folder that can be unzipped and run: the page, the plugins it
// loads, and the small server that gives the page its catalogue. Nothing else from the repository
// goes in: no tests, no documentation, no plugin sources or build output, no gallery.
//
//   node bin/package-app.js [--out dist/jiggy] [--zip dist/jiggy.zip]
//
// Run `npm run build:web` first, since the page is the committed bundle and this copies it as it is.
// What a plugin needs is read from its own profile (every `jig:location`) rather than listed here, so
// a plugin gaining a file gains it in the zip. tests/bin/package-app.test.js starts the server from
// the staged folder, which is the check that nothing the page asks for was left out.
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isMain } from './is-main.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

// Directories copied whole, from the repository root. The page fetches src/engine and src/host
// modules, the shapes it validates against, and the examples its presets point at.
const WHOLE = ['src', 'vocabs', 'examples']
// Not part of the app: the plugin gallery is a documentation page built from screenshots, and a
// source map is for a developer with the repository beside it.
const LEFT_OUT_OF_WEB = new Set(['gallery', 'gallery.html'])

/** Every file a plugin's profile names, relative to its directory: its resources, skin and assets. */
export function pluginFiles (dir) {
  const profile = readFileSync(join(dir, 'profile.ttl'), 'utf8')
  const named = [...profile.matchAll(/jig:location\s+<([^>#]+)>/g)].map(m => m[1])
  return ['profile.ttl', ...new Set(named)].filter(name => !/^[a-z]+:/i.test(name))
}

function copyFile (from, to) {
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
}

/** Copy the app into `out`, returning what was copied as paths relative to it. */
export function stage (out, { repository = root } = {}) {
  rmSync(out, { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  // The page is served from the root of the app, as web/ is served from the root of the repository.
  for (const name of readdirSync(join(repository, 'web'))) {
    if (LEFT_OUT_OF_WEB.has(name)) continue
    cpSync(join(repository, 'web', name), join(out, 'web', name), {
      recursive: true, filter: source => !source.endsWith('.map')
    })
  }
  for (const name of WHOLE) cpSync(join(repository, name), join(out, name), { recursive: true })

  copyFile(join(repository, 'plugins/index.json'), join(out, 'plugins/index.json'))
  const missing = []
  for (const entry of readdirSync(join(repository, 'plugins'), { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(repository, 'plugins', entry.name)
    if (!existsSync(join(dir, 'profile.ttl'))) continue
    for (const file of pluginFiles(dir)) {
      const from = resolve(dir, file)
      // A file the profile names and the tree does not hold is an error here, not a smaller zip.
      if (!existsSync(from) || !statSync(from).isFile()) { missing.push(relative(repository, from)); continue }
      copyFile(from, join(out, relative(repository, from)))
    }
  }
  if (missing.length) throw new Error(`a profile names files that are not there: ${missing.join(', ')}`)

  copyFile(join(repository, 'bin/serve.js'), join(out, 'bin/serve.js'))
  copyFile(join(repository, 'LICENSE'), join(out, 'LICENSE'))

  const pkg = JSON.parse(readFileSync(join(repository, 'package.json'), 'utf8'))
  writeFileSync(join(out, 'package.json'), JSON.stringify({
    name: 'jiggy',
    version: pkg.version,
    description: 'Jiggy, the JigDAW browser host, with the plugins it ships',
    type: 'module',
    license: pkg.license,
    engines: pkg.engines,
    scripts: { start: 'node bin/serve.js' },
    dependencies: pkg.dependencies
  }, null, 2) + '\n')
  writeFileSync(join(out, 'README.txt'), [
    'Jiggy',
    '',
    'Needs Node 20.11 or later.',
    '',
    '  npm install --omit=dev',
    '  npm start',
    '',
    'then open http://127.0.0.1:8748/ . PORT and HOST set where it listens (loopback by default).',
    'The page is in web/ and is served from the root; plugins are under plugins/. Plugin sources',
    'and the specification are in the JigDAW repository.',
    ''
  ].join('\n'))
}

function option (name, fallback) {
  const at = process.argv.indexOf(name)
  return at === -1 ? fallback : process.argv[at + 1]
}

if (isMain(import.meta.url)) {
  const out = resolve(option('--out', join(root, 'dist/jiggy')))
  const zip = resolve(option('--zip', join(root, 'dist/jiggy.zip')))
  stage(out)
  rmSync(zip, { force: true })
  mkdirSync(dirname(zip), { recursive: true })
  // -X leaves out the extra file attributes, so the same tree zips to the same bytes order for order.
  execFileSync('zip', ['-r', '-q', '-X', zip, '.'], { cwd: out })
  console.log(`${relative(root, zip)}: ${(statSync(zip).size / 1048576).toFixed(1)} MB from ${relative(root, out)}`)
}
