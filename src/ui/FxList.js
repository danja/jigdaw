// src/ui/FxList.js
//
// The FX button under a mixer channel and the list it opens: the plugins on that track, each with a way to remove it, and a
// way to add another. A disclosure, so the button says whether the list is open and names the list it controls. The open
// state is kept here, because the mixer redraws on every edit and a list that closed itself when a plugin was removed
// would take the focus with it.
//
// Adding does not choose the plugin: `onAdd` takes the person to the Browser with this track as the place the next Load
// goes (web/app/Rack.js). Removing is `onRemove(nodeId)`; the page does the Op.

/**
 * `id` is the stem of the control ids, so two channels do not share them.
 */
export function createFxList (document, { id, onAdd, onRemove }) {
  if (typeof onAdd !== 'function') throw new Error('createFxList needs onAdd')
  if (typeof onRemove !== 'function') throw new Error('createFxList needs onRemove')
  const element = document.createElement('div')
  element.className = 'fx'

  const toggle = document.createElement('button')
  toggle.type = 'button'
  toggle.className = 'fx-toggle'
  toggle.id = `${id}-fx`
  toggle.textContent = 'FX'
  toggle.setAttribute('aria-expanded', 'false')
  toggle.setAttribute('aria-controls', `${id}-fx-list`)

  const region = document.createElement('div')
  region.className = 'fx-list'
  region.id = `${id}-fx-list`
  region.setAttribute('role', 'group')
  region.hidden = true

  const list = document.createElement('ul')
  const add = document.createElement('button')
  add.type = 'button'
  add.className = 'fx-add'
  add.id = `${id}-fx-add`
  add.textContent = 'Add plugin'
  add.addEventListener('click', onAdd)
  region.append(list, add)

  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') !== 'true'
    toggle.setAttribute('aria-expanded', String(open))
    region.hidden = !open
  })
  element.append(toggle, region)

  return {
    element,
    toggle,
    /** `plugins` is `[{ id, label }]` in signal order; `label` names the track for the controls' names. */
    update ({ label, plugins }) {
      toggle.setAttribute('aria-label', `Plugins on ${label}: ${plugins.length}`)
      region.setAttribute('aria-label', `Plugins on ${label}`)
      add.setAttribute('aria-label', `Add a plugin to ${label}`)
      toggle.textContent = plugins.length > 0 ? `FX ${plugins.length}` : 'FX'
      list.replaceChildren(...plugins.map(plugin => {
        const item = document.createElement('li')
        const name = document.createElement('span')
        name.className = 'fx-name'
        name.textContent = plugin.label
        const remove = document.createElement('button')
        remove.type = 'button'
        remove.className = 'fx-remove'
        remove.id = `${id}-fx-remove-${plugin.id}`
        remove.textContent = 'Remove'
        remove.setAttribute('aria-label', `Remove ${plugin.label} from ${label}`)
        remove.addEventListener('click', () => {
          onRemove(plugin.id)
          // The button has gone with its plugin; the focus goes to the list's own button rather than to the page.
          toggle.focus()
        })
        item.append(name, remove)
        return item
      }))
      list.hidden = plugins.length === 0
    }
  }
}
