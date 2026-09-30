// src/ui/Timeline.js
//
// The arrangement: a ruler of bars, one lane per track, and the clips on each.
//
// Every clip is a button, so a clip is reachable by Tab and names itself: what
// it is, where it starts, how long it is, and what it holds. The keyboard does
// everything the pointer does:
//
//   Left and Right move a clip by a beat. Shift with them makes it shorter or
//   longer by a beat. Enter opens it. Delete removes it.
//
// A drag moves a clip by whole beats, and a drag on its right edge resizes it.
// Both listen for the move and the release on the document once the pointer
// is down, not on the clip: a drag that stops at the clip's own edge is the
// failure CLAUDE.md names, and it passes every test run without a renderer.
//
// Zoom and snap belong to a TimeView, shared with anything else drawn against
// the same beats. The controls above the lanes (Zoom out, Zoom in, Fit, Snap)
// are built once and outside the lanes, so a redraw never takes the focus off
// one. Plus and minus zoom from the keyboard, Ctrl with the wheel from the
// pointer, and Alt held during a drag bypasses the snap.
//
// The loop is drawn under the ruler as a brace with a handle at each end. A
// handle moves with the pointer or with the arrow keys (one grid step; Shift
// for a bar), and a drag on the empty row draws a new loop and turns it on.
// Whether it is on is said in text, not only by colour. With Follow on, the
// lanes scroll to keep the playhead in view while the transport runs, and
// Follow turns itself off when the person scrolls, since they are looking
// elsewhere.
//
// The lanes scroll inside their own box, so a long arrangement never makes the
// page scroll sideways (CLAUDE.md: no horizontal scrolling). Width is beats
// times a scale, which is what a timeline is; the box it scrolls in is sized
// by the page.

import { createTrackHeader } from './TrackHeader.js'
import { createChainStrip } from './ChainStrip.js'
import { Selection } from '../model/Selection.js'
import { TimeView, DEFAULT_PIXELS_PER_BEAT, GRIDS } from './TimeView.js'

/** CSS pixels per beat at the default zoom. */
export const PIXELS_PER_BEAT = DEFAULT_PIXELS_PER_BEAT

