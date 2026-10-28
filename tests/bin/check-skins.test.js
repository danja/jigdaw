// tests/bin/check-skins.test.js
//
// bin/check-skins.js runs the skin builder in a real Chrome. This runs the command
// the way a person does, because a command that exits 0 having checked nothing is
// a failure, and binds the files a skin is made of: the digests it carries and the
// shapes it must satisfy, for every plugin that declares one.
import { describe, it, expect } from 'vitest'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { parseText } from '../../src/rdf/parse.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { shapeValidatorFromFile } from '../../src/validate/files.js'
import { digestOf } from '../../src/host/Integrity.js'

const root = resolve(import.meta.dirname, '../..')
const chrome = process.env.CHROME_BIN ?? '/usr/bin/google-chrome'

const withSkins = readdirSync(join(root, 'plugins'), { withFileTypes: true })
  .filter(e => e.isDirectory() && existsSync(join(root, 'plugins', e.name, 'profile.json')))
  .map(e => ({ name: e.name, dir: join(root, 'plugins', e.name) }))
  .map(p => ({ ...p, template: JSON.parse(readFileSync(join(p.dir, 'profile.json'), 'utf8')) }))
  .filter(p => p.template.skin)

// An SVG skin is a skin.ttl and an artwork; an HTML skin is one file the profile points at (docs/html-skins.md).
const svgSkins = withSkins.filter(p => !p.template.skin.html)
const htmlSkins = withSkins.filter(p => p.template.skin.html)

describe('plugins that declare a skin', () => {
  it('include at least one of each kind, or every check below passes over nothing', () => {
    expect(svgSkins.map(p => p.name)).toContain('tremolo')
    expect(htmlSkins.map(p => p.name)).toContain('canticle')
  })

  for (const p of htmlSkins) {
    it(`${p.name}: the profile's digest is of the HTML file, and there is no skin.ttl to disagree with it`, async () => {
      const profile = readProfile(await parseText(readFileSync(join(p.dir, 'profile.ttl'), 'utf8'), p.template.iri))
      expect(profile.skin.mediaType).toBe('text/html')
      expect(profile.skin.integrity).toBe(await digestOf(new Uint8Array(readFileSync(join(p.dir, p.template.skin.html)))))
      expect(existsSync(join(p.dir, 'skin/skin.ttl'))).toBe(false)
    })
  }

  for (const p of svgSkins) {
    it(`${p.name}: the profile's digest is of skin.ttl and skin.ttl's is of the artwork`, async () => {
      const profile = readProfile(await parseText(readFileSync(join(p.dir, 'profile.ttl'), 'utf8'), p.template.iri))
      const skinText = readFileSync(join(p.dir, p.template.skin.file), 'utf8')
      expect(profile.skin.integrity).toBe(await digestOf(new TextEncoder().encode(skinText)))
      const art = new Uint8Array(readFileSync(join(p.dir, p.template.skin.artwork)))
      expect(skinText).toContain(`jig:integrity "${await digestOf(art)}"`)
    })

    it(`${p.name}: skin.ttl satisfies the skin shapes`, async () => {
      const validator = await shapeValidatorFromFile(join(root, 'vocabs/shapes.ttl'))
      const iri = new URL(p.template.skin.file, p.template.iri).href
      const report = await validator.validate(await parseText(readFileSync(join(p.dir, p.template.skin.file), 'utf8'), iri))
      expect(report.violations.map(v => v.message)).toEqual([])
    })
  }
})

describe('npm run check:skins', () => {
  // Skipped visibly, never passed: a machine without Chrome has not run the check.
  it.skipIf(!existsSync(chrome))('passes in Chrome, and says what it checked', () => {
    const run = spawnSync(process.execPath, ['bin/check-skins.js'], { cwd: root, encoding: 'utf8', timeout: 120000 })
    expect(run.stdout + run.stderr).not.toMatch(/^FAIL/m)
    expect(run.status).toBe(0)
    expect(run.stdout).toContain('ok   script')
    expect(run.stdout).toContain('ok   tremolo: 4 controls agree')
    expect(run.stdout).toContain('ok   canticle: html skin builds in Chrome with 16 controls')
    expect(run.stdout).toContain('ok   drumkit: html skin builds in Chrome with 75 controls')
    expect(run.stdout).toContain('ok   drumkit: no overflow and every target at least 44px, from 200 to 1600px in steps of 50')
    expect(run.stdout).toContain('ok   html: the author cannot remove the focus ring (the cascade, with :enabled standing in for :focus-visible)')
  })

  it('exits 3 and checks nothing when there is no Chrome, rather than passing', () => {
    const run = spawnSync(process.execPath, ['bin/check-skins.js'], { cwd: root, encoding: 'utf8', env: { ...process.env, CHROME_BIN: '/nonexistent/chrome' } })
    expect(run.status).toBe(3)
    expect(run.stdout).toContain('Nothing was checked')
  })
})
