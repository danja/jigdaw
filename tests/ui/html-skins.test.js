// tests/ui/html-skins.test.js
//
// Every HTML skin a plugin ships (plugins/*/skin/skin.html, docs/html-skins.md), run through the host's own builder and panel
// against that plugin's real profile. Found by walking plugins/ as it is now, so a skin added later is in scope. A skin that
// leaves a port to the generated panel is allowed, and is listed here by name so it is a decision and not an accident.
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { parseHTML } from 'linkedom'
import { buildHtmlSkin } from '../../src/ui/HtmlSkin.js'
import { createPanel } from '../../src/ui/Panel.js'
import { readProfile } from '../../src/rdf/ProfileReader.js'
import { parseTurtleFile } from '../../src/validate/files.js'
import { digestOf } from '../../src/host/Integrity.js'

const root = resolve(import.meta.dirname, '../..')
const skins = readdirSync(join(root, 'plugins'))
  .filter(name => existsSync(join(root, 'plugins', name, 'skin/skin.html')))
  .map(name => ({ name, dir: join(root, 'plugins', name) }))

// Ports a skin deliberately leaves to the generated panel. Empty today.
const LEFT_TO_PANEL = {}

describe('the HTML skins', () => {
  it('are found, or every check below passes over nothing', () => {
    expect(skins.map(s => s.name)).toEqual(expect.arrayContaining(['canticle', 'drumkit']))
  })

  for (const { name, dir } of skins) {
    describe(name, () => {
      const text = readFileSync(join(dir, 'skin/skin.html'), 'utf8')
      const template = JSON.parse(readFileSync(join(dir, 'profile.json'), 'utf8'))
      const load = async () => readProfile(await parseTurtleFile(join(dir, 'profile.ttl')), template.iri)
      const build = async () => {
        const profile = await load()
        const { document } = parseHTML('<!doctype html><html><body></body></html>')
        return { profile, document, built: buildHtmlSkin(parseHTML(text).document, profile, { document, prefix: 'skin-x-' }) }
      }
      const panelOf = async () => {
        const { profile, document, built } = await build()
        const panel = createPanel(document, profile, () => {}, null, { scope: name, skin: { ...built, kind: 'html' } })
        document.body.append(panel.element)
        return { profile, panel }
      }

      it('has no script, and nothing in it is refused or left out', async () => {
        expect(parseHTML(text).document.querySelectorAll('script')).toHaveLength(0)
        expect((await build()).built.omitted).toEqual([])
      })

      it('binds every port the plugin declares, once each, except those it names as left to the panel', async () => {
        const { profile, built } = await build()
        const bound = built.controls.map(c => c.port.symbol)
        const left = LEFT_TO_PANEL[name] ?? []
        expect(profile.ports.map(p => p.symbol).filter(s => !bound.includes(s) && !left.includes(s))).toEqual([])
        expect(new Set(bound).size).toBe(bound.length)
      })

      it('uses a select for every enumeration, a checkbox for every switch and a slider for the rest', async () => {
        const { built } = await build()
        const expected = { selector: 'select', switch: 'checkbox', dial: 'range' }
        for (const c of built.controls) expect(c.kind, c.port.symbol).toBe(expected[c.port.widget])
      })

      it('is the file the profile\'s digest was computed over, declared as HTML with no skin.ttl beside it', async () => {
        const profile = await load()
        expect(profile.skin.mediaType).toBe('text/html')
        expect(profile.skin.integrity).toBe(await digestOf(new Uint8Array(readFileSync(join(dir, 'skin/skin.html')))))
        expect(existsSync(join(dir, 'skin/skin.ttl'))).toBe(false)
      })

      it('makes a panel that draws the plugin from the skin, with a generated control only for a port named as left to it', async () => {
        const { panel } = await panelOf()
        expect(panel.skinned).toBe(true)
        const generated = [...(panel.element.querySelector('.skin-others')?.querySelectorAll('input, select') ?? [])]
        expect(generated).toHaveLength((LEFT_TO_PANEL[name] ?? []).length)
      })

      it('describes each port that has a comment, and no other', async () => {
        const { profile, panel } = await panelOf()
        const inside = panel.skinView.element.shadowRoot ?? panel.skinView.element
        const described = [...inside.querySelectorAll('[aria-describedby]')].map(el => el.getAttribute('data-param')).sort()
        expect(described).toEqual(profile.ports.filter(p => p.comment).map(p => p.symbol).sort())
      })

      it('reports no visible label that is missing from its port\'s name', async () => {
        const { panel } = await panelOf()
        expect(panel.skinView.warnings).toEqual([])
      })
    })
  }
})
