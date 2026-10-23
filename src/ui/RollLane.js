// src/ui/RollLane.js
//
// A lane of values under the note roll, aligned with its columns: one bar for each item (a note's velocity, a controller
// event), as tall as its value. It knows nothing of notes or controllers; the roll gives it items and says what to do with an
// edit.
//
// Every bar is a slider: it has a name, a range, a value and a value in words. Tab reaches the one bar (a roving tabindex);
// Left and Right move to the next bar, Up and Down change the value by one (Shift or Page Up and Page Down by ten), Home and End go
// to the ends of the range. A drag on a bar changes its value from where the pointer is, and sends one edit on release, so one
// drag is one undo step. Where several items share a column (the notes of a chord) the bars share the column's width, and the
// same values can be reached by the keys, so no one depends on hitting a thin bar.
//
// When the caller can add and remove items (`onAdd`, `onRemove`), a press on empty lane adds one (`onAdd(fraction, value)`,
// fraction being how far along the lane) and Delete removes the focused one. A control nobody can use is left out, so a lane whose items cannot be added has neither.

export const LANE_HEIGHT = 96

export function createRollLane (document, { id, label, min, max, onSet, onFocus = null, onAdd = null, onRemove = null, fine = 1, coarse = 10 }) {
  const element = document.createElement('div')
  element.className = 'piano-roll-lane'
  element.id = id
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', label)
  const title = document.createElement('span')
  title.className = 'piano-roll-lane-title'
  title.textContent = label
  title.setAttribute('aria-hidden', 'true')
  const bars = document.createElement('div')
  bars.className = 'piano-roll-lane-bars'
  element.append(title, bars)

  let items = []
  let focusKey = null
  let activeDrag = null

  const clamp = value => Math.min(max, Math.max(min, Math.round(value)))
  const heightOf = value => `${Math.max(2, ((value - min) / (max - min)) * LANE_HEIGHT)}px`
  const valueAt = clientY => {
    const rect = bars.getBoundingClientRect()
    return clamp(min + (1 - (clientY - rect.top) / (rect.height || LANE_HEIGHT)) * (max - min))
  }

  function bar (item, index, group) {
    const b = document.createElement('div')
    b.className = `piano-roll-lane-bar${item.chosen ? ' chosen' : ''}`
    b.dataset.key = item.key
    b.setAttribute('role', 'slider')
    b.setAttribute('aria-label', item.name)
    b.setAttribute('aria-orientation', 'vertical')
    b.setAttribute('aria-valuemin', String(min))
    b.setAttribute('aria-valuemax', String(max))
    b.setAttribute('aria-valuenow', String(item.value))
    b.setAttribute('aria-valuetext', item.text)
    b.tabIndex = item.key === (focusKey ?? items[0]?.key) ? 0 : -1
    // Items on one column share its width, each in its own slot.
    b.style.left = `calc(${item.beat} * var(--steps-per-beat, 4) * var(--cell) + ${group.slot} * var(--cell) / ${group.count})`
    b.style.width = `calc(var(--cell) / ${group.count})`
    const fill = document.createElement('span')
    fill.className = 'piano-roll-lane-fill'
    fill.style.height = heightOf(item.value)
    fill.setAttribute('aria-hidden', 'true')
    b.append(fill)

    const set = value => { if (clamp(value) !== item.value) onSet(item, clamp(value)) }
    b.addEventListener('focus', () => { focusKey = item.key; onFocus?.(item) })
    b.addEventListener('keydown', event => {
      const { key, shiftKey } = event
      const step = shiftKey ? coarse : fine
      if (key === 'ArrowUp') { event.preventDefault(); set(item.value + step) }
      else if (key === 'ArrowDown') { event.preventDefault(); set(item.value - step) }
      else if (key === 'PageUp') { event.preventDefault(); set(item.value + coarse) }
      else if (key === 'PageDown') { event.preventDefault(); set(item.value - coarse) }
      else if (key === 'Home') { event.preventDefault(); set(min) }
      else if (key === 'End') { event.preventDefault(); set(max) }
      else if (key === 'ArrowLeft' || key === 'ArrowRight') {
        event.preventDefault()
        const next = items[items.indexOf(item) + (key === 'ArrowRight' ? 1 : -1)]
        if (next) { focusKey = next.key; draw(items, { keepFocus: true }) }
      } else if ((key === 'Delete' || key === 'Backspace') && onRemove) { event.preventDefault(); onRemove(item) }
    })

    b.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      b.focus?.()
      let value = item.value
      const move = e => {
        value = valueAt(e.clientY)
        fill.style.height = heightOf(value)
        b.setAttribute('aria-valuenow', String(value))
      }
      const finish = commit => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        document.removeEventListener('pointercancel', cancel)
        activeDrag = null
        if (commit) set(value)
        else { fill.style.height = heightOf(item.value); b.setAttribute('aria-valuenow', String(item.value)) }
      }
      const up = () => finish(true)
      const cancel = () => finish(false)
      activeDrag = cancel
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
      document.addEventListener('pointercancel', cancel)
      move(event)
    })
    return b
  }

  if (onAdd) {
    bars.addEventListener('pointerdown', event => {
      if (event.button !== 0 || event.target !== bars) return
      event.preventDefault()
      const rect = bars.getBoundingClientRect()
      // How far along the lane, from 0 to 1: the caller knows the columns, the lane only the pixels it was drawn in.
      onAdd(Math.min(1, Math.max(0, (event.clientX - rect.left) / (rect.width || 1))), valueAt(event.clientY))
    })
  }

  function draw (next, { keepFocus = bars.contains(document.activeElement) } = {}) {
    activeDrag?.()
    items = next
    const columns = new Map()
    for (const item of items) columns.set(item.beat, (columns.get(item.beat) ?? 0) + 1)
    const used = new Map()
    bars.replaceChildren(...items.map((item, i) => {
      const slot = used.get(item.beat) ?? 0
      used.set(item.beat, slot + 1)
      return bar(item, i, { slot, count: columns.get(item.beat) })
    }))
    if (focusKey !== null && !items.some(i => i.key === focusKey)) focusKey = null
    // A redraw after an edit must not drop the keyboard's place.
    if (keepFocus) [...bars.children].find(b => b.dataset.key === (focusKey ?? items[0]?.key))?.focus?.()
  }

  return {
    element,
    draw,
    /** Which bar the keys are on, so the roll can keep the lane and the grid together. */
    focusItem (key) { focusKey = key },
    get items () { return items }
  }
}
