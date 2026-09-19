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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'
import { createStrip, decibels, panPosition } from '../../src/ui/Strip.js'

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

describe('the application hides a strip nobody can use', () => {
  // Level, Pan, Mute and Solo all end up at Engine.setChannel, which already
  // refuses to touch a node the engine built no gain stage for
  // (`if (!entry.strip) return`), and Engine.adopt only builds one
  // `if (profile.audioOutputs > 0 ...)`. So a MIDI generator's strip was four
  // controls that moved and never sounded: BassGen declares
  // `jig:audioOutputs 0` and had a Level knob, a Pan knob, and working Mute and
  // Solo buttons, none of which anything downstream ever heard.
  //
  // drawRack is in the browser bundle, where there is no AudioContext to build
  // a real Engine against, so the wiring is checked in the source, the way
  // tests/ui/Focus.test.js already checks that drawRack calls preserveFocus.
  const app = readFileSync(resolve(import.meta.dirname, '../../web/app.js'), 'utf8')
  const engine = readFileSync(resolve(import.meta.dirname, '../../src/engine/Engine.js'), 'utf8')
  const drawStart = app.indexOf('function drawRack')
  const draw = app.slice(drawStart, app.indexOf('\n\nfunction ', drawStart))

  it('only builds a strip once it knows the profile has an audio output', () => {
    const guard = draw.indexOf('if ((profile?.audioOutputs')
    const createStripCall = draw.indexOf('createStrip(')
    expect(guard, 'drawRack does not check audioOutputs before drawing a strip').toBeGreaterThan(-1)
    expect(guard, 'the check must come before the strip is built').toBeLessThan(createStripCall)
    // > 0, not === 0 or falsy: a profile with two audio outputs must still
    // pass, and a mutation that inverted the sense of this check is exactly
    // the shape of regression this exists to catch.
    expect(draw.slice(guard, guard + 45)).toMatch(/audioOutputs\s*\?\?\s*1\)\s*>\s*0/)
  })

  it('uses the same threshold Engine.adopt used to decide whether to build one', () => {
    // Not the same test twice: Engine.js is what actually withholds the gain
    // stage. A page that drew a strip under a different condition would show
    // controls for exactly the nodes the engine had already decided not to
    // wire one for, which is the bug this fixes, the other way round.
    expect(engine).toMatch(/audioOutputs > 0/)
  })

  it('drops a stale strip if one is cached from before this was fixed', () => {
    // forgetStrips clears the Tracks-tab strip and the Mixer-tab strip
    // together: both were built from the same audioOutputs question and a
    // node that loses the answer to one loses it to both.
    const guard = draw.indexOf('if ((profile?.audioOutputs')
    const elseBranch = draw.slice(draw.indexOf('} else {', guard))
    expect(elseBranch, 'the else branch does not clear cached strips for this node').toMatch(/forgetStrips\(node\.id\)/)
  })
})

describe('the mixer', () => {
  // A second strip instance per track, gathered on their own tab, because the
  // same DOM element cannot sit in both the Tracks slot and the Mixer tab at
  // once. Two instances of one widget is a place a fix can be made in one and
  // missed in the other, so every assertion below checks the pair rather than
  // either alone.
  const app = readFileSync(resolve(import.meta.dirname, '../../web/app.js'), 'utf8')
  const drawStart = app.indexOf('function drawRack')
  const draw = app.slice(drawStart, app.indexOf('\n\nfunction ', drawStart))
  const mixerStart = app.indexOf('function drawMixer')
  const mixer = app.slice(mixerStart, app.indexOf('\n\nfunction ', mixerStart))

  it('exists, and drawRack calls it before deciding the rack is empty', () => {
    // Before the empty check, because a track can exist in the mixer's sense
    // while drawRack has nothing else to show, and because drawMixer answers
    // its own empty case rather than being skipped along with the rack's.
    expect(mixerStart, 'no drawMixer function').toBeGreaterThan(-1)
    const call = draw.indexOf('drawMixer(')
    const emptyCheck = draw.indexOf('nodes.length === 0')
    expect(call, 'drawRack never calls drawMixer').toBeGreaterThan(-1)
    expect(call, 'drawMixer is called after the rack could already have returned')
      .toBeLessThan(emptyCheck)
  })

  it('excludes a track with no audio output, by the same threshold as the rack', () => {
    // Not the same assertion copied twice: this is the second of the two
    // places that question is asked, and a fix applied to one and not the
    // other is exactly the failure a guard this narrow would miss.
    expect(mixer).toMatch(/audioOutputs\s*\)\s*\?\?\s*1\)\s*>\s*0/)
  })

  it('caches its strip separately from the one embedded in the track slot', () => {
    expect(mixer, 'drawMixer reads from the Tracks strip cache').not.toMatch(/\bstrips\.get\(/)
    expect(mixer).toMatch(/mixerStrips\.get\(/)
    expect(mixer).toMatch(/mixerStrips\.set\(/)
  })

  it('gives every channel a visible heading, which the strip itself has none of', () => {
    expect(mixer).toMatch(/mixer-channel/)
    const heading = mixer.indexOf("createElement('h3')")
    expect(heading, 'no heading is created for a mixer channel').toBeGreaterThan(-1)
  })
})

describe('caching a node is not scattered across the file', () => {
  // AGENTS.md: a change in one file usually needs a second change with it, and
  // nothing connects them unless a test does. panels, strips and mixerStrips
  // are touched from three helpers and nowhere else, so adding a fourth cache
  // later, or a Mixer tab that forgets to clear itself, is one function to
  // edit rather than a search for every place that might need to know.
  const app = readFileSync(resolve(import.meta.dirname, '../../web/app.js'), 'utf8')

  it('deletes or clears a strip only inside forgetStrips, forgetNode or forgetAllNodes', () => {
    const helpers = app.slice(app.indexOf('const forgetStrips'), app.indexOf('const forgetAllNodes') + 200)
    const outside = app.replace(helpers, '')
    expect(outside).not.toMatch(/\bstrips\.delete\(/)
    expect(outside).not.toMatch(/\bmixerStrips\.delete\(/)
    expect(outside).not.toMatch(/\bstrips\.clear\(/)
    expect(outside).not.toMatch(/\bmixerStrips\.clear\(/)
  })
})
