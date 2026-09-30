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
  const panel = createBulkTrackPanel(document, { onChannel: rec('channel'), onColor: rec('color'), onSize: rec('size') })
  document.body.append(panel.element)
  panel.show({ tracks, labels: ['Lead', 'Bass'] })
  return { panel, calls, $: id => document.getElementById(id) }
}

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
