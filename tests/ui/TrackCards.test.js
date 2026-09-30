// tests/ui/TrackCards.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTrackCards } from '../../src/ui/TrackCards.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const event = type => new window.Event(type, { bubbles: true, cancelable: true })

function build () {
  const calls = []
  const panels = []
  const cards = createTrackCards(document, {
    onSwitch: (id, on) => calls.push(['switch', id, on]),
    onLevel: (id, level) => calls.push(['level', id, level]),
    panelFor: id => { panels.push(id); const p = document.createElement('div'); p.className = `panel-${id}`; return p }
  })
  document.body.append(cards.element)
  const state = [
    { id: 't1', label: 'Lead', on: true, level: 1, plugins: [{ id: 'a', label: 'Square lead', about: 'A bright lead sound.' }, { id: 'b', label: 'Echo', about: null }] },
    { id: 't2', label: 'Drums', on: false, level: 0.5, plugins: [{ id: 'c', label: 'Kit', about: null }] }
  ]
  cards.draw(state)
  return { cards, calls, panels, state }
}

const open = id => {
  const details = document.querySelector(`#card-${id} details`)
  details.open = true
  details.dispatchEvent(event('toggle'))
}

describe('the track cards', () => {
  it('draws one card per track, with its name and On or Off said in words and by state', () => {
    build()
    expect([...document.querySelectorAll('.card h3')].map(h => h.textContent)).toEqual(['Lead', 'Drums'])
    const [lead, drums] = [...document.querySelectorAll('.switch')]
    expect([lead.textContent, lead.getAttribute('aria-pressed')]).toEqual(['On', 'true'])
    expect([drums.textContent, drums.getAttribute('aria-pressed')]).toEqual(['Off', 'false'])
    expect(lead.getAttribute('aria-label')).toBe('Lead: on. Press to turn it off')
    expect(document.getElementById('card-t2').classList.contains('off')).toBe(true)
  })

  it('turns a track on or off from its button, asking for the opposite of what it is', () => {
    const { calls } = build()
    document.getElementById('switch-t1').dispatchEvent(event('click'))
    document.getElementById('switch-t2').dispatchEvent(event('click'))
    expect(calls).toEqual([['switch', 't1', false], ['switch', 't2', true]])
  })

  it('reports loudness once per movement, and says it in decibels', () => {
    const { calls } = build()
    const slider = document.getElementById('loud-t1')
    slider.value = '0.5'
    slider.dispatchEvent(event('input'))
    expect(calls).toEqual([['level', 't1', 0.5]])
    expect(slider.getAttribute('aria-valuetext')).toBe('-6.0 decibels')
    expect(slider.getAttribute('aria-label')).toBe('Loudness of Lead')
  })

  it('makes no panel until a card is opened, and then one for each plugin on it', () => {
    const { panels } = build()
    expect(panels).toEqual([])
    open('t1')
    expect(panels).toEqual(['a', 'b'])
    expect([...document.querySelectorAll('#card-t1 h4')].map(h => h.textContent)).toEqual(['Square lead', 'Echo'])
    expect(document.querySelector('#card-t1 .about').textContent).toBe('A bright lead sound.')
    expect(document.querySelectorAll('#card-t1 .about')).toHaveLength(1)
    expect(document.querySelector('.panel-a')).not.toBeNull()
  })

  it('keeps a card, and its open panels, across a redraw, so what is being turned is not taken away', () => {
    const { cards, state, panels } = build()
    open('t1')
    const before = document.getElementById('card-t1')
    const slider = document.getElementById('loud-t1')
    cards.draw(state.map(c => ({ ...c, level: 1.5 })))
    expect(document.getElementById('card-t1')).toBe(before)
    expect(document.getElementById('loud-t1')).toBe(slider)
    expect(slider.value).toBe('1.5')
    expect(panels).toEqual(['a', 'b'])
  })

  it('builds the panels again when the plugins on an open card change, and forgets a track that has gone', () => {
    const { cards, state, panels } = build()
    open('t1')
    cards.draw([{ ...state[0], plugins: [{ id: 'z', label: 'New', about: null }] }])
    expect(panels).toEqual(['a', 'b', 'z'])
    expect(document.getElementById('card-t2')).toBeNull()
    expect(document.querySelectorAll('.card')).toHaveLength(1)
  })

  it('does not touch the page when a redraw changes no track\'s place, so the focus stays on a knob being turned', () => {
    const { cards, state } = build()
    let touched = 0
    for (const method of ['append', 'replaceChildren', 'prepend', 'insertBefore', 'appendChild']) {
      const original = cards.element[method]?.bind(cards.element)
      if (original) cards.element[method] = (...a) => { touched++; return original(...a) }
    }
    cards.draw(state.map(c => ({ ...c, level: 1.25 })))
    expect(touched).toBe(0)
    // And it does when the order really changes.
    cards.draw([state[1], state[0]])
    expect(touched).toBeGreaterThan(0)
    expect([...document.querySelectorAll('.card h3')].map(h => h.textContent)).toEqual(['Drums', 'Lead'])
  })

  it('will not be built without its handlers', () => {
    expect(() => createTrackCards(document, { onSwitch () {}, onLevel () {} })).toThrow(/panelFor/)
  })
})
