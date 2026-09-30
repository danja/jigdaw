// tests/ui/TrackHeader.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTrackHeader } from '../../src/ui/TrackHeader.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  return e
}

function build () {
  const calls = []
  const rec = name => (...args) => calls.push([name, ...args])
  const header = createTrackHeader(document, { id: 't1', onSelect: rec('select'), onAdd: rec('add'), onAddAudio: rec('addAudio'), onChannel: rec('channel'), onMove: rec('move') })
  document.body.append(header.element)
  const state = { label: 'Bass', channel: { gain: 1, pan: 0, muted: false, soloed: false }, mixable: true, silent: false, at: 8, where: 'bar 3 beat 1' }
  header.update(state)
  return { header, calls, state, $: id => document.getElementById(id) }
}

describe('a track header', () => {
  it('names each control for the track it belongs to, and says its value as text', () => {
    const { $ } = build()
    expect($('head-t1-muted').getAttribute('aria-label')).toBe('Mute Bass')
    expect($('head-t1-gain').getAttribute('aria-label')).toBe('Level, Bass')
    expect($('head-t1-gain').getAttribute('aria-valuetext')).toBe('0.0 decibels')
    expect($('head-t1-pan').getAttribute('aria-valuetext')).toBe('centre')
    expect($('add-clip-t1').getAttribute('aria-label')).toBe('Add a MIDI clip to Bass at bar 3 beat 1')
  })

  it('sends only the part that changed, once per movement', () => {
    const { $, calls } = build()
    $('head-t1-muted').dispatchEvent(event('click'))
    $('head-t1-soloed').dispatchEvent(event('click'))
    $('head-t1-muted').dispatchEvent(event('click'))
    const level = $('head-t1-gain'); level.value = '0.5'; level.dispatchEvent(event('input'))
    const pan = $('head-t1-pan'); pan.value = '-0.25'; pan.dispatchEvent(event('input'))
    expect(calls).toEqual([
      ['channel', 't1', { muted: true }], ['channel', 't1', { soloed: true }], ['channel', 't1', { muted: false }],
      ['channel', 't1', { gain: 0.5 }], ['channel', 't1', { pan: -0.25 }]
    ])
    expect($('head-t1-pan').getAttribute('aria-valuetext')).toBe('25% left')
  })

  it('shows the pressed state as aria-pressed, from the model, and not by colour alone', () => {
    const { header, state, $ } = build()
    header.update({ ...state, channel: { ...state.channel, muted: true } })
    expect($('head-t1-muted').getAttribute('aria-pressed')).toBe('true')
    expect($('head-t1-soloed').getAttribute('aria-pressed')).toBe('false')
  })

  it('leaves the mix controls out for a track with nothing to hear, rather than disabling them', () => {
    const { header, state } = build()
    header.update({ ...state, mixable: false })
    expect(header.element.querySelector('.head-mix').hidden).toBe(true)
    expect(header.element.querySelectorAll('[disabled]')).toHaveLength(0)
  })

  it('says when solo has silenced it, in words', () => {
    const { header, state } = build()
    header.update({ ...state, silent: true })
    expect(header.element.getAttribute('aria-label')).toBe('Bass controls, silent')
    expect(header.element.querySelector('.head-silent').hidden).toBe(false)
  })

  it('does not move a slider that has the focus, since the person is holding it', () => {
    const { header, state, $ } = build()
    const level = $('head-t1-gain')
    // linkedom's focus() does not move activeElement, which a browser's does.
    Object.defineProperty(document, 'activeElement', { value: level, configurable: true })
    level.value = '0.7'
    header.update({ ...state, channel: { ...state.channel, gain: 1 } })
    expect(level.value).toBe('0.7')
  })

  it('selects the track from its name, and adds a clip where the timeline last said', () => {
    const { header, state, calls, $ } = build()
    $('show-track-t1').dispatchEvent(event('click'))
    $('add-clip-t1').dispatchEvent(event('click'))
    header.update({ ...state, at: 12 })
    $('add-audio-t1').dispatchEvent(event('click'))
    expect(calls).toEqual([['select', 't1', { toggle: false }], ['add', 't1', 8], ['addAudio', 't1', 12]])
  })

  it('says a selected track is selected, in text and not only style', () => {
    const { header, state, $ } = build()
    header.update({ ...state, selected: true })
    expect($('show-track-t1').getAttribute('aria-pressed')).toBe('true')
    expect($('show-track-t1').getAttribute('aria-label')).toBe('Select Bass')
    expect(header.element.classList.contains('selected')).toBe(true)
  })

  it('moves the track with Alt and the arrow keys, and ignores the arrows alone', () => {
    const { calls, $ } = build()
    $('show-track-t1').dispatchEvent(event('keydown', { key: 'ArrowUp', altKey: true }))
    $('show-track-t1').dispatchEvent(event('keydown', { key: 'ArrowDown', altKey: true }))
    $('show-track-t1').dispatchEvent(event('keydown', { key: 'ArrowDown' }))
    $('show-track-t1').dispatchEvent(event('keydown', { key: 'a', altKey: true }))
    expect(calls).toEqual([['move', 't1', -1], ['move', 't1', 1]])
  })

  it('carries its colour and size for the timeline to style, and drops them when cleared', () => {
    const { header, state } = build()
    header.update({ ...state, color: '#3e8ef7', size: 'small' })
    expect(header.element.style.getPropertyValue('--track-color')).toBe('#3e8ef7')
    expect(header.element.dataset.size).toBe('small')
    header.update({ ...state, color: null })
    expect(header.element.style.getPropertyValue('--track-color')).toBe('')
  })

  it('says how late the track is when it is late, and says nothing when it is not', () => {
    const { header, state } = build()
    const shown = () => { const p = header.element.querySelector('.head-latency'); return p.hidden ? null : p.textContent }
    expect(shown()).toBeNull()
    header.update({ ...state, latency: { frames: 2047, ms: 42.6458 } })
    expect(shown()).toBe('Latency 2047 frames, 42.6 ms')
    header.update({ ...state, latency: { frames: 512, ms: null } })
    expect(shown()).toBe('Latency 512 frames')
    header.update({ ...state, latency: { frames: 0, ms: 0 } })
    expect(shown()).toBeNull()
  })

  it('refuses to be built without its handlers', () => {
    expect(() => createTrackHeader(document, { id: 't', onSelect () {}, onAdd () {}, onAddAudio () {}, onMove () {} })).toThrow(/onChannel/)
  })
})
