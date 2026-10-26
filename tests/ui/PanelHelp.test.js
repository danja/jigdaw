// tests/ui/PanelHelp.test.js
//
// Help for a control, from the port's own comment: a line under the heading while the control is hovered or focused, and the same words as
// the control's description for a screen reader. These are the rules it has to keep: nothing is drawn for a plugin that says nothing, the
// line is never the only place the words are, a keyboard and a pointer get the same help, and Escape puts it away.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createPanel } from '../../src/ui/Panel.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

const port = over => ({
  symbol: 'mix', name: 'Mix', defaultValue: 0.3, minimum: 0, maximum: 1,
  unit: null, toggled: false, enumeration: false, scalePoints: [],
  automationRate: 'k-rate', widget: 'dial', comment: null, ...over
})

const build = ports => {
  const panel = createPanel(document, { iri: 'https://example.test/p/', label: 'P', ports }, () => {})
  document.body.append(panel.element)
  return panel.element
}

const fire = (target, type, extra = {}) => {
  const event = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(extra)) Object.defineProperty(event, k, { value: v })
  target.dispatchEvent(event)
}
const row = (element, label) => [...element.querySelectorAll('.control')].find(r => r.querySelector('label').textContent === label)
const help = element => element.querySelector('.control-help')

describe('a plugin that says nothing', () => {
  it('gets no help line, and its controls keep their full name as a tooltip', () => {
    const element = build([port({ symbol: 'a', name: 'Alpha' }), port({ symbol: 'b', name: 'Beta' })])
    expect(help(element)).toBeNull()
    expect(element.querySelector('input').title).toBe('Alpha')
  })
})

describe('a plugin with help', () => {
  const ports = () => [
    port({ symbol: 'rate', name: 'Rate', comment: 'How fast the wobble goes.' }),
    port({ symbol: 'depth', name: 'Depth', comment: 'How far the pitch swings.' }),
    port({ symbol: 'mute', name: 'Mute' })
  ]

  it('draws one help line under the heading, empty, and hidden from a screen reader since the controls carry the words', () => {
    const element = build(ports())
    expect(element.querySelectorAll('.control-help')).toHaveLength(1)
    expect(help(element).textContent).toBe('')
    expect(help(element).getAttribute('aria-hidden')).toBe('true')
    expect(help(element).previousElementSibling.tagName).toBe('H3')
  })

  it('shows the help of the control the pointer is over, with its name, and puts it away when the pointer leaves', () => {
    const element = build(ports())
    fire(row(element, 'Rate'), 'pointerenter')
    expect(help(element).textContent).toBe('Rate How fast the wobble goes.')
    fire(row(element, 'Rate'), 'pointerleave')
    expect(help(element).textContent).toBe('')
  })

  it('shows the control\'s name in bold and then its sentence, so a colon in the sentence is not a second colon', () => {
    const element = build([port({ symbol: 'cut', name: 'Cutoff', comment: 'A lowpass filter: lower is darker.' })])
    fire(row(element, 'Cutoff'), 'pointerenter')
    expect(help(element).querySelector('b').textContent).toBe('Cutoff')
    expect(help(element).textContent).toBe('Cutoff A lowpass filter: lower is darker.')
  })

  it('shows the same help when a control takes the focus, so a keyboard and a touch get what a pointer gets', () => {
    const element = build(ports())
    fire(row(element, 'Depth').querySelector('input'), 'focusin')
    expect(help(element).textContent).toBe('Depth How far the pitch swings.')
  })

  it('puts it away when the focus goes somewhere else, and keeps it when the focus moves within the same control', () => {
    const element = build(ports())
    const depth = row(element, 'Depth')
    fire(depth.querySelector('input'), 'focusin')
    fire(depth.querySelector('input'), 'focusout', { relatedTarget: depth.querySelector('label') })
    expect(help(element).textContent).toBe('Depth How far the pitch swings.')
    fire(depth.querySelector('input'), 'focusout', { relatedTarget: null })
    expect(help(element).textContent).toBe('')
  })

  it('goes back to explaining the focused control when the pointer leaves another one', () => {
    const element = build(ports())
    fire(row(element, 'Depth').querySelector('input'), 'focusin')
    fire(row(element, 'Rate'), 'pointerenter')
    expect(help(element).textContent).toMatch(/^Rate /)
    fire(row(element, 'Rate'), 'pointerleave')
    expect(help(element).textContent).toBe('Depth How far the pitch swings.')
  })

  it('is put away by Escape, without taking the key from anything else', () => {
    const element = build(ports())
    const rate = row(element, 'Rate')
    fire(rate, 'pointerenter')
    const event = new window.Event('keydown', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'key', { value: 'Escape' })
    rate.dispatchEvent(event)
    expect(help(element).textContent).toBe('')
    expect(event.defaultPrevented).toBe(false)
  })

  it('says nothing for a control that has no help, and clears what the last one said', () => {
    const element = build(ports())
    fire(row(element, 'Rate'), 'pointerenter')
    fire(row(element, 'Rate'), 'pointerleave')
    fire(row(element, 'Mute'), 'pointerenter')
    expect(help(element).textContent).toBe('')
  })

  it('gives every control with help its words as part of its description, after its value, and no others', () => {
    const element = build(ports())
    const input = row(element, 'Rate').querySelector('input')
    const ids = input.getAttribute('aria-describedby').split(' ')
    expect(ids).toHaveLength(2)
    expect(document.getElementById(ids[0]).className).toBe('value')
    expect(document.getElementById(ids[1]).textContent).toBe('How fast the wobble goes.')
    expect(document.getElementById(ids[1]).className).toContain('visually-hidden')
    expect(row(element, 'Mute').querySelector('input').getAttribute('aria-describedby').split(' ')).toHaveLength(1)
  })

  it('has no tooltip of its own on a control whose help is the line, and the name tooltip on one with none', () => {
    const element = build(ports())
    expect(row(element, 'Rate').querySelector('input').hasAttribute('title')).toBe(false)
    expect(row(element, 'Mute').querySelector('input').title).toBe('Mute')
  })

  it('works for a switch and a selector as for a dial', () => {
    const element = build([
      port({ symbol: 'sync', name: 'Sync', widget: 'switch', toggled: true, comment: 'Lock the rate to the tempo.' }),
      port({ symbol: 'wave', name: 'Wave', widget: 'selector', enumeration: true, scalePoints: [{ label: 'Sine', value: 0 }, { label: 'Saw', value: 1 }, { label: 'Square', value: 2 }], comment: 'The shape of the wobble.' })
    ])
    fire(row(element, 'Sync').querySelector('input'), 'focusin')
    expect(help(element).textContent).toBe('Sync Lock the rate to the tempo.')
    fire(row(element, 'Wave').querySelector('select'), 'focusin')
    expect(help(element).textContent).toBe('Wave The shape of the wobble.')
    expect(row(element, 'Wave').querySelector('select').getAttribute('aria-describedby')).toMatch(/-help$/)
  })

  it('keeps one help line per panel, so two plugins do not share one', () => {
    const first = build(ports())
    const second = build(ports())
    fire(row(first, 'Rate'), 'pointerenter')
    expect(help(first).textContent).not.toBe('')
    expect(help(second).textContent).toBe('')
  })
})
