// src/ui/TimelineTools.js
//
// The controls above the lanes: Zoom out, Zoom in, Fit, Follow, Routing, the zoom
// read-out, Snap and Go to bar. They are built once and sit outside the lanes, so a
// redraw never takes the focus off one. Follow and Routing say whether they are on
// with aria-pressed, never by colour alone.

import { setIcon } from './Icons.js'
import { GRIDS, DEFAULT_PIXELS_PER_BEAT } from './TimeView.js'

const GRID_LABELS = { off: 'Off', bar: 'Bar', beat: 'Beat' }

/**
 * `zoom(factor)` and `fit()` act on the lanes, which this module does not know.
 * `onRouting(on)` is told when the chain strips are shown or hidden, and once at
 * the start. `onSeek(beat)` is null when the page cannot seek, and then there is
 * no Go to bar. `onAddTrack()` likewise leaves out Add track, and `onLoops()` Loops, which opens the loop library.
 */
export function createTimelineTools (document, { view, bpb, zoom, fit, onSeek = null, onAddTrack = null, onLoops = null, onRouting }) {
  const element = document.createElement('div')
  element.className = 'timeline-tools'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', 'Timeline zoom and snap')
  const tool = (label, onClick) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', onClick)
    return button
  }
  const iconTool = (icon, label, onClick) => {
    const button = tool(label, onClick)
    setIcon(document, button, icon, label)
    return button
  }
  const zoomStatus = document.createElement('span')
  zoomStatus.className = 'timeline-zoom'
  zoomStatus.setAttribute('role', 'status')
  zoomStatus.textContent = 'Zoom 100%'
  const snapLabel = document.createElement('label')
  snapLabel.textContent = 'Snap '
  const snapSelect = document.createElement('select')
  for (const grid of GRIDS) {
    const option = document.createElement('option')
    option.value = grid
    option.textContent = GRID_LABELS[grid] ?? `${grid} beat`
    snapSelect.append(option)
  }
  const showGrid = () => { for (const option of snapSelect.options) option.selected = option.value === view.grid }
  showGrid()
  snapSelect.addEventListener('change', () => view.setGrid(snapSelect.value))
  snapLabel.append(snapSelect)
  let follow = true
  const followButton = tool('Follow', () => setFollow(!follow))
  const setFollow = on => {
    follow = on
    followButton.setAttribute('aria-pressed', String(on))
  }
  setFollow(true)
  // Whether each track's chain of plugins is drawn under its lane.
  let routing = true
  const routingButton = tool('Routing', () => setRouting(!routing))
  const setRouting = on => {
    routing = on
    routingButton.setAttribute('aria-pressed', String(on))
    onRouting(on)
  }
  // The keyboard and screen reader route to the same seek the ruler click makes; bars count from one.
  const seekLabel = document.createElement('label')
  seekLabel.textContent = 'Go to bar '
  const seekInput = document.createElement('input')
  seekInput.type = 'number'
  seekInput.min = '1'
  seekInput.step = '1'
  seekInput.value = '1'
  seekInput.addEventListener('change', () => {
    const bar = Math.floor(Number(seekInput.value))
    if (!Number.isFinite(bar) || bar < 1) { seekInput.value = '1'; return }
    onSeek((bar - 1) * bpb())
  })
  seekLabel.append(seekInput)
  element.append(
    iconTool('zoomOut', 'Zoom out', () => zoom(1 / 1.5)),
    iconTool('zoomIn', 'Zoom in', () => zoom(1.5)),
    tool('Fit', () => fit()),
    ...(onAddTrack ? [tool('Add track', () => onAddTrack())] : []),
    ...(onLoops ? [tool('Loops', () => onLoops())] : []),
    followButton, routingButton, zoomStatus, snapLabel, ...(onSeek ? [seekLabel] : []))
  setRouting(true)

  return {
    element,
    following: () => follow,
    setFollow,
    /** Show the view's grid and zoom in the controls, after either has changed. */
    sync () {
      showGrid()
      zoomStatus.textContent = `Zoom ${Math.round(view.pixelsPerBeat / DEFAULT_PIXELS_PER_BEAT * 100)}%`
    }
  }
}
