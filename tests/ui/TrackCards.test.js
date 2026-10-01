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
  const cards = createTrackCards(document, {
    onSwitch: (id, on) => calls.push(['switch', id, on]),
    onLevel: (id, level) => calls.push(['level', id, level]),
    onOpen: id => calls.push(['open', id])
  })
  document.body.append(cards.element)
  const state = [
    { id: 't1', label: 'Lead', on: true, level: 1 },
    { id: 't2', label: 'Drums', on: false, level: 0.5 }
  ]
  cards.draw(state)
  return { cards, calls, state }
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

  it('takes you to the rack for a track from its Change the sound button, named for the track', () => {
    const { calls } = build()
    const buttons = [...document.querySelectorAll('.card-open')]
    expect(buttons.map(b => b.textContent)).toEqual(['Change the sound', 'Change the sound'])
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Change the sound of Lead', 'Change the sound of Drums'])
    buttons[1].dispatchEvent(event('click'))
    expect(calls).toEqual([['open', 't2']])
    expect(document.querySelector('details')).toBeNull()
  })

  it('keeps a card across a redraw, so what is being turned is not taken away, and forgets a track that has gone', () => {
    const { cards, state } = build()
    const before = document.getElementById('card-t1')
    const slider = document.getElementById('loud-t1')
    const open = document.getElementById('open-t1')
    cards.draw(state.map(c => ({ ...c, level: 1.5 })))
    expect(document.getElementById('card-t1')).toBe(before)
    expect(document.getElementById('loud-t1')).toBe(slider)
    expect(document.getElementById('open-t1')).toBe(open)
    expect(slider.value).toBe('1.5')
    cards.draw([state[0]])
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
    expect(() => createTrackCards(document, { onSwitch () {}, onLevel () {} })).toThrow(/onOpen/)
  })
})
