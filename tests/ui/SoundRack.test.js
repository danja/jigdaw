// tests/ui/SoundRack.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createSoundRack } from '../../src/ui/SoundRack.js'

let document, window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

function build () {
  const calls = []
  const made = []
  const rack = createSoundRack(document, {
    onBack: () => calls.push('back'),
    panelFor: id => { made.push(id); const p = document.createElement('div'); p.className = `panel-${id}`; return p }
  })
  document.body.append(rack.element)
  return { rack, calls, made }
}
const plugins = [{ id: 'a', label: 'Square lead', about: 'A bright lead sound.' }, { id: 'b', label: 'Echo', about: null }]

describe('the sound rack', () => {
  it('is hidden until shown, then names the track, offers Back first, and has a panel for each plugin in order', () => {
    const { rack, made } = build()
    expect(rack.open).toBe(false)
    rack.show({ label: 'Lead', plugins })
    expect(rack.open).toBe(true)
    expect(document.getElementById('rack-title').textContent).toBe('Lead: change the sound')
    expect(document.getElementById('rack').getAttribute('aria-labelledby')).toBe('rack-title')
    expect(document.getElementById('rack').firstElementChild.id).toBe('rack-back')
    expect([...document.querySelectorAll('#rack h3')].map(h => h.textContent)).toEqual(['Square lead', 'Echo'])
    expect(document.querySelectorAll('#rack .about')).toHaveLength(1)
    expect(made).toEqual(['a', 'b'])
  })

  it('goes back from its Back button', () => {
    const { rack, calls } = build()
    rack.show({ label: 'Lead', plugins })
    document.getElementById('rack-back').dispatchEvent(new window.Event('click'))
    expect(calls).toEqual(['back'])
  })

  it('keeps its panels across an update that changes nothing, and makes them again when the plugins change', () => {
    const { rack, made } = build()
    rack.show({ label: 'Lead', plugins })
    const panel = document.querySelector('.panel-a')
    rack.update(plugins.map(p => ({ ...p })))
    expect(document.querySelector('.panel-a')).toBe(panel)
    expect(made).toEqual(['a', 'b'])
    rack.update([{ id: 'z', label: 'New', about: null }])
    expect(made).toEqual(['a', 'b', 'z'])
    expect(document.querySelectorAll('#rack .plugin')).toHaveLength(1)
  })

  it('empties and hides on hide, so a later show builds fresh', () => {
    const { rack, made } = build()
    rack.show({ label: 'Lead', plugins })
    rack.hide()
    expect(rack.open).toBe(false)
    expect(document.querySelectorAll('#rack .plugin')).toHaveLength(0)
    rack.show({ label: 'Lead', plugins })
    expect(made).toEqual(['a', 'b', 'a', 'b'])
  })

  it('can take the focus onto its title, which a script may focus and a person may not tab to', () => {
    const { rack } = build()
    rack.show({ label: 'Lead', plugins })
    expect(document.getElementById('rack-title').tabIndex).toBe(-1)
    expect(() => rack.focus()).not.toThrow()
  })

  it('will not be built without its handlers', () => {
    expect(() => createSoundRack(document, { onBack () {} })).toThrow(/panelFor/)
    expect(() => createSoundRack(document, { panelFor () {} })).toThrow(/onBack/)
  })
})
