// src/ui/TimelineReorder.js
//
// What changes the order of tracks in the timeline, and the folders that group them: the folder bars, moving a track or a whole
// folder by its keys or its grip, dropping onto a track's row or another folder's bar, and extending the selection along the
// list. Split out of Timeline.js along the seam it already had: all of it works on the rows the timeline draws and the order it
// was last given, and none of it draws a lane. Timeline.js is the front door and passes in what this reads.
//
//   rows            the timeline's map from a track id to its drawn row
//   current()       the arguments of the last draw (tracks, labelFor)
//   scroller        the element the rows are drawn in
//   say(text)       the status region a screen reader hears
//   onMoveTrack(id, delta), onFolderCollapse(name, collapsed)    the page's own handlers
import { createFolderBar } from './FolderBar.js'

export function createReorder (document, { rows, current, scroller, selection, say, onMoveTrack, onFolderCollapse }) {
  // A folder is a run of neighbouring tracks that give the same name; two separate runs are two bars.
  // The folders hidden right now, read from the layout on each draw: a folder is hidden when any of its tracks says so.
  let collapsedFolders = new Set()
  const folderBars = new Map()
  function withFolders (tracks, rowsInOrder, layoutFor) {
    collapsedFolders = new Set(tracks.filter(t => layoutFor(t).folder && layoutFor(t).folderCollapsed).map(t => layoutFor(t).folder))
    const out = []
    const seen = new Map()
    const live = new Set()
    for (let i = 0; i < tracks.length;) {
      const name = layoutFor(tracks[i]).folder ?? null
      let end = i + 1
      while (name !== null && end < tracks.length && layoutFor(tracks[end]).folder === name) end++
      if (name !== null) {
        const nth = seen.get(name) ?? 0
        seen.set(name, nth + 1)
        const key = `${name}\u0000${nth}`
        live.add(key)
        let bar = folderBars.get(key)
        if (!bar) {
          bar = createFolderBar(document, { onMove: delta => moveFolder(key, delta), onGrip: event => dragFolder(key, event), onToggle: folder => { onFolderCollapse(folder, !collapsedFolders.has(folder)); folderBars.get(key)?.element.querySelector('.folder-toggle').focus() } })
          folderBars.set(key, bar)
        }
        bar.runStart = i
        bar.runLength = end - i
        bar.firstTrack = tracks[i].id
        bar.runIds = tracks.slice(i, end).map(t => t.id)
        bar.neighbours = { up: tracks[i - 1]?.id ?? null, down: tracks[end]?.id ?? null }
        bar.update({ name, count: end - i, collapsed: collapsedFolders.has(name), canUp: i > 0, canDown: end < tracks.length })
        out.push(bar.element)
      }
      if (name === null || !collapsedFolders.has(name)) out.push(...rowsInOrder.slice(i, end))
      i = end
    }
    for (const key of [...folderBars.keys()]) if (!live.has(key)) folderBars.delete(key)
    return out
  }

  /**
   * Move one track and say where it went. The place is worked out from the order drawn and the distance asked, and a move
   * past either end, which the model refuses, is said as such: the focus has not moved and silence would read as success.
   */
  function moveTrack (id, delta) {
    const tracks = current().tracks
    const from = tracks.findIndex(t => t.id === id)
    const label = from < 0 ? id : current().labelFor(tracks[from])
    const moved = onMoveTrack(id, delta)
    if (from < 0) return moved
    const to = Math.min(Math.max(from + delta, 0), tracks.length - 1)
    if (to === from) say(`${label} is already ${delta < 0 ? 'first' : 'last'}.`)
    else say(`${label} moved to place ${to + 1} of ${tracks.length}.`)
    return moved
  }

  // Where a run of Shift+arrow presses began: the track last chosen by a click, or the one the first press was made on.
  let rangeAnchor = null
  /**
   * Shift with Up or Down on a track's name: select every drawn track between where the run began and the neighbour, and
   * move the focus there. A track hidden inside a collapsed folder is skipped, as the arrows of any list skip what is not shown.
   */
  function extendTrackSelection (id, delta) {
    const shown = current().tracks.map(t => t.id).filter(t => rows.get(t) && scroller.contains(rows.get(t).row))
    const at = shown.indexOf(id)
    if (at < 0) return
    const to = Math.min(Math.max(at + delta, 0), shown.length - 1)
    const from = shown.includes(rangeAnchor) ? shown.indexOf(rangeAnchor) : at
    rangeAnchor = shown[from]
    selection.set('track', shown.slice(Math.min(from, to), Math.max(from, to) + 1))
    document.getElementById(`show-track-${shown[to]}`)?.focus()
  }

  /**
   * What a drag can land on under `element`: a track's row, or the bar of a folder the drag is not part of. A bar stands for
   * the row beside it, so the rest of the drop is the same as for a row: dragged up, the drop lands above the folder's first
   * track; dragged down, just above the bar, past the end of what the folder held, and never inside it. That is the only way
   * onto a collapsed folder, whose rows are not drawn. Returns the row's id and the element to mark, or null.
   */
  function dropAt (element, own) {
    const bar = [...folderBars.values()].find(b => b.element.contains(element))
    if (bar) {
      if (bar.runIds.some(id => own.includes(id))) return null
      const order = current().tracks.map(t => t.id)
      const up = order.indexOf(own[0]) > bar.runStart
      return { row: up ? bar.firstTrack : order[bar.runStart - 1], mark: bar.element }
    }
    const row = element?.closest?.('.timeline-row')
    const id = row?.dataset.track
    return id && rows.has(id) ? { row: id, mark: row } : null
  }

  /**
   * Move a whole run of folder tracks one place: the track past the run hops over it, so the run keeps its order. One
   * layout change, so no undo, like moving a single track.
   */
  function moveFolder (key, delta) {
    const bar = folderBars.get(key)
    if (!bar) return
    const first = bar.firstTrack
    if (delta < 0) onMoveTrack(bar.neighbours.up, bar.runLength)
    else onMoveTrack(bar.neighbours.down, -bar.runLength)
    say(`Folder ${key.split('\u0000')[0]} moved ${delta < 0 ? 'up' : 'down'}.`)
    // The run sits somewhere else now; keep focus on the folder, on the button that was pressed if it still is one.
    const moved = [...folderBars.values()].find(b => b.firstTrack === first)
    const wanted = moved?.element.querySelector(delta < 0 ? '.folder-move-up' : '.folder-move-down')
    const target = wanted && !wanted.hidden ? wanted : moved?.element.querySelector('.folder-toggle')
    target?.focus()
  }

  /**
   * Drag a whole folder by its grip to the row of a track outside it. The tracks between hop over the run one by one, in order, so
   * the run lands where the row was (above it dragged up, below it dragged down) and nothing else is reordered. The same calls
   * as the Move buttons, a layout change with no undo.
   */
  function dragFolder (key, event) {
    event.preventDefault()
    event.target?.releasePointerCapture?.(event.pointerId)
    const bar = folderBars.get(key)
    if (!bar) return
    const run = bar.runIds
    const first = bar.firstTrack
    let target = null
    let marked = null
    for (const id of run) rows.get(id)?.row.classList.add('dragging')
    const clear = () => {
      document.removeEventListener('pointermove', over)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', clear)
      document.removeEventListener('keydown', escape)
      for (const { row } of rows.values()) row.classList.remove('dragging', 'drop-target')
      for (const { element } of folderBars.values()) element.classList.remove('drop-target')
    }
    // Escape drops the folder where it started: nothing is moved.
    function escape (e) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      clear()
      folderBars.get(key)?.element.querySelector('.folder-toggle')?.focus()
    }
    function over (e) {
      const hit = dropAt(e.target, run)
      // A bar beside the run's own edge stands for one of its own tracks: nowhere to go, and nothing marked.
      if (!hit || hit.row === target || run.includes(hit.row)) return
      marked?.classList.remove('drop-target')
      target = hit.row
      marked = hit.mark
      marked.classList.add('drop-target')
    }
    function up () {
      clear()
      if (target) {
        const order = current().tracks.map(t => t.id)
        const at = order.indexOf(run[0])
        const to = order.indexOf(target)
        if (to < at) for (let k = at - 1; k >= to; k--) onMoveTrack(order[k], run.length)
        else for (let k = at + run.length; k <= to; k++) onMoveTrack(order[k], -run.length)
        say(`Folder ${key.split('\u0000')[0]} moved.`)
      }
      const moved = [...folderBars.values()].find(b => b.firstTrack === first)
      moved?.element.querySelector('.folder-toggle')?.focus()
    }
    document.addEventListener('pointermove', over)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', clear)
    document.addEventListener('keydown', escape)
  }

  /**
   * Drag a track by its grip to the row of another. The row under the pointer is marked while the pointer is down, and
   * one move of that many places is made on release, so one drag is one reorder (the same call as Alt with Up or Down).
   */
  function dragTrack (id, event) {
    event.preventDefault()
    // A touch pointer is held by the element it began on, which would hide every row but the first from the move.
    event.target?.releasePointerCapture?.(event.pointerId)
    const rowOf = trackId => rows.get(trackId)?.row
    let target = id
    let marked = null
    rowOf(id)?.classList.add('dragging')
    const clear = () => {
      document.removeEventListener('pointermove', over)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      document.removeEventListener('keydown', escape)
      for (const { row } of rows.values()) row.classList.remove('dragging', 'drop-target')
      for (const { element } of folderBars.values()) element.classList.remove('drop-target')
    }
    // Escape drops the track where it started: the release that follows moves nothing.
    function escape (e) {
      if (e.key !== 'Escape') return
      e.preventDefault()
      clear()
      document.getElementById(`show-track-${id}`)?.focus()
    }
    function over (e) {
      const hit = dropAt(e.target, [id])
      if (!hit || hit.row === target) return
      marked?.classList.remove('drop-target')
      target = hit.row
      marked = hit.mark
      if (target !== id) marked.classList.add('drop-target')
    }
    function up () {
      clear()
      const order = current().tracks.map(t => t.id)
      const delta = order.indexOf(target) - order.indexOf(id)
      if (delta !== 0) moveTrack(id, delta)
      document.getElementById(`show-track-${id}`)?.focus()
    }
    function cancel () { clear() }
    document.addEventListener('pointermove', over)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
    document.addEventListener('keydown', escape)
  }

  return {
    withFolders,
    moveTrack,
    dragTrack,
    extendTrackSelection,
    /** A click chose this track: a run of Shift+arrow presses starts from it. */
    anchor (id) { rangeAnchor = id }
  }
}
