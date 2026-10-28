// tests/bin/package-app.test.js
//
// bin/package-app.js stages the app on its own. A copy list can be wrong in two directions, a file left out that the page asks for and
// a file put in that is not the app, so this starts the server from the staged folder, with nothing else of the repository beside it,
// and asks for what the page asks for.
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { resolve, join } from 'node:path'
import { existsSync, readdirSync, readFileSync, symlinkSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { stage, pluginFiles } from '../../bin/package-app.js'

const root = resolve(import.meta.dirname, '../..')
const has = (out, path) => existsSync(join(out, path))

describe('the staged app', () => {
  let out
  let work
  beforeAll(async () => {
    work = await mkdtemp(join(tmpdir(), 'jigdaw-app-'))
    out = join(work, 'jiggy')
    stage(out)
  })
  afterAll(async () => { await rm(work, { recursive: true, force: true }) })

  it('holds the page, its three entry points and the server', () => {
    for (const path of ['web/index.html', 'web/simple.html', 'web/reel.html', 'web/app.bundle.js', 'web/sw.js', 'bin/serve.js', 'package.json', 'README.txt', 'LICENSE']) {
      expect(has(out, path), path).toBe(true)
    }
  })

  it('leaves out what is not the app: the gallery, source maps, tests, documentation, plugin sources and build output', () => {
    for (const path of ['web/gallery.html', 'web/gallery', 'web/app.bundle.js.map', 'tests', 'docs', 'TODO.md', 'plugins/monochord/monochord.cpp', 'plugins/monochord/build', 'plugins/pulse/target', 'plugins/pulse/src', 'plugins/quartet/build.sh', '.git']) {
      expect(has(out, path), path).toBe(false)
    }
  })

  it('holds every file each plugin profile names, and no more of a plugin than that', () => {
    const dirs = readdirSync(join(root, 'plugins'), { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(root, 'plugins', e.name, 'profile.ttl')))
    expect(dirs.length).toBeGreaterThan(30)
    for (const { name } of dirs) {
      const wanted = pluginFiles(join(root, 'plugins', name)).map(f => resolve(join(root, 'plugins', name), f))
      for (const file of wanted) expect(existsSync(file.replace(root, out)), file).toBe(true)
    }
    // Quartet names its processor, module and skin, and its sources, build script and build output are not staged.
    expect(readdirSync(join(out, 'plugins/quartet')).sort()).toEqual(['profile.ttl', 'quartet-processor.js', 'quartet.wasm', 'skin'])
    expect(readdirSync(join(out, 'plugins/quartet/skin'))).toEqual(['skin.html'])
  })

  it('refuses to stage when a profile names a file the tree does not hold', async () => {
    const { cpSync, writeFileSync, rmSync, mkdirSync } = await import('node:fs')
    const fake = join(work, 'repository')
    mkdirSync(join(fake, 'plugins/gone'), { recursive: true })
    for (const dir of ['web', 'src', 'vocabs', 'examples', 'bin']) cpSync(join(root, dir), join(fake, dir), { recursive: true })
    for (const file of ['package.json', 'LICENSE']) cpSync(join(root, file), join(fake, file))
    writeFileSync(join(fake, 'plugins/index.json'), '[]')
    writeFileSync(join(fake, 'plugins/gone/profile.ttl'), '<#m> <http://purl.org/stuff/jigdaw/location> <x> .\n@prefix jig: <http://purl.org/stuff/jigdaw/> .\n<#m> jig:location <missing.wasm> .\n')
    expect(() => stage(join(work, 'refused'), { repository: fake })).toThrow(/missing\.wasm/)
    rmSync(fake, { recursive: true, force: true })
  })

  describe('run from the staged folder', () => {
    let server
    let base
    beforeAll(async () => {
      // The server's own dependencies come from the repository: the zip leaves them to npm install.
      symlinkSync(join(root, 'node_modules'), join(out, 'node_modules'))
      const port = 20000 + Math.floor(Math.random() * 20000)
      base = `http://127.0.0.1:${port}`
      server = spawn('node', ['bin/serve.js'], { cwd: out, env: { ...process.env, PORT: String(port) }, stdio: 'ignore' })
      for (let i = 0; i < 50; i++) {
        if (await fetch(base).then(r => r.ok, () => false)) return
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      throw new Error('the staged server did not start')
    })
    afterAll(() => { server?.kill() })

    it('serves the page, and every file the service worker precaches', async () => {
      const list = readFileSync(join(out, 'web/precache.js'), 'utf8')
      const paths = [...list.matchAll(/"path": "([^"]+)"/g)].map(m => m[1])
      expect(paths.length).toBeGreaterThan(20)
      for (const path of paths) {
        const response = await fetch(new URL(path, `${base}/`))
        expect(response.status, path).toBe(200)
      }
    })

    it('serves the catalogue, and the files of a plugin it lists', async () => {
      const found = await (await fetch(`${base}/catalogue/search?q=quartet&limit=5`)).json()
      expect(found.results.map(r => r.label)).toContain('Quartet')
      for (const file of ['profile.ttl', 'quartet.wasm', 'quartet-processor.js']) {
        expect((await fetch(`${base}/plugins/quartet/${file}`)).status, file).toBe(200)
      }
    })

    it('serves the modules the page imports from src, and the shapes it validates with', async () => {
      for (const path of ['src/engine/capture-processor.js', 'src/host/ForeignSupport.js', 'vocabs/shapes.ttl']) {
        expect((await fetch(`${base}/${path}`)).status, path).toBe(200)
      }
    })
  })
})

describe('the command', () => {
  it('writes a zip with the app at its root, and says how big it is', async () => {
    const work = await mkdtemp(join(tmpdir(), 'jigdaw-zip-'))
    const zip = join(work, 'jiggy.zip')
    const made = spawnSync('node', [resolve(root, 'bin/package-app.js'), '--out', join(work, 'jiggy'), '--zip', zip], { cwd: root, encoding: 'utf8', timeout: 120000 })
    expect(made.status, made.stderr).toBe(0)
    expect(made.stdout).toMatch(/MB/)
    expect(statSync(zip).size).toBeGreaterThan(1e6)
    const listing = spawnSync('unzip', ['-l', zip], { encoding: 'utf8' }).stdout
    expect(listing).toMatch(/ web\/index\.html/)
    expect(listing).toMatch(/ bin\/serve\.js/)
    expect(listing).not.toMatch(/ \.\//)
    await rm(work, { recursive: true, force: true })
  })
})
