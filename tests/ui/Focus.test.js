// tests/ui/Focus.test.js
//
// One rule, and it was broken in the live application for as long as the rack
// has been redrawn on every change: a control you can nudge once with an
// arrow key and then not again is not keyboard operable. It is WCAG 2.1.1 on
// every generated control at once, and a pointer never sees it.
//
// linkedom has focus() and no activeElement, so what is focused is set here
// directly. That is the one thing being stubbed: the reading and the putting
// back are the real code.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { preserveFocus } from '../../src/ui/Focus.js'
import { appFile } from './appSource.js'

let document, rack

beforeEach(() => {
  ({ document } = parseHTML('<!doctype html><body><div id="rack"></div><input id="outside"></body>'))
  rack = document.getElementById('rack')
  rack.innerHTML = '<input id="gain"><input id="cutoff"><button>press</button>'
})

/** Throw the container away and build it again, as drawRack does. */
const redraw = () => { rack.textContent = ''; rack.innerHTML = '<input id="gain"><input id="cutoff"><button>press</button>' }

describe('keeping the keyboard across a redraw', () => {
  it('puts the focus back on the same control', () => {
    document.activeElement = document.getElementById('gain')
    const restore = preserveFocus(rack)
    redraw()
    const again = restore()
    expect(again).not.toBeNull()
    expect(again.id).toBe('gain')
    // The rebuilt element, not the discarded one.
    expect(again).toBe(document.getElementById('gain'))
  })

  it('leaves the focus alone when it was outside the container', () => {
    document.activeElement = document.getElementById('outside')
    const restore = preserveFocus(rack)
    redraw()
    expect(restore()).toBeNull()
  })

  it('does nothing when nothing was focused', () => {
    document.activeElement = document.body
    expect(preserveFocus(rack)()).toBeNull()
    document.activeElement = null
    expect(preserveFocus(rack)()).toBeNull()
  })

  it('does not guess at a control with no id', () => {
    document.activeElement = rack.querySelector('button')
    const restore = preserveFocus(rack)
    redraw()
    expect(restore()).toBeNull()
  })

  it('reports nothing rather than throwing when the control did not come back', () => {
    document.activeElement = document.getElementById('cutoff')
    const restore = preserveFocus(rack)
    rack.textContent = ''
    expect(() => restore()).not.toThrow()
    expect(restore()).toBeNull()
  })

  it('survives being handed nothing', () => {
    expect(() => preserveFocus(null)()).not.toThrow()
    expect(preserveFocus(undefined)()).toBeNull()
  })
})

describe('the application uses it', () => {
  // The helper being right is worth nothing if drawRack does not call it, and
  // drawRack is in the browser bundle where there is no AudioContext to test
  // against. So the call is checked in the source, which is what the foreign
  // mark guards in tests/docs/conventions.test.js do for the same reason.
  const app = appFile('web/app/Rack.js') + appFile('web/app/RackSlot.js')

  it('preserves the focus around the rack rebuild', () => {
    expect(app).toMatch(/import \{ preserveFocus \} from/)
    const draw = app.slice(app.indexOf('function drawRack'))
    const captured = draw.indexOf('preserveFocus(rack)')
    const emptied = draw.indexOf("rack.textContent = ''")
    const restored = draw.indexOf('restoreFocus()')
    expect(captured, 'drawRack does not capture the focus').toBeGreaterThan(-1)
    expect(captured, 'the focus is read after the rack has been emptied').toBeLessThan(emptied)
    expect(restored, 'the focus is never put back').toBeGreaterThan(emptied)
  })
})

// An HTML skin (docs/html-skins.md) lives in a shadow root. document.activeElement is then its host, which has no focus
// to give back, so a control in it was nudged once with an arrow key and never again: found in Chrome, with the keys
// counted, after every other test passed.
describe('keeping the keyboard inside a shadow root', () => {
  function withSkin () {
    const host = document.createElement('div')
    host.id = 'skin-host'
    const shadow = host.attachShadow({ mode: 'open' })
    const slider = document.createElement('input')
    slider.id = 'tone'
    shadow.append(slider)
    rack.append(host)
    return { host, shadow, slider }
  }
  // The rack is built again and the same host is put back, as the panel cache does.
  const redrawKeeping = host => { rack.textContent = ''; rack.append(host) }

  it('puts the focus back on the control inside the host', () => {
    const { host, shadow, slider } = withSkin()
    document.activeElement = host
    shadow.activeElement = slider
    const restore = preserveFocus(rack)
    redrawKeeping(host)
    expect(restore()).toBe(shadow.getElementById('tone'))
  })

  it('finds the control again when the host is a new element with the same id', () => {
    const { host, shadow, slider } = withSkin()
    document.activeElement = host
    shadow.activeElement = slider
    const restore = preserveFocus(rack)
    rack.textContent = ''
    const again = withSkin()
    expect(restore()).toBe(again.shadow.getElementById('tone'))
  })

  it('does not guess when the host or the control has no id', () => {
    const { host, shadow, slider } = withSkin()
    host.removeAttribute('id')
    document.activeElement = host
    shadow.activeElement = slider
    expect(preserveFocus(rack)()).toBeNull()
  })

  it('reports nothing rather than throwing when the host did not come back', () => {
    const { host, shadow, slider } = withSkin()
    document.activeElement = host
    shadow.activeElement = slider
    const restore = preserveFocus(rack)
    rack.textContent = ''
    expect(() => restore()).not.toThrow()
    expect(restore()).toBeNull()
  })

  it('treats a host with nothing focused in it as the ordinary element it is', () => {
    const { host } = withSkin()
    document.activeElement = host
    expect(preserveFocus(rack)()).toBe(document.getElementById('skin-host'))
  })
})