/** Bar and beat, counting from one, as a musician reads a position. */
export function barBeat (beat, beatsPerBar) {
  const bar = Math.floor(beat / beatsPerBar) + 1
  const within = beat - (bar - 1) * beatsPerBar + 1
  return `bar ${bar} beat ${Number.isInteger(within) ? within : within.toFixed(2).replace(/0+$/, '')}`
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/** What a clip says about itself to a screen reader, and on hover. */
export function describeClip (clip, { beatsPerBar, playsIntoNothing = false }) {
  const what = clip.kind === 'midi' ? `MIDI clip, ${plural(clip.notes.length, 'note')}` : 'Audio clip'
  const where = `${barBeat(clip.startBeat, beatsPerBar)}, ${plural(clip.lengthBeats, 'beat')}`
  return `${what}, ${where}${playsIntoNothing ? ', plays into nothing: this track has no MIDI input' : ''}`
}

/**
 * Build a timeline.
 *
 * Handlers, each a request the page sends through the dispatcher:
 * - `onAdd(trackId, startBeat)`: a new MIDI clip.
 * - `onAddAudio(trackId, startBeat)`: a new audio clip, from a file the page
 *   asks the person for.
 * - `onMove(clipId, startBeat)` and `onResize(clipId, lengthBeats)`.
 * - `onOpen(clipId)` and `onRemove(clipId)`.
 * - `onChannel(trackId, change)`: level, pan, mute or solo, the part that changed.
 * - `onArm(trackId, on)`: take MIDI input, or stop.
 * - `onMoveTrack(trackId, delta)`: move a track up (-1) or down (1).
 * - `onSetLoop({ start, end })`: a new loop range in beats, which the page also turns on.
 */
export function createTimeline (document, { onAdd, onAddAudio, onMove, onResize, onOpen, onRemove, onChannel, onSetLoop, onMoveTrack, onArm }, { view = new TimeView(), selection = new Selection() } = {}) {
  for (const [name, fn] of Object.entries({ onAdd, onAddAudio, onMove, onResize, onOpen, onRemove, onChannel, onSetLoop, onMoveTrack, onArm })) {
    if (typeof fn !== 'function') throw new Error(`createTimeline needs ${name}`)
  }
  const element = document.createElement('div')
  element.className = 'timeline'
  const scroller = document.createElement('div')
  scroller.className = 'timeline-scroll'
  // Focusable, so the lanes can be scrolled by keyboard (WCAG 2.1.1).
  scroller.tabIndex = 0
  scroller.setAttribute('role', 'region')
  scroller.setAttribute('aria-label', 'Arrangement, scrolls sideways')
  const tools = document.createElement('div')
  tools.className = 'timeline-tools'
  tools.setAttribute('role', 'group')
  tools.setAttribute('aria-label', 'Timeline zoom and snap')
  const tool = (label, onClick) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.addEventListener('click', onClick)
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
    option.textContent = grid === 'off' ? 'Off' : grid === 'bar' ? 'Bar' : grid === 'beat' ? 'Beat' : `${grid} beat`
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
    element.dataset.routing = on ? 'on' : 'off'
  }
  tools.append(
    tool('Zoom out', () => zoom(1 / 1.5)),
    tool('Zoom in', () => zoom(1.5)),
    tool('Fit', () => fit()),
    followButton, routingButton, zoomStatus, snapLabel)
  element.append(tools, scroller)
  setRouting(true)
  // Where the transport is. Drawn over the lanes, never read: the position
  // readout in the transport bar says the same in words.
  const head = document.createElement('div')
  head.className = 'playhead'
  head.setAttribute('aria-hidden', 'true')
  head.hidden = true

  /**
   * `peaksFor(clip, count)` gives an audio clip's waveform as `count` peaks
   * from 0 to 1, or null while it is not loaded; `unplayable(clip)` gives why
   * an audio clip cannot play, or null.
   */
  let lastArgs = null
  // The scroll position this file last set itself, so its own scrolling is not taken for the person's.
  let programmatic = null
  // Kept for as long as the timeline is: the ruler is rewritten in place and a
  // track's row is reused, so a redraw moves nothing that has not changed.
  const ruler = document.createElement('div')
  ruler.className = 'timeline-ruler'
  ruler.setAttribute('aria-hidden', 'true')
  const rows = new Map()
  const loopRow = document.createElement('div')
  loopRow.className = 'timeline-loop'
  loopRow.setAttribute('role', 'group')
  const brace = document.createElement('div')
  brace.className = 'loop-brace'
  brace.setAttribute('aria-hidden', 'true')
  const braceText = document.createElement('span')
  brace.append(braceText)
  const handle = edge => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `loop-handle loop-${edge}`
    button.id = `loop-${edge}`
    return button
  }
  const startHandle = handle('start')
  const endHandle = handle('end')
  loopRow.append(brace, startHandle, endHandle)
  let loopNow = { start: 0, end: 0, enabled: false }
  const ppb = () => view.pixelsPerBeat
  const bpb = () => lastArgs?.beatsPerBar ?? 4
  const headPx = () => scroller.querySelector('.timeline-head')?.offsetWidth ?? 0

  /** Zoom by `factor`, keeping the beat under `anchorX` (from the lanes' left edge) where it is. */
  function zoom (factor, anchorX = 0) {
    const beat = (scroller.scrollLeft + anchorX) / ppb()
    view.zoomBy(factor)
    scroller.scrollLeft = beat * ppb() - anchorX
    programmatic = scroller.scrollLeft
  }

  function fit () {
    if (!lastArgs) return
    const width = scroller.clientWidth - headPx()
    if (!(width > 0)) return
    const last = Math.max(bpb() * 4, ...lastArgs.clips.map(c => c.startBeat + c.lengthBeats))
    view.fit(last, width)
    scroller.scrollLeft = 0
    programmatic = 0
  }

  // ── The loop ─────────────────────────────────────────────────────────────
  const minLoop = () => view.step(bpb()) ?? 0.25
  const x = e => e.clientX - loopRow.getBoundingClientRect().left
  const snapBeat = (beat, e) => view.snap(beat, bpb(), { bypass: e?.altKey })

  function drawLoop (loop, width) {
    loopNow = loop ?? { start: 0, end: 0, enabled: false }
    const set = loopNow.end > loopNow.start
    loopRow.style.width = `${width}px`
    loopRow.setAttribute('aria-label', set ? `Loop, ${loopNow.enabled ? 'on' : 'off'}` : 'Loop, not set')
    brace.hidden = !set
    startHandle.hidden = !set
    endHandle.hidden = !set
    if (!set) {
      braceText.textContent = ''
      return
    }
    brace.style.left = `${loopNow.start * ppb()}px`
    brace.style.width = `${(loopNow.end - loopNow.start) * ppb()}px`
    brace.classList.toggle('on', loopNow.enabled)
    braceText.textContent = loopNow.enabled ? 'Loop on' : 'Loop off'
    startHandle.style.left = `${loopNow.start * ppb() - 22}px`
    endHandle.style.left = `${loopNow.end * ppb() - 22}px`
    startHandle.setAttribute('aria-label', `Loop start, ${barBeat(loopNow.start, bpb())}. Left and Right move it.`)
    endHandle.setAttribute('aria-label', `Loop end, ${barBeat(loopNow.end, bpb())}. Left and Right move it.`)
  }

  /** Send one range, refusing one that would end at or before its start. */
  function sendLoop (start, end) {
    const lo = Math.max(0, Math.min(start, end))
    const hi = Math.max(start, end)
    if (hi - lo < minLoop() - 1e-9) return
    if (lo === loopNow.start && hi === loopNow.end) return
    onSetLoop({ start: lo, end: hi })
  }

  for (const [edge, button] of [['start', startHandle], ['end', endHandle]]) {
    const other = () => (edge === 'start' ? loopNow.end : loopNow.start)
    const put = beat => (edge === 'start' ? sendLoop(beat, other()) : sendLoop(other(), beat))
    button.addEventListener('keydown', event => {
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (direction === 0) return
      event.preventDefault()
      const step = event.shiftKey ? bpb() : (view.step(bpb()) ?? 1)
      put(Math.max(0, (edge === 'start' ? loopNow.start : loopNow.end) + direction * step))
    })
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      event.preventDefault()
      event.stopPropagation()
      const from = edge === 'start' ? loopNow.start : loopNow.end
      const originX = event.clientX
      const beatAt = e => snapBeat(from + (e.clientX - originX) / ppb(), e)
      const move = e => {
        // Shown while dragging; sent once, on release.
        const beat = beatAt(e)
        const lo = edge === 'start' ? beat : loopNow.start
        const hi = edge === 'start' ? loopNow.end : beat
        if (hi > lo) {
          brace.style.left = `${lo * ppb()}px`
          brace.style.width = `${(hi - lo) * ppb()}px`
          button.style.left = `${beat * ppb() - 22}px`
        }
      }
      const up = e => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        put(beatAt(e))
        drawLoop(loopNow, parseFloat(loopRow.style.width))
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    })
  }

  // A drag on the empty row draws a loop.
  loopRow.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target !== loopRow) return
    event.preventDefault()
    const from = snapBeat(x(event) / ppb(), event)
    const move = e => {
      const to = snapBeat(x(e) / ppb(), e)
      brace.hidden = false
      brace.classList.remove('on')
      brace.style.left = `${Math.min(from, to) * ppb()}px`
      brace.style.width = `${Math.abs(to - from) * ppb()}px`
    }
    const up = e => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      sendLoop(from, snapBeat(x(e) / ppb(), e))
      drawLoop(loopNow, parseFloat(loopRow.style.width))
    }
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
  })

  // A selection changes what is marked, never what is drawn, so the lanes are
  // not rebuilt and the focus stays where it is.
  selection.subscribe(() => {
    for (const button of scroller.querySelectorAll('.clip')) {
      const on = selection.has('clip', button.id.replace(/^clip-/, ''))
      button.classList.toggle('selected', on)
      button.setAttribute('aria-current', String(on))
    }
    for (const chip of scroller.querySelectorAll('.chain-node')) {
      chip.setAttribute('aria-pressed', String(selection.has('node', chip.id.replace(/^chain-/, ''))))
    }
    for (const [id, entry] of rows) {
      const on = selection.has('track', id)
      entry.header.element.classList.toggle('selected', on)
      entry.header.element.querySelector('.show-track')?.setAttribute('aria-pressed', String(on))
    }
  })

  view.subscribe(() => {
    showGrid()
    zoomStatus.textContent = `Zoom ${Math.round(ppb() / DEFAULT_PIXELS_PER_BEAT * 100)}%`
    if (lastArgs) draw(lastArgs)
  })
  scroller.addEventListener('keydown', event => {
    if (event.target !== scroller || event.ctrlKey || event.metaKey || event.altKey) return
    if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.5) }
    else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.5) }
  })
  scroller.addEventListener('wheel', event => {
    if (!event.ctrlKey) return
    event.preventDefault()
    const rect = scroller.getBoundingClientRect()
    zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, event.clientX - rect.left - headPx())
  }, { passive: false })

  function draw (args) {
    lastArgs = args
    // How much of the lanes is on screen, for anything that must wrap inside it.
    scroller.style.setProperty('--view', `${scroller.clientWidth}px`)
    const {
      tracks, clips, beatsPerBar, labelFor, playsIntoNothing, peaksFor = () => null, unplayable = () => null,
      mixable = () => true, silent = () => false, loop = null,
      layoutFor = () => ({ color: null, laneSize: 'medium' }),
      latencyFor = () => null,
      chainFor = () => ({ nodes: [] }),
      canArm = () => false, armed = () => false, routingFor = () => null,
      empty: emptyState = { text: 'No tracks yet. Load a plugin and its track appears here.', actions: [] }
    } = args
    const lastBeat = Math.max(0, ...clips.map(c => c.startBeat + c.lengthBeats))
    // Room for a few bars past the last clip, so there is always somewhere to put the next.
    const bars = Math.ceil(lastBeat / beatsPerBar) + 4
    const width = bars * beatsPerBar * ppb()

    ruler.replaceChildren()
    ruler.style.width = `${width}px`
    // A label every few bars once a bar is too narrow to hold one, so zoomed out
    // the numbers stay readable rather than running together.
    const every = Math.max(1, Math.ceil(40 / (beatsPerBar * ppb())))
    for (let bar = 0; bar < bars; bar += every) {
      const mark = document.createElement('span')
      mark.style.left = `${bar * beatsPerBar * ppb()}px`
      mark.textContent = String(bar + 1)
      ruler.append(mark)
    }
    if (ppb() >= 12) {
      for (let beat = 0; beat < bars * beatsPerBar; beat++) {
        if (beat % beatsPerBar === 0) continue
        const tick = document.createElement('i')
        tick.style.left = `${beat * ppb()}px`
        ruler.append(tick)
      }
    }

    if (tracks.length === 0) {
      rows.clear()
      const empty = document.createElement('div')
      empty.className = 'empty'
      const text = document.createElement('p')
      text.textContent = emptyState.text
      empty.append(text)
      // Real actions, each the same request the page makes elsewhere.
      for (const action of emptyState.actions) {
        const button = document.createElement('button')
        button.type = 'button'
        button.textContent = action.label
        button.addEventListener('click', () => action.run())
        empty.append(button)
      }
      drawLoop(loop, width)
      scroller.replaceChildren(head, ruler, loopRow, empty)
      return
    }

    // A row is kept for as long as its track is, and only its lane is redrawn.
    // The header holds sliders, and a slider dragged while it is taken out of
    // the document loses the pointer (src/ui/TrackHeader.js).
    for (const id of [...rows.keys()]) if (!tracks.some(t => t.id === id)) rows.delete(id)
    const wanted = tracks.map(track => {
      const label = labelFor(track)
      let entry = rows.get(track.id)
      if (!entry) {
        const row = document.createElement('div')
        row.className = 'timeline-row'
        row.setAttribute('role', 'group')
        const header = createTrackHeader(document, {
          id: track.id, onAdd, onAddAudio, onChannel, onMove: onMoveTrack, onArm,
          onSelect: (id, { toggle }) => (toggle ? selection.toggle('track', id) : selection.set('track', [id]))
        })
        const lane = document.createElement('div')
        lane.className = 'timeline-lane'
        // The header and lane sit side by side; the chain strip is under both.
        const body = document.createElement('div')
        body.className = 'timeline-body'
        body.append(header.element, lane)
        const strip = createChainStrip(document, { onSelect: id => selection.set('node', [id]) })
        row.append(body, strip.element)
        entry = { row, header, lane, strip }
        rows.set(track.id, entry)
      }
      const own = clips.filter(c => c.track === track.id)
      const end = Math.max(0, ...own.map(c => c.startBeat + c.lengthBeats))
      // After the last clip, rounded up to a bar, so a new clip never covers one.
      const at = Math.ceil(end / beatsPerBar) * beatsPerBar
      entry.row.setAttribute('aria-label', `Track ${label}`)
      const layout = layoutFor(track)
      entry.row.dataset.size = layout.laneSize
      if (layout.color) entry.row.style.setProperty('--track-color', layout.color); else entry.row.style.removeProperty('--track-color')
      entry.header.update({
        label, channel: track.channel ?? {}, mixable: mixable(track), silent: silent(track), at, where: barBeat(at, beatsPerBar), selected: selection.has('track', track.id),
        color: layout.color, size: layout.laneSize, latency: latencyFor(track), canArm: canArm(track), armed: armed(track), routing: routingFor(track)
      })
      entry.strip.update(chainFor(track), { label, selected: selection.kind === 'node' ? selection.ids[0] : null })
      entry.lane.style.width = `${width}px`
      entry.lane.style.backgroundSize = `${beatsPerBar * ppb()}px 100%`
      entry.lane.replaceChildren(...own.map(clip => clipButton(clip, {
        beatsPerBar,
        playsIntoNothing: clip.kind === 'midi' && playsIntoNothing(track),
        peaks: clip.kind === 'audio' ? peaksFor(clip, Math.max(1, Math.round(clip.lengthBeats * ppb() / 3))) : null,
        problem: clip.kind === 'audio' ? unplayable(clip) : null
      })))
      return entry.row
    })
    // Only when the list differs, so a redraw that changes no track's place
    // moves nothing (and so drops no focus).
    const current = [...scroller.children]
    drawLoop(loop, width)
    const expected = [head, ruler, loopRow, ...wanted]
    const same = current.length === expected.length && current.every((child, k) => child === expected[k])
    if (!same) scroller.replaceChildren(...expected)
  }

  function clipButton (clip, { beatsPerBar, playsIntoNothing, peaks, problem }) {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = `clip-${clip.id}`
    button.className = `clip clip-${clip.kind}${playsIntoNothing ? ' clip-orphan' : ''}`
    button.style.left = `${clip.startBeat * ppb()}px`
    button.style.width = `${clip.lengthBeats * ppb()}px`
    const description = describeClip(clip, { beatsPerBar, playsIntoNothing }) + (problem ? `, cannot play: ${problem}` : '')
    button.setAttribute('aria-label', description)
    button.title = description
    // Shown as well as said: a clip that plays into nothing, or cannot play,
    // is marked in text, not only by a colour.
    button.textContent = clip.kind === 'midi' ? `${clip.notes.length}♪${playsIntoNothing ? ' !' : ''}` : `∿${problem ? ' !' : ''}`
    if (problem) button.classList.add('clip-orphan')
    if (peaks) button.append(waveform(peaks))

    button.addEventListener('keydown', event => {
      const direction = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (direction !== 0) {
        event.preventDefault()
        // One grid step, or a beat when snapping is off: an arrow key that moved
        // by nothing would do nothing.
        const step = direction * (view.step(beatsPerBar) ?? 1)
        if (event.shiftKey) {
          const length = clip.lengthBeats + step
          if (length > 0) onResize(clip.id, length)
        } else {
          const start = clip.startBeat + step
          if (start >= 0) onMove(clip.id, start)
        }
      } else if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        onRemove(clip.id)
      }
    })
    button.addEventListener('click', event => {
      if (dragged) return
      // Shift or Ctrl adds to the selection; a plain click selects and opens.
      if (event.shiftKey || event.ctrlKey || event.metaKey) { selection.toggle('clip', clip.id); return }
      selection.set('clip', [clip.id])
      onOpen(clip.id)
    })
    const selected = selection.has('clip', clip.id)
    button.classList.toggle('selected', selected)
    button.setAttribute('aria-current', String(selected))

    const handle = document.createElement('span')
    handle.className = 'clip-resize'
    handle.setAttribute('aria-hidden', 'true')
    button.append(handle)

    let dragged = false
    button.addEventListener('pointerdown', event => {
      if (event.button !== 0) return
      const resizing = event.target === handle
      const originX = event.clientX
      dragged = false
      // Where the clip's edge lands: the pointer's movement in beats, on the
      // grid unless Alt is held. `min` is the shortest a clip may be.
      const step = view.step(beatsPerBar)
      const min = step ?? 0.25
      const target = e => {
        const at = (resizing ? clip.startBeat + clip.lengthBeats : clip.startBeat) + (e.clientX - originX) / ppb()
        return view.snap(at, beatsPerBar, { bypass: e.altKey })
      }
      const place = e => (resizing
        ? { length: Math.max(min, target(e) - clip.startBeat) }
        : { start: Math.max(0, target(e)) })
      const move = e => {
        const to = place(e)
        // A drag only once the clip has actually moved, so a click with a little jitter still opens it.
        if (resizing ? to.length !== clip.lengthBeats : to.start !== clip.startBeat) dragged = true
        // Shown while dragging; sent once, on release.
        if (resizing) button.style.width = `${to.length * ppb()}px`
        else button.style.left = `${to.start * ppb()}px`
      }
      const up = e => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        const to = place(e)
        if (resizing) { if (to.length !== clip.lengthBeats) onResize(clip.id, to.length) } else if (to.start !== clip.startBeat) onMove(clip.id, to.start)
      }
      document.addEventListener('pointermove', move)
      document.addEventListener('pointerup', up)
    })
    return button
  }

  /** A waveform, drawn and not read: the clip's own label says what it is. */
  function waveform (peaks) {
    const ns = 'http://www.w3.org/2000/svg'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('class', 'clip-wave')
    svg.setAttribute('aria-hidden', 'true')
    svg.setAttribute('viewBox', `0 -1 ${peaks.length} 2`)
    svg.setAttribute('preserveAspectRatio', 'none')
    const path = document.createElementNS(ns, 'path')
    let d = ''
    for (let i = 0; i < peaks.length; i++) d += `M${i + 0.5} ${-peaks[i]}V${peaks[i]}`
    path.setAttribute('d', d)
    svg.append(path)
    return svg
  }

  /** Show the transport at `beat`, or nothing for null. */
  function playhead (beat) {
    head.hidden = beat === null
    if (beat === null) return
    head.style.left = `calc(var(--head) + ${beat * ppb()}px)`
    if (!follow) return
    // Page-flip: when the head leaves the visible lanes, bring it back a
    // little in from the left, rather than nudging every frame.
    const visible = scroller.clientWidth - headPx()
    const x = beat * ppb()
    if (visible > 0 && (x < scroller.scrollLeft || x > scroller.scrollLeft + visible)) {
      scroller.scrollLeft = Math.max(0, x - visible * 0.15)
      programmatic = scroller.scrollLeft
    }
  }
  // Scrolling that this file did not do is the person looking elsewhere.
  scroller.addEventListener('scroll', () => {
    if (follow && !head.hidden && (programmatic === null || Math.abs(scroller.scrollLeft - programmatic) > 1)) setFollow(false)
    programmatic = null
  })

  return { element, draw, playhead }
}
