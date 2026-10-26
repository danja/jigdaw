// src/ui/SoundChooser.js
//
// The "Add a track" chooser: sounds by what a person wants to play, each with a Hear button and an Add button
// (docs/learning-curve.md, "Sounds, not plugins").
//
// This file is the part that needs no page: which catalogue entries are sounds, how one is described in a line, which few notes
// Hear plays, and the dialog's markup. Loading a trial track and removing it again are web/app/AddTrack.js, since they need the
// dispatcher.

/** The first sentence of a description, cut to `limit` characters at a word if it runs on. Empty for nothing. */
export function firstSentence (text, limit = 110) {
  const flat = String(text ?? '').replace(/\s+/g, ' ').trim()
  if (flat === '') return ''
  const end = flat.search(/[.!?](\s|$)/)
  const sentence = end === -1 ? flat : flat.slice(0, end + 1)
  if (sentence.length <= limit) return sentence
  const cut = sentence.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return `${(space > 0 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, '')}…`
}

/**
 * The entries of a catalogue search that this host can run and that make sound from notes, as sounds, by name.
 * A native plugin the catalogue merely knows about is left out rather than listed and refused later. `load` is the address the
 * Browser loads from (the homepage, else the IRI), so a sound is loaded from where a Load button on the same result would load it.
 */
export function soundsFrom (results) {
  return results
    .filter(r => r.web && (r.roles ?? []).includes('Instrument'))
    .map(r => ({ iri: r.iri, load: r.homepage ?? r.iri, label: r.label, about: firstSentence(r.comment), drums: (r.roles ?? []).includes('DrumInstrument') }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The notes Hear plays: `at` and `length` in seconds, MIDI pitch and velocity. A drum kit gets a kick, a snare and a closed hat
 * (General MIDI notes 36, 38 and 42) because a drum kit's keys are not a scale; anything else gets a rising chord of C major.
 */
export function phraseFor (sound) {
  const notes = sound.drums ? [36, 42, 38, 42] : [60, 64, 67, 72]
  const step = sound.drums ? 0.25 : 0.3
  return notes.map((pitch, i) => ({ at: i * step, length: sound.drums ? 0.15 : 0.45, pitch, velocity: 100 }))
}

/**
 * The dialog. `sounds` is from soundsFrom. The buttons are real buttons with a name that says which sound, since "Add" four
 * times is no help to someone who hears one control at a time. Nothing is disabled: a press while a load is under way is ignored
 * by the caller, which keeps the status line honest about it.
 *
 * Returns `{ element, say(text), heard(iri) }`. `say` writes the status line; `heard` marks which sound is on the trial track, as
 * text as well as a state, so it is not told by colour alone.
 */
export function createSoundChooser (document, { sounds, onHear, onAdd, onEmpty, onCancel }) {
  const dialog = document.createElement('dialog')
  dialog.className = 'chooser'
  dialog.setAttribute('aria-labelledby', 'sound-chooser-title')

  const title = document.createElement('h2')
  title.id = 'sound-chooser-title'
  title.textContent = 'Add a track'
  const help = document.createElement('p')
  help.className = 'note'
  help.textContent = 'Choose a sound. Hear plays a few notes on a trial track, which is taken away again unless you add it.'
  const status = document.createElement('p')
  status.className = 'note'
  status.setAttribute('role', 'status')

  const list = document.createElement('ul')
  list.className = 'sound-list'
  const rows = new Map()
  for (const sound of sounds) {
    const item = document.createElement('li')
    const words = document.createElement('div')
    words.className = 'sound-words'
    const name = document.createElement('strong')
    name.textContent = sound.label
    const mark = document.createElement('span')
    mark.className = 'sound-mark'
    const about = document.createElement('span')
    about.className = 'sound-about'
    about.textContent = sound.about
    words.append(name, mark, about)
    const hear = document.createElement('button')
    hear.type = 'button'
    hear.textContent = 'Hear'
    hear.setAttribute('aria-label', `Hear ${sound.label}`)
    hear.addEventListener('click', () => onHear(sound))
    const add = document.createElement('button')
    add.type = 'button'
    add.textContent = 'Add'
    add.setAttribute('aria-label', `Add ${sound.label}`)
    add.addEventListener('click', () => onAdd(sound))
    item.append(words, hear, add)
    list.append(item)
    rows.set(sound.iri, mark)
  }

  const none = document.createElement('p')
  none.className = 'note'
  none.textContent = 'No sounds are available to load here.'
  none.hidden = sounds.length > 0

  const buttons = document.createElement('div')
  buttons.className = 'consent-buttons'
  const empty = document.createElement('button')
  empty.type = 'button'
  empty.textContent = 'An empty track'
  empty.addEventListener('click', () => onEmpty())
  const cancel = document.createElement('button')
  cancel.type = 'button'
  cancel.textContent = 'Cancel'
  cancel.addEventListener('click', () => onCancel())
  buttons.append(empty, cancel)

  dialog.append(title, help, status, list, none, buttons)
  // Escape, and any other way of dismissing it, is Cancel.
  dialog.addEventListener('cancel', () => onCancel())

  return {
    element: dialog,
    say (text) { status.textContent = text },
    heard (iri) { for (const [key, mark] of rows) mark.textContent = key === iri ? ' (on the trial track)' : '' }
  }
}
