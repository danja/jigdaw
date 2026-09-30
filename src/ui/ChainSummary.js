// src/ui/ChainSummary.js
//
// The dock's view of one track: its plugins in the order the signal goes
// through them, and where its clips play. A list, in words, and the way to the
// plugins' own panels. The routing itself is drawn elsewhere (Phase T3); this
// is what a person selecting a track is owed first, which is what is on it.

/**
 * `nodes` are the track's nodes already in signal order, `labelOf(node)` names
 * each one. `onShowPlugins()` leads to the Plugins tab for this track.
 */
export function createChainSummary (document, { onShowPlugins }) {
  if (typeof onShowPlugins !== 'function') throw new Error('createChainSummary needs onShowPlugins')
  const element = document.createElement('div')
  element.className = 'chain-summary'
  const intro = document.createElement('p')
  const list = document.createElement('ol')
  list.setAttribute('aria-label', 'Plugins in signal order')
  const show = document.createElement('button')
  show.type = 'button'
  show.textContent = 'Show plugins'
  show.addEventListener('click', () => onShowPlugins())
  element.append(intro, list, show)

  return {
    element,
    show ({ label, nodes, labelOf, midiInputLabel = null, audioInputLabel = null }) {
      if (nodes.length === 0) {
        intro.textContent = `${label} has no plugins. Its clips, if any, play straight to its fader.`
        list.replaceChildren()
        list.hidden = true
        show.hidden = true
        return
      }
      const many = nodes.length === 1 ? '1 plugin' : `${nodes.length} plugins`
      const inputs = [
        midiInputLabel ? `MIDI clips play into ${midiInputLabel}` : null,
        audioInputLabel ? `audio clips play into ${audioInputLabel}` : null
      ].filter(Boolean)
      intro.textContent = `${label}: ${many}${inputs.length ? `. ${inputs.join('; ')}` : ''}.`
      list.hidden = false
      show.hidden = false
      list.replaceChildren(...nodes.map(node => {
        const item = document.createElement('li')
        item.textContent = labelOf(node)
        return item
      }))
    }
  }
}
