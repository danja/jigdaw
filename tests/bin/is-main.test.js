// tests/bin/is-main.test.js
//
// bin/is-main.js decides whether a script was asked to run. The raw comparison it replaces, `process.argv[1]` against
// `import.meta.url`, differs for the same file reached through a symlink or a second mount, and a script guarded by it then does
// nothing and exits 0. That was in a dozen scripts, including bin/bundle.js, which CLAUDE.md already records as exiting 0
// having produced nothing. This holds the helper to the case that broke, and holds every script to using it.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, unlinkSync, readdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')

describe('isMain', () => {
  // A script that says whether it is main, run directly and through a symlink to it.
  function run (how) {
    const dir = mkdtempSync(join(tmpdir(), 'is-main-'))
    const dirLink = `${dir}-link`
    try {
      writeFileSync(join(dir, 'script.mjs'), `import { isMain } from ${JSON.stringify(join(root, 'bin/is-main.js'))}\nconsole.log(isMain(import.meta.url) ? 'main' : 'imported')\n`)
      writeFileSync(join(dir, 'importer.mjs'), `import './script.mjs'\n`)
      symlinkSync(join(dir, 'script.mjs'), join(dir, 'link.mjs'))
      symlinkSync(dir, dirLink, 'dir')
      const path = { direct: join(dir, 'script.mjs'), link: join(dir, 'link.mjs'), imported: join(dir, 'importer.mjs'), dirlink: join(dirLink, 'script.mjs') }[how]
      return spawnSync(process.execPath, [path], { encoding: 'utf8' })
    } finally {
      // A symlink to a directory is removed as a link, not as the directory it names.
      unlinkSync(dirLink)
      rmSync(dir, { recursive: true })
    }
  }

  it('is true for a script run directly', () => expect(run('direct').stdout.trim()).toBe('main'))
  it('is true for a script run through a symlink to it, which the raw comparison got wrong', () => expect(run('link').stdout.trim()).toBe('main'))
  it('is true for a script run through a symlink to its directory', () => expect(run('dirlink').stdout.trim()).toBe('main'))
  it('is false for a module another script imports', () => expect(run('imported').stdout.trim()).toBe('imported'))

  it('is false, and does not throw, with no script at all', () => {
    const run = spawnSync(process.execPath, ['-e', `import(${JSON.stringify(join(root, 'bin/is-main.js'))}).then(m => console.log(m.isMain('file:///nowhere.js')))`], { encoding: 'utf8' })
    expect(run.stdout.trim()).toBe('false')
  })
})

// Every script that guards its work must use the helper. Walks bin/ as it is now, so a script added later is in scope.
describe('the raw comparison', () => {
  const scripts = readdirSync(join(root, 'bin')).filter(f => f.endsWith('.js'))
  // jig.js carries its own real-path check, written before the helper existed; is-main.js is the helper.
  const exempt = new Set(['is-main.js', 'jig.js'])

  it('walks the scripts, or the guard below passes over nothing', () => {
    expect(scripts.length).toBeGreaterThan(20)
    expect(scripts).toContain('bundle.js')
  })

  for (const file of scripts.filter(f => !exempt.has(f))) {
    it(`${file} does not compare process.argv[1] with its own url`, () => {
      const source = readFileSync(join(root, 'bin', file), 'utf8')
      expect(source).not.toMatch(/process\.argv\[1\]\s*===/)
      expect(source).not.toMatch(/===\s*`file:\/\/\$\{process\.argv\[1\]\}`/)
      expect(source).not.toMatch(/`file:\/\/\$\{process\.argv\[1\]\}`\s*===/)
    })
  }
})

// Replacing the guard is not enough: a script that calls isMain without importing it throws only when it is run, and `node --check`
// does not see an undefined name. One was found that way, with the import written into the template a script generates.
describe('the scripts that call isMain', () => {
  const users = readdirSync(join(root, 'bin')).filter(f => f.endsWith('.js') && f !== 'is-main.js' && /\bisMain\(/.test(readFileSync(join(root, 'bin', f), 'utf8')))

  it('are found, or the checks below pass over nothing', () => {
    expect(users).toContain('bundle.js')
    expect(users).toContain('wam.js')
  })

  for (const file of users) {
    it(`${file} imports it at the top level, before any code`, () => {
      const lines = readFileSync(join(root, 'bin', file), 'utf8').split('\n')
      const at = lines.findIndex(l => l === "import { isMain } from './is-main.js'")
      expect(at, 'no top-level import of isMain').toBeGreaterThanOrEqual(0)
      const code = lines.findIndex(l => /^(const|let|function|async function|export|if|for|await) /.test(l))
      if (code >= 0) expect(at).toBeLessThan(code)
      // And only once: a second copy inside a template string is how this went wrong.
      expect(lines.filter(l => l.includes("from './is-main.js'"))).toHaveLength(1)
    })
  }
})

