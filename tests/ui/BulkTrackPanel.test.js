// tests/ui/BulkTrackPanel.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createBulkTrackPanel, tally } from '../../src/ui/BulkTrackPanel.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })
const event = type => new window.Event(type, { bubbles: true, cancelable: true })
const track = (muted = false, soloed = false) => ({ channel: { muted, soloed } })

function build (tracks = [track(), track()]) {
  const calls = []
  const rec = name => (...a) => calls.push([name, ...a])
  const panel = createBulkTrackPanel(document, { onChannel: rec('channel'), onColor: rec('color'), onSize: rec('size'), onFolder: rec('folder'), onBus: rec('bus'), onLevelShift: rec('level'), onPanShift: rec('pan') })
  document.body.append(panel.element)
  panel.show({ tracks, labels: ['Lead', 'Bass'] })
  return { panel, calls, $: id => document.getElementById(id) }
}

describe('the typed amounts', () => {
  const apply = id => document.getElementById(id).dispatchEvent(event('click'))
  it('send the level and the pan typed as exact shifts', () => {
    const { $, calls } = build()
    $('bulk-level-by').value = '-2.5'
    apply('bulk-level-by-apply')
    $('bulk-pan-by').value = '0.25'
    apply('bulk-pan-by-apply')
    expect(calls).toEqual([['level', -2.5], ['pan', 0.25]])
  })

  it('refuse a pan shift beyond one, so the panel never asks for what cannot be done', () => {
    const { $, calls } = build()
    $('bulk-pan-by').value = '1.5'
    apply('bulk-pan-by-apply')
    expect(calls).toEqual([])
    expect($('bulk-pan-by').getAttribute('aria-invalid')).toBe('true')
  })
})

describe('the folder controls', () => {
  it('commit a trimmed name for all, ignore an empty one, and offer the names in use', () => {
    const { $, calls, panel } = build()
    panel.show({ tracks: [track(), track()], labels: ['Lead', 'Bass'], folders: ['Drums', 'Keys'] })
    expect([...document.querySelectorAll('#bulk-folder-names option')].map(o => o.value)).toEqual(['Drums', 'Keys'])
    $('bulk-folder').value = '  Drums '
    $('bulk-folder').dispatchEvent(event('change'))
    $('bulk-folder').value = '   '
    $('bulk-folder').dispatchEvent(event('change'))
    expect(calls).toEqual([['folder', 'Drums']])
    expect($('bulk-folder').value).toBe('')
  })

  it('leave out Take out of their folder until one of them is in a folder, then send null', () => {
    const { $, calls, panel } = build()
    expect($('bulk-unfolder').hidden).toBe(true)
    panel.show({ tracks: [track(), track()], labels: ['Lead', 'Bass'], inFolder: 1 })
    expect($('bulk-unfolder').hidden).toBe(false)
    $('bulk-unfolder').dispatchEvent(event('click'))
    expect(calls).toEqual([['folder', null]])
  })

  it('will not be built without onFolder', () => {
    const noop = () => {}
    expect(() => createBulkTrackPanel(document, { onChannel: noop, onColor: noop, onSize: noop, onBus: noop, onLevelShift: noop, onPanShift: noop })).toThrow(/onFolder/)
  })
})

describe('the bus button', () => {
  it('asks for a bus with no argument', () => {
    const { $, calls } = build()
    $('bulk-bus').dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(calls).toEqual([['bus']])
  })
})

describe('tally', () => {
  it('says all, none or some', () => {
    expect(tally([track(true), track(true)], 'muted')).toBe('all')
    expect(tally([track(), track()], 'muted')).toBe('none')
    expect(tally([track(true), track()], 'muted')).toBe('some')
  })
})

describe('the bulk track panel', () => {
  it('says how many tracks and which', () => {
    build()
    expect(document.querySelector('.bulk-summary').textContent).toBe('2 tracks selected: Lead, Bass.')
  })

  it('mutes all when not all are muted, and turns it off only when all are', () => {
    const { panel, calls, $ } = build([track(true), track(false)])
    expect($('bulk-mute').textContent).toBe('Mute all')
    $('bulk-mute').dispatchEvent(event('click'))
    panel.show({ tracks: [track(true), track(true)], labels: ['a', 'b'] })
    expect($('bulk-mute').textContent).toBe('Mute off for all')
    expect($('bulk-mute').getAttribute('aria-pressed')).toBe('true')
    $('bulk-mute').dispatchEvent(event('click'))
    expect(calls).toEqual([['channel', { muted: true }], ['channel', { muted: false }]])
  })

  it('solos the same way', () => {
    const { calls, $ } = build()
    $('bulk-solo').dispatchEvent(event('click'))
    expect(calls).toEqual([['channel', { soloed: true }]])
  })

  it('applies a colour, and none, to all', () => {
    const { calls } = build()
    const swatches = [...document.querySelectorAll('.swatch')]
    swatches[0].dispatchEvent(event('click'))
    swatches[6].dispatchEvent(event('click'))
    expect(calls).toHaveLength(2)
    expect(calls[0]).toEqual(['color', null])
    expect(calls[1][1]).toMatch(/^#[0-9a-f]{6}$/)
    expect(swatches[6].getAttribute('aria-label')).toMatch(/for all selected tracks$/)
  })

  it('applies a lane size, and does nothing for "leave as they are"', () => {
    const { calls, $ } = build()
    Object.defineProperty($('bulk-size'), 'value', { value: '', configurable: true })
    $('bulk-size').dispatchEvent(event('change'))
    Object.defineProperty($('bulk-size'), 'value', { value: 'small', configurable: true })
    $('bulk-size').dispatchEvent(event('change'))
    expect(calls).toEqual([['size', 'small']])
  })

  it('will not be built without its handlers', () => {
    expect(() => createBulkTrackPanel(document, { onChannel () {}, onColor () {} })).toThrow(/onSize/)
  })
})

describe('the relative buttons', () => {
  it('ask for a decibel step and a pan step', () => {
    const { $, calls } = build()
    for (const id of ['bulk-quieter', 'bulk-louder', 'bulk-pan-left', 'bulk-pan-right']) {
      $(id).dispatchEvent(new window.Event('click', { bubbles: true }))
    }
    expect(calls).toEqual([['level', -1], ['level', 1], ['pan', -0.1], ['pan', 0.1]])
  })
})
