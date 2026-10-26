// tests/ui/SoundChooser.test.js
//
// Which catalogue entries are offered as sounds, how each is described, which notes Hear plays, and the dialog's controls.
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { firstSentence, soundsFrom, phraseFor, createSoundChooser } from '../../src/ui/SoundChooser.js'

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

  it('is empty for no results, so the dialog can say there are none', () => {
    expect(soundsFrom([])).toEqual([])
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
      sounds,
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

  it('says there are no sounds, rather than showing an empty list, when it has none', () => {
    const { element } = build([])
    expect(element.querySelectorAll('.sound-list li')).toHaveLength(0)
    const none = [...element.querySelectorAll('p.note')].find(p => /No sounds/.test(p.textContent))
    expect(none.hidden).toBe(false)
  })
})
