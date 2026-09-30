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
import { decibels, panPosition } from './Strip.js'

export function createTrackHeader (document, { id, onSelect, onAdd, onAddAudio, onChannel, onMove }) {
  for (const [name, fn] of Object.entries({ onSelect, onAdd, onAddAudio, onChannel, onMove })) {
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

  const mix = document.createElement('div')
  mix.className = 'head-mix'
  const toggle = (text, key) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `strip-toggle ${key}`
    button.id = `head-${id}-${key}`
    button.textContent = text
    button.setAttribute('aria-pressed', 'false')
    button.addEventListener('click', () => {
      const next = button.getAttribute('aria-pressed') !== 'true'
      button.setAttribute('aria-pressed', String(next))
      onChannel(id, { [key]: next })
    })
    return button
  }
  const mute = toggle('Mute', 'muted')
  const solo = toggle('Solo', 'soloed')

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
  element.append(name, mix, latency, add, addAudio)

  return {
    element,
    /**
     * `channel` is the track's strip; `mixable` says whether there is anything
     * to hear; `silent` is what solo did to it, which is not the same as muted;
     * `at` and `where` are where the next clip goes and how to say so.
     */
    update ({ label, channel, mixable, silent: isSilent, at: place, where, selected = false, color = null, size = 'medium', latency: late = null }) {
      name.textContent = label
      name.setAttribute('aria-label', `Select ${label}`)
      name.setAttribute('aria-pressed', String(selected))
      element.classList.toggle('selected', selected)
      // A colour is a second cue beside the name, which is always shown.
      if (color) element.style.setProperty('--track-color', color); else element.style.removeProperty('--track-color')
      element.dataset.size = size
      name.title = 'Alt with Up or Down moves this track'
      element.setAttribute('role', 'group')
      element.setAttribute('aria-label', `${label} controls${isSilent ? ', silent' : ''}`)
      at = place
      add.setAttribute('aria-label', `Add a MIDI clip to ${label} at ${where}`)
      addAudio.setAttribute('aria-label', `Add an audio file to ${label} at ${where}`)

      mix.hidden = !mixable
      mute.setAttribute('aria-pressed', String(Boolean(channel.muted)))
      solo.setAttribute('aria-pressed', String(Boolean(channel.soloed)))
      mute.setAttribute('aria-label', `Mute ${label}`)
      solo.setAttribute('aria-label', `Solo ${label}`)
      // A slider being dragged already says what the model will say; setting
      // its value under the person's hand would only jitter it.
      for (const [control, key] of [[level, 'gain'], [pan, 'pan']]) {
        if (document.activeElement !== control.input) control.input.value = String(channel[key])
        control.show(channel[key])
        control.input.setAttribute('aria-label', `${key === 'gain' ? 'Level' : 'Pan'}, ${label}`)
      }
      silent.hidden = !isSilent
      latency.hidden = !(late && late.frames > 0)
      if (!latency.hidden) {
        latency.textContent = `Latency ${late.frames} frames${late.ms !== null ? `, ${late.ms.toFixed(1)} ms` : ''}`
        latency.title = 'How far this track lags a track with no latency. Tracks are not aligned to each other.'
      }
    }
  }
}
