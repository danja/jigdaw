// tests/ui/Strip.test.js
//
// The channel strip is drawn for every node, so an inaccessible one is an
// inaccessible mixer. The same reasoning as Panel.test.js: one generator makes
// every channel usable or none of them.
//
// The value assertions matter as much as the accessibility ones. A fader that
// reports 0.7 rather than -3.1 dB is reporting the number the engine wants
// rather than the one a person reads, and AGENTS.md is explicit that those are
// different information.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createStrip, decibels, panPosition } from '../../src/ui/Strip.js'
import { appSource, appFile } from './appSource.js'

let document
beforeEach(() => { document = parseHTML('<!doctype html><html><body></body></html>').document })

const build = (channel = {}, onChange = () => {}) =>
  createStrip(document, channel, onChange, { label: 'Pulse' })

describe('what a strip says', () => {
  it('reports level in decibels, not in the linear gain the engine takes', () => {
    const strip = build({ gain: 1 })
    const value = strip.element.querySelectorAll('.value')[0]
    expect(value.textContent).toBe('0.0 dB')
  })

  it('says unity, half and silence correctly', () => {
    expect(decibels(1)).toBe('0.0')
    expect(decibels(0.5)).toBe('-6.0')
    expect(decibels(2)).toBe('+6.0')
    // Not "-Infinity dB", which is a number rather than a thing to read.
    expect(decibels(0)).toBe('-inf')
  })

  it('says where a pan is, rather than what number it is', () => {
    expect(panPosition(0)).toBe('centre')
    expect(panPosition(-1)).toBe('100% left')
    expect(panPosition(0.5)).toBe('50% right')
    // A fader nudged off centre by a pixel is still centre to a listener.
    expect(panPosition(0.001)).toBe('centre')
  })

  it('gives every slider its value as text, not only as a number', () => {
    const strip = build({ gain: 0.5, pan: -1 })
    const sliders = strip.element.querySelectorAll('input[type=range]')
    expect(sliders[0].getAttribute('aria-valuetext')).toBe('-6.0 decibels')
    expect(sliders[1].getAttribute('aria-valuetext')).toBe('100% left')
  })
})

describe('what a strip is, to a screen reader', () => {
  it('is a named group', () => {
    const strip = build()
    expect(strip.element.getAttribute('role')).toBe('group')
    expect(strip.element.getAttribute('aria-label')).toBe('Pulse channel')
  })

  it('labels every slider with a control that points at it', () => {
    const strip = build()
    for (const slider of strip.element.querySelectorAll('input[type=range]')) {
      expect(slider.id, 'a slider needs an id for its label to point at').toBeTruthy()
      const label = strip.element.querySelector(`label[for="${slider.id}"]`)
      expect(label, `no label points at ${slider.id}`).not.toBeNull()
      expect(label.textContent.length).toBeGreaterThan(0)
    }
  })

  it('makes mute and solo pressed buttons rather than checkboxes', () => {
    // They are not a form. aria-pressed is what says a toggle is engaged.
    const strip = build({ muted: true, soloed: false })
    const mute = strip.element.querySelector('.strip-toggle.muted')
    const solo = strip.element.querySelector('.strip-toggle.soloed')
    expect(mute.getAttribute('aria-pressed')).toBe('true')
    expect(solo.getAttribute('aria-pressed')).toBe('false')
    expect(mute.type).toBe('button')
  })

  it('says it is silent, rather than only dimming it', () => {
    // Solo silences a node without muting it, so a strip showing only its own
    // flags would say a node was heard while it was not. And state must not be
    // signalled by colour alone.
    const strip = build()
    strip.update({}, { silent: true })
    expect(strip.element.classList.contains('silent')).toBe(true)
    expect(strip.element.getAttribute('aria-label')).toBe('Pulse channel, silent')
    strip.update({}, { silent: false })
    expect(strip.element.getAttribute('aria-label')).toBe('Pulse channel')
  })
})

