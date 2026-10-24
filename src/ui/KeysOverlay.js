// src/ui/KeysOverlay.js
//
// A dialog that lists the studio's keyboard shortcuts, read from KeyTable.js. Hidden until shown; showing it moves the
// focus to its Close button and hiding it puts the focus back where it was, so a keyboard user is never left on something
// that has gone. Tab stays on the one button the dialog holds, since nothing else in it can take focus.
import { KEY_ROWS, KEY_SCOPES } from './KeyTable.js'

export function createKeysOverlay (document, { rows = KEY_ROWS, scopes = KEY_SCOPES } = {}) {
  const element = document.createElement('div')
  element.id = 'keys'
  element.className = 'keys-overlay'
  element.hidden = true
  element.setAttribute('role', 'dialog')
  element.setAttribute('aria-modal', 'true')
  element.setAttribute('aria-labelledby', 'keys-heading')

  const heading = document.createElement('h2')
  heading.id = 'keys-heading'
  heading.textContent = 'Keyboard shortcuts'
  const note = document.createElement('p')
  note.className = 'note'
  note.textContent = 'Keys that act on one thing work only while that thing has the focus. Keys inside the piano roll and the timeline are not listed here yet. The Menu key, or Shift and F10, opens the context menu of whatever has the focus: a clip, a track name, a plugin in a chain.'
  const close = document.createElement('button')
  close.type = 'button'
  close.id = 'close-keys'
  close.textContent = 'Close'
  element.append(heading, note)

  for (const [scope, title] of Object.entries(scopes)) {
    const mine = rows.filter(row => row.scope === scope)
    if (mine.length === 0) continue
    const section = document.createElement('section')
    const h3 = document.createElement('h3')
    h3.textContent = title
    const list = document.createElement('dl')
    for (const row of mine) {
      const term = document.createElement('dt')
      const kbd = document.createElement('kbd')
      kbd.textContent = row.keys
      term.append(kbd)
      const detail = document.createElement('dd')
      detail.textContent = row.does
      list.append(term, detail)
    }
    section.append(h3, list)
    element.append(section)
  }
  element.append(close)

  let returnTo = null
  function show (open) {
    if (open) returnTo = document.activeElement
    element.hidden = !open
    if (open) close.focus({ preventScroll: true })
    else if (returnTo && typeof returnTo.focus === 'function') returnTo.focus()
  }
  close.addEventListener('click', () => show(false))
  element.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); show(false) }
    else if (event.key === 'Tab') event.preventDefault()
  })

  return { element, show, toggle: () => show(element.hidden), close }
}
