// src/ui/Timeline.js
//
// The arrangement: a ruler of bars, one lane per track, and the clips on each.
//
// Every clip is a button, so a clip is reachable by Tab and names itself: what
// it is, where it starts, how long it is, and what it holds. The keyboard does
// everything the pointer does:
//
//   Left and Right move a clip by a beat. Shift with them makes it shorter or
//   longer by a beat. Enter opens it. Delete removes it. S cuts it in two at
//   the playhead, D puts a copy straight after it, M mutes or unmutes it, L locks or unlocks it, [ and ] trim its start or its end to the playhead, and Ctrl+C and Ctrl+X copy or cut
//   the clip (or the selected clips) and Ctrl+V pastes at the playhead.
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
import { createEnvelopeLanes } from './EnvelopeLanes.js'
import { createMasterRow } from './MasterRow.js'
import { createFolderBar } from './FolderBar.js'
import { createLoopRow } from './LoopRow.js'
import { createRuler } from './Ruler.js'
import { createTimelineTools } from './TimelineTools.js'
import { Selection } from '../model/Selection.js'
import { barBeat, describeClip } from './ClipText.js'
import { createClipButton } from './ClipButton.js'
import { TimeView, DEFAULT_PIXELS_PER_BEAT } from './TimeView.js'
import { DEFAULT_LANE_SIZE } from '../model/EditorState.js'

// The text a clip says about itself is ClipText.js and the clip itself is ClipButton.js; both are re-exported here so
// callers keep one front door.
export { barBeat, describeClip }

/** CSS pixels per beat at the default zoom. */
export const PIXELS_PER_BEAT = DEFAULT_PIXELS_PER_BEAT

/**
 * Build a timeline.
 *
 * Handlers, each a request the page sends through the dispatcher:
 * - `onAdd(trackId, startBeat)`: a new MIDI clip.
 * - `onAddAudio(trackId, startBeat)`: a new audio clip, from a file the page
 *   asks the person for.
 * - `onMove(clipId, startBeat)` and `onResize(clipId, lengthBeats)`.
 * - `onOpen(clipId)` and `onRemove(clipId)`.
 * - `onSplit(clipId)` and `onDuplicate(clipId)`: the page knows the playhead.
 * - `onLock(clipId, locked)`: protect a clip from being moved, edited or deleted.
 * - `onMute(clipId, muted)`: keep a clip on the lane but do not play it.
 * - `onCopy(clipId)`, `onCut(clipId)` and `onPaste(clipId)`: Ctrl or Cmd with C, X and V; the page holds the clipboard.
 * - `onAutomateMaster(kind)`: add a lane for the master's 'masterGain' or 'masterPan'.
 * - `onEnvelope(envelopeId, points)` and `onRemoveEnvelope(envelopeId)`: an automation lane edited, or taken away.
 * - `onMoveInChain(nodeId, delta)`: move a plugin one place earlier (-1) or later (1) in its audio chain.
 * - `onBypass(nodeId, bypassed)`: take a plugin out of the signal, or put it back.
 * - `onTrim(clipId, edge)`: shorten a clip to the playhead, from its 'start' or its 'end'.
 * - `onChannel(trackId, change)`: level, pan, mute or solo, the part that changed.
 * - `onArm(trackId, on)`: take MIDI input, or stop.
 * - `onMoveTrack(trackId, delta)`: move a track up (-1) or down (1).
 * - `onFolderCollapse(folderName, collapsed)`: hide or show every track of a folder. Whether a folder is hidden is read
 *   back from each track's layout (`folderCollapsed`), so it is the caller's to keep and save.
 * - `onAddTrack()`: add an empty track. Optional: without it the toolbar has no Add track.
 * - `onDuplicateTrack(trackId)`: copy a track with its plugins. Optional: without it a track has no Duplicate button.
 * - `onSetLoop({ start, end })`: a new loop range in beats, which the page also turns on.
 */
