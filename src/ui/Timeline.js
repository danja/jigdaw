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
// The lanes scroll inside their own box, so a long arrangement never makes the
// page scroll sideways (CLAUDE.md: no horizontal scrolling). Width is beats
// times a scale, which is what a timeline is; the box it scrolls in is sized
// by the page.

/** CSS pixels per beat. A timeline is drawn to a scale; this is it. */
export const PIXELS_PER_BEAT = 24

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
 * - `onShowTrack(trackId)`: go to the track's plugins, from its name.
 */
export function createTimeline (document, { onAdd, onAddAudio, onMove, onResize, onOpen, onRemove, onShowTrack }) {
  for (const [name, fn] of Object.entries({ onAdd, onAddAudio, onMove, onResize, onOpen, onRemove, onShowTrack })) {
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
  element.append(scroller)
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
  function draw ({ tracks, clips, beatsPerBar, labelFor, playsIntoNothing, peaksFor = () => null, unplayable = () => null }) {
    scroller.textContent = ''
    scroller.append(head)
    const lastBeat = Math.max(0, ...clips.map(c => c.startBeat + c.lengthBeats))
    // Room for a few bars past the last clip, so there is always somewhere to put the next.
    const bars = Math.ceil(lastBeat / beatsPerBar) + 4
    const width = bars * beatsPerBar * PIXELS_PER_BEAT

    const ruler = document.createElement('div')
    ruler.className = 'timeline-ruler'
    ruler.setAttribute('aria-hidden', 'true')
    ruler.style.width = `${width}px`
    for (let bar = 0; bar < bars; bar++) {
      const mark = document.createElement('span')
      mark.style.left = `${bar * beatsPerBar * PIXELS_PER_BEAT}px`
      mark.textContent = String(bar + 1)
      ruler.append(mark)
    }
    scroller.append(ruler)

    if (tracks.length === 0) {
      const empty = document.createElement('p')
      empty.className = 'empty'
      empty.textContent = 'No tracks yet. Load a plugin and its track appears here.'
      scroller.append(empty)
      return
    }

    for (const track of tracks) {
      const label = labelFor(track)
      const row = document.createElement('div')
      row.className = 'timeline-row'
      row.setAttribute('role', 'group')
      row.setAttribute('aria-label', `Track ${label}`)

      const head = document.createElement('div')
      head.className = 'timeline-head'
      // The track's name, which leads to its plugins: a link in what it does,
      // a button in how it is built, because it acts on this page.
      const name = document.createElement('button')
      name.type = 'button'
      name.className = 'show-track'
      name.id = `show-track-${track.id}`
      name.textContent = label
      name.setAttribute('aria-label', `${label}: show its plugins`)
      name.addEventListener('click', () => onShowTrack(track.id))
      const own = clips.filter(c => c.track === track.id)
      const end = Math.max(0, ...own.map(c => c.startBeat + c.lengthBeats))
      // After the last clip, rounded up to a bar, so a new clip never covers one.
      const at = Math.ceil(end / beatsPerBar) * beatsPerBar
      const add = document.createElement('button')
      add.type = 'button'
      add.id = `add-clip-${track.id}`
      add.textContent = 'Add clip'
      add.setAttribute('aria-label', `Add a MIDI clip to ${label} at ${barBeat(at, beatsPerBar)}`)
      add.addEventListener('click', () => onAdd(track.id, at))
      const addAudio = document.createElement('button')
      addAudio.type = 'button'
      addAudio.id = `add-audio-${track.id}`
      addAudio.textContent = 'Add audio'
      addAudio.setAttribute('aria-label', `Add an audio file to ${label} at ${barBeat(at, beatsPerBar)}`)
      addAudio.addEventListener('click', () => onAddAudio(track.id, at))
      head.append(name, add, addAudio)

      const lane = document.createElement('div')
      lane.className = 'timeline-lane'
      lane.style.width = `${width}px`
      lane.style.backgroundSize = `${beatsPerBar * PIXELS_PER_BEAT}px 100%`
      for (const clip of own) {
        lane.append(clipButton(clip, {
          beatsPerBar,
          playsIntoNothing: clip.kind === 'midi' && playsIntoNothing(track),
          peaks: clip.kind === 'audio' ? peaksFor(clip, Math.max(1, Math.round(clip.lengthBeats * PIXELS_PER_BEAT / 3))) : null,
          problem: clip.kind === 'audio' ? unplayable(clip) : null
        }))
      }

      row.append(head, lane)
      scroller.append(row)
    }
  }

  function clipButton (clip, { beatsPerBar, playsIntoNothing, peaks, problem }) {
    const button = document.createElement('button')
    button.type = 'button'
    button.id = `clip-${clip.id}`
    button.className = `clip clip-${clip.kind}${playsIntoNothing ? ' clip-orphan' : ''}`
    button.style.left = `${clip.startBeat * PIXELS_PER_BEAT}px`
    button.style.width = `${clip.lengthBeats * PIXELS_PER_BEAT}px`
    const description = describeClip(clip, { beatsPerBar, playsIntoNothing }) + (problem ? `, cannot play: ${problem}` : '')
    button.setAttribute('aria-label', description)
    button.title = description
    // Shown as well as said: a clip that plays into nothing, or cannot play,
    // is marked in text, not only by a colour.
    button.textContent = clip.kind === 'midi' ? `${clip.notes.length}♪${playsIntoNothing ? ' !' : ''}` : `∿${problem ? ' !' : ''}`
    if (problem) button.classList.add('clip-orphan')
    if (peaks) button.append(waveform(peaks))

    button.addEventListener('keydown', event => {
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0
      if (step !== 0) {
        event.preventDefault()
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
    button.addEventListener('click', () => { if (!dragged) onOpen(clip.id) })

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
      const beatsMoved = e => Math.round((e.clientX - originX) / PIXELS_PER_BEAT)
      const move = e => {
        const beats = beatsMoved(e)
        if (beats !== 0) dragged = true
        // Shown while dragging; sent once, on release.
        if (resizing) button.style.width = `${Math.max(1, clip.lengthBeats + beats) * PIXELS_PER_BEAT}px`
        else button.style.left = `${Math.max(0, clip.startBeat + beats) * PIXELS_PER_BEAT}px`
      }
      const up = e => {
        document.removeEventListener('pointermove', move)
        document.removeEventListener('pointerup', up)
        const beats = beatsMoved(e)
        if (beats === 0) return
        if (resizing) onResize(clip.id, Math.max(1, clip.lengthBeats + beats))
        else onMove(clip.id, Math.max(0, clip.startBeat + beats))
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
    if (beat !== null) head.style.left = `calc(var(--head) + ${beat * PIXELS_PER_BEAT}px)`
  }

  return { element, draw, playhead }
}
