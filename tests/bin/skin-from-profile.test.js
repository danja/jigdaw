// tests/bin/skin-from-profile.test.js
//
// bin/skin-from-profile.js drafts an HTML skin from a profile.json. The draft is edited by hand afterwards, so what is held here is
// that it starts valid: the host's own builder accepts what it writes, for every plugin in the repository and not only the ones it
// was written from, and the command does what it says to the files it is given.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseHTML } from 'linkedom'
import { generateSkin, sharedPrefix, widgetOf } from '../../bin/skin-from-profile.js'
import { buildHtmlSkin } from '../../src/ui/HtmlSkin.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile } from '../../src/validate/files.js'

const root = resolve(import.meta.dirname, '../..')
const port = (symbol, name, extra = {}) => ({ symbol, name, minimum: 0, maximum: 1, default: 0, ...extra })

describe('sharedPrefix', () => {
  it('is the words every name begins with, when there are three or more names', () => {
    expect(sharedPrefix(['Op A Waveform', 'Op A Ratio', 'Op A Level'])).toBe('Op A ')
    expect(sharedPrefix(['Closed HH Decay', 'Closed HH Level', 'Closed HH Mute'])).toBe('Closed HH ')
  })
  it('is nothing for fewer than three names, or names that share no first word', () => {
    expect(sharedPrefix(['Kick Pitch', 'Kick Decay'])).toBe('')
    expect(sharedPrefix(['Algorithm', 'Feedback', 'FM Depth'])).toBe('')
  })
  it('never takes a whole name, so every label keeps a word', () => {
    expect(sharedPrefix(['Drive', 'Drive Amount', 'Drive Tone'])).toBe('')
    expect(sharedPrefix(['Pitch Envelope', 'Pitch Envelope Amount', 'Pitch Attack'])).toBe('Pitch ')
  })
})

describe('generateSkin', () => {
  const template = {
    label: 'Test & "Co"',
    ports: [
      port('a_wave', 'Op A Waveform', { group: 'Operator A', scalePoints: [{ label: 'x', value: 0 }, { label: 'y', value: 1 }, { label: 'z', value: 2 }] }),
      port('a_fixed', 'Op A Fixed', { group: 'Operator A', toggled: true }),
      port('a_level', 'Op A Level', { group: 'Operator A' }),
      port('loose', 'Loose <one>'),
      port('master', 'Master', { group: 'Output' })
    ]
  }
  const html = generateSkin(template)

  it('makes a card for each group, in the order the groups first appear, with ungrouped ports in a last card', () => {
    expect([...html.matchAll(/<h2>(.*?)<\/h2>/g)].map(m => m[1])).toEqual(['Operator A', 'Output', 'Controls'])
  })

  it('draws a select for an enumeration, a checkbox for a switch and a slider with its value for the rest, by the host\'s own rule', () => {
    expect(html).toContain('<select id="a_wave" data-param="a_wave">')
    expect(html).toContain('<input id="a_fixed" type="checkbox" data-param="a_fixed">')
    expect(html).toContain('<input id="a_level" type="range" data-param="a_level"><output data-param-text="a_level">')
    expect(widgetOf(template.ports[0])).toBe('selector')
    expect(widgetOf(port('t', 'T', { scalePoints: [{ label: 'a', value: 0 }, { label: 'b', value: 1 }] }))).toBe('switch')
  })

  it('shortens a label by its group\'s shared prefix and leaves other labels whole', () => {
    expect(html).toContain('<label for="a_level">Level</label>')
    expect(html).toContain('<label for="master">Master</label>')
  })

  it('writes a port\'s name and the plugin\'s label as text, never as markup', () => {
    expect(html).toContain('Loose &lt;one&gt;')
    expect(html).toContain('Test &amp; &quot;Co&quot;')
    expect(html).not.toContain('<one>')
  })

  it('has no script, and one stylesheet confined to the skin layer', () => {
    expect(html).not.toContain('<script')
    expect(html.match(/<style>/g)).toHaveLength(1)
    expect(html).toContain('@layer skin {')
  })
})

