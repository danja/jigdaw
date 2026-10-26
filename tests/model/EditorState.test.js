// tests/model/EditorState.test.js
import { describe, it, expect } from 'vitest'
import { EditorState } from '../../src/model/EditorState.js'

describe('EditorState', () => {
  it('starts as the default and says so', () => {
    const editor = new EditorState()
    expect(editor.isDefault).toBe(true)
    expect(editor.track('t')).toEqual({ order: null, color: null, folder: null, folderCollapsed: false, laneSize: 'small', laneHeight: null })
    expect(editor.position('n')).toEqual({ x: 0, y: 0 })
  })

  it('keeps whether the folder is collapsed, and refuses anything but true or false', () => {
    const editor = new EditorState()
    editor.setTrack('t', { folderCollapsed: true })
    expect(editor.track('t').folderCollapsed).toBe(true)
    expect(() => editor.setTrack('t', { folderCollapsed: 'yes' })).toThrow(/folderCollapsed/)
    expect(editor.track('t').folderCollapsed).toBe(true)
    editor.setTrack('t', { folderCollapsed: false })
    expect(editor.track('t').folderCollapsed).toBe(false)
  })

  it('keeps a folder name trimmed, refuses an empty or long one, and clears with null', () => {
    const editor = new EditorState()
    editor.setTrack('t', { folder: '  Drums ' })
    expect(editor.track('t').folder).toBe('Drums')
    expect(() => editor.setTrack('t', { folder: '   ' })).toThrow(/folder/)
    expect(() => editor.setTrack('t', { folder: 'x'.repeat(61) })).toThrow(/folder/)
    expect(editor.track('t').folder).toBe('Drums')
    editor.setTrack('t', { folder: null })
    expect(editor.track('t').folder).toBeNull()
  })

  it('is no longer the default once a track or a node is laid out', () => {
    const a = new EditorState(); a.setTrack('t', { color: '#ff8800' })
    const b = new EditorState(); b.setPosition('n', 3, 4)
    expect(a.isDefault).toBe(false)
    expect(b.isDefault).toBe(false)
  })

  it('refuses a colour that is not lower case #rrggbb', () => {
    const editor = new EditorState()
    for (const bad of ['red', '#FF8800', '#f80', 'ff8800', 5]) {
      expect(() => editor.setTrack('t', { color: bad })).toThrow(/color/)
    }
    expect(editor.isDefault).toBe(true)
  })

  it('accepts a collapsed lane, which is a size like the others', () => {
    const editor = new EditorState()
    editor.setTrack('t', { laneSize: 'collapsed' })
    expect(editor.track('t').laneSize).toBe('collapsed')
  })

  it('refuses an unknown lane size and a fractional order', () => {
    const editor = new EditorState()
    expect(() => editor.setTrack('t', { laneSize: 'huge' })).toThrow(/laneSize/)
    expect(() => editor.setTrack('t', { order: 1.5 })).toThrow(/order/)
  })

  it('refuses a position that is not finite', () => {
    expect(() => new EditorState().setPosition('n', NaN, 0)).toThrow(/finite/)
  })

  it('shows placed tracks by order, then the unplaced in the order given', () => {
    const editor = new EditorState()
    editor.setTrack('c', { order: 0 })
    editor.setTrack('a', { order: 1 })
    expect(editor.orderTracks(['a', 'b', 'c', 'd'])).toEqual(['c', 'a', 'b', 'd'])
  })

  it('load replaces everything, and a bad value changes nothing', () => {
    const editor = new EditorState()
    editor.setTrack('t', { color: '#000000' })
    expect(() => editor.load({ positions: new Map(), tracks: new Map([['t', { color: 'nope' }]]) })).toThrow()
    expect(editor.track('t').color).toBe('#000000')
    editor.load({ positions: new Map([['n', { x: 1, y: 2 }]]), tracks: new Map() })
    expect(editor.track('t').color).toBeNull()
    expect(editor.position('n')).toEqual({ x: 1, y: 2 })
  })

  it('prunes what names something that is gone', () => {
    const editor = new EditorState()
    editor.setPosition('n', 1, 1); editor.setTrack('t', { order: 0 })
    editor.prune(new Set(), new Set())
    expect(editor.isDefault).toBe(true)
  })
})

