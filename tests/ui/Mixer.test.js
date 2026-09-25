// tests/ui/Mixer.test.js
//
// One strip per track, and none for a track nothing can be heard from. The
// mixer used to be drawn inside web/app.js, where the only way to test it was
// to read its source text; here it is driven.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createMixer, mixable } from '../../src/ui/Mixer.js'

let document
beforeEach(() => { document = parseHTML('<!doctype html><html><body></body></html>').document })

const channel = (over = {}) => ({ gain: 1, pan: 0, muted: false, soloed: false, ...over })
const track = (id, label, over = {}) => ({ id, label, channel: channel(over), midiInput: null, audioInput: null })

const outputs = { synth: 1, verb: 2, gen: 0 }
const audioOutputsOf = id => outputs[id]

function drawn ({ tracks, nodes, audibility = [], onChange = () => {} }) {
  const mixer = createMixer(document, { onChange })
  document.body.append(mixer.element)
  const draw = (t = tracks, a = audibility) => mixer.draw({
    tracks: t, nodes, audibility: a, audioOutputsOf, labelFor: x => x.label
  })
  draw()
  return { mixer, draw }
}

const headings = element => [...element.querySelectorAll('.mixer-channel h3')].map(h => h.textContent)

describe('which tracks get a strip', () => {
  const nodes = [
    { id: 'gen', track: 'lines' },
    { id: 'synth', track: 'lead' },
    { id: 'verb', track: 'lead' },
    { id: 'loading', track: 'pending' }
  ]

  it('draws one strip per track, however many plugins are on it', () => {
    const { mixer } = drawn({ tracks: [track('lead', 'Lead')], nodes })
    expect(headings(mixer.element)).toEqual(['Lead'])
    expect(mixer.element.querySelectorAll('.strip')).toHaveLength(1)
  })

  it('leaves out a track whose every plugin has no audio output', () => {
    const { mixer } = drawn({ tracks: [track('lines', 'Lines'), track('lead', 'Lead')], nodes })
    expect(headings(mixer.element)).toEqual(['Lead'])
  })

  it('keeps a track with no plugins, whose audio clips go straight to its fader', () => {
    expect(mixable(track('clips', 'Clips'), nodes, audioOutputsOf)).toBe(true)
  })

  it('counts a plugin not yet loaded as audio, rather than hiding a strip it may need', () => {
    expect(mixable(track('pending', 'Pending'), nodes, audioOutputsOf)).toBe(true)
  })

  it('says why it is empty', () => {
    expect(drawn({ tracks: [], nodes: [] }).mixer.element.textContent).toMatch(/No tracks yet/)
    expect(drawn({ tracks: [track('lines', 'Lines')], nodes }).mixer.element.textContent)
      .toMatch(/has an audio output to mix/)
  })
})

describe('what a strip does', () => {
  const nodes = [{ id: 'synth', track: 'a' }, { id: 'verb', track: 'b' }]

  it('reports a change against its track', () => {
    const seen = []
    const { mixer } = drawn({
      tracks: [track('a', 'A'), track('b', 'B')], nodes, onChange: (id, change) => seen.push([id, change])
    })
    const mute = [...mixer.element.querySelectorAll('.mixer-channel')][1]
      .querySelector('button[aria-pressed]')
    mute.dispatchEvent(new document.defaultView.Event('click'))
    expect(seen).toEqual([['b', { muted: true }]])
  })

  it('shows a track silenced by another track\'s solo, without calling it muted', () => {
    const { mixer } = drawn({
      tracks: [track('a', 'A', { soloed: true }), track('b', 'B')],
      nodes,
      audibility: [{ trackId: 'a', silent: false }, { trackId: 'b', silent: true }]
    })
    const [a, b] = mixer.element.querySelectorAll('.strip')
    expect(a.classList.contains('silent')).toBe(false)
    expect(b.classList.contains('silent')).toBe(true)
    expect(b.querySelector('button[aria-pressed]').getAttribute('aria-pressed')).toBe('false')
  })

  it('keeps the same strip element across redraws, so focus on it survives an edit', () => {
    const { mixer, draw } = drawn({ tracks: [track('a', 'A')], nodes })
    const before = mixer.element.querySelector('.strip')
    draw([track('a', 'A', { gain: 0.5 })])
    expect(mixer.element.querySelector('.strip')).toBe(before)
  })

  it('takes nothing out of the document when no track was added or removed', () => {
    // Taking a focused element out of the document blurs it. A mixer that
    // rebuilt itself on every edit lost the focus from the button just pressed.
    const { mixer, draw } = drawn({ tracks: [track('a', 'A'), track('b', 'B')], nodes })
    let replaced = 0
    const real = mixer.element.replaceChildren.bind(mixer.element)
    mixer.element.replaceChildren = (...children) => { replaced += 1; return real(...children) }
    draw([track('a', 'A', { muted: true }), track('b', 'B')])
    expect(replaced).toBe(0)
    expect(mixer.element.querySelector('button[aria-pressed]').getAttribute('aria-pressed')).toBe('true')
    draw([track('b', 'B')])
    expect(replaced).toBe(1)
  })

  it('renames a channel in place', () => {
    const { mixer, draw } = drawn({ tracks: [track('a', 'A')], nodes })
    draw([track('a', 'Drums')])
    expect(headings(mixer.element)).toEqual(['Drums'])
    expect(mixer.element.querySelector('.strip').getAttribute('aria-label')).toBe('Drums channel')
  })

  it('drops the strip of a track that has gone', () => {
    const { mixer, draw } = drawn({ tracks: [track('a', 'A')], nodes })
    const before = mixer.element.querySelector('.strip')
    draw([])
    draw([track('a', 'A')])
    expect(mixer.element.querySelector('.strip')).not.toBe(before)
  })

  it('needs somewhere to send a change', () => {
    expect(() => createMixer(document, {})).toThrow(/onChange/)
  })
})

describe('control ids', () => {
  it('come from the track, so two tracks with one name do not share them', () => {
    const { mixer } = drawn({ tracks: [track('a', 'Pulse'), track('b', 'Pulse')], nodes: [] })
    const ids = [...mixer.element.querySelectorAll('[id]')].map(e => e.id)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids).toContain('strip-a-muted')
    expect(ids).toContain('strip-b-level')
  })
})
