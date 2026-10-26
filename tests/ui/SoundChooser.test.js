// tests/ui/SoundChooser.test.js
//
// Which catalogue entries are offered as sounds, how each is described, which notes Hear plays, and the dialog's controls.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { firstSentence, soundsFrom, drumGeneratorsFrom, groupsFrom, phraseFor, createSoundChooser } from '../../src/ui/SoundChooser.js'

const { document } = parseHTML('<!doctype html><body></body>')

describe('firstSentence', () => {
  it('is the first sentence of a description', () => {
    expect(firstSentence('A six-band equalizer. With shelves and notches.')).toBe('A six-band equalizer.')
  })

  it('does not stop at a full stop inside a number or a name', () => {
    expect(firstSentence('Runs at 44.1 kHz and more.')).toBe('Runs at 44.1 kHz and more.')
  })

  it('is cut at a word, with an ellipsis, when the sentence runs on', () => {
    const cut = firstSentence('Nine voices across three chips, hardware envelopes, a percussion set on channel ten, and the firmware vibrato', 50)
    expect(cut.endsWith('…')).toBe(true)
    expect(cut.length).toBeLessThanOrEqual(51)
    expect(cut).not.toMatch(/\s…$/)
  })

  it('is empty for nothing, whitespace, null and undefined', () => {
    for (const value of ['', '   ', null, undefined]) expect(firstSentence(value)).toBe('')
  })
})

describe('soundsFrom', () => {
  const results = [
    { iri: 'a', homepage: 'https://example.test/a/', label: 'Zed', comment: 'Zed plays. It is loud.', roles: ['Instrument', 'AudioInstrument'], web: true },
    { iri: 'b', label: 'Boost', comment: 'Louder.', roles: ['AudioEffect'], web: true },
    { iri: 'c', label: 'Native', comment: 'Not here.', roles: ['Instrument'], web: false },
    { iri: 'd', label: 'Kit', comment: 'Drums.', roles: ['Instrument', 'DrumInstrument'], web: true },
    { iri: 'e', label: 'Bare', web: true }
  ]

  it('keeps instruments this host can run, and nothing else', () => {
    expect(soundsFrom(results).map(s => s.label)).toEqual(['Kit', 'Zed'])
  })

  it('describes each in a line and says which are drums', () => {
    const [kit, zed] = soundsFrom(results)
    expect(kit.drums).toBe(true)
    expect(zed.drums).toBe(false)
    expect(zed.about).toBe('Zed plays.')
  })

  it('loads from the homepage when there is one and from the IRI when there is not, as the Browser does', () => {
    const [kit, zed] = soundsFrom(results)
    expect(zed.load).toBe('https://example.test/a/')
    expect(zed.iri).toBe('a')
    expect(kit.load).toBe('d')
  })

  it('is one part, loaded from where the Browser would load it', () => {
    const [kit, zed] = soundsFrom(results)
    expect(zed.parts).toEqual([{ load: 'https://example.test/a/', label: 'Zed' }])
    expect(kit.parts).toEqual([{ load: 'd', label: 'Kit' }])
  })

  it('is empty for no results, so the dialog can say there are none', () => {
    expect(soundsFrom([])).toEqual([])
  })
})

describe('drumGeneratorsFrom', () => {
  const results = [
    { iri: 'g1', homepage: 'https://example.test/g1/', label: 'Beat', comment: 'Writes a beat. More.', roles: ['MidiGenerator'], produces: ['Midi', 'DrumMidi'], web: true },
    { iri: 'g2', label: 'Bass', comment: 'Writes bass.', roles: ['MidiGenerator'], produces: ['Midi', 'BassMidi'], web: true },
    { iri: 'g3', label: 'Native beat', roles: ['MidiGenerator'], produces: ['DrumMidi'], web: false },
    { iri: 'g4', label: 'Filter', roles: ['MidiProcessor'], produces: ['DrumMidi'], web: true },
    { iri: 'g5', label: 'Bare', roles: ['MidiGenerator'], web: true }
  ]

  it('keeps the MIDI generators this host can run that write drum notes, and nothing else', () => {
    expect(drumGeneratorsFrom(results).map(g => g.label)).toEqual(['Beat'])
  })

  it('loads from the homepage and describes itself in a line', () => {
    expect(drumGeneratorsFrom(results)[0]).toEqual({ iri: 'g1', load: 'https://example.test/g1/', label: 'Beat', about: 'Writes a beat.' })
  })
})

describe('groupsFrom', () => {
  const instruments = [
    { iri: 'a', label: 'Zed', comment: 'Plays.', roles: ['Instrument'], web: true },
    { iri: 'k', label: 'Kit', comment: 'Drums.', roles: ['Instrument', 'DrumInstrument'], web: true }
  ]
  const generators = [{ iri: 'g', label: 'Beat', comment: 'Writes a beat.', roles: ['MidiGenerator'], produces: ['DrumMidi'], web: true }]

  it('lists instruments that are not drum kits under Instruments, and drums under Drums', () => {
    const groups = groupsFrom({ instruments, generators })
    expect(groups.map(g => g.heading)).toEqual(['Instruments', 'Drums'])
    expect(groups[0].sounds.map(s => s.label)).toEqual(['Zed'])
  })

  it('offers each drum kit played by each beat generator first, then the kit alone', () => {
    const drums = groupsFrom({ instruments, generators })[1].sounds
    expect(drums.map(s => s.label)).toEqual(['Kit with Beat', 'Kit'])
  })

  it('loads the generator first and the kit second, so the generator\'s notes are joined to the kit', () => {
    const [beat] = groupsFrom({ instruments, generators })[1].sounds
    expect(beat.parts.map(p => p.label)).toEqual(['Beat', 'Kit'])
    expect(beat.generated).toBe(true)
    expect(beat.drums).toBe(true)
  })

  it('gives each sound its own key, so the one on the trial track can be told from its parts', () => {
    const all = groupsFrom({ instruments, generators }).flatMap(g => g.sounds)
    expect(new Set(all.map(s => s.iri)).size).toBe(all.length)
  })

  it('has a kit alone and no generated drums when there is no beat generator, and no Drums group with no kit', () => {
    expect(groupsFrom({ instruments, generators: [] })[1].sounds.map(s => s.label)).toEqual(['Kit'])
    expect(groupsFrom({ instruments: [instruments[0]], generators }).map(g => g.heading)).toEqual(['Instruments'])
  })

  it('is empty when there is nothing, so the dialog can say there are none', () => {
    expect(groupsFrom({ instruments: [], generators: [] })).toEqual([])
  })
})

