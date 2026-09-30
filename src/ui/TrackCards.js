// src/ui/TrackCards.js
//
// The simple page's view of a piece: one card per track, each with a big On and
// Off, and "Change the sound" that opens the plugins on it as their generated
// panels. Plain words, large targets, and everything else one step away.
//
// A card is kept and updated in place, like a track header: a panel being
// turned or a slider being dragged must not be taken out of the page by the
// redraw every edit causes. Panels are made only when a card is first opened,
// since a piece may hold a dozen plugins and most are never touched.
import { decibels } from './Strip.js'

export function createTrackCards (document, { onSwitch, onLevel, panelFor }) {
  for (const [name, fn] of Object.entries({ onSwitch, onLevel, panelFor })) {
    if (typeof fn !== 'function') throw new Error(`createTrackCards needs ${name}`)
  }
  const element = document.createElement('ul')
  element.className = 'cards'
  const kept = new Map()

  function make (card) {
    const li = document.createElement('li')
    li.className = 'card'
    li.id = `card-${card.id}`

    const head = document.createElement('div')
    head.className = 'card-head'
    const title = document.createElement('h3')
    const power = document.createElement('button')
    power.type = 'button'
    power.className = 'switch'
    power.id = `switch-${card.id}`
    power.addEventListener('click', () => onSwitch(card.id, power.getAttribute('aria-pressed') !== 'true'))
    head.append(title, power)

    const details = document.createElement('details')
    const summary = document.createElement('summary')
    summary.textContent = 'Change the sound'
    const body = document.createElement('div')
    body.className = 'card-body'
    const loud = document.createElement('label')
    loud.className = 'loud'
    const loudText = document.createElement('span')
    const slider = document.createElement('input')
    slider.type = 'range'
    slider.min = '0'
    slider.max = '2'
    slider.step = '0.01'
    slider.id = `loud-${card.id}`
    const loudValue = document.createElement('span')
    loudValue.className = 'value'
    loud.append(loudText, slider, loudValue)
    const plugins = document.createElement('div')
    plugins.className = 'plugins'
    body.append(loud, plugins)
    details.append(summary, body)
    li.append(head, details)

    const entry = { li, title, power, details, slider, loudText, loudValue, plugins, built: null }
    slider.addEventListener('input', () => { showLevel(entry, Number(slider.value)); onLevel(card.id, Number(slider.value)) })
    // The panels are made the first time the card is opened, and again if its plugins change.
    details.addEventListener('toggle', () => { if (details.open) build(entry, card.id) })
    return entry
  }

  const showLevel = (entry, n) => {
    entry.loudValue.textContent = `${decibels(n)} dB`
    entry.slider.setAttribute('aria-valuetext', `${decibels(n)} decibels`)
  }

  function build (entry, id) {
    const current = entry.pluginList
    const key = current.map(p => p.id).join('|')
    if (entry.built === key) return
    entry.built = key
    entry.plugins.replaceChildren(...current.map(plugin => {
      const section = document.createElement('section')
      section.className = 'plugin'
      const h = document.createElement('h4')
      h.textContent = plugin.label
      section.append(h)
      if (plugin.about) {
        const p = document.createElement('p')
        p.className = 'about'
        p.textContent = plugin.about
        section.append(p)
      }
      const panel = panelFor(plugin.id)
      if (panel) section.append(panel)
      return section
    }))
  }

  return {
    element,
    /** `cards`: `{ id, label, on, level, plugins: [{ id, label, about }] }` in the order to show. */
    draw (cards) {
      for (const id of [...kept.keys()]) {
        if (!cards.some(c => c.id === id)) { kept.get(id).li.remove(); kept.delete(id) }
      }
      for (const card of cards) {
        let entry = kept.get(card.id)
        if (!entry) { entry = make(card); kept.set(card.id, entry) }
        entry.title.textContent = card.label
        entry.power.textContent = card.on ? 'On' : 'Off'
        entry.power.setAttribute('aria-pressed', String(card.on))
        entry.power.setAttribute('aria-label', `${card.label}: ${card.on ? 'on. Press to turn it off' : 'off. Press to turn it on'}`)
        entry.loudText.textContent = 'Loudness '
        entry.slider.setAttribute('aria-label', `Loudness of ${card.label}`)
        if (document.activeElement !== entry.slider) entry.slider.value = String(card.level)
        showLevel(entry, card.level)
        entry.li.classList.toggle('off', !card.on)
        entry.pluginList = card.plugins
        if (entry.details.open) build(entry, card.id)
      }
      // Only when the order differs. Putting an element back where it already is still
      // takes it out of the page for a moment, which drops the focus from a knob being
      // turned: one nudge with an arrow key and then nothing (CLAUDE.md, the focus rule).
      const wanted = cards.map(c => kept.get(c.id).li)
      const current = [...element.children]
      if (current.length !== wanted.length || current.some((li, i) => li !== wanted[i])) element.replaceChildren(...wanted)
    }
  }
}
