// src/ui/Tabs.js
//
// A tab list switching between panels that already exist in the document.
//
// This does not build the panels or decide what goes in them: it is handed
// elements the caller already has (`web/app.js` has a `.stage` full of
// sections before any tab existed) and only ever toggles which one is
// visible. That split is deliberate, the same reason Dial.js draws a control
// and never asks what it is a control for: a widget that also owned its
// content could not be reused for a second unrelated pair of views.
//
// The WAI-ARIA Authoring Practices tab pattern, with automatic activation:
// moving to a tab with the keyboard shows its panel immediately, rather than
// requiring a second key to confirm. Automatic activation is what the
// practices guide recommends when, as here, showing a panel is cheap and
// carries no request to a server. Left and Right move by one tab and wrap at
// the ends; Home and End jump to the first and last. A pointer click selects
// directly, the same destination either way.
export function createTabs (document, tabs, { onSelect = () => {} } = {}) {
  if (tabs.length === 0) throw new Error('a tab list needs at least one tab')

  const tablist = document.createElement('div')
  tablist.setAttribute('role', 'tablist')
  tablist.className = 'tabs'

  const buttons = tabs.map((tab, index) => {
    const button = document.createElement('button')
    button.type = 'button'
    // Prefixed so the id cannot collide with the panel's own, which a caller
    // is free to have named anything.
    button.id = `tab-${tab.id}`
    button.className = 'tab'
    button.setAttribute('role', 'tab')
    button.setAttribute('aria-controls', tab.panel.id)
    button.textContent = tab.label
    tablist.append(button)

    // The panel side of the same relationship. A tabpanel is reachable on its
    // own terms, tabIndex 0, because its content may end before anything else
    // inside it can take the focus, and the practices guide asks for it to be
    // reachable regardless.
    tab.panel.setAttribute('role', 'tabpanel')
    tab.panel.setAttribute('aria-labelledby', button.id)
    tab.panel.tabIndex = 0

    return button
  })

  let current = 0

  /** Show `index`, hide the rest, and move the keyboard focus there. */
  const select = index => {
    current = index
    buttons.forEach((button, i) => {
      const active = i === index
      button.setAttribute('aria-selected', String(active))
      // Roving tabindex: only the selected tab is in the page's Tab order,
      // which is what lets Left and Right move between tabs without Tab
      // itself stopping on each one along the way.
      button.tabIndex = active ? 0 : -1
      tabs[i].panel.hidden = !active
    })
    onSelect(tabs[index].id)
  }

  const MOVES = {
    ArrowRight: i => (i + 1) % buttons.length,
    ArrowLeft: i => (i - 1 + buttons.length) % buttons.length,
    Home: () => 0,
    End: () => buttons.length - 1
  }

  buttons.forEach((button, index) => {
    button.addEventListener('click', () => select(index))
    button.addEventListener('keydown', event => {
      const move = MOVES[event.key]
      if (!move) return
      // Arrow keys otherwise scroll the page, which is the wrong thing to
      // happen while moving between tabs.
      event.preventDefault()
      const next = move(index)
      select(next)
      buttons[next].focus()
    })
  })

  select(0)

  return {
    element: tablist,
    /** Select a tab by id, from outside a keypress or a click. */
    select (id) {
      const index = tabs.findIndex(tab => tab.id === id)
      if (index === -1) throw new Error(`no such tab: ${id}`)
      select(index)
    },
    /** The id of whichever tab is currently shown. */
    selected () { return tabs[current].id }
  }
}