describe('the strip uses the same control as the panel', () => {
  // A page with knobs for a plugin and sliders for the mixer beside it reads
  // as two interfaces, which is what it was. The strip is still not a panel:
  // no lv2:port declares its controls and Panel.js does not draw them. Only
  // the widget is shared.
  it('draws level and pan as rotary controls', () => {
    const { element } = createStrip(document, {}, () => {}, { label: 'Pulse' })
    expect(element.querySelectorAll('.dial')).toHaveLength(2)
    // Still a native range underneath, which is where the keyboard and the
    // announced value come from.
    expect([...element.querySelectorAll('.dial input')].map(i => i.type)).toEqual(['range', 'range'])
  })

  it('grows the pan arc from the centre and the level arc from silence', () => {
    // Centred is nothing, not half. Unity gain is not the middle of nought to
    // two in decibels, so level has no centre to grow from.
    const { element } = createStrip(document, { gain: 1, pan: 0 }, () => {}, { label: 'Pulse' })
    const [level, pan] = [...element.querySelectorAll('.dial-value')]
      .map(c => Number(c.getAttribute('stroke-dasharray').split(' ')[0]))
    expect(pan).toBe(0)
    expect(level).toBeGreaterThan(0)
  })
})

describe('what a strip reports', () => {
  it('sends only what changed, so one movement is one operation', () => {
    const changes = []
    const strip = build({ gain: 1, pan: 0 }, c => changes.push(c))
    const [gain, pan] = strip.element.querySelectorAll('input[type=range]')

    gain.value = '0.5'
    gain.dispatchEvent(new document.defaultView.Event('input'))
    expect(changes).toEqual([{ gain: 0.5 }])

    pan.value = '-0.25'
    pan.dispatchEvent(new document.defaultView.Event('input'))
    expect(changes[1]).toEqual({ pan: -0.25 })
  })

  it('toggles mute and solo, reporting the new state', () => {
    const changes = []
    const strip = build({}, c => changes.push(c))
    strip.element.querySelector('.strip-toggle.muted').click()
    strip.element.querySelector('.strip-toggle.soloed').click()
    expect(changes).toEqual([{ muted: true }, { soloed: true }])
  })

  it('renders what the host decided rather than what was requested', () => {
    const strip = build({ gain: 1 })
    strip.update({ gain: 0.25 })
    const slider = strip.element.querySelector('input[type=range]')
    expect(slider.value).toBe('0.25')
    expect(strip.element.querySelector('.value').textContent).toBe('-12.0 dB')
  })
})

describe('where the application draws strips', () => {
  // A strip belongs to a track now, not to a plugin (docs/project-format.md
  // "Tracks"), so the rack draws none and the mixer draws one per track. The
  // mixer is src/ui/Mixer.js and tests/ui/Mixer.test.js drives it; what is
  // left to check here is that the page uses it and nothing else. drawRack is
  // in the browser bundle, where there is no AudioContext to build a real
  // Engine against, so the wiring is checked in the source, the way
  // tests/ui/Focus.test.js already checks that drawRack calls preserveFocus.
  const app = appSource()
  const rack = appFile('web/app/Rack.js')
  const drawStart = rack.indexOf('function drawRack')
  const draw = rack.slice(drawStart, rack.indexOf('\n  }\n', drawStart))

  it('builds no strip in the rack, where there is no longer one per plugin', () => {
    expect(app).not.toMatch(/createStrip\(/)
    expect(app).not.toMatch(/setChannel\(/)
  })

  it('draws the mixer from drawRack, before deciding the rack is empty', () => {
    // Before the empty check, because the mixer answers its own empty case and
    // must not be skipped along with the rack's.
    const call = draw.indexOf('mixer.draw(')
    const emptyCheck = draw.indexOf('tracks.length === 0')
    expect(call, 'drawRack never draws the mixer').toBeGreaterThan(-1)
    expect(emptyCheck).toBeGreaterThan(-1)
    expect(call, 'the mixer is drawn after the rack could already have returned').toBeLessThan(emptyCheck)
  })

  it('sends a strip change to the track it belongs to', () => {
    expect(app).toMatch(/dispatcher\.setTrackChannel\(trackId, change\)/)
  })
})
