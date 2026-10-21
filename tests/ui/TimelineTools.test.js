// tests/ui/TimelineTools.test.js
import { describe, it, expect } from 'vitest'
import { parseHTML } from 'linkedom'
import { createTimelineTools } from '../../src/ui/TimelineTools.js'
import { TimeView } from '../../src/ui/TimeView.js'

const setup = ({ onSeek = null, onAddTrack = null } = {}) => {
  const { document, window } = parseHTML('<html><body></body></html>')
  const view = new TimeView()
  const calls = []
  const routing = []
  const tools = createTimelineTools(document, {
    view, bpb: () => 4, zoom: f => calls.push(['zoom', f]), fit: () => calls.push(['fit']), onSeek, onAddTrack, onRouting: on => routing.push(on)
  })
  document.body.append(tools.element)
  const button = name => [...tools.element.querySelectorAll('button')].find(b => b.textContent === name || b.getAttribute('aria-label') === name)
  const change = (el, value) => { el.value = value; el.dispatchEvent(new window.Event('change', { bubbles: true })) }
  return { tools, view, calls, routing, button, change, document, window }
}

describe('TimelineTools', () => {
  it('asks for a zoom by a factor and for a fit, and names every control', () => {
    const { calls, button } = setup()
    button('Zoom in').click()
    button('Zoom out').click()
    button('Fit').click()
    expect(calls).toEqual([['zoom', 1.5], ['zoom', 1 / 1.5], ['fit']])
  })

  it('starts with Follow on and Routing on, and says so with aria-pressed', () => {
    const { tools, routing, button } = setup()
    expect(tools.following()).toBe(true)
    expect(button('Follow').getAttribute('aria-pressed')).toBe('true')
    expect(button('Routing').getAttribute('aria-pressed')).toBe('true')
    expect(routing).toEqual([true])
    button('Routing').click()
    expect(button('Routing').getAttribute('aria-pressed')).toBe('false')
    expect(routing).toEqual([true, false])
    button('Follow').click()
    expect(tools.following()).toBe(false)
  })

  it('follows the view for the grid and the zoom read-out', () => {
    const { tools, view, document } = setup()
    // linkedom does not keep `selected` on an option, so record what is set.
    const chosen = new Map()
    for (const option of document.querySelectorAll('option')) {
      Object.defineProperty(option, 'selected', { set: on => chosen.set(option.value, on), configurable: true })
    }
    view.setGrid('bar')
    view.zoomBy(2)
    tools.sync()
    expect([...chosen].filter(([, on]) => on).map(([value]) => value)).toEqual(['bar'])
    expect(document.querySelector('.timeline-zoom').textContent).toBe('Zoom 200%')
  })

  it('sets the grid from the select', () => {
    const { view, window, document } = setup()
    // linkedom's select has no value accessor, which a browser's does.
    const select = document.querySelector('select')
    Object.defineProperty(select, 'value', { value: 'beat', configurable: true })
    select.dispatchEvent(new window.Event('change', { bubbles: true }))
    expect(view.grid).toBe('beat')
  })

  it('has Go to bar only with a seek, counts bars from one, and refuses a bar below one', () => {
    expect(setup().document.querySelector('input')).toBeNull()
    const seen = []
    const { change, document } = setup({ onSeek: beat => seen.push(beat) })
    const input = document.querySelector('input')
    change(input, '3')
    expect(seen).toEqual([8])
    change(input, '0')
    expect(seen).toEqual([8])
    expect(input.value).toBe('1')
  })

  it('has Add track only where the page can add one, and asks for it with no argument', () => {
    expect(setup().button('Add track')).toBeUndefined()
    const seen = []
    setup({ onAddTrack: (...args) => seen.push(args) }).button('Add track').click()
    expect(seen).toEqual([[]])
  })
})
