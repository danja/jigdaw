// src/ui/FxList.js
//
// The FX button under a mixer channel and the list it opens: the plugins on that track, each with a way to remove it, and a
// way to add another. A disclosure, so the button says whether the list is open and names the list it controls. The open
// state is kept here, because the mixer redraws on every edit and a list that closed itself when a plugin was removed
// would take the focus with it.
//
// Adding does not choose the plugin: `onAdd` takes the person to the Browser with this track as the place the next Load
// goes (web/app/Rack.js). Removing is `onRemove(nodeId)`; the page does the Op.
//
// Each plugin has what the chain strip gives it, in the same words: Bypass (a toggle that says whether it is on), Move earlier
// and Move later, Replace, and Controls, which shows the plugin's own panel. A control that cannot act is left out, not shown
// disabled: a plugin that has not loaded or failed has nothing to bypass, replace or show; the first has nothing to move
// earlier, and a neighbour that does not pass audio cannot be swapped with. `actions` holds the handlers, each optional, and
// a control with no handler is not drawn.
import { setIcon } from './Icons.js'

/**
 * `id` is the stem of the control ids, so two channels do not share them.
 */
export function createFxList (document, { id, onAdd, onRemove, actions = {} }) {
  const { onBypass = null, onMove = null, onReplace = null, onShow = null } = actions
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
    /**
     * `plugins` is `[{ id, label, loaded, failed, bypassed, canEarlier, canLater }]` in signal order (src/ui/FxModel.js; the last
     * five may be left out for a plain list); `label` names the track for the controls' names.
     */
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
        const buttons = []
        const usable = plugin.loaded !== false && !plugin.failed
        const button = (kind, text, run) => {
          const b = document.createElement('button')
          b.type = 'button'
          b.className = `fx-${kind}`
          b.id = `${id}-fx-${kind}-${plugin.id}`
          b.textContent = text
          b.addEventListener('click', run)
          buttons.push(b)
          return b
        }
        if (onBypass && usable) {
          const b = button('bypass', 'Bypass', () => onBypass(plugin.id, !plugin.bypassed))
          setIcon(document, b, 'bypass', `Bypass ${plugin.label} on ${label}`)
          b.setAttribute('aria-pressed', String(plugin.bypassed === true))
        }
        if (onMove && usable) {
          for (const [delta, can, icon, text] of [[-1, plugin.canEarlier, 'earlier', 'earlier'], [1, plugin.canLater, 'later', 'later']]) {
            if (!can) continue
            const b = button(`move-${text}`, `Move ${text}`, () => {
              onMove(plugin.id, delta)
              // The plugin has moved and the list is drawn again. Where it can still move that way the same button is there;
              // at the end of the chain the other way is, and failing that the list's own button.
              const again = region.querySelector(`#${id}-fx-move-${text}-${plugin.id}`) ?? region.querySelector(`#${id}-fx-move-${text === 'earlier' ? 'later' : 'earlier'}-${plugin.id}`)
              ;(again ?? toggle).focus()
            })
            setIcon(document, b, icon, `Move ${plugin.label} ${text} on ${label}`)
          }
        }
        if (onReplace && usable) {
          const b = button('replace', 'Replace', () => onReplace(plugin.id))
          setIcon(document, b, 'replace', `Replace ${plugin.label} on ${label}`)
        }
        if (onShow && usable) {
          const b = button('show', 'Controls', () => onShow(plugin.id))
          b.setAttribute('aria-label', `Show the controls of ${plugin.label} on ${label}`)
        }
        const remove = button('remove', 'Remove', () => {
          onRemove(plugin.id)
          // The button has gone with its plugin; the focus goes to the list's own button rather than to the page.
          toggle.focus()
        })
        remove.setAttribute('aria-label', `Remove ${plugin.label} from ${label}`)
        const row = document.createElement('div')
        row.className = 'fx-actions'
        row.append(...buttons)
        // Said in words as well as by the pressed button, never by colour alone.
        if (plugin.bypassed) { item.classList.add('bypassed'); name.textContent = `${plugin.label} (bypassed)` }
        if (plugin.failed) name.textContent = `${plugin.label} (failed to load)`
        item.append(name, row)
        return item
      }))
      list.hidden = plugins.length === 0
    }
  }
}
