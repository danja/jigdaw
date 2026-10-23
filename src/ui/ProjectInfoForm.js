// src/ui/ProjectInfoForm.js
//
// Title, author and notes for the open session, as three labelled fields. A field is saved when it is left
// (the change event), one patch for that field, so typing is never an edit per key and a screen reader
// reading the form is not interrupted. `show(info)` fills the fields, for a session just opened.
import { INFO_LIMITS } from '../model/ProjectInfo.js'

const FIELDS = [
  { key: 'title', label: 'Title', tag: 'input' },
  { key: 'author', label: 'Author', tag: 'input' },
  { key: 'notes', label: 'Notes', tag: 'textarea' }
]

/**
 * @param onChange called with `{ [key]: text }` when a field is left with a new value; may throw or reject,
 *   in which case the field is put back to what `show` last set.
 */
export function createProjectInfoForm (document, { onChange, onError = () => {} }) {
  const element = document.createElement('form')
  element.className = 'project-info'
  element.addEventListener('submit', event => event.preventDefault())
  let shown = { title: null, author: null, notes: null }
  const inputs = {}

  for (const { key, label, tag } of FIELDS) {
    const wrap = document.createElement('label')
    wrap.className = 'project-info-field'
    const name = document.createElement('span')
    name.textContent = label
    const input = document.createElement(tag)
    input.id = `project-${key}`
    input.maxLength = INFO_LIMITS[key]
    if (tag === 'textarea') input.rows = 4
    input.addEventListener('change', async () => {
      try {
        await onChange({ [key]: input.value })
        shown = { ...shown, [key]: input.value.trim() === '' ? null : input.value.trim() }
      } catch (error) {
        input.value = shown[key] ?? ''
        onError(error)
      }
    })
    inputs[key] = input
    wrap.append(name, input)
    element.append(wrap)
  }

  function show (info) {
    shown = { title: info.title ?? null, author: info.author ?? null, notes: info.notes ?? null }
    for (const { key } of FIELDS) inputs[key].value = shown[key] ?? ''
  }
  show(shown)
  return { element, show, inputs }
}
