// tests/validate/DeprecatedFormat.test.js
//
// plugin-universe deprecated trn:WebAudio for trn:Jig and its raw shape rejects the old term, so a profile that still declares it
// fails there with one violation. Two generators (bin/write-profile.js from each plugin's profile.json, and bin/jsfx-import.js)
// emitted it for every plugin until 2026-10-24, and changing it changes every plugin's digest, so the rule is held here
// across everything that can carry the term: each plugin's source and generated profile, the generator, and the examples.
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const plugins = readdirSync(resolve(root, 'plugins'), { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)
const carriers = plugins.flatMap(name => ['profile.json', 'profile.ttl', 'plugin.json'].map(f => `plugins/${name}/${f}`))
  .concat(['bin/jsfx-import.js', 'bin/write-profile.js', 'examples/reference-profile.ttl'])
  .filter(path => existsSync(resolve(root, path)))

describe('the deprecated trn:WebAudio format', () => {
  it('walks every plugin and both generators, so the rest of this is not vacuous', () => {
    expect(carriers.filter(p => p.endsWith('profile.ttl')).length).toBeGreaterThanOrEqual(30)
    expect(carriers).toContain('bin/jsfx-import.js')
    expect(carriers).toContain('plugins/8b8/plugin.json')
  })

  it('is declared by nothing: every profile, source and generator says trn:Jig', () => {
    const declaring = carriers.filter(path => /"format"\s*:\s*"[^"]*trn:WebAudio|trn:format[^;.]*trn:WebAudio|format:\s*'[^']*trn:WebAudio/.test(readFileSync(resolve(root, path), 'utf8')))
    expect(declaring).toEqual([])
  })

  it('has trn:Jig as the format of every generated profile', () => {
    const missing = carriers.filter(p => p.endsWith('profile.ttl') && !/trn:format\s+trn:Jig\s*;/.test(readFileSync(resolve(root, p), 'utf8')))
    expect(missing).toEqual([])
  })
})
