// src/ui/SoundChooser.js
//
// The "Add a track" chooser: sounds by what a person wants to play, each with a Hear button and an Add button
// (docs/learning-curve.md, "Sounds, not plugins").
//
// This file is the part that needs no page: which catalogue entries are sounds, how one is described in a line, which few notes
// Hear plays, and the dialog's markup. Loading a trial track and removing it again are web/app/AddTrack.js, since they need the
// dispatcher.
//
// A sound is a recipe of one or more plugins, in the order they are loaded onto one new track: an instrument is one part, and a drum
// kit played by a beat generator is two, the generator first so that its output is joined to the kit's input as loading a second plugin
// onto a track does. They are listed by kind, Instruments and Drums, as the New Track screens of other DAWs list them.

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
 * Each is one part, and `drums` says it is a drum kit, whose keys are not a scale.
 */
export function soundsFrom (results) {
  return results
    .filter(r => r.web && (r.roles ?? []).includes('Instrument'))
    .map(r => {
      const load = r.homepage ?? r.iri
      return { iri: r.iri, load, label: r.label, about: firstSentence(r.comment), drums: (r.roles ?? []).includes('DrumInstrument'), parts: [{ load, label: r.label }] }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The beat generators this host can run: MIDI generators that write drum notes, which a drum kit plays. A generator that writes a
 * melody or a bass line is not one, and neither is a native plugin the catalogue merely knows about.
 */
export function drumGeneratorsFrom (results) {
  return results
    .filter(r => r.web && (r.roles ?? []).includes('MidiGenerator') && (r.produces ?? []).includes('DrumMidi'))
    .map(r => ({ iri: r.iri, load: r.homepage ?? r.iri, label: r.label, about: firstSentence(r.comment) }))
    .sort((a, b) => a.label.localeCompare(b.label))
}

/**
 * The chooser's groups. Instruments are every sound that is not a drum kit. Drums are each drum kit played by each beat generator, which
 * is the beat made for the person, then each kit alone, for playing it by hand. A group with nothing in it is left out.
 */
export function groupsFrom ({ instruments, generators }) {
  const sounds = soundsFrom(instruments)
  const kits = sounds.filter(s => s.drums)
  const beats = drumGeneratorsFrom(generators)
  const drums = [
    ...kits.flatMap(kit => beats.map(beat => ({
      iri: `${kit.iri}+${beat.iri}`,
      label: `${kit.label} with ${beat.label}`,
      about: `${beat.label} writes the beat and ${kit.label} plays it. Press Play after adding it, and drag the Feel pad.`,
      drums: true,
      generated: true,
      parts: [{ load: beat.load, label: beat.label }, { load: kit.load, label: kit.label }]
    }))),
    ...kits.map(kit => ({ ...kit, about: `${kit.about} Played by hand or by clips.` }))
  ]
  return [
    { heading: 'Instruments', sounds: sounds.filter(s => !s.drums) },
    { heading: 'Drums', sounds: drums }
  ].filter(group => group.sounds.length > 0)
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
 * The dialog. `groups` is from groupsFrom. The buttons are real buttons with a name that says which sound, since "Add" four
 * times is no help to someone who hears one control at a time. Nothing is disabled: a press while a load is under way is ignored
 * by the caller, which keeps the status line honest about it.
 *
 * Returns `{ element, say(text), heard(iri) }`. `say` writes the status line; `heard` marks which sound is on the trial track, as
 * text as well as a state, so it is not told by colour alone.
 */
export function createSoundChooser (document, { groups, onHear, onAdd, onEmpty, onCancel }) {
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

  const rows = new Map()
  const lists = groups.map((group, index) => {
    const section = document.createElement('section')
    const heading = document.createElement('h3')
    heading.id = `sound-group-${index}`
    heading.textContent = group.heading
    const list = document.createElement('ul')
    list.className = 'sound-list'
    list.setAttribute('aria-labelledby', heading.id)
    for (const sound of group.sounds) {
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
    section.append(heading, list)
    return section
  })

  const none = document.createElement('p')
  none.className = 'note'
  none.textContent = 'No sounds are available to load here.'
  none.hidden = groups.length > 0

  const scroll = document.createElement('div')
  scroll.className = 'sound-scroll'
  scroll.append(...lists, none)

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

  dialog.append(title, help, status, scroll, buttons)
  // Escape, and any other way of dismissing it, is Cancel.
  dialog.addEventListener('cancel', () => onCancel())

  return {
    element: dialog,
    say (text) { status.textContent = text },
    heard (iri) { for (const [key, mark] of rows) mark.textContent = key === iri ? ' (on the trial track)' : '' }
  }
}
