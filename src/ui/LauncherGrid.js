// src/ui/LauncherGrid.js
//
// The clip launcher's grid: a column per track, a row per scene, one button a cell (docs/clip-launcher.md, "The view").
// A cell says its state in words as well as by mark, never by colour alone: "Bass, scene 2, playing". An empty cell is a button
// that adds an empty clip there, so the grid can be filled without leaving it. Under the columns, a Stop for each track and one
// for all; beside the rows, a button that launches the whole row.
//
// Built once and updated in place while its shape is the same, so a state change (the common one, as a slot goes from queued to
// playing) takes no element out of the document and the focus stays. A different shape (a track or a clip added or gone) rebuilds,
// with the focus put back by id.
//
// Keys, with a cell focused: arrows move over the grid, Enter or Space press it (launch, or add where empty).
import { attachMenu } from './ContextMenu.js'
import { preserveFocus } from './Focus.js'

const WORDS = Object.freeze({ empty: 'empty, press to add a clip', stopped: 'stopped', queued: 'queued', playing: 'playing', stopping: 'stopping' })
const MARKS = Object.freeze({ empty: '+', stopped: '▶', queued: '◔', playing: '■', stopping: '◑' })

export function createLauncherGrid (document, { onLaunch, onAdd, onScene, onStopTrack, onStopAll, onQuantise, onEdit = null, onRemove = null, menu = null, quantiseNames }) {
  for (const [name, fn] of Object.entries({ onLaunch, onAdd, onScene, onStopTrack, onStopAll, onQuantise })) {
    if (typeof fn !== 'function') throw new Error(`createLauncherGrid needs ${name}`)
  }
  const element = document.createElement('div')
  element.className = 'launcher'

  const bar = document.createElement('div')
  bar.className = 'launcher-bar'
  const quantiseLabel = document.createElement('label')
  quantiseLabel.append(Object.assign(document.createElement('span'), { textContent: 'Launch on ' }))
  const quantise = document.createElement('select')
  quantise.id = 'launcher-quantise'
  const QUANTISE_TEXT = { none: 'the press', beat: 'the next beat', bar: 'the next bar', '2bars': 'every 2 bars', '4bars': 'every 4 bars' }
  for (const name of quantiseNames) {
    const option = document.createElement('option')
    option.value = name
    option.textContent = QUANTISE_TEXT[name] ?? name
    quantise.append(option)
  }
  quantise.addEventListener('change', () => onQuantise(quantise.value))
  quantiseLabel.append(quantise)
  const stopAll = document.createElement('button')
  stopAll.type = 'button'
  stopAll.id = 'launcher-stop-all'
  stopAll.textContent = 'Stop all'
  stopAll.addEventListener('click', () => onStopAll())
  bar.append(quantiseLabel, stopAll)

  const grid = document.createElement('div')
  grid.className = 'launcher-grid'
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-label', 'Clip launcher: tracks across, scenes down')
  const empty = document.createElement('p')
  empty.className = 'empty'
  element.append(bar, grid, empty)

  // Cells by their position, for the arrow keys and for in-place updates.
  let cells = []
  let shape = null
  let tracksNow = []
  let scenesNow = 0

  grid.addEventListener('keydown', event => {
    const step = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[event.key]
    if (!step || event.altKey || event.ctrlKey || event.metaKey) return
    const at = event.target.closest?.('button[data-row]')
    if (!at) return
    event.preventDefault()
    const row = Number(at.dataset.row) + step[0]
    const col = Number(at.dataset.col) + step[1]
    cells[row]?.[col]?.focus({ preventScroll: false })
  })

  function cellButton (track, scene, cell, trackIndex) {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = 'launcher-cell'
    button.id = `cell-${track.id}-${scene}`
    button.dataset.row = String(scene)
    button.dataset.col = String(trackIndex)
    button.setAttribute('role', 'gridcell')
    button.addEventListener('click', () => (button.dataset.clip ? onLaunch(button.dataset.clip) : onAdd(track.id, scene)))
    if (onEdit) button.addEventListener('dblclick', () => { if (button.dataset.clip) onEdit(button.dataset.clip) })
    if (menu) {
      attachMenu(button, menu, () => {
        const clip = button.dataset.clip
        if (!clip) return [{ label: 'Add an empty clip', run: () => onAdd(track.id, scene) }]
        return [
          { label: 'Launch', run: () => onLaunch(clip) },
          { label: 'Stop this track', run: () => onStopTrack(track.id) },
          ...(onEdit ? ['-', { label: 'Edit the notes', run: () => onEdit(clip) }] : []),
          ...(onRemove ? [{ label: 'Delete the clip', danger: true, run: () => onRemove(clip) }] : [])
        ]
      })
    }
    return button
  }

  function paint (button, track, scene, cell) {
    const state = cell ? cell.state : 'empty'
    if (cell) button.dataset.clip = cell.clipId; else delete button.dataset.clip
    button.dataset.state = state
    button.textContent = `${MARKS[state]} ${state === 'empty' ? '' : state}`.trim()
    button.setAttribute('aria-label', `${track.label}, scene ${scene + 1}, ${WORDS[state]}`)
  }

  return {
    element,
    /**
     * `tracks` is `[{ id, label }]` for tracks that can play a clip; `cells` maps `${trackId}|${scene}` to `{ clipId, state }`;
     * `scenes` is how many rows to draw (one more than the last used, so there is always an empty row to fill).
     */
    draw ({ tracks, scenes, cells: byKey, quantise: current }) {
      for (const option of quantise.options) option.selected = option.value === current
      empty.hidden = tracks.length > 0
      empty.textContent = tracks.length === 0 ? 'No track has a MIDI input to play a clip into. Load an instrument first.' : ''
      grid.hidden = tracks.length === 0
      stopAll.hidden = tracks.length === 0
      const key = JSON.stringify([tracks.map(t => [t.id, t.label]), scenes, [...byKey].map(([k, v]) => [k, v.clipId])])
      if (key !== shape) {
        const restore = preserveFocus(element)
        shape = key
        tracksNow = tracks
        scenesNow = scenes
        cells = []
        const head = document.createElement('div')
        head.className = 'launcher-row launcher-head'
        head.setAttribute('role', 'row')
        head.append(Object.assign(document.createElement('span'), { className: 'launcher-corner' }))
        for (const track of tracks) {
          const name = document.createElement('span')
          name.className = 'launcher-track'
          name.setAttribute('role', 'columnheader')
          name.textContent = track.label
          head.append(name)
        }
        const rows = [head]
        for (let scene = 0; scene < scenes; scene++) {
          const row = document.createElement('div')
          row.className = 'launcher-row'
          row.setAttribute('role', 'row')
          // A scene with no clip has nothing to launch, so a blank stands where the button would be, and keeps the columns in line.
          if ([...byKey.keys()].some(k => k.endsWith(`|${scene}`))) {
            const go = document.createElement('button')
            go.type = 'button'
            go.className = 'launcher-scene'
            go.id = `scene-${scene}`
            go.textContent = `▶ ${scene + 1}`
            go.setAttribute('aria-label', `Launch scene ${scene + 1}`)
            go.addEventListener('click', () => onScene(scene))
            row.append(go)
          } else {
            row.append(Object.assign(document.createElement('span'), { className: 'launcher-corner' }))
          }
          cells[scene] = tracks.map((track, i) => {
            const button = cellButton(track, scene, byKey.get(`${track.id}|${scene}`), i)
            row.append(button)
            return button
          })
          rows.push(row)
        }
        const stops = document.createElement('div')
        stops.className = 'launcher-row launcher-stops'
        stops.append(Object.assign(document.createElement('span'), { className: 'launcher-corner' }))
        for (const track of tracks) {
          const stop = document.createElement('button')
          stop.type = 'button'
          stop.className = 'launcher-stop'
          stop.id = `stop-${track.id}`
          stop.textContent = '■ Stop'
          stop.setAttribute('aria-label', `Stop ${track.label}`)
          stop.addEventListener('click', () => onStopTrack(track.id))
          stops.append(stop)
        }
        rows.push(stops)
        grid.style.setProperty('--tracks', String(tracks.length))
        grid.replaceChildren(...rows)
        restore()
      }
      tracksNow.forEach((track, i) => {
        for (let scene = 0; scene < scenesNow; scene++) paint(cells[scene][i], track, scene, byKey.get(`${track.id}|${scene}`))
      })
    }
  }
}
