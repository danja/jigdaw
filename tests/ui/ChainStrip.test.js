// tests/ui/ChainStrip.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createChainStrip } from '../../src/ui/ChainStrip.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const node = (over = {}) => ({
  id: 'a', label: 'Synth', loaded: true, failed: null, takes: ['MIDI'], gives: ['audio'],
  takesMidiFromTrack: false, takesAudioFromTrack: false, sends: [], receives: [], ...over
})

function build (chain, selected = null) {
  const picked = []
  const bypassed = []
  const moved = []
  const strip = createChainStrip(document, { onSelect: id => picked.push(id), onBypass: (id, on) => bypassed.push([id, on]), onMove: (id, delta) => moved.push([id, delta]) })
  document.body.append(strip.element)
  strip.update(chain, { label: 'Lead', selected })
  return { strip, picked, bypassed, moved }
}

describe('the chain strip', () => {
  it('draws one button per plugin, in order, each saying what it takes and gives', () => {
    build({ nodes: [node({ id: 'a', label: 'Synth' }), node({ id: 'b', label: 'Reverb', takes: ['audio'] })] })
    expect([...document.querySelectorAll('.chain-node')].map(b => b.textContent)).toEqual(['Synth', 'Reverb'])
    expect([...document.querySelectorAll('.chain-io')].map(s => s.textContent)).toEqual(['MIDI in, audio out', 'audio in, audio out'])
  })

  it('offers Bypass on a loaded plugin, says its state in name, pressed state and words, and asks for the opposite', () => {
    const { bypassed } = build({ nodes: [node({ id: 'a', label: 'Reverb', takes: ['audio'] }), node({ id: 'b', label: 'Delay', takes: ['audio'], bypassed: true })] })
    const buttons = [...document.querySelectorAll('.chain-bypass')]
    expect(buttons.map(b => b.getAttribute('aria-label'))).toEqual(['Bypass Reverb', 'Bypass Delay'])
    // Findable by id after a redraw, which is how the focus is put back.
    expect(buttons.map(b => b.id)).toEqual(['chain-bypass-a', 'chain-bypass-b'])
    expect(buttons.map(b => b.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
    expect(document.querySelectorAll('.chain-item.bypassed')).toHaveLength(1)
    expect([...document.querySelectorAll('.chain-io')][1].textContent).toBe('bypassed: passes what it gets')
    expect(document.querySelectorAll('.chain-node')[1].getAttribute('aria-label')).toMatch(/^Delay; bypassed/)
    buttons[0].dispatchEvent(new document.defaultView.Event('click'))
    buttons[1].dispatchEvent(new document.defaultView.Event('click'))
    expect(bypassed).toEqual([['a', true], ['b', false]])
  })

  // linkedom has no KeyboardEvent: a plain event carrying the fields the handler reads.
  const key = fields => Object.assign(new document.defaultView.Event('keydown', { cancelable: true }), fields)
  const audioFx = (id, label) => node({ id, label, takes: ['audio'], gives: ['audio'], passesAudio: true })

  it('offers Move earlier and later only where a neighbour takes and gives audio, and asks for one place', () => {
    const { moved } = build({ nodes: [audioFx('a', 'EQ'), audioFx('b', 'Comp'), audioFx('c', 'Verb'), node({ id: 'd', label: 'Synth' })] })
    const names = () => [...document.querySelectorAll('.chain-move')].map(b => b.getAttribute('aria-label'))
    // EQ has nothing earlier; Verb has a synth after it (not audio in and out); the synth has no moves at all.
    expect(names()).toEqual(['Move later: EQ', 'Move earlier: Comp', 'Move later: Comp', 'Move earlier: Verb'])
    const buttons = [...document.querySelectorAll('.chain-move')]
    buttons[0].dispatchEvent(new document.defaultView.Event('click'))
    buttons[1].dispatchEvent(new document.defaultView.Event('click'))
    expect(moved).toEqual([['a', 1], ['b', -1]])
    expect(buttons.map(b => b.id)).toEqual(['chain-move-later-a', 'chain-move-earlier-b', 'chain-move-later-b', 'chain-move-earlier-c'])
  })

  it('moves with Alt and Left or Right on the plugin button, only where it can, and never without Alt', () => {
    const { moved } = build({ nodes: [audioFx('a', 'EQ'), audioFx('b', 'Comp')] })
    const [first, second] = [...document.querySelectorAll('.chain-node')]
    first.dispatchEvent(key({ key: 'ArrowLeft', altKey: true }))
    first.dispatchEvent(key({ key: 'ArrowRight', altKey: true }))
    second.dispatchEvent(key({ key: 'ArrowLeft', altKey: true }))
    second.dispatchEvent(key({ key: 'ArrowRight', altKey: true }))
    first.dispatchEvent(key({ key: 'ArrowRight' }))
    expect(moved).toEqual([['a', 1], ['b', -1]])
  })

  it('leaves Bypass out for a plugin that failed or has not loaded', () => {
    build({ nodes: [node({ id: 'a', failed: 'no' }), node({ id: 'b', loaded: false })] })
    expect(document.querySelectorAll('.chain-bypass')).toHaveLength(0)
  })

  it('selects a plugin from its button and says which is selected', () => {
    const { picked } = build({ nodes: [node()] }, 'a')
    const button = document.getElementById('chain-a')
    expect(button.getAttribute('aria-pressed')).toBe('true')
    button.dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(picked).toEqual(['a'])
  })

  it('names the button in words, including what it sends and what reaches it from elsewhere', () => {
    build({ nodes: [node({
      sends: [{ kind: 'audio', toLabel: 'Bus', other: true, toTrackLabel: 'Drums', parameter: null }],
      receives: [{ kind: 'MIDI', fromLabel: 'Gen', fromTrackLabel: 'Bass' }]
    })] })
    const label = document.getElementById('chain-a').getAttribute('aria-label')
    expect(label).toContain('sends audio to Bus on Drums')
    expect(label).toContain('receives MIDI from Gen on Bass')
    expect([...document.querySelectorAll('.chain-links li')].map(li => li.textContent)).toEqual(['audio to Bus on Drums', 'MIDI from Gen on Bass'])
    expect(document.querySelectorAll('.chain-links li.other')).toHaveLength(2)
  })

  it('shows a failed plugin and one still loading as such, in text, beside the rest', () => {
    build({ nodes: [node({ id: 'a', failed: 'boom' }), node({ id: 'b', label: 'Slow', loaded: false })] })
    const [failed, loading] = [...document.querySelectorAll('.chain-item')]
    expect(failed.classList.contains('failed')).toBe(true)
    expect(failed.querySelector('.chain-io').textContent).toBe('failed to load')
    expect(loading.querySelector('.chain-io').textContent).toBe('loading')
  })

  it('is left out for a track with no plugins', () => {
    const { strip } = build({ nodes: [] })
    expect(strip.element.hidden).toBe(true)
  })

  it('will not be built without its handler', () => {
    expect(() => createChainStrip(document, {})).toThrow(/onSelect/)
    expect(() => createChainStrip(document, { onSelect () {} })).toThrow(/onBypass/)
    expect(() => createChainStrip(document, { onSelect () {}, onBypass () {} })).toThrow(/onMove/)
  })
})
