// tests/web/SettingsTab.test.js
//
// The Settings tab holds the preferences and session details that are not part of playing: the latency alignment, the project's title,
// author and notes, and the two agent connections. Its modules find their controls by id, so what is checked is that each id sits in
// the Settings panel, once, and that the tab is in the list the page builds.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '../..')
const { document } = parseHTML(readFileSync(resolve(root, 'web/index.html'), 'utf8'))

describe('the Settings tab', () => {
  const panel = document.getElementById('settings-panel')

  it('is a hidden tab panel, and the page builds a tab for it after the others', () => {
    expect(panel.className).toBe('tabpanel')
    expect(panel.hasAttribute('hidden')).toBe(true)
    const app = readFileSync(resolve(root, 'web/app.js'), 'utf8')
    const ids = [...app.matchAll(/\{ id: '([a-z]+)', label: '([A-Za-z]+)', panel: \$\('([a-z-]+)'\) \}/g)].map(m => m[1])
    expect(ids).toEqual(['arrangement', 'tracks', 'routing', 'mixer', 'launcher', 'script', 'settings'])
    expect(app).toContain("panel: $('settings-panel')")
  })

  it('holds the latency alignment, the project details and both agent connections, each id once', () => {
    for (const id of ['align-tracks', 'align-status', 'project-body', 'agentbar', 'bridgebar', 'bridge-status']) {
      expect(document.querySelectorAll(`#${id}`), id).toHaveLength(1)
      expect(panel.querySelector(`#${id}`), `${id} is in the Settings panel`).not.toBeNull()
    }
  })

  it('has taken them out of the Mixer tab and the foot of the page', () => {
    expect(document.getElementById('mixer-panel').querySelector('#align-tracks')).toBeNull()
    const loose = [...document.querySelectorAll('body > details')].map(d => d.id || d.className)
    expect(loose.join(' ')).not.toMatch(/agent|bridge|project/)
  })

  it('names each section with a heading, so the tab can be read in pieces', () => {
    expect([...panel.querySelectorAll('h2, h3')].map(h => h.textContent)).toEqual(['Settings', 'Appearance', 'Playback', 'Project', 'Agents'])
  })
})

describe('the mixer channel', () => {
  it('stacks Mute over Solo, and stands the meter beside the fader', () => {
    const css = readFileSync(resolve(root, 'web/index.html'), 'utf8')
    expect(css).toMatch(/\.strip-desk \.strip-buttons \{ flex-direction:column;/)
    expect(css).toMatch(/\.mixer-channel \.meter \{ flex-direction:column-reverse;/)
    expect(css).toMatch(/\.strip-faderbox \{ display:flex;/)
  })
})
