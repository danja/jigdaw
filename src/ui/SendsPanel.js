// src/ui/SendsPanel.js
//
// Where one track's signal goes besides straight to the master: its output (the
// master, or another track, which makes that track a bus) and its sends, each a
// copy of the signal at a level, taken before or after the fader, into another
// track. A return is just the track a send goes to.
//
// A send's row is kept while it exists and its values updated in place, never
// rebuilt: a level slider dragged while it is taken out of the document loses
// the pointer, and every edit redraws the dock.
//
// Destinations offered are only those the model would accept (src/ui/SendsModel.js);
// a control that cannot act is left out, so with nowhere to send there is no Add.
import { decibels } from './Strip.js'

export function createSendsPanel (document, { onOutput, onAdd, onLevel, onTap, onRemove }) {
  for (const [name, fn] of Object.entries({ onOutput, onAdd, onLevel, onTap, onRemove })) {
    if (typeof fn !== 'function') throw new Error(`createSendsPanel needs ${name}`)
  }
  const element = document.createElement('div')
  element.className = 'sends-panel'

  const outLabel = document.createElement('label')
  outLabel.className = 'track-field'
  outLabel.append(document.createTextNode('Output '))
  const output = document.createElement('select')
  output.id = 'track-output'
  output.addEventListener('change', () => onOutput(output.value === '' ? null : output.value))
  outLabel.append(output)

  const heading = document.createElement('h3')
  heading.textContent = 'Sends'
  const list = document.createElement('ul')
  list.className = 'send-list'
  list.setAttribute('aria-label', 'Sends from this track')

  const addForm = document.createElement('form')
  addForm.className = 'send-add'
  const addLabel = document.createElement('label')
  addLabel.className = 'track-field'
  addLabel.append(document.createTextNode('Send to '))
  const addTo = document.createElement('select')
  addTo.id = 'send-to'
  addLabel.append(addTo)
  const addButton = document.createElement('button')
  addButton.type = 'submit'
  addButton.id = 'send-add'
  addButton.textContent = 'Add send'
  addForm.append(addLabel, addButton)
  // What is chosen, kept from the change event so the first option counts before anyone touches it.
  let addChoice = null
  addTo.addEventListener('change', () => { addChoice = addTo.value })
  addForm.addEventListener('submit', event => { event.preventDefault(); if (addChoice !== null) onAdd(addChoice) })

  element.append(outLabel, heading, list, addForm)
  const rows = new Map()

  function fill (select, options, chosen, { blank = null } = {}) {
    const items = blank ? [{ id: '', label: blank }, ...options] : options
    select.replaceChildren(...items.map(o => {
      const option = document.createElement('option')
      option.value = o.id
      option.textContent = o.label
      option.selected = o.id === chosen
      return option
    }))
  }

  function makeRow (send) {
    const li = document.createElement('li')
    li.className = 'send-row'
    const name = document.createElement('span')
    name.className = 'send-name'
    const level = document.createElement('label')
    level.className = 'send-level'
    const input = document.createElement('input')
    input.type = 'range'
    input.min = '0'
    input.max = '2'
    input.step = '0.01'
    input.id = `send-${send.id}-level`
    const value = document.createElement('span')
    value.className = 'value'
    level.append(document.createTextNode('Level '), input, value)
    const tap = document.createElement('select')
    tap.id = `send-${send.id}-tap`
    for (const [v, text] of [['post', 'After the fader'], ['pre', 'Before the fader']]) {
      const option = document.createElement('option')
      option.value = v
      option.textContent = text
      tap.append(option)
    }
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.textContent = 'Remove'
    input.addEventListener('input', () => { show(Number(input.value)); onLevel(send.id, Number(input.value)) })
    tap.addEventListener('change', () => onTap(send.id, tap.value))
    remove.addEventListener('click', () => onRemove(send.id))
    const show = n => {
      value.textContent = `${decibels(n)} dB`
      input.setAttribute('aria-valuetext', `${decibels(n)} decibels`)
    }
    li.append(name, level, tap, remove)
    return { li, name, input, tap, remove, show }
  }

  return {
    element,
    /**
     * `output` is the track this one's output goes to, or null for the master;
     * `outputOptions` and `addOptions` are `{ id, label }` lists; `sends` are
     * `{ id, toLabel, level, tap }`.
     */
    show ({ label, output: current, outputOptions, sends, addOptions }) {
      // A track already outputting somewhere is offered even if it is no longer a
      // free choice, so the select never shows something it cannot say.
      fill(output, outputOptions, current ?? '', { blank: 'Master' })
      output.setAttribute('aria-label', `Output of ${label}`)

      for (const id of [...rows.keys()]) {
        if (!sends.some(s => s.id === id)) { rows.get(id).li.remove(); rows.delete(id) }
      }
      for (const send of sends) {
        let row = rows.get(send.id)
        if (!row) { row = makeRow(send); rows.set(send.id, row) }
        row.name.textContent = `To ${send.toLabel}`
        row.input.setAttribute('aria-label', `Level of the send from ${label} to ${send.toLabel}`)
        row.tap.setAttribute('aria-label', `Where the send from ${label} to ${send.toLabel} is taken`)
        row.remove.setAttribute('aria-label', `Remove the send from ${label} to ${send.toLabel}`)
        if (document.activeElement !== row.input) row.input.value = String(send.level)
        row.show(send.level)
        for (const option of row.tap.options) option.selected = option.value === send.tap
        list.append(row.li)
      }
      list.hidden = sends.length === 0
      heading.hidden = false

      addForm.hidden = addOptions.length === 0
      fill(addTo, addOptions, addOptions[0]?.id)
      addChoice = addOptions[0]?.id ?? null
    }
  }
}
