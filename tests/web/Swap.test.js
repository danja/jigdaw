// tests/web/Swap.test.js
//
// The Replace mode: begin names the plugin and opens the Browser, the next Load is the one that swaps, and Cancel ends it.
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createSwap } from '../../web/app/Swap.js'

let document, ctx, shown
beforeEach(() => {
  ({ document } = parseHTML('<!doctype html><body><div id="replacing" hidden><span id="replacing-text"></span><button id="cancel-replace"></button></div><input id="q"></body>'))
  shown = []
  ctx = {
    document,
    $: id => document.getElementById(id),
    dispatcher: { project: { node: id => (id === 'n1' ? { id: 'n1', label: 'Reverb' } : null) } },
    layout: { showBrowser: open => shown.push(open) }
  }
})

describe('replace mode', () => {
  it('is off at first, and begin says which plugin is being replaced and opens the Browser', () => {
    const swap = createSwap(ctx)
    expect(swap.target()).toBe(null)
    expect(document.getElementById('replacing').hidden).toBe(true)
    swap.begin('n1')
    expect(swap.target()).toBe('n1')
    expect(document.getElementById('replacing').hidden).toBe(false)
    expect(document.getElementById('replacing-text').textContent).toBe('Replacing Reverb: Load a plugin to put it in its place.')
    expect(shown).toEqual([true])
  })

  it('ends on end, hiding the banner, and on Cancel, putting the focus back on the search box', () => {
    const swap = createSwap(ctx)
    swap.mount()
    swap.begin('n1')
    swap.end()
    expect(swap.target()).toBe(null)
    expect(document.getElementById('replacing').hidden).toBe(true)
    swap.begin('n1')
    const focused = []
    document.getElementById('q').focus = () => focused.push('q')
    document.getElementById('cancel-replace').dispatchEvent(new document.defaultView.Event('click'))
    expect(swap.target()).toBe(null)
    expect(focused).toEqual(['q'])
  })
})
