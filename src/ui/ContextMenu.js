// src/ui/ContextMenu.js
//
// One context menu for the whole page: the actions a person can take on the thing under the pointer, which are always actions
// the page already offers elsewhere (a button, a key). A menu is never the only way to do something.
//
// It opens on a right click, and on the Menu key or Shift+F10, which the browser reports as the same `contextmenu` event with
// no pointer button; `attachMenu` anchors that one to the item rather than to a pointer that is not there. The menu follows the
// ARIA menu pattern: arrows, Home and End move, Enter or Space act, Escape closes, Tab closes, and the focus goes back to the item
// it came from. An action that cannot act is left out of the list and not drawn disabled (CLAUDE.md).
//
// An item is `{ label, run, checked?, hint?, danger? }`; the string '-' is a divider.

/** Build the page's menu. `document` is the page; the element is appended to the body on first use. */
export function createContextMenu (document) {
  const element = document.createElement('ul')
  element.className = 'context-menu'
  element.setAttribute('role', 'menu')
  element.hidden = true
  element.tabIndex = -1
  let returnTo = null
  let entries = []
  let outside = null

  function focusables () { return entries.filter(entry => entry.button) }
  function move (from, delta) {
    const list = focusables()
    if (list.length === 0) return
    const index = list.findIndex(entry => entry.button === from)
    list[(index + delta + list.length) % list.length].button.focus()
  }

  function close ({ restore = true } = {}) {
    if (element.hidden) return
    element.hidden = true
    element.replaceChildren()
    entries = []
    if (outside) { document.removeEventListener('pointerdown', outside, true); outside = null }
    if (restore && returnTo && typeof returnTo.focus === 'function') returnTo.focus()
    returnTo = null
  }

  element.addEventListener('keydown', event => {
    const current = event.target.closest?.('button') ?? null
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close() }
    else if (event.key === 'Tab') { close() }
    else if (event.key === 'ArrowDown') { event.preventDefault(); move(current, 1) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); move(current, -1) }
    else if (event.key === 'Home') { event.preventDefault(); focusables()[0]?.button.focus() }
    else if (event.key === 'End') { event.preventDefault(); focusables().at(-1)?.button.focus() }
  })

  /**
   * Show `items` with the corner at (`x`, `y`), then move the focus to the first. `from` is the element the focus returns to.
   * An empty list shows nothing: a menu with no action is a control nobody can use.
   */
  function open (items, { x = 0, y = 0, from = null } = {}) {
    close({ restore: false })
    const actions = items.filter((item, index, all) => item !== '-' || (index > 0 && index < all.length - 1 && all[index - 1] !== '-'))
    if (actions.every(item => item === '-')) return false
    if (!element.isConnected) document.body.append(element)
    returnTo = from
    entries = actions.map(item => {
      const li = document.createElement('li')
      if (item === '-') {
        li.setAttribute('role', 'separator')
        element.append(li)
        return { li }
      }
      li.setAttribute('role', 'none')
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', item.checked === undefined ? 'menuitem' : 'menuitemcheckbox')
      if (item.checked !== undefined) button.setAttribute('aria-checked', String(item.checked))
      if (item.danger) button.classList.add('danger')
      const text = document.createElement('span')
      text.textContent = item.label
      button.append(text)
      if (item.hint) {
        const hint = document.createElement('kbd')
        hint.textContent = item.hint
        button.append(hint)
      }
      button.addEventListener('click', () => {
        close()
        item.run()
      })
      li.append(button)
      element.append(li)
      return { li, button }
    })
    element.hidden = false
    // Clamped so the menu is never drawn off the window: moved left and up by what overflows.
    const view = document.defaultView
    element.style.left = '0px'
    element.style.top = '0px'
    const box = element.getBoundingClientRect?.() ?? { width: 0, height: 0 }
    const width = view?.innerWidth ?? 0
    const height = view?.innerHeight ?? 0
    element.style.left = `${Math.max(0, width ? Math.min(x, width - box.width - 4) : x)}px`
    element.style.top = `${Math.max(0, height ? Math.min(y, height - box.height - 4) : y)}px`
    outside = event => { if (!element.contains(event.target)) close({ restore: false }) }
    document.addEventListener('pointerdown', outside, true)
    focusables()[0]?.button.focus({ preventScroll: true })
    return true
  }

  return { element, open, close, get isOpen () { return !element.hidden } }
}

/**
 * Make `target` open a menu. `items()` is asked each time and returns the list for now, since what can be done changes (a clip
 * is muted or not); it is given the event, so a lane can read where the pointer was. An empty list opens nothing and leaves the
 * browser's own menu alone. The keyboard's Menu key arrives as a `contextmenu` event with button 0 and no pointer: it is anchored to the item's own box.
 */
export function attachMenu (target, menu, items) {
  target.addEventListener('contextmenu', event => {
    const list = items(event)
    if (!list || list.length === 0) return
    // An item that handles the event owns it: the browser's own menu would sit on top of this one.
    event.preventDefault()
    event.stopPropagation()
    const fromKeyboard = event.button !== 2 && !event.clientX && !event.clientY
    const box = target.getBoundingClientRect?.() ?? { left: 0, bottom: 0 }
    menu.open(list, {
      x: fromKeyboard ? box.left + 8 : event.clientX,
      y: fromKeyboard ? box.bottom - 4 : event.clientY,
      from: target
    })
  })
}
