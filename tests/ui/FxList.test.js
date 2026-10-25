// tests/ui/FxList.test.js
//
// What each plugin in a channel's FX list can do: Bypass as a toggle that says so in words too, Move earlier and later where
// there is somewhere to go, Replace, Controls and Remove. A control that cannot act is left out, not shown disabled, and one
// whose page has no handler is not drawn at all.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createFxList } from '../../src/ui/FxList.js'

let document
beforeEach(() => { document = parseHTML('<!doctype html><html><body></body></html>').document })
const click = element => element.dispatchEvent(new document.defaultView.Event('click'))

const plugin = (id, over = {}) => ({ id, label: id.toUpperCase(), loaded: true, failed: null, bypassed: false, canEarlier: false, canLater: false, ...over })
function build (plugins, actions = {}) {
  const calls = []
  const fx = createFxList(document, {
    id: 'strip-a',
    onAdd: () => {},
    onRemove: id => calls.push(['remove', id]),
    actions: {
      onBypass: (id, on) => calls.push(['bypass', id, on]),
      onMove: (id, delta) => calls.push(['move', id, delta]),
      onReplace: id => calls.push(['replace', id]),
      onShow: id => calls.push(['show', id]),
      ...actions
    }
  })
  document.body.append(fx.element)
  fx.update({ label: 'Lead', plugins })
  return { fx, calls, q: selector => fx.element.querySelector(selector), all: selector => [...fx.element.querySelectorAll(selector)] }
}

describe('the controls of a plugin in the FX list', () => {
  it('draws Bypass, Replace, Controls and Remove for a plugin that has loaded, each named for the plugin and the track', () => {
    const { q } = build([plugin('eq')])
    expect(q('#strip-a-fx-bypass-eq').getAttribute('aria-label')).toBe('Bypass EQ on Lead')
    expect(q('#strip-a-fx-replace-eq').getAttribute('aria-label')).toBe('Replace EQ on Lead')
    expect(q('#strip-a-fx-show-eq').getAttribute('aria-label')).toBe('Show the controls of EQ on Lead')
    expect(q('#strip-a-fx-remove-eq').getAttribute('aria-label')).toBe('Remove EQ from Lead')
  })

  it('does what each says, with the plugin it belongs to', () => {
    const { q, calls } = build([plugin('eq'), plugin('verb')])
    click(q('#strip-a-fx-bypass-verb'))
    click(q('#strip-a-fx-replace-eq'))
    click(q('#strip-a-fx-show-verb'))
    click(q('#strip-a-fx-remove-eq'))
    expect(calls).toEqual([['bypass', 'verb', true], ['replace', 'eq'], ['show', 'verb'], ['remove', 'eq']])
  })

  it('shows Bypass as pressed when the plugin is bypassed, says so in words, and a press turns it back on', () => {
    const { q, calls } = build([plugin('eq', { bypassed: true })])
    expect(q('#strip-a-fx-bypass-eq').getAttribute('aria-pressed')).toBe('true')
    expect(q('.fx-name').textContent).toBe('EQ (bypassed)')
    click(q('#strip-a-fx-bypass-eq'))
    expect(calls).toEqual([['bypass', 'eq', false]])
  })

  it('draws Move earlier and Move later only where the model says there is somewhere to go', () => {
    const { q, calls } = build([plugin('a', { canLater: true }), plugin('b', { canEarlier: true, canLater: true }), plugin('c', { canEarlier: true })])
    expect(q('#strip-a-fx-move-earlier-a')).toBeNull()
    expect(q('#strip-a-fx-move-later-c')).toBeNull()
    expect(q('#strip-a-fx-move-later-a').getAttribute('aria-label')).toBe('Move A later on Lead')
    click(q('#strip-a-fx-move-earlier-b'))
    click(q('#strip-a-fx-move-later-b'))
    expect(calls).toEqual([['move', 'b', -1], ['move', 'b', 1]])
  })

  it('leaves out everything but Remove for a plugin that has not loaded or has failed, and says a failure in words', () => {
    const { q, all } = build([plugin('slow', { loaded: false, canLater: true }), plugin('broken', { failed: 'no wasm' })])
    expect(all('.fx-list li button').map(b => b.className)).toEqual(['fx-remove', 'fx-remove'])
    expect(all('.fx-name').map(n => n.textContent)).toEqual(['SLOW', 'BROKEN (failed to load)'])
    expect(q('#strip-a-fx-bypass-slow')).toBeNull()
  })

  it('draws no control for an action the page gave no handler for, so a plain list is as it was', () => {
    const { all } = build([plugin('eq', { canEarlier: true, canLater: true })], { onBypass: null, onMove: null, onReplace: null, onShow: null })
    expect(all('#strip-a-fx-list button').map(b => b.className)).toEqual(['fx-remove', 'fx-add'])
  })

  it('works for a plain list of id and label only, with every action given', () => {
    const { all, calls } = build([{ id: 'x', label: 'X' }])
    expect(all('.fx-bypass')).toHaveLength(1)
    click(all('.fx-remove')[0])
    expect(calls).toEqual([['remove', 'x']])
  })

  describe('after a move, where the focus goes', () => {
    const run = (before, after, press) => {
      const focused = []
      document.defaultView.HTMLElement.prototype.focus = function () { focused.push(this.id) }
      let fx
      const made = build(before, { onMove: () => fx.update({ label: 'Lead', plugins: after }) })
      fx = made.fx
      click(made.q(press))
      return focused
    }

    it('is the same Move button where the plugin can still go that way', () => {
      const focused = run(
        [plugin('a', { canLater: true }), plugin('b', { canEarlier: true, canLater: true }), plugin('c', { canEarlier: true })],
        [plugin('b', { canLater: true }), plugin('a', { canEarlier: true, canLater: true }), plugin('c', { canEarlier: true })],
        '#strip-a-fx-move-later-a')
      expect(focused).toEqual(['strip-a-fx-move-later-a'])
    })

    it('is the other Move button when it has reached the end of the chain', () => {
      const focused = run(
        [plugin('a', { canLater: true }), plugin('b', { canEarlier: true })],
        [plugin('b', { canLater: true }), plugin('a', { canEarlier: true })],
        '#strip-a-fx-move-later-a')
      expect(focused).toEqual(['strip-a-fx-move-earlier-a'])
    })

    it('is the FX button when the plugin can no longer move at all', () => {
      const focused = run([plugin('a', { canLater: true }), plugin('b', { canEarlier: true })], [plugin('a'), plugin('b')], '#strip-a-fx-move-later-a')
      expect(focused).toEqual(['strip-a-fx'])
    })
  })
})

