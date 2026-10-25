// tests/web/Align.test.js
//
// The alignment box and where its value comes from. A session that says wins over the person's own preference when it is
// opened; one that says nothing gets the preference (not the last session's value); changing the box makes the session say,
// and tells the person that the session is what says so. The project is the real model, so what is saved is what is held.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createAlign } from '../../web/app/Align.js'
import { Project } from '../../src/model/Project.js'

let document
let window
const settle = () => new Promise(resolve => setTimeout(resolve, 0))
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body><input type="checkbox" id="align-tracks"><p id="align-status"></p></body>')) })

function build ({ stored = null, config = true, failStorage = false } = {}) {
  const store = new Map(stored === null ? [] : [['jigdaw.alignTracks', stored]])
  const page = {
    localStorage: {
      getItem: key => { if (failStorage) throw new Error('blocked'); return store.get(key) ?? null },
      setItem: (key, value) => { if (failStorage) throw new Error('blocked'); store.set(key, value) }
    }
  }
  const dispatcher = {
    project: new Project(),
    alignTracks: config,
    setAlignTracks (on) { this.alignTracks = Boolean(on) }
  }
  let drawn = 0
  const ctx = {
    window: page, document, $: id => document.getElementById(id), log () {},
    hostConfig: { alignTracks: config }, dispatcher,
    runtime: { ensureRunning: async () => dispatcher },
    rack: { draw: () => { drawn += 1 } }
  }
  const align = createAlign(ctx)
  align.mount()
  const box = document.getElementById('align-tracks')
  const toggle = async on => { box.checked = on; box.dispatchEvent(new window.Event('change', { bubbles: true })); await settle() }
  return { align, dispatcher, box, store, toggle, status: () => document.getElementById('align-status').textContent, drawn: () => drawn }
}

describe('where the alignment setting comes from', () => {
  it('uses what the session says over the person\'s own preference, and says the session is why', () => {
    const { align, dispatcher, box, status } = build({ stored: '0', config: true })
    dispatcher.project.setSettings({ alignTracks: true })
    align.fromSession()
    expect(dispatcher.alignTracks).toBe(true)
    expect(box.checked).toBe(true)
    expect(status()).toMatch(/delayed to line up.*This session says so\.$/)
  })

  it('uses the preference for a session that says nothing, not the last session\'s value', () => {
    const { align, dispatcher, box, status } = build({ stored: '0', config: true })
    dispatcher.alignTracks = true
    align.fromSession()
    expect(dispatcher.alignTracks).toBe(false)
    expect(box.checked).toBe(false)
    expect(status()).toBe('Tracks are not lined up: a track with latency sounds later than one without.')
  })

  it('falls back to the host file when there is no preference, or the storage is blocked', () => {
    const none = build({ config: true })
    none.dispatcher.alignTracks = false
    none.align.fromSession()
    expect(none.dispatcher.alignTracks).toBe(true)
    const blocked = build({ config: false, failStorage: true })
    blocked.dispatcher.alignTracks = true
    blocked.align.fromSession()
    expect(blocked.dispatcher.alignTracks).toBe(false)
  })

  it('a session that says false is honoured over a preference of true', () => {
    const { align, dispatcher } = build({ stored: '1', config: true })
    dispatcher.project.setSettings({ alignTracks: false })
    align.fromSession()
    expect(dispatcher.alignTracks).toBe(false)
  })

  it('redraws the rack, since each track\'s header says how far it was delayed', () => {
    const { align, drawn } = build()
    align.fromSession()
    expect(drawn()).toBe(1)
  })
})

describe('changing the box', () => {
  it('makes the session say, keeps the preference, and tells the person which', async () => {
    const { dispatcher, toggle, store, status } = build({ config: true })
    expect(dispatcher.project.settings.alignTracks).toBeNull()
    await toggle(false)
    expect(dispatcher.alignTracks).toBe(false)
    expect(dispatcher.project.settings.alignTracks).toBe(false)
    expect(store.get('jigdaw.alignTracks')).toBe('0')
    expect(status()).toMatch(/This session says so\.$/)
    await toggle(true)
    expect(dispatcher.project.settings.alignTracks).toBe(true)
    expect(store.get('jigdaw.alignTracks')).toBe('1')
  })

  it('still changes the session when the storage is blocked', async () => {
    const { dispatcher, toggle } = build({ failStorage: true })
    await toggle(false)
    expect(dispatcher.project.settings.alignTracks).toBe(false)
  })
})

describe('opening a session', () => {
  it('reads the settings into the project and applies them, after the plugins are loaded (Sessions.js is the caller)', async () => {
    const { readFileSync } = await import('node:fs')
    const { resolve } = await import('node:path')
    const source = readFileSync(resolve(import.meta.dirname, '../../web/app/Sessions.js'), 'utf8')
    // Replaced even when the file says nothing, and applied once the project holds it.
    expect(source).toMatch(/d\.project\.setSettings\(read\.settings\)/)
    expect(source.indexOf('setSettings(read.settings)')).toBeLessThan(source.indexOf('ctx.align?.fromSession()'))
    expect(source.indexOf('openProject')).toBeLessThan(source.indexOf('ctx.align?.fromSession()'))
  })
})