describe('EditorState, moving tracks and telling views', () => {
  it('moves a track one place at a time and gives every track an explicit order', () => {
    const editor = new EditorState()
    const ids = ['a', 'b', 'c']
    expect(editor.moveTrack(ids, 'c', -1)).toBe(true)
    expect(editor.orderTracks(ids)).toEqual(['a', 'c', 'b'])
    expect(ids.map(id => editor.track(id).order)).toEqual([0, 2, 1])
    expect(editor.moveTrack(ids, 'c', -1)).toBe(true)
    expect(editor.orderTracks(ids)).toEqual(['c', 'a', 'b'])
  })

  it('refuses to move past either end, and says nothing moved', () => {
    const editor = new EditorState()
    expect(editor.moveTrack(['a', 'b'], 'a', -1)).toBe(false)
    expect(editor.moveTrack(['a', 'b'], 'b', 1)).toBe(false)
    expect(editor.moveTrack(['a', 'b'], 'b', 0)).toBe(false)
    expect(editor.isDefault).toBe(true)
    expect(() => editor.moveTrack(['a'], 'ghost', 1)).toThrow(/no such track/)
  })

  it('a track made after a reorder shows last', () => {
    const editor = new EditorState()
    editor.moveTrack(['a', 'b'], 'b', -1)
    expect(editor.orderTracks(['a', 'b', 'c'])).toEqual(['b', 'a', 'c'])
  })

  it('tells subscribers after a change, and only a change', () => {
    const editor = new EditorState()
    let told = 0
    const off = editor.subscribe(() => { told++ })
    editor.setTrack('a', { color: '#112233' })
    editor.setPosition('n', 1, 2)
    editor.moveTrack(['a', 'b'], 'a', -1)
    expect(told).toBe(2)
    editor.prune(new Set(['n']), new Set(['a']))
    expect(told).toBe(2)
    editor.prune(new Set(), new Set(['a']))
    expect(told).toBe(3)
    off()
    editor.setTrack('a', { laneSize: 'small' })
    expect(told).toBe(3)
  })
})

describe('EditorState.isDefaultFor', () => {
  it('ignores layout and positions of things that are gone', () => {
    const editor = new EditorState()
    editor.setTrack('gone', { color: '#112233' })
    editor.setPosition('goneNode', 5, 5)
    expect(editor.isDefaultFor(new Set(['n']), new Set(['t']))).toBe(true)
    expect(editor.isDefaultFor(new Set(['goneNode']), new Set(['t']))).toBe(false)
    expect(editor.isDefaultFor(new Set(), new Set(['gone']))).toBe(false)
  })
})

describe('a clip colour', () => {
  it('is set and read without touching a revision, and refuses a value that is not a colour', () => {
    const editor = new EditorState()
    expect(editor.clip('c')).toEqual({ color: null })
    editor.setClip('c', { color: '#e5484d' })
    expect(editor.clip('c').color).toBe('#e5484d')
    expect(() => editor.setClip('c', { color: 'red' })).toThrow(/color must be/)
    expect(editor.isDefault).toBe(false)
  })

  it('is forgotten with its clip when pruned, and kept when nothing is said about clips', () => {
    const editor = new EditorState()
    editor.setClip('c', { color: '#e5484d' })
    editor.prune(new Set(), new Set())
    expect(editor.clip('c').color).toBe('#e5484d')
    editor.prune(new Set(), new Set(), new Set())
    expect(editor.clip('c').color).toBe(null)
  })

  describe('a lane dragged to a height of its own', () => {
    it('is kept as a whole number of pixels, and none when it has not been dragged', () => {
      const editor = new EditorState()
      expect(editor.track('t').laneHeight).toBeNull()
      editor.setTrack('t', { laneHeight: 120 })
      expect(editor.track('t').laneHeight).toBe(120)
      editor.setTrack('t', { laneHeight: null })
      expect(editor.track('t').laneHeight).toBeNull()
    })

    it('refuses a height that is not a whole number from 24 to 800, and keeps what it had', () => {
      const editor = new EditorState()
      editor.setTrack('t', { laneHeight: 100 })
      for (const bad of [23, 801, 100.5, NaN, Infinity, '100', -1, 0]) expect(() => editor.setTrack('t', { laneHeight: bad }), String(bad)).toThrow(/laneHeight must be a whole number of pixels from 24 to 800, or null/)
      expect(editor.track('t').laneHeight).toBe(100)
    })

    it('is accepted at either end of the range', () => {
      const editor = new EditorState()
      editor.setTrack('t', { laneHeight: 24 })
      editor.setTrack('t', { laneHeight: 800 })
      expect(editor.track('t').laneHeight).toBe(800)
    })

    it('is kept beside the size it was dragged from, and setting a size alone does not touch it', () => {
      const editor = new EditorState()
      editor.setTrack('t', { laneSize: 'large', laneHeight: 200 })
      editor.setTrack('t', { laneSize: 'medium' })
      expect(editor.track('t')).toMatchObject({ laneSize: 'medium', laneHeight: 200 })
    })
  })
})