describe('phraseFor', () => {
  it('is a rising C major chord for a pitched sound, in time order', () => {
    const phrase = phraseFor({ drums: false })
    expect(phrase.map(n => n.pitch)).toEqual([60, 64, 67, 72])
    expect(phrase.map(n => n.at)).toEqual([...phrase.map(n => n.at)].sort((a, b) => a - b))
  })

  it('is kick, hat, snare, hat for a drum kit, which has no scale', () => {
    expect(phraseFor({ drums: true }).map(n => n.pitch)).toEqual([36, 42, 38, 42])
  })

  it('stays inside the MIDI range and every note has a length', () => {
    for (const drums of [true, false]) {
      for (const n of phraseFor({ drums })) {
        expect(n.pitch).toBeGreaterThanOrEqual(0)
        expect(n.pitch).toBeLessThanOrEqual(127)
        expect(n.velocity).toBeGreaterThan(0)
        expect(n.length).toBeGreaterThan(0)
      }
    }
  })
})

describe('the chooser dialog', () => {
  const build = (sounds, calls = []) => {
    const chooser = createSoundChooser(document, {
      groups: sounds.length === 0 ? [] : [{ heading: 'Instruments', sounds: sounds.filter(s => !s.drums) }, { heading: 'Drums', sounds: sounds.filter(s => s.drums) }].filter(g => g.sounds.length > 0),
      onHear: s => calls.push(`hear ${s.label}`),
      onAdd: s => calls.push(`add ${s.label}`),
      onEmpty: () => calls.push('empty'),
      onCancel: () => calls.push('cancel')
    })
    document.body.append(chooser.element)
    return chooser
  }
  const sounds = [{ iri: 'a', label: 'Pulse', about: 'A square wave.', drums: false }, { iri: 'b', label: 'Kit', about: 'Drums.', drums: true }]
  const click = el => el.dispatchEvent(new document.defaultView.Event('click', { bubbles: true }))

  it('is a dialog named by its heading, with a status line for a screen reader', () => {
    const { element } = build(sounds)
    const heading = element.querySelector('#sound-chooser-title')
    expect(element.getAttribute('aria-labelledby')).toBe(heading.id)
    expect(element.querySelector('[role="status"]')).not.toBeNull()
  })

  it('gives every Hear and Add button a name that says which sound, so a list of them can be told apart', () => {
    const { element } = build(sounds)
    const names = [...element.querySelectorAll('.sound-list button')].map(b => b.getAttribute('aria-label'))
    expect(names).toEqual(['Hear Pulse', 'Add Pulse', 'Hear Kit', 'Add Kit'])
  })

  it('runs what was pressed, with the sound it belongs to', () => {
    const calls = []
    const { element } = build(sounds, calls)
    const buttons = [...element.querySelectorAll('button')]
    click(buttons.find(b => b.getAttribute('aria-label') === 'Hear Kit'))
    click(buttons.find(b => b.getAttribute('aria-label') === 'Add Pulse'))
    click(buttons.find(b => b.textContent === 'An empty track'))
    click(buttons.find(b => b.textContent === 'Cancel'))
    expect(calls).toEqual(['hear Kit', 'add Pulse', 'empty', 'cancel'])
  })

  it('treats the dialog being dismissed, as Escape does, as Cancel', () => {
    const calls = []
    const { element } = build(sounds, calls)
    element.dispatchEvent(new document.defaultView.Event('cancel'))
    expect(calls).toEqual(['cancel'])
  })

  it('says in words which sound is on the trial track, and only that one', () => {
    const { element, heard } = build(sounds)
    heard('b')
    const marks = [...element.querySelectorAll('.sound-mark')].map(m => m.textContent)
    expect(marks).toEqual(['', ' (on the trial track)'])
    heard(null)
    expect([...element.querySelectorAll('.sound-mark')].map(m => m.textContent)).toEqual(['', ''])
  })

  it('lists the sounds under a heading for each group, each list named by its heading', () => {
    const { element } = build(sounds)
    const headings = [...element.querySelectorAll('h3')].map(h => h.textContent)
    expect(headings).toEqual(['Instruments', 'Drums'])
    for (const list of element.querySelectorAll('ul.sound-list')) {
      expect(document.getElementById(list.getAttribute('aria-labelledby')).tagName).toBe('H3')
    }
  })

  it('says there are no sounds, rather than showing an empty list, when it has none', () => {
    const { element } = build([])
    expect(element.querySelectorAll('.sound-list li')).toHaveLength(0)
    const none = [...element.querySelectorAll('p.note')].find(p => /No sounds/.test(p.textContent))
    expect(none.hidden).toBe(false)
  })
})
