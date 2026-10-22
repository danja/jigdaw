// src/ui/BulkTrackPanel.js
//
// What can be done to several selected tracks at once: mute, solo, colour and
// lane size and folder. Naming, moving and deleting are one track at a time, so they are
// not offered here (a control that cannot act is left out). The caller turns
// each request into one changeset, so one undo takes back the whole edit.
import { COLORS, colorName } from './TrackPanel.js'
import { MAX_FOLDER_NAME } from '../model/EditorState.js'

/** 'all', 'none' or 'some': how many of the selected tracks have a flag set. */
export function tally (tracks, key) {
  const on = tracks.filter(t => t.channel[key]).length
  return on === 0 ? 'none' : on === tracks.length ? 'all' : 'some'
}

export function createBulkTrackPanel (document, { onChannel, onColor, onSize, onFolder, onBus, onLevelShift, onPanShift }) {
  for (const [name, fn] of Object.entries({ onChannel, onColor, onSize, onFolder, onBus, onLevelShift, onPanShift })) {
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
  for (const [value, text] of [['collapsed', 'Collapsed'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']]) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    size.append(option)
  }
  size.addEventListener('change', () => { if (size.value) onSize(size.value) })
  sizeLabel.append(size)

  // Folder: one name for all of them. Empty does nothing here; taking them out is its own button,
  // left out while none of them is in a folder.
  const folderLabel = document.createElement('label')
  folderLabel.className = 'track-field'
  folderLabel.append(document.createTextNode('Folder for all '))
  const folder = document.createElement('input')
  folder.type = 'text'
  folder.id = 'bulk-folder'
  folder.autocomplete = 'off'
  folder.spellcheck = false
  folder.maxLength = MAX_FOLDER_NAME
  folder.setAttribute('list', 'bulk-folder-names')
  const folderNames = document.createElement('datalist')
  folderNames.id = 'bulk-folder-names'
  const commitFolder = () => {
    const name = folder.value.trim()
    folder.value = ''
    if (name !== '') onFolder(name)
  }
  folder.addEventListener('change', commitFolder)
  folder.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commitFolder() } })
  folderLabel.append(folder, folderNames)
  const unfolder = document.createElement('button')
  unfolder.type = 'button'
  unfolder.id = 'bulk-unfolder'
  unfolder.textContent = 'Take out of their folder'
  unfolder.addEventListener('click', () => onFolder(null))

  // A bus takes the selected tracks' output instead of the master.
  const bus = document.createElement('button')
  bus.type = 'button'
  bus.id = 'bulk-bus'
  bus.textContent = 'Send to a new bus'
  bus.addEventListener('click', () => onBus())

  // Relative moves keep the tracks' balance (src/model/GroupChannel.js).
  const shifts = document.createElement('div')
  shifts.className = 'track-actions'
  shifts.setAttribute('role', 'group')
  shifts.setAttribute('aria-label', 'Move all selected tracks together')
  for (const [id, text, call] of [
    ['bulk-quieter', 'Level down 1 dB', () => onLevelShift(-1)],
    ['bulk-louder', 'Level up 1 dB', () => onLevelShift(1)],
    ['bulk-pan-left', 'Pan left 0.1', () => onPanShift(-0.1)],
    ['bulk-pan-right', 'Pan right 0.1', () => onPanShift(0.1)]
  ]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = id
    button.textContent = text
    button.addEventListener('click', call)
    shifts.append(button)
  }

  const actions = document.createElement('div')
  actions.className = 'track-actions'
  actions.append(mute, solo, bus)
  element.append(summary, actions, shifts, colors, sizeLabel, folderLabel, unfolder)

  return {
    element,
    /** `tracks` are the selected ones, each with its `channel`; `labels` names them for the summary,
     * `folders` are the names in use and `inFolder` how many of the selected are in one. */
    show ({ tracks, labels, folders = [], inFolder = 0 }) {
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
      folderNames.replaceChildren(...folders.map(text => { const option = document.createElement('option'); option.value = text; return option }))
      unfolder.hidden = inFolder === 0
    }
  }
}

export { colorName }
