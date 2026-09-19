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
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { parseHTML } from 'linkedom'
import { preserveFocus } from '../../src/ui/Focus.js'

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
  const app = readFileSync(resolve(import.meta.dirname, '../../web/app.js'), 'utf8')

  it('preserves the focus around the rack rebuild', () => {
    expect(app).toMatch(/import \{ preserveFocus \}/)
    const draw = app.slice(app.indexOf('function drawRack'))
    const captured = draw.indexOf('preserveFocus(rack)')
    const emptied = draw.indexOf("rack.textContent = ''")
    const restored = draw.indexOf('restoreFocus()')
    expect(captured, 'drawRack does not capture the focus').toBeGreaterThan(-1)
    expect(captured, 'the focus is read after the rack has been emptied').toBeLessThan(emptied)
    expect(restored, 'the focus is never put back').toBeGreaterThan(emptied)
  })
})
