// tests/ui/Icons.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'
import { ICONS, iconElement, setIcon, applyIcons } from '../../src/ui/Icons.js'

let document
beforeEach(() => { ({ document } = parseHTML('<!doctype html><html><body></body></html>')) })

describe('icons', () => {
  it('has a path for every name, each a non-empty drawing', () => {
    for (const [name, d] of Object.entries(ICONS)) expect(d.length, name).toBeGreaterThan(10)
  })

  it('draws a hidden, unfocusable svg, and refuses a name it does not have', () => {
    const svg = iconElement(document, 'play')
    expect(svg.getAttribute('aria-hidden')).toBe('true')
    expect(svg.getAttribute('focusable')).toBe('false')
    expect(svg.querySelector('path').getAttribute('d')).toBe(ICONS.play)
    expect(() => iconElement(document, 'nope')).toThrow(/no such icon/)
  })

  it('an icon button keeps its words as its name and tooltip', () => {
    const button = document.createElement('button')
    button.textContent = 'Play'
    setIcon(document, button, 'play', 'Play')
    expect(button.getAttribute('aria-label')).toBe('Play')
    expect(button.getAttribute('title')).toBe('Play')
    expect(button.textContent).toBe('')
    expect(button.querySelector('svg')).not.toBeNull()
  })

  it('keeps a fuller title the page wrote, when asked', () => {
    const button = document.createElement('button')
    button.setAttribute('title', 'Repeat the loop range while playing')
    setIcon(document, button, 'loop', 'Loop', { keepTitle: true })
    expect(button.getAttribute('title')).toBe('Repeat the loop range while playing')
    expect(button.getAttribute('aria-label')).toBe('Loop')
  })

  it('turns marked buttons into icon buttons from their words, once, and leaves others alone', () => {
    document.body.innerHTML = '<button id="a" data-icon="save">Save</button><button id="b">Browser</button>'
    applyIcons(document.body)
    applyIcons(document.body)
    expect(document.getElementById('a').getAttribute('aria-label')).toBe('Save')
    expect(document.getElementById('a').querySelectorAll('svg')).toHaveLength(1)
    expect(document.getElementById('b').textContent).toBe('Browser')
  })

  it('every data-icon in the studio page names an icon, and its button has words to become a name', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8')
    const found = [...html.matchAll(/<button[^>]*data-icon="([^"]+)"[^>]*>([^<]*)</g)]
    expect(found.length).toBeGreaterThan(5)
    for (const [, name, words] of found) {
      expect(ICONS[name], name).toBeDefined()
      expect(words.trim().length, `${name} has words`).toBeGreaterThan(0)
    }
  })
})
