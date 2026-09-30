// src/ui/TunePicker.js
//
// Pieces to start from, as big buttons. Choosing one replaces what is playing,
// which the button says beforehand only by being the way to a new piece; the
// page never opens one on its own (WCAG 3.2.2), and the one that is open says so
// by aria-pressed as well as by its look.
export function createTunePicker (document, { onPick }) {
  if (typeof onPick !== 'function') throw new Error('createTunePicker needs onPick')
  const element = document.createElement('ul')
  element.className = 'tunes'
  return {
    element,
    /** `tunes`: `{ label, url }` in the order to show; `current` the url open now, or null. */
    draw (tunes, { current = null } = {}) {
      element.replaceChildren(...tunes.map(tune => {
        const li = document.createElement('li')
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'tune'
        button.textContent = tune.label
        button.setAttribute('aria-pressed', String(tune.url === current))
        button.addEventListener('click', () => onPick(tune))
        li.append(button)
        return li
      }))
    }
  }
}
