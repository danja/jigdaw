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
  const strip = createChainStrip(document, { onSelect: id => picked.push(id) })
  document.body.append(strip.element)
  strip.update(chain, { label: 'Lead', selected })
  return { strip, picked }
}

describe('the chain strip', () => {
  it('draws one button per plugin, in order, each saying what it takes and gives', () => {
    build({ nodes: [node({ id: 'a', label: 'Synth' }), node({ id: 'b', label: 'Reverb', takes: ['audio'] })] })
    expect([...document.querySelectorAll('.chain-node')].map(b => b.textContent)).toEqual(['Synth', 'Reverb'])
    expect([...document.querySelectorAll('.chain-io')].map(s => s.textContent)).toEqual(['MIDI in, audio out', 'audio in, audio out'])
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
  })
})
