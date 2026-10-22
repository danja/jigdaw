// src/ui/RollScale.js
//
// The Key and Scale choices above the note roll. With a scale chosen the roll marks the rows outside it and snaps drawn
// and dragged notes to the nearest pitch inside it. None, the first choice, is no scale at all. The choice belongs to the
// view, not the session: it changes nothing that is heard and is not saved.
import { SCALE_NAMES } from '../model/Scale.js'

const KEYS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
const words = name => name.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase())

export function createRollScale (document, { onChange }) {
  const element = document.createElement('div')
  element.className = 'piano-roll-scale'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Scale for the notes')
  const make = (id, label, entries) => {
    const wrap = document.createElement('label')
    wrap.append(document.createTextNode(`${label} `))
    const select = document.createElement('select')
    select.id = id
    entries.forEach(([value, text], i) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = text
      option.selected = i === 0
      select.append(option)
    })
    select.addEventListener('change', () => onChange())
    wrap.append(select)
    element.append(wrap)
    return select
  }
  const scale = make('roll-scale', 'Scale', [['', 'None'], ...SCALE_NAMES.map(name => [name, words(name)])])
  const key = make('roll-scale-key', 'Key', KEYS.map((text, i) => [String(i), text]))
  // The key means nothing without a scale, so it is left out until one is chosen.
  const sync = () => { key.parentNode.hidden = scale.value === '' }
  scale.addEventListener('change', sync)
  sync()
  return {
    element,
    /** The chosen scale as `{ root, scale }`, or null for none. */
    get current () { return scale.value === '' ? null : { root: Number(key.value), scale: scale.value } }
  }
}
