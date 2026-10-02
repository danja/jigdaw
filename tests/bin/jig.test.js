// tests/bin/jig.test.js
//
// bin/jig.js is the jalv equivalent: list, info, panel and render over the
// local plugins. These tests bind its list to the plugin directories and its
// panel output to the profile it claims to show, so the two cannot drift.
import { describe, it, expect } from 'vitest'
import { mkdtempSync, symlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  listLocalPlugins, dirNameOf, resolveProfile, renderPanelHTML, escapeHtml, panelStyle
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

  // A standalone panel page is opened as a file:// URL, so it cannot link
  // web/panel.css: the styles have to be inlined. Without the panel rules a
  // screenshot is of an unstyled page where every control is a full-width
  // block, which is not a defect in the plugin and is invisible to every
  // other check. Found by measuring a rendered page in Chrome rather than by
  // reading the CSS.
  it('inlines the panel stylesheet the studio page only links', async () => {
    const style = await panelStyle()
    // Every selector the generated panel and the knob need, from
    // web/panel.css.
    for (const selector of ['.controls', '.control', '.dial', '.dial-input', '.control-selector']) {
      expect(style, `panelStyle() has no ${selector} rule`).toContain(selector)
    }
    // And the tokens it expects to be defined on :root, from web/index.html.
    expect(style).toContain('--line')
  })

  it('puts every rule the panel needs in the page it renders', async () => {
    const { profile } = await resolveProfile('pulse')
    const html = await renderPanelHTML(profile)
    expect(html).toContain('.controls')
    // A stylesheet link would resolve to nothing under file://.
    expect(html).not.toMatch(/<link[^>]+stylesheet/)
  })

  // A checkout reached by two names is ordinary: ~/github/jigdaw symlinked or
  // bind mounted at another path, then `node that/bin/jig.js list` printed
  // nothing and exited 0, because the entry point test compared two strings.
  // plugin-universe's screenshot path worked around it upstream rather than
  // reporting it. Nothing else here can see it: every other call in this file
  // imports the module rather than running it.
  it('runs its entry point when the same file is reached by another name', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jig-entry-'))
    const link = join(dir, 'jig.js')
    try {
      symlinkSync(resolve(root, 'bin/jig.js'), link)
      const result = spawnSync(process.execPath, [link, 'list'], { encoding: 'utf8' })
      expect(result.status, `stderr: ${result.stderr}`).toBe(0)
      expect(result.stdout.trim(), 'the process exited 0 having done nothing').not.toBe('')
      expect(result.stdout).toContain('Boost')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 120000)

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
