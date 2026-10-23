// tests/ui/ChannelToggle.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import { createChannelToggle } from '../../src/ui/ChannelToggle.js'

let document
beforeEach(() => { ({ document } = parseHTML('<!doctype html><body></body>')) })

describe('a mute or solo toggle', () => {
  it('shows one letter and keeps the word as its name and tooltip', () => {
    const mute = createChannelToggle(document, { key: 'muted', id: 'm' })
    const solo = createChannelToggle(document, { key: 'soloed', id: 's', name: 'Bass' })
    expect([mute.textContent, mute.getAttribute('aria-label'), mute.title]).toEqual(['M', 'Mute', 'Mute'])
    expect([solo.textContent, solo.getAttribute('aria-label'), solo.title]).toEqual(['S', 'Solo Bass', 'Solo Bass'])
  })
  it('starts off, or on when told, and reports it as pressed', () => {
    expect(createChannelToggle(document, { key: 'muted', id: 'a' }).getAttribute('aria-pressed')).toBe('false')
    expect(createChannelToggle(document, { key: 'muted', id: 'b', pressed: true }).getAttribute('aria-pressed')).toBe('true')
  })
  it('carries the id and the class the stylesheet and the focus restore look for', () => {
    const button = createChannelToggle(document, { key: 'soloed', id: 'head-t1-soloed' })
    expect(button.id).toBe('head-t1-soloed')
    expect(button.className).toBe('strip-toggle soloed')
  })
  it('refuses a key that is neither', () => {
    expect(() => createChannelToggle(document, { key: 'armed', id: 'x' })).toThrow(/muted or soloed/)
  })
  it('is styled so on differs from off by more than colour, and is 44px on a phone', () => {
    const css = readFileSync(new URL('../../web/index.html', import.meta.url), 'utf8')
    expect(css).toMatch(/\.strip-toggle\[aria-pressed="true"\] \{ text-decoration:underline/)
    expect(css).toMatch(/\(pointer: coarse\) \{\s*\.strip-toggle \{ min-height:44px; min-width:44px; \}/)
  })
})
