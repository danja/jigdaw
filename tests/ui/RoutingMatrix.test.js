// tests/ui/RoutingMatrix.test.js
//
// Keys are sent to the table and the focus read back, the way a real press
// arrives, since a table that can only be pressed by a pointer passes every test
// that never touches the keyboard.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createRoutingMatrix } from '../../src/ui/RoutingMatrix.js'

let document
let window
let focused
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')); focused = null })
const event = (type, props = {}) => {
  const e = new window.Event(type, { bubbles: true, cancelable: true })
  for (const [k, v] of Object.entries(props)) Object.defineProperty(e, k, { value: v })
  return e
}

const port = (kind, portIndex, name) => ({ kind, portIndex, name })
const row = (key, text, track = 't1', trackLabel = 'Lead') => ({ key, text, node: key, track, trackLabel, port: port('A', 0, text) })
const col = (key, text, track = 't1', trackLabel = 'Lead') => ({ key, text, node: key, track, trackLabel, port: port('A', 0, text) })

function build (matrix) {
  const calls = []
  const view = createRoutingMatrix(document, { onConnect: (r, c) => calls.push(['connect', r.key, c.key]), onDisconnect: id => calls.push(['disconnect', id]) })
  document.body.append(view.element)
  view.draw(matrix)
  // linkedom's focus() does not move activeElement; record what was asked.
  for (const b of view.element.querySelectorAll('button')) b.focus = () => { focused = b.id }
  return { view, calls }
}

// Rows a, b, c; columns x, y, z. No cell for b to y, and none for c to x.
const matrix = () => {
  const rows = [row('a', 'A out'), row('b', 'B out'), row('c', 'C out', 't2', 'Drums')]
  const cols = [col('x', 'X in'), col('y', 'Y in'), col('z', 'Z in', 't2', 'Drums')]
  return {
    rows, cols,
    possible: (r, c) => !(r.key === 'b' && c.key === 'y') && !(r.key === 'c' && c.key === 'x'),
    connectionAt: (r, c) => (r.key === 'a' && c.key === 'y' ? { id: 'c-ay' } : null)
  }
}

const buttons = () => [...document.querySelectorAll('button.matrix-cell')]

describe('the routing matrix', () => {
  it('is a table with outputs as row headers and inputs as column headers under their track', () => {
    build(matrix())
    expect([...document.querySelectorAll('thead th[scope=colgroup]')].map(t => [t.textContent, Number(t.getAttribute('colspan'))])).toEqual([['Lead', 2], ['Drums', 1]])
    expect([...document.querySelectorAll('thead th[scope=col]')].map(t => t.textContent)).toEqual(['X in', 'Y in', 'Z in'])
    expect([...document.querySelectorAll('tbody th')].map(t => t.textContent)).toEqual(['Lead: A out', 'B out', 'Drums: C out'])
  })

  it('has a button only where a pair can be joined, so nothing in it is disabled', () => {
    build(matrix())
    expect(buttons()).toHaveLength(7)
    expect(document.querySelectorAll('[disabled]')).toHaveLength(0)
  })

  it('says each cell in words, connected or not, and marks it as well as colouring it', () => {
    build(matrix())
    const ay = buttons().find(b => b.getAttribute('aria-pressed') === 'true')
    expect(ay.getAttribute('aria-label')).toBe('A out on Lead to Y in on Lead: connected')
    expect(ay.textContent).toBe('●')
    const other = buttons().find(b => b.getAttribute('aria-pressed') === 'false')
    expect(other.getAttribute('aria-label')).toMatch(/not connected$/)
    expect(other.textContent).toBe('○')
  })

  it('connects from an unjoined cell and disconnects from a joined one', () => {
    const { calls } = build(matrix())
    buttons().find(b => b.getAttribute('aria-pressed') === 'false').dispatchEvent(event('click'))
    buttons().find(b => b.getAttribute('aria-pressed') === 'true').dispatchEvent(event('click'))
    expect(calls).toEqual([['connect', 'a', 'x'], ['disconnect', 'c-ay']])
  })

  it('has one tab stop', () => {
    build(matrix())
    expect(buttons().filter(b => b.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('moves with the arrow keys, stepping over cells that have no button', () => {
    build(matrix())
    const [ax, ay, az, bx, bz, cy, cz] = buttons()
    key(ax, 'ArrowRight'); expect(focused).toBe(ay.id)
    key(ay, 'ArrowRight'); expect(focused).toBe(az.id)
    key(bx, 'ArrowRight'); expect(focused).toBe(bz.id)
    key(ay, 'ArrowDown'); expect(focused).toBe(cy.id)
    key(cy, 'ArrowUp'); expect(focused).toBe(ay.id)
    key(cz, 'ArrowLeft'); expect(focused).toBe(cy.id)
  })

  it('does not run off an edge', () => {
    build(matrix())
    const [ax] = buttons()
    focused = null
    key(ax, 'ArrowLeft'); key(ax, 'ArrowUp')
    expect(focused).toBeNull()
  })

  it('Home and End go to the ends of the row, and with Control to the first and last of all', () => {
    build(matrix())
    const [ax, , az, , bz, , cz] = buttons()
    key(az, 'Home'); expect(focused).toBe(ax.id)
    key(ax, 'End'); expect(focused).toBe(az.id)
    key(bz, 'Home'); expect(focused).toBe(buttons()[3].id)
    key(ax, 'End', { ctrlKey: true }); expect(focused).toBe(cz.id)
    key(cz, 'Home', { ctrlKey: true }); expect(focused).toBe(ax.id)
  })

  it('keeps the tab stop on the button last used across a redraw', () => {
    const { view } = build(matrix())
    const target = buttons()[2]
    target.dispatchEvent(event('click'))
    view.draw(matrix())
    expect(document.getElementById(target.id).getAttribute('tabindex')).toBe('0')
    expect(buttons().filter(b => b.getAttribute('tabindex') === '0')).toHaveLength(1)
  })

  it('says why there is no table when there is nothing to route', () => {
    const { view } = build({ rows: [], cols: [], possible: () => false, connectionAt: () => null })
    expect(document.querySelector('.empty').textContent).toBe('No plugins to route yet.')
    view.draw({ rows: [row('a', 'A out')], cols: [], possible: () => false, connectionAt: () => null })
    expect(document.querySelector('.empty').textContent).toBe('No plugin here has an input to connect to.')
  })

  it('will not be built without its handlers', () => {
    expect(() => createRoutingMatrix(document, { onConnect () {} })).toThrow(/onDisconnect/)
  })
})

function key (el, k, props = {}) { el.dispatchEvent(event('keydown', { key: k, ...props })) }
