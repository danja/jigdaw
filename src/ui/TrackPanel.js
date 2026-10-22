// src/ui/TrackPanel.js
//
// What a person can do to one track: name it, colour it, size its lane, move it
// up or down, delete it. It lives in the dock beside the track's chain, so the
// header stays free for the controls used during playing.
//
// Colour is always a second cue. A track's name is shown wherever its colour
// is, and the panel says the colour's name in words.
//
// A control that cannot act is left out, not disabled: the first track has no
// Move up and the last no Move down.

import { MAX_FOLDER_NAME } from '../model/EditorState.js'

export const COLORS = Object.freeze([
  { name: 'Red', value: '#e5484d' },
  { name: 'Orange', value: '#f5a524' },
  { name: 'Yellow', value: '#e2c541' },
  { name: 'Green', value: '#46a758' },
  { name: 'Teal', value: '#12a594' },
  { name: 'Blue', value: '#3e8ef7' },
  { name: 'Purple', value: '#8e4ec6' },
  { name: 'Pink', value: '#e93d82' }
])

const SIZES = Object.freeze([['collapsed', 'Collapsed'], ['small', 'Small'], ['medium', 'Medium'], ['large', 'Large']])

export function colorName (value) {
  return COLORS.find(c => c.value === value)?.name ?? (value ? value : 'None')
}

export function createTrackPanel (document, { onRename, onColor, onSize, onFolder, onMove, onDelete, onFreeze, onGroupLevel = null }) {
  for (const [name, fn] of Object.entries({ onRename, onColor, onSize, onFolder, onMove, onDelete, onFreeze })) {
    if (typeof fn !== 'function') throw new Error(`createTrackPanel needs ${name}`)
  }
  const element = document.createElement('div')
  element.className = 'track-panel'
  let trackId = null

  // Name
  const nameLabel = document.createElement('label')
  nameLabel.className = 'track-field'
  nameLabel.append(document.createTextNode('Name '))
  const name = document.createElement('input')
  name.type = 'text'
  name.id = 'track-name-input'
  name.autocomplete = 'off'
  name.spellcheck = false
  const commit = () => onRename(trackId, name.value.trim() === '' ? null : name.value.trim())
  name.addEventListener('change', commit)
  name.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commit() } })
  nameLabel.append(name)

  // Folder: a name, shared by the tracks that belong together. Empty takes the track out of its folder.
  const folderLabel = document.createElement('label')
  folderLabel.className = 'track-field'
  folderLabel.append(document.createTextNode('Folder '))
  const folder = document.createElement('input')
  folder.type = 'text'
  folder.id = 'track-folder-input'
  folder.autocomplete = 'off'
  folder.spellcheck = false
  folder.maxLength = MAX_FOLDER_NAME
  folder.setAttribute('list', 'track-folder-names')
  const folderNames = document.createElement('datalist')
  folderNames.id = 'track-folder-names'
  const commitFolder = () => onFolder(trackId, folder.value.trim() === '' ? null : folder.value.trim())
  folder.addEventListener('change', commitFolder)
  folder.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commitFolder() } })
  folderLabel.append(folder, folderNames)

  // Colour
  const colorGroup = document.createElement('div')
  colorGroup.className = 'track-colors'
  colorGroup.setAttribute('role', 'group')
  colorGroup.setAttribute('aria-label', 'Colour')
  const colorSaid = document.createElement('span')
  colorSaid.className = 'track-color-said'
  const swatches = [{ name: 'None', value: null }, ...COLORS].map(color => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'swatch'
    button.dataset.color = color.value ?? ''
    button.setAttribute('aria-label', color.name)
    button.setAttribute('aria-pressed', 'false')
    if (color.value) button.style.background = color.value
    else button.textContent = '×'
    button.addEventListener('click', () => onColor(trackId, color.value))
    colorGroup.append(button)
    return button
  })
  colorGroup.append(colorSaid)

  // Lane size
  const sizeLabel = document.createElement('label')
  sizeLabel.className = 'track-field'
  sizeLabel.append(document.createTextNode('Lane size '))
  const size = document.createElement('select')
  size.id = 'track-size-input'
  for (const [value, text] of SIZES) {
    const option = document.createElement('option')
    option.value = value
    option.textContent = text
    size.append(option)
  }
  size.addEventListener('change', () => onSize(trackId, size.value))
  sizeLabel.append(size)

  // Order and delete
  const up = document.createElement('button')
  up.type = 'button'
  up.id = 'track-move-up'
  up.textContent = 'Move up'
  up.addEventListener('click', () => onMove(trackId, -1))
  const down = document.createElement('button')
  down.type = 'button'
  down.id = 'track-move-down'
  down.textContent = 'Move down'
  down.addEventListener('click', () => onMove(trackId, 1))
  const position = document.createElement('span')
  position.className = 'track-position'
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.id = 'track-delete'
  remove.className = 'danger'
  remove.addEventListener('click', () => onDelete(trackId))

  // Render the track as heard to an audio clip on a new track, and mute this one (web/app/Bounce.js).
  const freeze = document.createElement('button')
  freeze.type = 'button'
  freeze.id = 'track-freeze'
  freeze.textContent = 'Freeze track'
  freeze.title = 'Render this track as heard to an audio clip on a new track, and mute this one'
  freeze.addEventListener('click', () => onFreeze(trackId))

  // A bus or folder's own level for its members: each moves by the same decibels (src/model/GroupChannel.js).
  // Left out unless the track has members, and unless the host can act on it.
  const group = document.createElement('div')
  group.className = 'track-actions'
  group.setAttribute('role', 'group')
  group.id = 'track-group-level'
  const groupStep = (id, text, decibels) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = id
    button.textContent = text
    button.addEventListener('click', () => onGroupLevel(trackId, decibels))
    return button
  }
  if (onGroupLevel) group.append(groupStep('track-group-down', 'Members down 1 dB', -1), groupStep('track-group-up', 'Members up 1 dB', 1))
  group.hidden = true

  const actions = document.createElement('div')
  actions.className = 'track-actions'
  actions.append(position, up, down, freeze, remove)
  element.append(nameLabel, folderLabel, colorGroup, sizeLabel, group, actions)

  return {
    element,
    get trackId () { return trackId },
    /**
     * `defaultName` is what the track is called with no name of its own,
     * `plugins` how many a delete would take with it, `index` and `count` where
     * it stands in the arrangement.
     */
    show ({ id, name: current, defaultName, layout, index, count, plugins, folders = [], members = 0 }) {
      trackId = id
      // A name being typed is not overwritten by a redraw.
      if (document.activeElement !== name) name.value = current ?? ''
      name.placeholder = defaultName
      if (document.activeElement !== folder) folder.value = layout.folder ?? ''
      folderNames.replaceChildren(...folders.map(text => { const option = document.createElement('option'); option.value = text; return option }))
      colorSaid.textContent = ` ${colorName(layout.color)}`
      for (const button of swatches) button.setAttribute('aria-pressed', String((button.dataset.color || null) === layout.color))
      for (const option of size.options) option.selected = option.value === layout.laneSize
      group.hidden = !onGroupLevel || members === 0
      group.setAttribute('aria-label', `Move the ${members} tracks in this bus or folder together`)
      position.textContent = `Track ${index + 1} of ${count}.`
      up.hidden = index === 0
      down.hidden = index === count - 1
      remove.textContent = plugins > 0 ? `Delete track and ${plugins === 1 ? '1 plugin' : `${plugins} plugins`}` : 'Delete track'
      remove.setAttribute('aria-label', `${remove.textContent}: ${defaultName}. Undo brings it back.`)
    }
  }
}
