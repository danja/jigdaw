// tests/model/Selection.test.js
import { describe, it, expect, vi } from 'vitest'
import { Selection } from '../../src/model/Selection.js'

describe('Selection', () => {
  it('starts empty', () => {
    const s = new Selection()
    expect(s.kind).toBeNull()
    expect(s.size).toBe(0)
  })

  it('holds one kind at a time: adding another kind replaces', () => {
    const s = new Selection()
    s.set('track', ['t1', 't2'])
    s.add('track', ['t3'])
    expect(s.ids).toEqual(['t1', 't2', 't3'])
    s.add('clip', ['c1'])
    expect(s.kind).toBe('clip')
    expect(s.ids).toEqual(['c1'])
    expect(s.has('track', 't1')).toBe(false)
  })

  it('toggles, and an emptied selection has no kind', () => {
    const s = new Selection()
    s.toggle('clip', 'c1')
    expect(s.has('clip', 'c1')).toBe(true)
    s.toggle('clip', 'c1')
    expect(s.kind).toBeNull()
  })

  it('refuses a kind it does not know', () => {
    expect(() => new Selection().set('banana', ['x'])).toThrow(/cannot select/)
  })

  it('notifies on change only, and stops after unsubscribe', () => {
    const s = new Selection()
    const fn = vi.fn()
    const off = s.subscribe(fn)
    s.set('clip', ['a'])
    s.set('clip', ['a'])
    expect(fn).toHaveBeenCalledTimes(1)
    off()
    s.clear()
    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('prunes what the project no longer holds', () => {
    const s = new Selection()
    s.set('clip', ['a', 'b'])
    s.prune((kind, id) => id === 'a')
    expect(s.ids).toEqual(['a'])
    s.prune(() => false)
    expect(s.kind).toBeNull()
  })
})
