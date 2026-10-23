// src/ui/ChannelToggle.js
//
// Mute and Solo as small lettered squares: an M that goes red, an S that goes yellow. The words stay as the
// accessible name and the tooltip, so a screen reader still hears "Mute" and "pressed". On is not shown by colour
// alone: the square fills and the letter is underlined, where off is an outline with a plain letter, and
// aria-pressed says it to everything else (web/index.html styles `.strip-toggle`).
const KINDS = Object.freeze({
  muted: { letter: 'M', word: 'Mute' },
  soloed: { letter: 'S', word: 'Solo' }
})

/** `key` is 'muted' or 'soloed'; `name` is what the button says it acts on, as in "Mute Bass". */
export function createChannelToggle (document, { key, id, pressed = false, name = null }) {
  const kind = KINDS[key]
  if (!kind) throw new Error(`a channel toggle is for muted or soloed, not ${key}`)
  const button = document.createElement('button')
  button.type = 'button'
  button.className = `strip-toggle ${key}`
  button.id = id
  button.textContent = kind.letter
  const label = name ? `${kind.word} ${name}` : kind.word
  button.setAttribute('aria-label', label)
  button.title = label
  button.setAttribute('aria-pressed', String(pressed))
  return button
}
