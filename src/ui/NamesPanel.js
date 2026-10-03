// src/ui/NamesPanel.js
//
// The plugins of the open piece, as a script names them, with each parameter's range and a button that writes
// the line to set it into the script. A script is typed, and on a phone typing a symbol like hh_closed_brightness
// is the slow part, so this is the shortcut. src/reel/Names.js decides what is listed and what the line says.
//
// A parameter with named values, such as a genre, shows them, because "genre = 5" says nothing without them.
export function createNamesPanel (document, { onInsert }) {
  if (typeof onInsert !== 'function') throw new Error('createNamesPanel needs onInsert')
  const element = document.createElement('div')
  element.className = 'names'

  const el = (tag, className, text) => {
    const node = document.createElement(tag)
    if (className) node.className = className
    if (text !== undefined) node.textContent = text
    return node
  }

  return {
    element,
    /** `names`: the result of describeNames, or an empty list for a piece that is not open yet. */
    draw (names) {
      if (names.length === 0) {
        element.replaceChildren(el('p', 'note', 'No piece is open. Choose one above, or write a script that loads its own plugins.'))
        return
      }
      element.replaceChildren(...names.map(plugin => {
        const section = el('section', 'name')
        const heading = el('h3')
        heading.append(el('code', null, plugin.name), ` ${plugin.label}`)
        const list = el('ul', 'parameters')
        for (const parameter of plugin.parameters) {
          const item = el('li', 'parameter')
          item.append(el('code', 'symbol', parameter.symbol), el('span', 'value', ` ${parameter.name}, ${parameter.range}`))
          const insert = el('button', 'insert', 'Insert')
          insert.type = 'button'
          insert.setAttribute('aria-label', `Insert a line setting ${plugin.name} ${parameter.symbol}`)
          insert.addEventListener('click', () => onInsert(parameter.line, insert))
          item.append(insert)
          if (parameter.choices.length > 0) {
            const details = el('details', 'choices')
            details.append(el('summary', null, 'Values'), el('p', 'about', parameter.choices.map(c => `${c.value} ${c.label}`).join(', ')))
            item.append(details)
          }
          list.append(item)
        }
        section.append(heading, list)
        return section
      }))
    }
  }
}
