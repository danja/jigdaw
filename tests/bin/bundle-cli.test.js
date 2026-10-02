// tests/bin/bundle-cli.test.js
//
// The commands, run as commands. tests/host/bundle.test.js and compositeBundle.test.js call bundle() as a library, and a library
// call cannot see a deadlock in the entry point: bin/bundle.js once awaited an import of a module that imported bin/bundle.js back,
// so node printed "unsettled top-level await" and wrote nothing, for every plugin, while every one of those tests passed.
import { describe, it, expect, beforeAll } from 'vitest'
import { resolve, join } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'

const root = resolve(import.meta.dirname, '../..')
const run = (script, args) => spawnSync('node', [resolve(root, 'bin', script), ...args], { cwd: root, encoding: 'utf8', timeout: 60000 })

describe('bin/bundle.js and bin/verify.js as commands', () => {
  let out
  beforeAll(async () => { out = await mkdtemp(join(tmpdir(), 'jigdaw-cli-')) })

  it('bundles a plain plugin, writing both forms, and says nothing is unsettled', () => {
    const made = run('bundle.js', ['plugins/boost', out, '--date', '2026-10-02T12:00:00Z'])
    expect(made.stderr).not.toMatch(/unsettled top-level await/)
    expect(made.status).toBe(0)
    expect(existsSync(join(out, 'boost.jig'))).toBe(true)
    expect(existsSync(join(out, 'boost.ttl'))).toBe(true)
    expect(made.stdout).toContain('Boost')
  })

  it('bundles a composite plugin with --members, writing both forms', () => {
    const made = run('bundle.js', ['plugins/stomp-rack', out, '--members', 'plugins', '--date', '2026-10-02T12:00:00Z'])
    expect(made.stderr).not.toMatch(/unsettled top-level await/)
    expect(made.status, made.stderr).toBe(0)
    expect(existsSync(join(out, 'stomp-rack.jig'))).toBe(true)
    expect(existsSync(join(out, 'stomp-rack.ttl'))).toBe(true)
    expect(made.stdout).toContain('boost/boost.wasm')
  })

  it('verifies both composite forms, every pin and every member file ok', () => {
    for (const form of ['stomp-rack.jig', 'stomp-rack.ttl']) {
      const checked = run('verify.js', [join(out, form)])
      expect(checked.status, `${form}\n${checked.stdout}${checked.stderr}`).toBe(0)
      expect(checked.stdout).toMatch(/ok\s+pin https:\/\/strandz\.it\/jigdaw\/plugins\/boost\//)
      expect(checked.stdout).toMatch(/ok\s+Cascade jig:module/)
      expect(checked.stdout).not.toMatch(/FAILED|absent/)
    }
  })

  it('refuses a composite with no --members, saying what it needs, and exits non-zero', () => {
    const made = run('bundle.js', ['plugins/stomp-rack', out])
    expect(made.status).toBe(1)
    expect(made.stderr).toMatch(/--members/)
  })
})
