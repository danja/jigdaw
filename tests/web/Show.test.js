// tests/web/Show.test.js
//
// Binds the step list in src/ui/Show.js to the studio page, in both directions. A list that names a control the page no longer has,
// or a page with a control the list never placed, is the case this exists for: a control added next month with no step would be
// drawn at every step, which is the same as the list never having existed.
//
// What it walks: every button, select and input inside the transport bar (`.transport`), the tabs web/app.js builds, and the
// named details below the stage. What it does not walk: controls that scripts draw later (the timeline's tools, the mixer's
// channels, a plugin's panel). Those take the step of the panel they are drawn in, and a step list for them is a later addition.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { FROM, STEPS, STEP_LABELS } from '../../src/ui/Show.js'

const root = resolve(import.meta.dirname, '../..')
const html = readFileSync(resolve(root, 'web/index.html'), 'utf8')
const app = readFileSync(resolve(root, 'web/app.js'), 'utf8')
const { document } = parseHTML(html)

const tabIds = [...app.matchAll(/\{ id: '([a-z]+)', label: '[A-Za-z]+', panel: \$\('[a-z-]+'\) \}/g)].map(m => m[1])
const isTab = selector => selector.startsWith('#tab-')

describe('the step list and the page', () => {
  it('finds the tabs the page builds, so the walk below is not empty', () => {
    expect(tabIds).toEqual(['arrangement', 'tracks', 'routing', 'mixer', 'launcher', 'script', 'settings'])
  })

  it('names, for every selector that is not a tab, exactly one element in index.html', () => {
    for (const selector of Object.keys(FROM).filter(s => !isTab(s))) {
      expect(document.querySelectorAll(selector), selector).toHaveLength(1)
    }
  })

  it('names a tab for every tab the page builds and no other', () => {
    expect(Object.keys(FROM).filter(isTab).sort()).toEqual(tabIds.map(id => `#tab-${id}`).sort())
  })

  it('places every button, select and input in the transport bar, itself or by what holds it', () => {
    const controls = [...document.querySelectorAll('.transport button, .transport select, .transport input')]
      .filter(el => el.getAttribute('type') !== 'file')
    expect(controls.length).toBeGreaterThan(20)
    const unplaced = controls.filter(el => !Object.keys(FROM).filter(s => !isTab(s)).some(s => el.matches(s) || el.closest(s)))
    expect(unplaced.map(el => el.id || el.outerHTML.slice(0, 60))).toEqual([])
  })

  it('places every details block with an id that holds the log, an agent or the history', () => {
    for (const id of ['history', 'log-details', 'local-agent', 'bridge']) {
      expect(FROM[`#${id}`], id).toBeDefined()
    }
  })

  it('never draws a control earlier than the thing that holds it, since it would still not be on the screen', () => {
    const selectors = Object.keys(FROM).filter(s => !isTab(s))
    const wrong = []
    for (const selector of selectors) {
      for (const outer of selectors) {
        if (outer === selector) continue
        const el = document.querySelector(selector)
        const holder = document.querySelector(outer)
        if (holder.contains(el) && STEPS.indexOf(FROM[selector]) < STEPS.indexOf(FROM[outer])) wrong.push(`${selector} in ${outer}`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('draws a group from the step of the earliest thing in it, so no step is left with an empty group', () => {
    const selectors = Object.keys(FROM).filter(s => !isTab(s))
    const wrong = []
    for (const group of document.querySelectorAll('.transport [role="group"][id], .transport details[id]')) {
      const own = selectors.find(sel => document.querySelector(sel) === group)
      const inside = selectors.filter(sel => { const el = document.querySelector(sel); return el !== group && group.contains(el) })
      expect(inside.length, `${group.id} holds nothing the list places`).toBeGreaterThan(0)
      const earliest = STEPS[Math.min(...inside.map(sel => STEPS.indexOf(FROM[sel])))]
      if (FROM[own] !== earliest) wrong.push(`${group.id} is ${FROM[own]}, its earliest control is ${earliest}`)
    }
    expect(wrong).toEqual([])
  })

  it('draws the Show control itself at every step, and the Undo, Save, Open and Keys controls with it', () => {
    for (const selector of ['#show-group', '#undo', '#redo', '#save', '#open', '#toggle-keys', '#play', '#stop']) {
      expect(FROM[selector], selector).toBe('simple')
    }
  })

  it('offers the three steps in the select, with the words the list uses, in order', () => {
    const options = [...document.querySelectorAll('#show-step option')]
    expect(options.map(o => o.getAttribute('value'))).toEqual(STEPS)
    expect(options.map(o => o.textContent)).toEqual(STEPS.map(s => STEP_LABELS[s]))
  })

  it('leaves out what a step does not reach with a rule that beats any display a class gives', () => {
    expect(html).toMatch(/html\[data-step="simple"\] \[data-from="standard"\]/)
    expect(html).toMatch(/html\[data-step="simple"\] \[data-from="advanced"\]/)
    expect(html).toMatch(/html\[data-step="standard"\] \[data-from="advanced"\]\s*\{\s*display:\s*none\s*!important/)
    // Advanced reaches everything, so it has no rule, and a rule for it would leave things out.
    expect(html).not.toMatch(/data-step="advanced"\]/)
  })

  it('puts every transport control in a named group, so a screen reader hears where it is', () => {
    const groups = [...document.querySelectorAll('.transport [role="group"]')]
    expect(groups.map(g => g.getAttribute('aria-label'))).toEqual(['Tempo and time', 'Input', 'Edit', 'File', 'More', 'Output', 'Sounds and help', 'Play'])
    const loose = [...document.querySelectorAll('.transport button, .transport select:not(#show-step), .transport input:not([type=file]):not(#show-step)')]
      .filter(el => !el.closest('[role="group"]'))
    expect(loose.map(el => el.id)).toEqual([])
  })

  it('keeps Panic, Stems and Install together in the More disclosure, which only Advanced draws', () => {
    const more = document.getElementById('transport-more')
    expect(more.tagName.toLowerCase()).toBe('details')
    expect(FROM['#transport-more']).toBe('advanced')
    for (const id of ['panic', 'export-stems', 'install']) expect(more.querySelector(`#${id}`), id).not.toBeNull()
    expect(more.querySelector('summary').textContent.trim()).toBe('More')
  })

  it('writes the words beside the icon on the five buttons that matter first, and on no others', () => {
    const wordy = [...document.querySelectorAll('.transport button[data-words]')].map(b => b.id)
    expect(wordy.sort()).toEqual(['open', 'play', 'record', 'save', 'stop'])
  })

  it('has a place to say where a tab is when the step does not draw it', () => {
    for (const id of ['show-note', 'show-note-text', 'show-note-raise']) expect(document.getElementById(id), id).not.toBeNull()
    expect(document.getElementById('show-note').hasAttribute('hidden')).toBe(true)
    expect(document.getElementById('show-note').getAttribute('role')).toBe('status')
  })

  it('asks the step before a tab is chosen from code, and says where it is when refused', () => {
    expect(app).toMatch(/allowed: id => ctx\.show\.allowsTab\(id\)/)
    expect(app).toMatch(/onRefused: id => ctx\.show\.refuseTab\(id\)/)
  })
})