describe('the menu on a plugin in the FX list', () => {
  function withMenu (plugins) {
    const opened = []
    const calls = []
    const fx = createFxList(document, {
      id: 'strip-a',
      onAdd: () => {},
      onRemove: id => calls.push(['remove', id]),
      actions: { onBypass: (id, on) => calls.push(['bypass', id, on]), onMove: (id, d) => calls.push(['move', id, d]), onReplace: id => calls.push(['replace', id]), onShow: id => calls.push(['show', id]) },
      menu: { open: (items, where) => opened.push({ items, where }) }
    })
    document.body.append(fx.element)
    fx.update({ label: 'Lead', plugins })
    const open = index => { fx.element.querySelectorAll('li')[index].dispatchEvent(new document.defaultView.Event('contextmenu', { bubbles: true, cancelable: true })); return opened.at(-1) }
    return { open, calls }
  }
  const labels = opened => opened.items.filter(i => i !== '-').map(i => i.label)

  it('offers what the buttons do, with the same limits, and Remove last', () => {
    const { open } = withMenu([plugin('a', { canLater: true }), plugin('b', { canEarlier: true, canLater: true })])
    expect(labels(open(0))).toEqual(['Bypass', 'Replace with another plugin', 'Move later', 'Show controls', 'Remove'])
    expect(labels(open(1))).toEqual(['Bypass', 'Replace with another plugin', 'Move earlier', 'Move later', 'Show controls', 'Remove'])
  })

  it('marks Bypass as checked when the plugin is bypassed, and a pick does what the button does', () => {
    const { open, calls } = withMenu([plugin('a', { bypassed: true, canLater: true })])
    const menu = open(0)
    expect(menu.items.find(i => i.label === 'Bypass').checked).toBe(true)
    for (const item of menu.items.filter(i => i !== '-')) item.run()
    expect(calls).toEqual([['bypass', 'a', false], ['replace', 'a'], ['move', 'a', 1], ['show', 'a'], ['remove', 'a']])
  })

  it('offers only Remove for a plugin that failed or has not loaded', () => {
    const { open } = withMenu([plugin('broken', { failed: 'no wasm', canEarlier: true, canLater: true }), plugin('slow', { loaded: false, canEarlier: true })])
    expect(labels(open(0))).toEqual(['Remove'])
    expect(labels(open(1))).toEqual(['Remove'])
  })

  it('opens no menu when the page gave none', () => {
    const { fx } = build([plugin('a')])
    const event = new document.defaultView.Event('contextmenu', { bubbles: true, cancelable: true })
    fx.element.querySelector('li').dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
  })
})
