// src/ui/ClipActions.js
//
// The clip actions as buttons, for a person with no keyboard: the same requests
// the keys make (split, duplicate, mute, trim, copy, paste, delete), acting on
// the selected clips. Drawn only while a clip is selected, and each button only
// where it can do something: Split and the trims need exactly one clip, Paste
// needs something copied. A control nobody can use is left out, not disabled.
//
// `onAction(name)` gets 'split', 'duplicate', 'mute', 'lock', 'trimStart', 'trimEnd',
// 'copy', 'cut', 'paste' or 'remove'. The page decides what each does to the selection.

const BUTTONS = [
  { name: 'split', icon: 'split', label: 'Split at playhead', one: true },
  { name: 'trimStart', icon: 'trimStart', label: 'Trim start to playhead', one: true },
  { name: 'trimEnd', icon: 'trimEnd', label: 'Trim end to playhead', one: true },
  { name: 'duplicate', icon: 'duplicate', label: 'Duplicate' },
  { name: 'mute', icon: 'mute', label: 'Mute' },
  { name: 'lock', icon: 'lock', label: 'Lock' },
  { name: 'copy', icon: 'copy', label: 'Copy' },
  { name: 'cut', icon: 'cut', label: 'Cut' },
  { name: 'paste', icon: 'paste', label: 'Paste', needsClipboard: true },
  { name: 'remove', icon: 'delete', label: 'Delete' }
]

import { COLORS } from './TrackPanel.js'
import { setIcon } from './Icons.js'

export function createClipActions (document, { onAction, onColor }) {
  if (typeof onAction !== 'function') throw new Error('createClipActions needs onAction')
  if (typeof onColor !== 'function') throw new Error('createClipActions needs onColor')
  const element = document.createElement('div')
  element.className = 'clip-actions'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Selected clips')
  element.hidden = true
  const buttons = new Map()
  for (const spec of BUTTONS) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.action = spec.name
    setIcon(document, button, spec.icon, spec.label)
    button.addEventListener('click', () => onAction(spec.name))
    buttons.set(spec.name, { spec, button })
  }

  // Colour: a group of buttons, each named in words and each showing its colour, so it is not colour alone.
  const colors = document.createElement('div')
  colors.className = 'clip-colors'
  colors.setAttribute('role', 'group')
  colors.setAttribute('aria-label', 'Colour for the selected clips')
  for (const color of [{ name: 'No colour', value: null }, ...COLORS]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.color = color.value ?? ''
    button.setAttribute('aria-label', `${color.name} for the selected clips`)
    button.title = color.name
    if (color.value) button.style.background = color.value
    button.textContent = color.value ? '' : '\u00D7'
    button.addEventListener('click', () => onColor(color.value))
    colors.append(button)
  }

  /**
   * `count` clips are selected, `allMuted` is true when every one is muted (so the button
   * says what it will do), `canPaste` when something has been copied. Buttons are kept
   * and only added or removed where the set changes, so a focused button stays focused.
   */
  function draw ({ count, allMuted = false, allLocked = false, canPaste = false }) {
    element.hidden = count === 0
    setIcon(document, buttons.get('mute').button, allMuted ? 'unmute' : 'mute', allMuted ? 'Unmute' : 'Mute')
    setIcon(document, buttons.get('lock').button, allLocked ? 'unlock' : 'lock', allLocked ? 'Unlock' : 'Lock')
    const wanted = BUTTONS
      .filter(({ one, needsClipboard }) => count > 0 && (!one || count === 1) && (!needsClipboard || canPaste))
      .map(({ name }) => buttons.get(name).button)
    const same = wanted.length + (count > 0 ? 1 : 0) === element.children.length && wanted.every((b, i) => element.children[i] === b)
    if (!same) element.replaceChildren(...wanted, ...(count > 0 ? [colors] : []))
  }

  return { element, draw }
}
