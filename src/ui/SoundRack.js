// src/ui/SoundRack.js
//
// The simple page's plugin rack for one track: "Change the sound" takes you here, to a screen of its own with
// the plugins on that track as their generated panels, and a Back button to the instruments. It replaces the
// instruments while it is open, so on a phone there is one thing on screen at a time and the music's own
// controls (Play, Stop, Speed) stay where they were above it.
//
// Updated in place, like the cards: the panels are kept and only made again when the plugins on the track
// change, so a knob being turned is not taken out of the page by the redraw an edit causes.
export function createSoundRack (document, { onBack, panelFor }) {
  for (const [name, fn] of Object.entries({ onBack, panelFor })) {
    if (typeof fn !== 'function') throw new Error(`createSoundRack needs ${name}`)
  }
  const element = document.createElement('section')
  element.id = 'rack'
  element.hidden = true
  element.setAttribute('aria-labelledby', 'rack-title')

  const back = document.createElement('button')
  back.type = 'button'
  back.id = 'rack-back'
  back.textContent = 'Back to the instruments'
  back.addEventListener('click', () => onBack())

  const title = document.createElement('h2')
  title.id = 'rack-title'
  // Focusable by script so the screen reader lands on what the screen is when it opens.
  title.tabIndex = -1

  const plugins = document.createElement('div')
  plugins.className = 'plugins'
  element.append(back, title, plugins)

  let built = null

  return {
    element,
    /** Show the rack for a track. `plugins`: `[{ id, label, about }]` in signal order. */
    show ({ label, plugins: list }) {
      title.textContent = `${label}: change the sound`
      this.update(list)
      element.hidden = false
    },
    /** The plugins on the track have changed, or may have: the panels are made again only if they did. */
    update (list) {
      const key = list.map(p => p.id).join('|')
      if (built === key) return
      built = key
      plugins.replaceChildren(...list.map(plugin => {
        const section = document.createElement('section')
        section.className = 'plugin'
        const h = document.createElement('h3')
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
    },
    hide () { element.hidden = true; built = null; plugins.replaceChildren() },
    get open () { return !element.hidden },
    /** Put the focus on the screen's title, where a screen reader should begin. */
    focus () { title.focus({ preventScroll: false }) }
  }
}
