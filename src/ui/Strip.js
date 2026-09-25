// src/ui/Strip.js
//
// The channel strip for one track: level, position, mute and solo.
//
// These are not plugin parameters and are deliberately not drawn by Panel.js.
// No lv2:port declares them, the host provides them with native Web Audio nodes,
// and solo is a property of the whole graph rather than of one node. Drawing
// them with the generated controls would say they came from the plugin.
//
// Every control reports its value as text as well as a number, per AGENTS.md:
// "4200" and "4200 Hz" are different information, and so are "0.7" and "-3 dB".
// Mute and solo are pressed buttons with aria-pressed rather than checkboxes,
// because that is what they are, and neither signals its state by colour alone.
//
// Level and position are drawn by src/ui/Dial.js, the same rotary control the
// generated panel uses. Not because the strip is a panel, which it is not,
// but because a page with knobs for a plugin and sliders for the mixer beside
// it reads as two interfaces. The control underneath is still the same native
// range it always was.
import { createDial } from './Dial.js'

/** A gain as decibels, for a person. Linear is what the engine wants. */
export function decibels (gain) {
  if (!(gain > 0)) return '-inf'
  const db = 20 * Math.log10(gain)
  return `${db > 0 ? '+' : ''}${db.toFixed(1)}`
}

/** Where a pan sits, said rather than shown. */
export function panPosition (pan) {
  if (Math.abs(pan) < 0.005) return 'centre'
  const side = pan < 0 ? 'left' : 'right'
  return `${Math.round(Math.abs(pan) * 100)}% ${side}`
}

/**
 * Build a strip.
 *
 * `onChange` receives the part that changed, never the whole strip, so the
 * caller sends one operation for one movement rather than re-sending values
 * nobody touched.
 */
export function createStrip (document, channel, onChange, { label: initialLabel = '', id = null } = {}) {
  let label = initialLabel
  // The ids of the controls. From `id` when given, because a label is a name
  // for people and two tracks can share one; from the label otherwise.
  const base = (id ?? `${initialLabel || 'node'}`).replace(/\s+/g, '-').toLowerCase()
  const element = document.createElement('div')
  element.className = 'strip'
  element.setAttribute('role', 'group')
  element.setAttribute('aria-label', label ? `${label} channel` : 'Channel')

  const state = { gain: 1, pan: 0, muted: false, soloed: false, ...channel }

  // ── Level ────────────────────────────────────────────────────────────────
  const gainRow = document.createElement('div')
  gainRow.className = 'strip-control'
  const gainLabel = document.createElement('label')
  gainLabel.textContent = 'Level'
  // Above unity, because a quiet plugin has to be able to reach the mix. The
  // range is linear in gain and the readout is in decibels, which is the pair
  // every mixer presents. Unity is not the middle of nought to two in
  // decibels, so the arc grows from silence rather than from the centre.
  const gainDial = createDial(document, { minimum: 0, maximum: 2, defaultValue: state.gain },
    `${base}-level`)
  const gain = gainDial.input
  const gainValue = document.createElement('span')
  gainValue.className = 'value'

  const showGain = () => {
    gainValue.textContent = `${decibels(state.gain)} dB`
    gain.setAttribute('aria-valuetext', `${decibels(state.gain)} decibels`)
    gainDial.render(state.gain)
  }
  // setAttribute rather than the htmlFor property: the property reflects in a
  // browser and does not in every DOM implementation, and a label that does not
  // point at its control is not a label.
  gainLabel.setAttribute('for', gain.id)
  gain.addEventListener('input', () => {
    state.gain = Number(gain.value)
    showGain()
    onChange({ gain: state.gain })
  })
  showGain()
  gainRow.append(gainLabel, gainDial.element, gainValue)

  // ── Position ─────────────────────────────────────────────────────────────
  const panRow = document.createElement('div')
  panRow.className = 'strip-control'
  const panLabel = document.createElement('label')
  panLabel.textContent = 'Pan'
  // Minus one to one, so Dial.js grows the arc from the middle: a centred pan
  // draws nothing, which is what centred means, and a slider's thumb in the
  // middle never said that.
  const panDial = createDial(document, { minimum: -1, maximum: 1, defaultValue: state.pan },
    `${base}-pan`)
  const pan = panDial.input
  const panValue = document.createElement('span')
  panValue.className = 'value'

  const showPan = () => {
    panValue.textContent = panPosition(state.pan)
    pan.setAttribute('aria-valuetext', panPosition(state.pan))
    panDial.render(state.pan)
  }
  panLabel.setAttribute('for', pan.id)
  pan.addEventListener('input', () => {
    state.pan = Number(pan.value)
    showPan()
    onChange({ pan: state.pan })
  })
  showPan()
  panRow.append(panLabel, panDial.element, panValue)

  // ── Mute and solo ────────────────────────────────────────────────────────
  const buttons = document.createElement('div')
  buttons.className = 'strip-buttons'

  const toggle = (name, key) => {
    const button = document.createElement('button')
    button.type = 'button'
    button.className = `strip-toggle ${key}`
    // An id, so a redraw that does take the strip out of the document can put
    // the focus back (src/ui/Focus.js restores by id).
    button.id = `${base}-${key}`
    button.textContent = name
    button.setAttribute('aria-pressed', String(Boolean(state[key])))
    button.addEventListener('click', () => {
      state[key] = !state[key]
      button.setAttribute('aria-pressed', String(state[key]))
      onChange({ [key]: state[key] })
    })
    return button
  }

  const mute = toggle('Mute', 'muted')
  const solo = toggle('Solo', 'soloed')
  buttons.append(mute, solo)

  element.append(gainRow, panRow, buttons)

  return {
    element,
    /**
     * Show what the host decided, which is not always what was asked for.
     *
     * `silent` is separate from `muted` because solo silences a track without
     * muting it, and a strip that showed only its own flags would say a track
     * was heard while it was not. `label` renames the strip, for a track that
     * was renamed after its strip was built.
     */
    update (next = {}, { silent = null, label: renamed = null } = {}) {
      if (renamed !== null) label = renamed
      if (next.gain !== undefined) { state.gain = next.gain; gain.value = String(next.gain); showGain() }
      if (next.pan !== undefined) { state.pan = next.pan; pan.value = String(next.pan); showPan() }
      if (next.muted !== undefined) { state.muted = next.muted; mute.setAttribute('aria-pressed', String(next.muted)) }
      if (next.soloed !== undefined) { state.soloed = next.soloed; solo.setAttribute('aria-pressed', String(next.soloed)) }
      if (silent !== null) element.classList.toggle('silent', silent)
      if (silent !== null || renamed !== null) {
        // Said, not only shown, because state must not be signalled by colour.
        element.setAttribute('aria-label',
          `${label ? label + ' channel' : 'Channel'}${element.classList.contains('silent') ? ', silent' : ''}`)
      }
    }
  }
}
