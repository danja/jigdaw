// tests/bin/jig.test.js
//
// bin/jig.js is the jalv equivalent: list, info, panel and render over the
// local plugins. These tests bind its list to the plugin directories and its
// panel output to the profile it claims to show, so the two cannot drift.
import { describe, it, expect } from 'vitest'
import { resolve } from 'node:path'
import {
  listLocalPlugins, dirNameOf, resolveProfile, renderPanelHTML, escapeHtml
} from '../../bin/jig.js'
import { pluginDirs } from '../../src/catalogue/PluginDirectories.js'

const root = resolve(import.meta.dirname, '../..')

describe('jig list', () => {
  it('lists exactly the plugin directories on disk', async () => {
    const plugins = await listLocalPlugins()
    const dirs = await pluginDirs(resolve(root, 'plugins'))
    expect(plugins.map(p => dirNameOf(p.iri)).sort()).toEqual(dirs)
  })
})

describe('jig info/panel resolution', () => {
  it('resolves a bare directory name to its profile', async () => {
    const { profile, name } = await resolveProfile('pulse')
    expect(name).toBe('pulse')
    expect(profile.label).toBe('Pulse')
    expect(profile.ports.length).toBeGreaterThan(0)
  })
})

describe('renderPanelHTML', () => {
  it('shows every declared control by name', async () => {
    const { profile } = await resolveProfile('pulse')
    const html = await renderPanelHTML(profile)
    for (const port of profile.ports) {
      expect(html).toContain(port.name)
    }
  })

  it('treats profile strings as data, never as markup', async () => {
    const { profile } = await resolveProfile('pulse')
    const hostile = {
      ...profile,
      label: '<script>alert(1)</script>',
      comment: '<img src=x onerror=alert(1)>'
    }
    const html = await renderPanelHTML(hostile)
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain(escapeHtml(hostile.label))
    expect(html).toContain(escapeHtml(hostile.comment))
  })
})
