// src/ui/TrackHeader.js
//
// The left edge of a track's lane: its name (which selects the track), mute and solo, level and pan, and
// the buttons that add a clip. The same channel a mixer strip edits, drawn
// small enough to sit beside the clips it belongs to.
//
// Built once per track and updated in place, never rebuilt. A slider dragged
// while its element is taken out of the document loses the pointer, and every
// edit redraws the arrangement; so the timeline keeps this element and only
// changes what it says (src/ui/Mixer.js keeps its strips for the same reason).
//
// Level, pan, mute and solo are left out for a track that has nothing to hear:
// four controls that move and change nothing are worse than none (CLAUDE.md).
import { createChannelToggle } from './ChannelToggle.js'
import { decibels, panPosition } from './Strip.js'
import { TRACK_KIND_LABELS } from '../model/TrackKind.js'
import { DEFAULT_LANE_SIZE } from '../model/EditorState.js'

export function createTrackHeader (document, { id, onSelect, onAdd, onAddAudio, onChannel, onMove, onArm, onDuplicateTrack = null, onGrip = null, onExpand = null, onSizeStep = null }) {
  for (const [name, fn] of Object.entries({ onSelect, onAdd, onAddAudio, onChannel, onMove, onArm })) {
    if (typeof fn !== 'function') throw new Error(`createTrackHeader needs ${name}`)
  }
  const element = document.createElement('div')
  element.className = 'timeline-head'

  const name = document.createElement('button')
  name.type = 'button'
  name.className = 'show-track'
  name.id = `show-track-${id}`
  name.addEventListener('click', event => onSelect(id, { toggle: Boolean(event.shiftKey || event.ctrlKey || event.metaKey) }))

  // Alt with Up or Down moves the track, so reordering does not need the pointer.
  name.addEventListener('keydown', event => {
    if (!event.altKey || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown')) return
    event.preventDefault()
    onMove(id, event.key === 'ArrowUp' ? -1 : 1)
  })
  // Plus and minus make the lane one size taller or shorter, so resizing does not need the pointer or the dock.
  name.addEventListener('keydown', event => {
    if (!onSizeStep || event.altKey || event.ctrlKey || event.metaKey) return
    const by = event.key === '+' || event.key === '=' ? 1 : event.key === '-' || event.key === '_' ? -1 : 0
    if (by === 0) return
    event.preventDefault()
    onSizeStep(id, by)
  })
  // A grip to drag the track to another place in the order. Only where the page can follow a drag; the keys above
  // do the same without it, and a grip that did nothing would be left out.
  const grip = document.createElement('button')
  grip.type = 'button'
  grip.className = 'head-grip'
  grip.id = `head-${id}-grip`
  grip.textContent = '⠿'
  grip.addEventListener('pointerdown', event => { if (event.button === 0) onGrip(id, event) })
  // On a collapsed lane only: brings it back to small. Left out where the page cannot, and where the lane is not collapsed.
  const expand = document.createElement('button')
  expand.type = 'button'
  expand.className = 'head-expand'
  expand.id = `head-${id}-expand`
  expand.textContent = 'Expand'
  expand.addEventListener('click', () => onExpand(id))
  // D copies the track, as it copies a clip. Reachable here because a small lane hides every button but the name.
  name.addEventListener('keydown', event => {
    if (!onDuplicateTrack || event.altKey || event.ctrlKey || event.metaKey || event.key.toLowerCase() !== 'd') return
    event.preventDefault()
    onDuplicateTrack(id)
  })

  const add = document.createElement('button')
  add.type = 'button'
  add.id = `add-clip-${id}`
  add.textContent = 'Add clip'
  const addAudio = document.createElement('button')
  addAudio.type = 'button'
  addAudio.id = `add-audio-${id}`
  addAudio.textContent = 'Add audio'
  // Where a new clip goes changes as clips are added, so the click reads it now.
  let at = 0
  add.addEventListener('click', () => onAdd(id, at))
  addAudio.addEventListener('click', () => onAddAudio(id, at))

  // Arm: this track takes what a MIDI controller plays. Only for a track with a
  // MIDI input to play into; on any other it would do nothing, so it is left out.
  const arm = document.createElement('button')
  arm.type = 'button'
  arm.className = 'head-arm'
  arm.id = `head-${id}-arm`
  arm.textContent = 'Arm'
  arm.setAttribute('aria-pressed', 'false')
  arm.addEventListener('click', () => onArm(id, arm.getAttribute('aria-pressed') !== 'true'))

  // Only where the page can copy a track; a button that did nothing would be left out.
  const duplicate = document.createElement('button')
  duplicate.type = 'button'
  duplicate.className = 'head-duplicate'
  duplicate.id = `head-${id}-duplicate`
  duplicate.textContent = 'Duplicate'
  duplicate.addEventListener('click', () => onDuplicateTrack(id))

  const mix = document.createElement('div')
  mix.className = 'head-mix'
  const toggle = key => {
    const button = createChannelToggle(document, { key, id: `head-${id}-${key}` })
    button.addEventListener('click', () => {
      const next = button.getAttribute('aria-pressed') !== 'true'
      button.setAttribute('aria-pressed', String(next))
      onChannel(id, { [key]: next })
    })
    return button
  }
  const mute = toggle('muted')
  const solo = toggle('soloed')

  const slider = (text, key, min, max, format, speak) => {
    const label = document.createElement('label')
    label.className = 'head-slider'
    const caption = document.createElement('span')
    caption.textContent = text
    const input = document.createElement('input')
    input.type = 'range'
    input.min = String(min)
    input.max = String(max)
    input.step = '0.01'
    input.id = `head-${id}-${key}`
    const value = document.createElement('span')
    value.className = 'value'
    const show = n => {
      value.textContent = format(n)
      input.setAttribute('aria-valuetext', speak(n))
    }
    input.addEventListener('input', () => { show(Number(input.value)); onChannel(id, { [key]: Number(input.value) }) })
    label.append(caption, input, value)
    return { label, input, show }
  }
  const level = slider('Level', 'gain', 0, 2, n => `${decibels(n)} dB`, n => `${decibels(n)} decibels`)
  const pan = slider('Pan', 'pan', -1, 1, panPosition, panPosition)

  // How this track is routed besides straight to the master, in words.
  const routing = document.createElement('p')
  routing.className = 'head-routing'
  routing.hidden = true

  // The kind of track, from its ports. Said in words; left out when the ports say nothing.
  const kindLabel = document.createElement('span')
  kindLabel.className = 'head-kind'
  kindLabel.hidden = true

  const silent = document.createElement('span')
  silent.className = 'head-silent'
  silent.hidden = true
  silent.textContent = 'Silent'

  // Said only when there is some: a line reading "0 frames" on every track would
  // be noise, and a control or figure nobody can use is left out.
  const latency = document.createElement('p')
  latency.className = 'head-latency'
  latency.hidden = true

  mix.append(mute, solo, level.label, pan.label, silent)
  const title = document.createElement('div')
  title.className = 'head-title'
  title.append(name, ...(onGrip ? [grip] : []), ...(onExpand ? [expand] : []))
  element.append(title, kindLabel, arm, mix, routing, latency, add, addAudio, ...(onDuplicateTrack ? [duplicate] : []))

  return {
    element,
    /**
     * `channel` is the track's strip; `mixable` says whether there is anything
     * to hear; `silent` is what solo did to it, which is not the same as muted;
     * `at` and `where` are where the next clip goes and how to say so.
     */
    update ({ label, channel, mixable, silent: isSilent, at: place, where, selected = false, color = null, size = DEFAULT_LANE_SIZE, latency: late = null, canArm = false, armed = false, routing: routed = null, kind = null }) {
      name.textContent = label
      name.setAttribute('aria-label', `Select ${label}`)
      name.setAttribute('aria-pressed', String(selected))
      element.classList.toggle('selected', selected)
      // A colour is a second cue beside the name, which is always shown.
      if (color) element.style.setProperty('--track-color', color); else element.style.removeProperty('--track-color')
      element.dataset.size = size
      expand.hidden = size !== 'collapsed'
      expand.setAttribute('aria-label', `Expand ${label}`)
      grip.setAttribute('aria-label', `Drag to move ${label}, or press Alt with Up or Down on its name`)
      grip.title = 'Drag to move this track'
      name.title = `Alt with Up or Down moves this track${onDuplicateTrack ? ', D duplicates it' : ''}${onSizeStep ? ', plus and minus change the lane size' : ''}`
      element.setAttribute('role', 'group')
      kindLabel.hidden = kind === null
      kindLabel.textContent = kind === null ? '' : TRACK_KIND_LABELS[kind]
      element.setAttribute('aria-label', `${label} controls${kind === null ? '' : `, ${TRACK_KIND_LABELS[kind]} track`}${isSilent ? ', silent' : ''}`)
      at = place
      add.setAttribute('aria-label', `Add a MIDI clip to ${label} at ${where}`)
      addAudio.setAttribute('aria-label', `Add an audio file to ${label} at ${where}`)
      duplicate.setAttribute('aria-label', `Duplicate ${label} with its plugins`)

      mix.hidden = !mixable
      mute.setAttribute('aria-pressed', String(Boolean(channel.muted)))
      solo.setAttribute('aria-pressed', String(Boolean(channel.soloed)))
      mute.setAttribute('aria-label', `Mute ${label}`)
      mute.title = `Mute ${label}`
      solo.setAttribute('aria-label', `Solo ${label}`)
      solo.title = `Solo ${label}`
      // A slider being dragged already says what the model will say; setting
      // its value under the person's hand would only jitter it.
      for (const [control, key] of [[level, 'gain'], [pan, 'pan']]) {
        if (document.activeElement !== control.input) control.input.value = String(channel[key])
        control.show(channel[key])
        control.input.setAttribute('aria-label', `${key === 'gain' ? 'Level' : 'Pan'}, ${label}`)
      }
      silent.hidden = !isSilent
      routing.hidden = routed === null
      routing.textContent = routed ?? ''
      arm.hidden = !canArm
      arm.setAttribute('aria-pressed', String(armed))
      // Said in text too, not only by the colour it turns.
      arm.textContent = armed ? 'Armed' : 'Arm'
      arm.setAttribute('aria-label', `Arm ${label} for MIDI input`)
      latency.hidden = !(late && (late.frames > 0 || late.alignFrames > 0))
      if (!latency.hidden) {
        const ms = n => (late.rate ? `, ${((n / late.rate) * 1000).toFixed(1)} ms` : '')
        const own = late.frames > 0 ? `Latency ${late.frames} frames${ms(late.frames)}` : 'No latency'
        const aligned = late.alignFrames > 0 ? `; delayed ${late.alignFrames} frames${ms(late.alignFrames)} to line up with the tracks it arrives with` : ''
        latency.textContent = own + aligned
        latency.title = late.alignFrames > 0
          ? 'Aligned: this track is delayed so it arrives with the others going to the same place. Change it on the Mixer tab.'
          : 'How far this track lags a track with no latency. Tracks are not aligned to each other.'
      }
    }
  }
}
