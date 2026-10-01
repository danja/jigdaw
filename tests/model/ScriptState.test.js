// tests/model/ScriptState.test.js
import { describe, it, expect } from 'vitest'
import { ScriptState, REEL } from '../../src/model/ScriptState.js'
import { Project } from '../../src/model/Project.js'

describe('saving a script', () => {
  it('keeps the text exactly as typed, with its language and label', () => {
    const s = new ScriptState()
    s.set('script', { source: 'a.mix = 1\n# a comment\n', label: 'Main' })
    expect(s.get('script')).toEqual({ id: 'script', label: 'Main', language: REEL, source: 'a.mix = 1\n# a comment\n', savedAt: null })
  })

  it('refuses an empty script, a non-string, a missing language and a bad id', () => {
    const s = new ScriptState()
    expect(() => s.set('x', { source: '' })).toThrow(/not empty/)
    expect(() => s.set('x', { source: 3 })).toThrow(/not empty/)
    expect(() => s.set('x', { source: 'a', language: '' })).toThrow(/language/)
    expect(() => s.set('has space', { source: 'a' })).toThrow(/letters, digits/)
    expect(() => s.set('a/b', { source: 'a' })).toThrow(/letters, digits/)
    expect(s.size).toBe(0)
  })

  it('replaces a script saved under the same id, and removes and clears', () => {
    const s = new ScriptState()
    s.set('one', { source: 'a' })
    s.set('one', { source: 'b' })
    s.set('two', { source: 'c' })
    expect(s.get('one').source).toBe('b')
    s.remove('one')
    expect(s.get('one')).toBeNull()
    s.clear()
    expect(s.size).toBe(0)
  })

  it('lists scripts by id and finds the first in a language', () => {
    const s = new ScriptState()
    s.set('b', { source: 'x' })
    s.set('a', { source: 'y' })
    s.set('c', { source: 'z', language: 'https://example.org/Other' })
    expect(s.all.map(x => x.id)).toEqual(['a', 'b', 'c'])
    expect(s.firstIn(REEL).id).toBe('a')
    expect(s.firstIn('https://example.org/None')).toBeNull()
  })

  it('hands out copies, so a caller cannot change what is held', () => {
    const s = new ScriptState()
    s.set('a', { source: 'x' })
    s.get('a').source = 'changed'
    s.all[0].source = 'changed'
    expect(s.get('a').source).toBe('x')
  })

  it('tells a subscriber about each change, and not about a no-op', () => {
    const s = new ScriptState()
    let told = 0
    const stop = s.subscribe(() => { told++ })
    s.set('a', { source: 'x' })
    s.clear()
    s.clear()
    expect(told).toBe(2)
    stop()
    s.set('a', { source: 'y' })
    expect(told).toBe(2)
  })

  it('loads a list whole, and a bad entry changes nothing', () => {
    const s = new ScriptState()
    s.set('keep', { source: 'x' })
    expect(() => s.load([{ id: 'ok', source: 'y' }, { id: 'bad', source: '' }])).toThrow()
    expect(s.all.map(x => x.id)).toEqual(['keep'])
    s.load([{ id: 'ok', source: 'y' }])
    expect(s.all.map(x => x.id)).toEqual(['ok'])
  })
})

describe('a script is not part of the project', () => {
  it('does not move the revision, so saving one cannot conflict with an edit or invalidate anything', () => {
    const p = new Project()
    const before = p.revision
    p.scripts.set('script', { source: 'a.mix = 1' })
    expect(p.revision).toBe(before)
  })

  it('is not undone with the project, because the snapshot does not hold it', () => {
    const p = new Project()
    p.scripts.set('script', { source: 'a.mix = 1' })
    const snapshot = p.snapshot()
    expect(JSON.stringify(snapshot)).not.toContain('a.mix')
  })
})
