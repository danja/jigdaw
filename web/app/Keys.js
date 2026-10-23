// web/app/Keys.js
//
// The list of keyboard shortcuts: a button in the transport bar and F1 open it, Escape and its Close button shut it.
// F1 is not a character key, so WCAG 2.1.4 (character key shortcuts) does not apply to it.
import { createKeysOverlay } from '../../src/ui/KeysOverlay.js'

export function createKeys (ctx) {
  const { document, $ } = ctx
  const overlay = createKeysOverlay(document)

  function mount () {
    document.body.append(overlay.element)
    const button = $('toggle-keys')
    button.addEventListener('click', () => overlay.toggle())
    document.addEventListener('keydown', event => {
      if (event.key !== 'F1' || event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      overlay.toggle()
    })
  }

  return { mount, overlay }
}
