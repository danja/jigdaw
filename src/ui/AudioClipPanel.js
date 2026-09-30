// src/ui/AudioClipPanel.js
//
// The dock's view of one audio clip: where it starts, how long it is, how far
// into the file it begins, and the file it plays. Numbers, because an audio
// clip has no notes to draw; the waveform is on the clip itself. Each change
// is one request and one undo, sent on Enter or when the field is left, never
// per keystroke, so a half-typed number is never a clip.
import { barBeat } from './Timeline.js'

export function createAudioClipPanel (document, { onSet, onRemove }) {
  for (const [name, fn] of Object.entries({ onSet, onRemove })) {
    if (typeof fn !== 'function') throw new Error(`createAudioClipPanel needs ${name}`)
  }
  const element = document.createElement('div')
  element.className = 'audio-panel'
  const summary = document.createElement('p')
  summary.className = 'audio-summary'
  const source = document.createElement('p')
  source.className = 'audio-source'
  const problem = document.createElement('p')
  problem.className = 'audio-problem'
  problem.setAttribute('role', 'status')
  let clipId = null

  const field = (key, text, { min, step }) => {
    const label = document.createElement('label')
    label.className = 'audio-field'
    label.append(document.createTextNode(`${text} `))
    const input = document.createElement('input')
    // A text input with a numeric keypad: type=number spins on the wheel and
    // is 16px only if told to be, and this stays 16px (iOS zooms below that).
    input.type = 'text'
    input.inputMode = 'decimal'
    input.id = `audio-${key}`
    input.autocomplete = 'off'
    input.spellcheck = false
    const commit = () => {
      const value = Number(input.value.trim().replace(',', '.'))
      if (!Number.isFinite(value) || value < min) { problem.textContent = `${text} must be a number, ${min} or more`; return }
      problem.textContent = ''
      onSet(clipId, { [key]: value })
    }
    input.addEventListener('change', commit)
    input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); commit() } })
    label.append(input)
    return { label, input, step }
  }
  const start = field('startBeat', 'Start (beats)', { min: 0, step: 1 })
  const length = field('lengthBeats', 'Length (beats)', { min: 0.25, step: 1 })
  const offset = field('offsetSeconds', 'Offset into the file (seconds)', { min: 0, step: 0.1 })
  const remove = document.createElement('button')
  remove.type = 'button'
  remove.textContent = 'Remove clip'
  remove.addEventListener('click', () => onRemove(clipId))
  element.append(summary, source, start.label, length.label, offset.label, problem, remove)

  return {
    element,
    get clipId () { return clipId },
    /** Draw `clip`. A field being typed in is left alone. */
    show (clip, { beatsPerBar, label, unplayable = null }) {
      clipId = clip.id
      summary.textContent = `${label}: audio clip at ${barBeat(clip.startBeat, beatsPerBar)}.`
      source.textContent = `File: ${clip.source}`
      const active = document.activeElement
      for (const [f, key] of [[start, 'startBeat'], [length, 'lengthBeats'], [offset, 'offsetSeconds']]) {
        if (active !== f.input) f.input.value = String(clip[key])
      }
      if (!problem.textContent || unplayable) problem.textContent = unplayable ? `Cannot play: ${unplayable}` : ''
    }
  }
}
