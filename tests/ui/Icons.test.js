// tests/ui/Icons.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
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

  it('gives every icon button in the studio its own drawing, so two buttons are never told apart by their tooltip alone', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8')
    const found = [...html.matchAll(/<button[^>]*id="([^"]+)"[^>]*data-icon="([^"]+)"[^>]*>/g)]
    const owner = new Map()
    const shared = []
    for (const [, id, name] of found) {
      if (owner.has(name)) shared.push(`${id} and ${owner.get(name)} both use ${name}`)
      else owner.set(name, id)
    }
    expect(shared).toEqual([])
  })

  it('every drawing is used or is one the pages build in code, so none is left over', () => {
    const html = readFileSync(resolve(import.meta.dirname, '../../web/index.html'), 'utf8')
    const code = ['src/ui', 'web/app'].flatMap(dir => readdirSync(resolve(import.meta.dirname, '../..', dir)).map(f => resolve(import.meta.dirname, '../..', dir, f))).filter(f => f.endsWith('.js')).map(f => readFileSync(f, 'utf8')).join('\n')
    const unused = Object.keys(ICONS).filter(name => !html.includes(`data-icon="${name}"`) && !new RegExp(`['"]${name}['"]`).test(code.replace(/export const ICONS[\s\S]*?\n\}\)/, '')))
    expect(unused).toEqual([])
  })
})

describe('words beside an icon', () => {
  const make = (extra = '') => {
    document.body.innerHTML = `<button id="b" data-icon="play" ${extra}>Play</button>`
    applyIcons(document.body)
    return document.getElementById('b')
  }

  it('are drawn after the icon when the button asks, and the accessible name is the same words', () => {
    const button = make('data-words')
    expect(button.querySelector('.icon-words').textContent).toBe('Play')
    expect(button.getAttribute('aria-label')).toBe('Play')
    expect(button.firstElementChild.tagName.toLowerCase()).toBe('svg')
  })

  it('are not drawn when the button does not ask, so an icon button stays an icon', () => {
    expect(make().querySelector('.icon-words')).toBeNull()
  })

  it('are not added a second time when icons are applied again', () => {
    const button = make('data-words')
    applyIcons(document.body)
    expect(button.querySelectorAll('.icon-words')).toHaveLength(1)
  })

  it('are the label the setIcon call was given', () => {
    document.body.innerHTML = '<button id="c"></button>'
    const button = document.getElementById('c')
    setIcon(document, button, 'stop', 'Halt', { words: true })
    expect(button.querySelector('.icon-words').textContent).toBe('Halt')
    expect(button.getAttribute('aria-label')).toBe('Halt')
  })
})
