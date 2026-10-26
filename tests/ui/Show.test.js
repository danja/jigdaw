// tests/ui/Show.test.js
//
// The rules of the step list: which step draws what, and where a visit starts. What binds the list to the page is
// tests/web/Show.test.js.
import { describe, it, expect } from 'vitest'
import { STEPS, FROM, drawnAt, asStep, defaultStep, tabsDrawnAt } from '../../src/ui/Show.js'

describe('the steps', () => {
  it('are three, from the least drawn to the most', () => {
    expect(STEPS).toEqual(['simple', 'standard', 'advanced'])
  })

  it('give every control in the list a first step that is one of them', () => {
    for (const [selector, from] of Object.entries(FROM)) expect(STEPS, selector).toContain(from)
  })

  it('draw a thing at its first step and every step after, and not before', () => {
    expect(drawnAt('simple', 'standard')).toBe(false)
    expect(drawnAt('standard', 'standard')).toBe(true)
    expect(drawnAt('advanced', 'standard')).toBe(true)
    expect(drawnAt('standard', 'advanced')).toBe(false)
    expect(drawnAt('simple', 'simple')).toBe(true)
  })

  it('refuse a step that does not exist, for either argument, rather than drawing or leaving out by accident', () => {
    expect(() => drawnAt('expert', 'simple')).toThrow(/no such step: expert/)
    expect(() => drawnAt('simple', 'expert')).toThrow(/no such step: expert/)
  })
})

describe('what storage hands back', () => {
  it('is a step or it is nothing', () => {
    expect(asStep('advanced')).toBe('advanced')
    expect(asStep('Advanced')).toBeNull()
    expect(asStep('')).toBeNull()
    expect(asStep(null)).toBeNull()
    expect(asStep(undefined)).toBeNull()
    expect(asStep('__proto__')).toBeNull()
  })
})

describe('where a visit starts', () => {
  it('is Simple on a narrow screen and Standard on a wide one, and never Advanced', () => {
    expect(defaultStep({ narrow: true })).toBe('simple')
    expect(defaultStep({ narrow: false })).toBe('standard')
  })
})

describe('the tabs', () => {
  const tabs = ['arrangement', 'tracks', 'routing', 'mixer', 'launcher', 'script', 'settings'].map(id => ({ id }))

  it('are the arrangement alone in Simple, so there is nothing to switch between', () => {
    expect(tabsDrawnAt('simple', tabs)).toEqual(['arrangement'])
  })

  it('add the mixer, the launcher and settings in Standard, in the page order', () => {
    expect(tabsDrawnAt('standard', tabs)).toEqual(['arrangement', 'mixer', 'launcher', 'settings'])
  })

  it('are all seven in Advanced', () => {
    expect(tabsDrawnAt('advanced', tabs)).toHaveLength(7)
  })

  it('refuse a tab the list has not placed, rather than guessing a step for it', () => {
    expect(() => tabsDrawnAt('simple', [{ id: 'new' }])).toThrow(/no such step/)
  })
})
