// src/ui/MasterRow.js
//
// The master's place in the arrangement: a row after the tracks that holds the automation lanes for what is not
// on a track (the master's level and pan, and the tempo) and a way to add one. A row of its own rather than a track, because the master is not on any track
// and nothing plays into it from a lane. The form is left out when both lanes exist, not shown empty.
import { createEnvelopeLanes } from './EnvelopeLanes.js'

export function createMasterRow (document, { onChange, onRemove, onAutomate, view }) {
  if (typeof onAutomate !== 'function') throw new Error('createMasterRow needs onAutomate')
  const element = document.createElement('div')
  element.className = 'master-row'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Master and tempo')
  const head = document.createElement('form')
  head.className = 'master-head'
  head.setAttribute('aria-label', 'Automate the master or the tempo')
  const title = document.createElement('span')
  title.className = 'master-title'
  title.textContent = 'Master and tempo'
  const label = document.createElement('label')
  label.className = 'track-field'
  label.append(document.createTextNode('Automate '))
  const select = document.createElement('select')
  select.id = 'automate-master'
  label.append(select)
  const go = document.createElement('button')
  go.type = 'submit'
  go.textContent = 'Add lane'
  head.append(title, label, go)
  const lanes = createEnvelopeLanes(document, { onChange, onRemove, view })
  element.append(head, lanes.element)

  let chosen = null
  select.addEventListener('change', () => { chosen = select.value })
  head.addEventListener('submit', event => {
    event.preventDefault()
    if (chosen) onAutomate(chosen)
  })

  return {
    element,
    /** `available` is `[{ kind, label }]` of the master's parameters with no lane yet; `list` the lanes there are. */
    update ({ list, available }, { beatsPerBar, width }) {
      chosen = available[0]?.kind ?? null
      select.replaceChildren(...available.map(a => {
        const option = document.createElement('option')
        option.value = a.kind
        option.textContent = a.label
        return option
      }))
      label.hidden = go.hidden = available.length === 0
      lanes.update(list, { beatsPerBar, width })
    }
  }
}
