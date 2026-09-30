// tests/ui/ClipActions.test.js
import { describe, it, expect, beforeEach } from 'vitest'
import { parseHTML } from 'linkedom'
import { createClipActions } from '../../src/ui/ClipActions.js'

let document
beforeEach(() => { ({ document } = parseHTML('<!doctype html><html><body></body></html>')) })

const build = () => {
  const calls = []
  const actions = createClipActions(document, { onAction: name => calls.push(name), onColor: color => calls.push(['color', color]) })
  document.body.append(actions.element)
  const names = () => [...actions.element.children].filter(b => b.dataset.action).map(b => b.dataset.action)
  const click = name => [...actions.element.children].find(b => b.dataset.action === name).dispatchEvent(new document.defaultView.Event('click'))
  return { actions, calls, names, click }
}

describe('the clip action buttons', () => {
  it('are left out while nothing is selected', () => {
    const { actions, names } = build()
    actions.draw({ count: 0 })
    expect(actions.element.hidden).toBe(true)
    expect(names()).toEqual([])
  })

  it('offer split and the trims only for one clip, and paste only when something was copied', () => {
    const { actions, names } = build()
    actions.draw({ count: 1 })
    expect(names()).toEqual(['split', 'trimStart', 'trimEnd', 'duplicate', 'mute', 'lock', 'copy', 'cut', 'remove'])
    actions.draw({ count: 1, canPaste: true })
    expect(names()).toContain('paste')
    actions.draw({ count: 3 })
    expect(names()).toEqual(['duplicate', 'mute', 'lock', 'copy', 'cut', 'remove'])
    expect(actions.element.hidden).toBe(false)
  })

  it('say what mute will do, and report the action a click asks for', () => {
    const { actions, calls, click } = build()
    actions.draw({ count: 2, allMuted: true })
    const mute = [...actions.element.children].find(b => b.dataset.action === 'mute')
    expect(mute.getAttribute('aria-label')).toBe('Unmute')
    click('mute'); click('copy')
    expect(calls).toEqual(['mute', 'copy'])
    actions.draw({ count: 2, allMuted: false })
    expect(mute.getAttribute('aria-label')).toBe('Mute')
  })

  it('says Unlock when every selected clip is locked', () => {
    const { actions } = build()
    actions.draw({ count: 1, allLocked: true })
    expect([...actions.element.children].find(b => b.dataset.action === 'lock').getAttribute('aria-label')).toBe('Unlock')
  })

  it('keeps the same buttons across a redraw, so a focused one stays focused', () => {
    const { actions } = build()
    actions.draw({ count: 1 })
    const before = [...actions.element.children]
    actions.draw({ count: 1 })
    expect([...actions.element.children]).toEqual(before)
  })

  it('offers a colour for each of the track colours and none, each named, and reports the choice', () => {
    const { actions, calls } = build()
    actions.draw({ count: 2 })
    const group = actions.element.querySelector('.clip-colors')
    const buttons = [...group.children]
    expect(buttons.length).toBeGreaterThan(2)
    expect(buttons.every(b => b.getAttribute('aria-label').endsWith('for the selected clips'))).toBe(true)
    buttons[0].dispatchEvent(new document.defaultView.Event('click'))
    buttons[1].dispatchEvent(new document.defaultView.Event('click'))
    expect(calls[0]).toEqual(['color', null])
    expect(calls[1][1]).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('needs a handler', () => {
    expect(() => createClipActions(document, {})).toThrow(/needs onAction/)
    expect(() => createClipActions(document, { onAction () {} })).toThrow(/needs onColor/)
  })
})
