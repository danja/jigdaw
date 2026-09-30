// src/ui/RoutingMatrix.js
//
// The whole routing graph as one table: an output on each row, an input on each
// column, and a button where the two can be joined. Pressed means joined. The
// same table serves a keyboard, a screen reader and a thumb, which a drawn graph
// cannot (src/ui/Routing.js says why there is no canvas).
//
// One tab stop. Arrow keys move between the buttons, Home and End to the ends of
// a row, Control with them to the corners; Enter or Space presses. A table with
// a hundred buttons that were each a tab stop would be a hundred keypresses to
// cross. Rows and columns are headed in words: "Lead line MIDI out" and "Bass
// line MIDI in", under the name of the track each belongs to.
//
// The state is said in text on every button ("connected" and "not connected"),
// and a joined pair shows a mark as well as a colour.

export function createRoutingMatrix (document, { onConnect, onDisconnect }) {
  for (const [what, fn] of Object.entries({ onConnect, onDisconnect })) {
    if (typeof fn !== 'function') throw new Error(`createRoutingMatrix needs ${what}`)
  }
  const element = document.createElement('div')
  element.className = 'routing-matrix'
  let cursor = null

  const cellButtons = () => [...element.querySelectorAll('button.matrix-cell')]

  /** The button at a row and column of the table, or null where there is none. */
  function at (r, c) {
    const rows = [...element.querySelectorAll('tbody tr')]
    return rows[r]?.querySelectorAll('td')[c]?.querySelector('button') ?? null
  }

  /** Arrow keys: the next button in that direction, stepping over cells that have none. */
  function move (button, dr, dc) {
    const td = button.closest('td')
    const tr = td.parentElement
    const rows = [...element.querySelectorAll('tbody tr')]
    let r = rows.indexOf(tr) + dr
    let c = [...tr.querySelectorAll('td')].indexOf(td) + dc
    const width = tr.querySelectorAll('td').length
    while (r >= 0 && r < rows.length && c >= 0 && c < width) {
      const target = at(r, c)
      if (target) { focus(target); return }
      r += dr
      c += dc
    }
  }

  /** Home and End go to the ends of the row; with Control, to the first and last button of all. */
  function jump (button, toEnd, whole) {
    const scope = whole ? cellButtons() : [...button.closest('tr').querySelectorAll('button.matrix-cell')]
    focus(toEnd ? scope.at(-1) : scope[0])
  }

  function focus (button) {
    for (const b of cellButtons()) b.setAttribute('tabindex', '-1')
    button.setAttribute('tabindex', '0')
    cursor = button.id
    button.focus()
  }

  element.addEventListener('keydown', event => {
    const button = event.target.closest?.('button.matrix-cell')
    if (!button) return
    const ctrl = event.ctrlKey || event.metaKey
    const delta = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]
    }[event.key]
    if (delta) { event.preventDefault(); move(button, ...delta); return }
    if (event.key === 'Home' || event.key === 'End') { event.preventDefault(); jump(button, event.key === 'End', ctrl) }
  })

  return {
    element,
    /** Draw from `buildMatrix`'s answer. The button the keyboard was on is kept. */
    draw (matrix) {
      const { rows, cols, possible, connectionAt } = matrix
      if (rows.length === 0 || cols.length === 0) {
        const none = document.createElement('p')
        none.className = 'empty'
        none.textContent = rows.length === 0 && cols.length === 0
          ? 'No plugins to route yet.'
          : rows.length === 0 ? 'No plugin here has an output to connect from.' : 'No plugin here has an input to connect to.'
        element.replaceChildren(none)
        return
      }

      const table = document.createElement('table')
      table.setAttribute('aria-label', 'Routing: outputs down the side, inputs across the top. Press a cell to connect or disconnect.')

      // Inputs across the top, grouped under their track.
      const head = document.createElement('thead')
      const groups = document.createElement('tr')
      const corner = document.createElement('td')
      corner.setAttribute('rowspan', '2')
      groups.append(corner)
      const trackRuns = []
      for (const col of cols) {
        const last = trackRuns.at(-1)
        if (last && last.track === col.track) last.count++
        else trackRuns.push({ track: col.track, label: col.trackLabel, count: 1 })
      }
      for (const run of trackRuns) {
        const th = document.createElement('th')
        th.setAttribute('scope', 'colgroup')
        th.setAttribute('colspan', String(run.count))
        th.textContent = run.label
        groups.append(th)
      }
      const names = document.createElement('tr')
      for (const col of cols) {
        const th = document.createElement('th')
        th.setAttribute('scope', 'col')
        th.textContent = col.text
        names.append(th)
      }
      head.append(groups, names)

      const body = document.createElement('tbody')
      let previousTrack = null
      let first = null
      for (const row of rows) {
        const tr = document.createElement('tr')
        const th = document.createElement('th')
        th.setAttribute('scope', 'row')
        // The track's name once, on its first row, so the table is not a wall of repeats.
        th.textContent = row.track === previousTrack ? row.text : `${row.trackLabel}: ${row.text}`
        previousTrack = row.track
        tr.append(th)
        for (const col of cols) {
          const td = document.createElement('td')
          if (possible(row, col)) {
            const connection = connectionAt(row, col)
            const button = document.createElement('button')
            button.type = 'button'
            button.className = 'matrix-cell'
            button.id = `cell-${row.key}--${col.key}`.replace(/[^\w-]/g, '_')
            button.setAttribute('tabindex', '-1')
            button.textContent = connection ? '●' : '○'
            button.setAttribute('aria-pressed', String(Boolean(connection)))
            button.setAttribute('aria-label',
              `${row.text} on ${row.trackLabel} to ${col.text} on ${col.trackLabel}: ${connection ? 'connected' : 'not connected'}`)
            button.addEventListener('click', () => {
              cursor = button.id
              if (connection) onDisconnect(connection.id)
              else onConnect(row, col)
            })
            td.append(button)
            first ??= button
          }
          tr.append(td)
        }
        body.append(tr)
      }
      table.append(head, body)
      element.replaceChildren(table)

      // One tab stop: the button the keyboard was on if it is still here, else the first.
      const keep = cursor && document.getElementById(cursor)
      ;(keep && element.contains(keep) ? keep : first).setAttribute('tabindex', '0')
    }
  }
}