export function createTimeline (document, { onAdd, onAddAudio, onMove, onResize, onOpen, onRemove, onSplit, onDuplicate, onBypass, onMoveInChain, onEnvelope, onRemoveEnvelope, onAutomateMaster, onMute, onTrim, onCopy, onCut, onPaste, onLock, onChannel, onSetLoop, onMoveTrack, onFolderCollapse, onArm, onSeek = null, onReplace = null, onDuplicateTrack = null, onAddTrack = null, onExpandTrack = null, onSizeStep = null }, { view = new TimeView(), selection = new Selection() } = {}) {
  for (const [name, fn] of Object.entries({ onAdd, onAddAudio, onMove, onResize, onOpen, onRemove, onSplit, onDuplicate, onBypass, onMoveInChain, onEnvelope, onRemoveEnvelope, onAutomateMaster, onMute, onTrim, onCopy, onPaste, onChannel, onSetLoop, onMoveTrack, onFolderCollapse, onArm })) {
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
  const tools = createTimelineTools(document, {
    view, onSeek, onAddTrack, bpb: () => bpb(), zoom: factor => zoom(factor), fit: () => fit(),
    onRouting: on => { element.dataset.routing = on ? 'on' : 'off' }
  })
  element.append(tools.element, scroller)
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
  const ruler = createRuler(document, { ppb: () => ppb(), onSeek: onSeek && (beat => onSeek(beat)), snapBeat: (beat, e) => snapBeat(beat, e) })
  const rows = new Map()
  // The master's own row after the tracks: its automation lanes and the way to add one.
  const masterRow = createMasterRow(document, { onChange: onEnvelope, onRemove: onRemoveEnvelope, onAutomate: onAutomateMaster, view })
  const ppb = () => view.pixelsPerBeat
  const bpb = () => lastArgs?.beatsPerBar ?? 4
  const snapBeat = (beat, e) => view.snap(beat, bpb(), { bypass: e?.altKey })
  const loopRow = createLoopRow(document, { view, bpb, onSetLoop, snapBeat })
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
    tools.sync()
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

  const clipButton = createClipButton(document, { ppb, view, selection, onMove, onResize, onOpen, onRemove, onSplit, onDuplicate, onMute, onCopy, onCut, onPaste, onLock, onTrim })

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
   * Move a whole run of folder tracks one place: the track past the run hops over it, so the run keeps its order. One
   * layout change, so no undo, like moving a single track.
   */
  function moveFolder (key, delta) {
    const bar = folderBars.get(key)
    if (!bar) return
    const first = bar.firstTrack
    if (delta < 0) onMoveTrack(bar.neighbours.up, bar.runLength)
    else onMoveTrack(bar.neighbours.down, -bar.runLength)
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
    for (const id of run) rows.get(id)?.row.classList.add('dragging')
    const clear = () => {
      document.removeEventListener('pointermove', over)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', clear)
      for (const { row } of rows.values()) row.classList.remove('dragging', 'drop-target')
    }
    function over (e) {
      const hit = e.target?.closest?.('.timeline-row')?.dataset.track
      if (!hit || hit === target || run.includes(hit) || !rows.has(hit)) return
      if (target) rows.get(target)?.row.classList.remove('drop-target')
      target = hit
      rows.get(target).row.classList.add('drop-target')
    }
    function up () {
      clear()
      if (target) {
        const order = lastArgs.tracks.map(t => t.id)
        const at = order.indexOf(run[0])
        const to = order.indexOf(target)
        if (to < at) for (let k = at - 1; k >= to; k--) onMoveTrack(order[k], run.length)
        else for (let k = at + run.length; k <= to; k++) onMoveTrack(order[k], -run.length)
      }
      const moved = [...folderBars.values()].find(b => b.firstTrack === first)
      moved?.element.querySelector('.folder-toggle')?.focus()
    }
    document.addEventListener('pointermove', over)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', clear)
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
    rowOf(id)?.classList.add('dragging')
    const clear = () => {
      document.removeEventListener('pointermove', over)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', cancel)
      for (const { row } of rows.values()) row.classList.remove('dragging', 'drop-target')
    }
    function over (e) {
      const hit = e.target?.closest?.('.timeline-row')?.dataset.track
      if (!hit || hit === target || !rows.has(hit)) return
      rowOf(target)?.classList.remove('drop-target')
      target = hit
      if (target !== id) rowOf(target).classList.add('drop-target')
    }
    function up () {
      clear()
      const order = lastArgs.tracks.map(t => t.id)
      const delta = order.indexOf(target) - order.indexOf(id)
      if (delta !== 0) onMoveTrack(id, delta)
      document.getElementById(`show-track-${id}`)?.focus()
    }
    function cancel () { clear() }
    document.addEventListener('pointermove', over)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', cancel)
  }

  function draw (args) {
    lastArgs = args
    // How much of the lanes is on screen, for anything that must wrap inside it.
    scroller.style.setProperty('--view', `${scroller.clientWidth}px`)
    const {
      tracks, clips, beatsPerBar, labelFor, playsIntoNothing, peaksFor = () => null, unplayable = () => null,
      mixable = () => true, silent = () => false, loop = null, lanesFor = () => [], masterFor = () => ({ list: [], available: [] }),
      layoutFor = () => ({ color: null, laneSize: DEFAULT_LANE_SIZE }),
      colorFor = () => null,
      latencyFor = () => null,
      chainFor = () => ({ nodes: [] }),
      kindFor = () => null, canArm = () => false, armed = () => false, routingFor = () => null,
      empty: emptyState = { text: 'No tracks yet. Load a plugin and its track appears here.', actions: [] }
    } = args
    const lastBeat = Math.max(0, ...clips.map(c => c.startBeat + c.lengthBeats))
    // Room for a few bars past the last clip, so there is always somewhere to put the next.
    const bars = Math.ceil(lastBeat / beatsPerBar) + 4
    const width = bars * beatsPerBar * ppb()

    ruler.draw({ bars, beatsPerBar, width })

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
      loopRow.draw(loop, width)
      scroller.replaceChildren(head, ruler.element, loopRow.element, empty)
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
        row.dataset.track = track.id
        row.setAttribute('role', 'group')
        const header = createTrackHeader(document, {
          id: track.id, onAdd, onAddAudio, onChannel, onMove: onMoveTrack, onArm, onDuplicateTrack, onGrip: dragTrack, onExpand: onExpandTrack, onSizeStep,
          onSelect: (id, { toggle }) => (toggle ? selection.toggle('track', id) : selection.set('track', [id]))
        })
        const lane = document.createElement('div')
        lane.className = 'timeline-lane'
        // The header and lane sit side by side; the chain strip is under both.
        const body = document.createElement('div')
        body.className = 'timeline-body'
        body.append(header.element, lane)
        const strip = createChainStrip(document, { onSelect: id => selection.set('node', [id]), onBypass, onMove: onMoveInChain, onReplace })
        const automation = createEnvelopeLanes(document, { onChange: onEnvelope, onRemove: onRemoveEnvelope, view })
        row.append(body, automation.element, strip.element)
        entry = { row, header, lane, strip, automation }
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
        color: layout.color, size: layout.laneSize, latency: latencyFor(track), kind: kindFor(track), canArm: canArm(track), armed: armed(track), routing: routingFor(track)
      })
      entry.strip.update(chainFor(track), { label, selected: selection.kind === 'node' ? selection.ids[0] : null })
      entry.automation.update(lanesFor(track), { beatsPerBar, width })
      entry.lane.style.width = `${width}px`
      entry.lane.style.backgroundSize = `${beatsPerBar * ppb()}px 100%`
      entry.lane.replaceChildren(...own.map(clip => clipButton(clip, {
        beatsPerBar,
        playsIntoNothing: clip.kind === 'midi' && playsIntoNothing(track),
        color: colorFor(clip),
        peaks: clip.kind === 'audio' ? peaksFor(clip, Math.max(1, Math.round(clip.lengthBeats * ppb() / 3))) : null,
        problem: clip.kind === 'audio' ? unplayable(clip) : null
      })))
      return entry.row
    })
    // Only when the list differs, so a redraw that changes no track's place
    // moves nothing (and so drops no focus).
    const current = [...scroller.children]
    loopRow.draw(loop, width)
    masterRow.update(masterFor(), { beatsPerBar, width })
    const expected = [head, ruler.element, loopRow.element, ...withFolders(tracks, wanted, layoutFor), masterRow.element]
    const same = current.length === expected.length && current.every((child, k) => child === expected[k])
    if (!same) scroller.replaceChildren(...expected)
    // The playhead is as tall as everything that scrolls, not as the box it is seen through: the box is shorter than the
    // lanes now, and a head the height of the box would scroll away with the first track.
    head.style.height = `${scroller.scrollHeight}px`
  }

  /** Show the transport at `beat`, or nothing for null. */
  function playhead (beat) {
    head.hidden = beat === null
    if (beat === null) return
    head.style.left = `calc(var(--head) + ${beat * ppb()}px)`
    if (!tools.following()) return
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
    if (tools.following() && !head.hidden && (programmatic === null || Math.abs(scroller.scrollLeft - programmatic) > 1)) tools.setFollow(false)
    programmatic = null
  })

  // The view is handed back so the page can snap a cut to the same grid a drag snaps to.
  return { element, draw, playhead, view }
}
