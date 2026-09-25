// src/ui/Keyboard.js
//
// An on-screen keyboard, so an instrument can be played.
//
// It emits MIDI the way any source does: bytes and a stream position, handed to
// the host to route. It knows nothing about the instrument, the engine or the
// audio graph, which is what lets the same events come from a real MIDI device
// later without anything here changing.
import { carriesNotes } from '../engine/EventRouter.js'

const WHITE = [0, 2, 4, 5, 7, 9, 11]
const BLACK = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 }
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export const noteName = note => `${NAMES[note % 12]}${Math.floor(note / 12) - 1}`

/** The smallest a key may be and still be reliably hit. WCAG 2.5.8 asks 24px. */
export const MIN_KEY_WIDTH = 24

/**
 * How many octaves fit in a given width with usable keys.
 *
 * The keys divide the width they are given, so more octaves means narrower
 * keys. At two octaves in a 320px phone they come out at 17.6px, which is under
 * the WCAG minimum and hard to hit with a thumb. Showing fewer octaves is
 * better than showing more keys nobody can press accurately.
 */
export function octavesForWidth (width, { max = 2, minKeyWidth = MIN_KEY_WIDTH } = {}) {
  for (let octaves = max; octaves > 1; octaves--) {
    if (width / (octaves * 7) >= minKeyWidth) return octaves
  }
  return 1
}

/**
 * Whether a plugin is one a person plays.
 *
 * Accepting MIDI is not enough, which is what this used to be. BassGen
 * accepts MIDI to be steered by it: `follow` takes the root note from
 * whatever is playing, and the plugin itself produces MIDI and no audio. It
 * was given two octaves of keys that made no sound, above a panel for a thing
 * the transport drives.
 *
 * So the question is whether the plugin turns what you play into something
 * you hear, and `jig:audioOutputs` is the structural fact that answers it. A
 * role would answer it too and less reliably: `trn:Instrument` is a claim an
 * author makes and an output count is a number a host already has to trust.
 *
 * Steering BassGen from a keyboard still works. The keys come from whatever
 * is wired into its MIDI input, which is where a MIDI input's notes should
 * come from.
 */
export const playable = profile =>
  (profile?.audioOutputs ?? 0) > 0 &&
  (profile?.accepts ?? []).some(carriesNotes)

/** Note on and note off, as the three bytes a MIDI source sends. */
export const noteOn = (note, velocity = 100) => Uint8Array.from([0x90, note, velocity])
export const noteOff = note => Uint8Array.from([0x80, note, 0])

/**
 * Build a keyboard.
 *
 * `onNote(bytes)` is called with the MIDI message. The caller decides where it
 * goes and at which frame, because the keyboard has no idea what the transport
 * is doing.
 */
export function createKeyboard (document, { first = 48, octaves = 2, onNote } = {}) {
  const root = document.createElement('div')
  root.className = 'keyboard'
  root.setAttribute('role', 'group')
  root.setAttribute('aria-label', 'Play notes')

  const held = new Set()

  const press = note => {
    if (held.has(note)) return
    held.add(note)
    onNote?.(noteOn(note), note)
    root.querySelector(`[data-note="${note}"]`)?.classList.add('held')
  }

  const release = note => {
    if (!held.has(note)) return
    held.delete(note)
    onNote?.(noteOff(note), note)
    root.querySelector(`[data-note="${note}"]`)?.classList.remove('held')
  }

  const key = (note, className) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = className
    element.dataset.note = String(note)
    // Named for a screen reader, which cannot see a piano.
    element.setAttribute('aria-label', noteName(note))
    element.title = noteName(note)

    // Pointer events rather than mouse or touch, so one path covers a mouse, a
    // finger and a pen, and a drag across the keys plays them.
    element.addEventListener('pointerdown', event => {
      event.preventDefault()
      element.setPointerCapture?.(event.pointerId)
      press(note)
    })
    element.addEventListener('pointerup', () => release(note))
    element.addEventListener('pointercancel', () => release(note))
    element.addEventListener('pointerleave', () => release(note))

    // A keyboard user gets the same notes: space and enter on a focused key.
    element.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); press(note) }
    })
    element.addEventListener('keyup', event => {
      if (event.key === ' ' || event.key === 'Enter') release(note)
    })

    return element
  }

  const whites = document.createElement('div')
  whites.className = 'keys-white'
  const blacks = document.createElement('div')
  blacks.className = 'keys-black'

  for (let octave = 0; octave < octaves; octave++) {
    for (const [index, semitone] of WHITE.entries()) {
      whites.append(key(first + octave * 12 + semitone, 'key key-white'))
      void index
    }
  }

  // Black keys are positioned over the white ones, so they are laid out by
  // which white key they sit after rather than in pitch order.
  for (let octave = 0; octave < octaves; octave++) {
    for (const [semitone, after] of Object.entries(BLACK)) {
      const element = key(first + octave * 12 + Number(semitone), 'key key-black')
      const position = octave * 7 + after
      element.style.left = `calc(${position + 1} * var(--white-width) - var(--black-width) / 2)`
      blacks.append(element)
    }
  }

  root.append(whites, blacks)
  root.style.setProperty('--white-count', String(octaves * 7))

  return {
    element: root,
    /** Release everything, for when the instrument goes away. */
    allNotesOff () {
      for (const note of [...held]) release(note)
    },
    get held () { return [...held] }
  }
}