// The draft must start valid for every plugin there is, so a plugin with an odd port or a long name cannot be the first to find out.
describe('the draft for every plugin in the repository', () => {
  const plugins = readdirSync(join(root, 'plugins'))
    .filter(name => existsSync(join(root, 'plugins', name, 'profile.json')) && existsSync(join(root, 'plugins', name, 'profile.ttl')))
    .map(name => ({ name, dir: join(root, 'plugins', name), template: JSON.parse(readFileSync(join(root, 'plugins', name, 'profile.json'), 'utf8')) }))
    .filter(p => p.template.ports?.length)

  it('covers the plugins, or the checks below pass over nothing', () => {
    expect(plugins.length).toBeGreaterThan(25)
    expect(plugins.map(p => p.name)).toEqual(expect.arrayContaining(['quartet', 'drumkit', 'octet']))
  })

  for (const { name, dir, template } of plugins) {
    it(`${name}: is accepted by the host's builder with every port bound`, async () => {
      const profile = await readProfile(await parseTurtleFile(join(dir, 'profile.ttl')), template.iri)
      const { document } = parseHTML('<!doctype html><html><body></body></html>')
      const built = buildHtmlSkin(parseHTML(generateSkin(template)).document, profile, { document, prefix: 'g-' })
      expect(built.omitted).toEqual([])
      expect(built.controls.map(c => c.port.symbol).sort()).toEqual(profile.ports.map(p => p.symbol).sort())
    })
  }
})

describe('the command', () => {
  const script = join(root, 'bin/skin-from-profile.js')
  const profileJson = { iri: 'https://example.org/p/', label: 'P', ports: [port('gain', 'Gain', { group: 'Out' }), port('mute', 'Mute', { group: 'Out', toggled: true })] }
  function plugin (json = profileJson, text = null) {
    const dir = mkdtempSync(join(tmpdir(), 'skin-from-'))
    writeFileSync(join(dir, 'profile.json'), text ?? JSON.stringify(json, null, 2) + '\n')
    return dir
  }
  const run = (dir, ...args) => spawnSync(process.execPath, [script, dir, ...args], { encoding: 'utf8' })

  it('writes the skin and adds the one key to a profile.json it can rewrite exactly', () => {
    const dir = plugin()
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(existsSync(join(dir, 'skin/skin.html'))).toBe(true)
      expect(JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8')).skin).toEqual({ html: 'skin/skin.html' })
      expect(result.stdout).toContain('build.sh')
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('refuses to replace a skin that is there, until it is told to', () => {
    const dir = plugin()
    try {
      run(dir)
      writeFileSync(join(dir, 'skin/skin.html'), 'hand edited')
      const refused = run(dir)
      expect(refused.status).toBe(1)
      expect(refused.stderr).toContain('--force')
      expect(readFileSync(join(dir, 'skin/skin.html'), 'utf8')).toBe('hand edited')
      expect(run(dir, '--force').status).toBe(0)
      expect(readFileSync(join(dir, 'skin/skin.html'), 'utf8')).toContain('<div class="panel">')
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('refuses a plugin that has an SVG skin', () => {
    const dir = plugin({ ...profileJson, skin: { file: 'skin/skin.ttl', artwork: 'skin/panel.svg', controls: [] } })
    try {
      const result = run(dir)
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('SVG skin')
      expect(existsSync(join(dir, 'skin/skin.html'))).toBe(false)
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('leaves a profile.json alone, and says so, when rewriting it would change more than the one key', () => {
    const text = JSON.stringify(profileJson).replace(/,/g, ', ') + '\n'
    const dir = plugin(null, text)
    try {
      const result = run(dir)
      expect(result.status).toBe(0)
      expect(readFileSync(join(dir, 'profile.json'), 'utf8')).toBe(text)
      expect(result.stdout).toContain('add "skin"')
    } finally { rmSync(dir, { recursive: true }) }
  })

  it('exits 2 with its usage, and writes nothing, when given no directory', () => {
    const result = spawnSync(process.execPath, [script], { encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('usage:')
  })
})
