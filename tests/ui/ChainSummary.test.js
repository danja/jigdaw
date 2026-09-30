// tests/ui/ChainSummary.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createChainSummary } from '../../src/ui/ChainSummary.js'

let document
let window
beforeEach(() => { ({ document, window } = parseHTML('<!doctype html><body></body>')) })

describe('the chain summary', () => {
  it('lists the plugins in the order given, and says where the clips play', () => {
    const summary = createChainSummary(document, { onShowPlugins () {} })
    summary.show({
      label: 'Bass', nodes: [{ id: 'a' }, { id: 'b' }], labelOf: n => `Plugin ${n.id}`, midiInputLabel: 'Plugin a'
    })
    expect([...summary.element.querySelectorAll('li')].map(li => li.textContent)).toEqual(['Plugin a', 'Plugin b'])
    expect(summary.element.querySelector('p').textContent).toBe('Bass: 2 plugins. MIDI clips play into Plugin a.')
    expect(summary.element.querySelector('ol').getAttribute('aria-label')).toBe('Plugins in signal order')
  })

  it('leaves out the list and the button for a track with no plugins, rather than disabling them', () => {
    const summary = createChainSummary(document, { onShowPlugins () {} })
    summary.show({ label: 'Loop', nodes: [], labelOf: () => '' })
    expect(summary.element.querySelector('ol').hidden).toBe(true)
    expect(summary.element.querySelector('button').hidden).toBe(true)
    expect(summary.element.querySelector('p').textContent).toMatch(/no plugins/)
  })

  it('leads to the plugins', () => {
    let called = 0
    const summary = createChainSummary(document, { onShowPlugins: () => { called++ } })
    summary.show({ label: 'Bass', nodes: [{ id: 'a' }], labelOf: () => 'A' })
    summary.element.querySelector('button').dispatchEvent(new window.Event('click', { bubbles: true }))
    expect(called).toBe(1)
  })

  it('says one plugin in the singular', () => {
    const summary = createChainSummary(document, { onShowPlugins () {} })
    summary.show({ label: 'Bass', nodes: [{ id: 'a' }], labelOf: () => 'A' })
    expect(summary.element.querySelector('p').textContent).toBe('Bass: 1 plugin.')
  })
})
