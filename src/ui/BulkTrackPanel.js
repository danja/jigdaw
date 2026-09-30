// src/ui/BulkTrackPanel.js
//
// What can be done to several selected tracks at once: mute, solo, colour and
// lane size. Naming, moving and deleting are one track at a time, so they are
// not offered here (a control that cannot act is left out). The caller turns
// each request into one changeset, so one undo takes back the whole edit.
import { COLORS, colorName } from './TrackPanel.js'

/** 'all', 'none' or 'some': how many of the selected tracks have a flag set. */
export function tally (tracks, key) {
  const on = tracks.filter(t => t.channel[key]).length
  return on === 0 ? 'none' : on === tracks.length ? 'all' : 'some'
}

export function createBulkTrackPanel (document, { onChannel, onColor, onSize }) {
  for (const [name, fn] of Object.entries({ onChannel, onColor, onSize })) {
    if (typeof fn !== 'function') throw new Error(`createBulkTrackPanel needs ${name}`)
  }
  const element = document.createElement('div')
  element.className = 'bulk-panel'
  const summary = document.createElement('p')
  summary.className = 'bulk-summary'
  summary.setAttribute('role', 'status')

  const toggle = (id, key) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = id
    // What pressing does is decided from the state the panel was last shown with.
    button.addEventListener('click', () => onChannel({ [key]: button.dataset.next === 'true' }))
    return button
  }
  const mute = toggle('bulk-mute', 'muted')
  const solo = toggle('bulk-solo', 'soloed')

  const colors = document.createElement('div')
  colors.className = 'track-colors'
  colors.setAttribute('role', 'group')
  colors.setAttribute('aria-label', 'Colour for all selected tracks')
  for (const color of [{ name: 'None', value: null }, ...COLORS]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'swatch'
    button.setAttribute('aria-label', `${color.name} for all selected tracks`)
    if (color.value) button.style.background = color.value
    else button.textContent = '×'
    button.addEventListener('click', () => onColor(color.value))
    colors.append(button)
  }

  const sizeLabel = document.createElement('label')
  sizeLabel.className = 'track-field'
  sizeLabel.append(document.createTextNode('Lane size for all '))
  const size = document.createElement('select')
  size.id = 'bulk-size'
  const keep = document.createElement('option')
  keep.value = ''
  keep.textContent = 'Leave as they are'
  size.append(keep)
  for (const [value, text] of [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    size.append(option)
  }
  size.addEventListener('change', () => { if (size.value) onSize(size.value) })
  sizeLabel.append(size)

  const actions = document.createElement('div')
  actions.className = 'track-actions'
  actions.append(mute, solo)
  element.append(summary, actions, colors, sizeLabel)

  return {
    element,
    /** `tracks` are the selected ones, each with its `channel`; `labels` names them for the summary. */
    show ({ tracks, labels }) {
      summary.textContent = `${tracks.length} tracks selected: ${labels.join(', ')}.`
      for (const [button, key, word] of [[mute, 'muted', 'Mute'], [solo, 'soloed', 'Solo']]) {
        const state = tally(tracks, key)
        // Everything already on: the button turns it off. Anything else: on.
        const turnOn = state !== 'all'
        button.dataset.next = String(turnOn)
        button.textContent = turnOn ? `${word} all` : `${word} off for all`
        button.setAttribute('aria-pressed', String(state === 'all'))
      }
      size.options[0].selected = true
    }
  }
}

export { colorName }
