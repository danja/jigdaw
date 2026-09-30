// tests/ui/AudioClipPanel.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createAudioClipPanel } from '../../src/ui/AudioClipPanel.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  return e
}
const clip = { id: 'c3', track: 't', kind: 'audio', startBeat: 8, lengthBeats: 4, source: 'https://x.test/loop.wav', offsetSeconds: 0.25 }

function build () {
  const calls = []
  const panel = createAudioClipPanel(document, { onSet: (...a) => calls.push(['set', ...a]), onRemove: (...a) => calls.push(['remove', ...a]) })
  document.body.append(panel.element)
  panel.show(clip, { beatsPerBar: 4, label: 'Loop' })
  return { panel, calls, $: id => document.getElementById(id) }
}

describe('the audio clip panel', () => {
  it('says where the clip is and what it plays, and fills the fields', () => {
    const { $ } = build()
    expect(document.querySelector('.audio-summary').textContent).toBe('Loop: audio clip at bar 3 beat 1.')
    expect(document.querySelector('.audio-source').textContent).toBe('File: https://x.test/loop.wav')
    expect([$('audio-startBeat').value, $('audio-lengthBeats').value, $('audio-offsetSeconds').value]).toEqual(['8', '4', '0.25'])
  })

  it('sends one change for one field, on change or on Enter, never per keystroke', () => {
    const { $, calls } = build()
    $('audio-startBeat').value = '12'
    $('audio-startBeat').dispatchEvent(event('input'))
    expect(calls).toEqual([])
    $('audio-startBeat').dispatchEvent(event('change'))
    $('audio-lengthBeats').value = '2,5'
    $('audio-lengthBeats').dispatchEvent(event('keydown', { key: 'Enter' }))
    expect(calls).toEqual([['set', 'c3', { startBeat: 12 }], ['set', 'c3', { lengthBeats: 2.5 }]])
  })

  it('refuses text, a negative start and a length below a sixteenth, saying why', () => {
    const { $, calls } = build()
    for (const [id, text] of [['audio-startBeat', 'abc'], ['audio-startBeat', '-1'], ['audio-lengthBeats', '0.1']]) {
      $(id).value = text
      $(id).dispatchEvent(event('change'))
    }
    expect(calls).toEqual([])
    expect(document.querySelector('.audio-problem').textContent).toMatch(/Length \(beats\) must be a number, 0.25 or more/)
  })

  it('shows and sets both fades, refusing a negative one', () => {
    const { $, calls, panel } = build()
    expect([$('audio-fadeInBeats').value, $('audio-fadeOutBeats').value]).toEqual(['0', '0'])
    panel.show({ ...clip, fadeInBeats: 1, fadeOutBeats: 0.5 }, { beatsPerBar: 4, label: 'Loop' })
    expect([$('audio-fadeInBeats').value, $('audio-fadeOutBeats').value]).toEqual(['1', '0.5'])
    $('audio-fadeOutBeats').value = '2'
    $('audio-fadeOutBeats').dispatchEvent(event('change'))
    $('audio-fadeInBeats').value = '-1'
    $('audio-fadeInBeats').dispatchEvent(event('change'))
    expect(calls).toEqual([['set', 'c3', { fadeOutBeats: 2 }]])
    expect(document.querySelector('.audio-problem').textContent).toMatch(/Fade in \(beats\) must be a number, 0 or more/)
  })

  it('removes the clip it shows', () => {
    const { calls } = build()
    document.querySelector('button').dispatchEvent(event('click'))
    expect(calls).toEqual([['remove', 'c3']])
  })

  it('says when the file cannot play', () => {
    const { panel } = build()
    panel.show(clip, { beatsPerBar: 4, label: 'Loop', unplayable: '404 for loop.wav' })
    expect(document.querySelector('.audio-problem').textContent).toBe('Cannot play: 404 for loop.wav')
  })

  it('will not be built without its handlers', () => {
    expect(() => createAudioClipPanel(document, { onSet () {} })).toThrow(/onRemove/)
  })
})
