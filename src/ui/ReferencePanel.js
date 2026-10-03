// src/ui/ReferencePanel.js
//
// The language reference as page content, drawn from src/reel/Reference.js. Each statement has a button that
// puts its example into the script, since a worked line is the quickest way to learn one.
import { STATEMENTS, UNITS_REFERENCE, FUNCTIONS_REFERENCE, NOTES } from '../reel/Reference.js'

export function createReferencePanel (document, { onInsert }) {
  if (typeof onInsert !== 'function') throw new Error('createReferencePanel needs onInsert')

  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  const bullets = items => {
    const list = el('ul')
    for (const text of items) list.append(el('li', null, text))
    return list
  }

  const section = (id, heading, ...children) => {
    const node = el('section', 'ref-section')
    node.setAttribute('aria-labelledby', id)
    const h = el('h3', null, heading)
    h.id = id
    node.append(h, ...children)
    return node
  }

  const noteSection = (note, index) =>
    section(`ref-note-${index}`, note.heading, el('p', null, note.text), ...(note.items.length ? [bullets(note.items)] : []))

  const entry = (form, what, example) => {
    const item = el('div', 'ref-entry')
    const insert = el('button', 'insert', 'Insert example')
    insert.type = 'button'
    insert.setAttribute('aria-label', `Insert the example for ${form}`)
    insert.addEventListener('click', () => onInsert(example, insert))
    item.append(el('code', 'form', form), el('p', 'about', what), el('pre', 'sample', example), insert)
    return item
  }

  const [running, naming, values, lengths, ...rest] = NOTES
  const element = el('div', 'reference')
  element.append(
    noteSection(running, 0),
    section('ref-statements', 'Statements', ...STATEMENTS.map(s => entry(s.form, s.what, s.example))),
    noteSection(naming, 1),
    noteSection(values, 2),
    section('ref-units', 'Units', bullets(Object.values(UNITS_REFERENCE).map(u => `${u.example}: ${u.means}`))),
    section('ref-functions', 'Functions', ...Object.values(FUNCTIONS_REFERENCE).map(f => entry(f.form, f.what, f.example))),
    noteSection(lengths, 3),
    ...rest.map((note, i) => noteSection(note, i + 4))
  )
  return { element }
}
