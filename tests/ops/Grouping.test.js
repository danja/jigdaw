// tests/ops/Grouping.test.js
//
// dispatcher.grouped(fn): one undo step for however many edits fn makes, which is how a Reel script's run is
// one thing to undo (docs/livecoding.md), and the unrecorded firings that follow it are not.
import { describe, it, expect, beforeEach } from 'vitest'
import { OpDispatcher } from '../../src/ops/OpDispatcher.js'

const IRI = 'https://strandz.it/jigdaw/plugins/cascade/'

let d
beforeEach(() => {
  d = new OpDispatcher()
  d.apply([{ op: 'addTrack', id: 't' }, { op: 'addNode', id: 'a', track: 't', pluginIri: IRI }])
  d.clearHistory()
})

const setting = symbol => d.project.nodes.find(n => n.id === 'a').settings.get(symbol)

describe('grouped', () => {
  it('makes several edits one step to undo, and one to redo', async () => {
    await d.grouped(async () => {
      d.setParameter('a', 'mix', 0.1)
      d.setParameter('a', 'size', 0.2)
      d.setParameter('a', 'damping', 0.3)
    })
    expect([setting('mix'), setting('size'), setting('damping')]).toEqual([0.1, 0.2, 0.3])

    await d.undo()
    expect([setting('mix'), setting('size'), setting('damping')]).toEqual([undefined, undefined, undefined])
    expect(d.canUndo()).toBe(false)

    await d.redo()
    expect([setting('mix'), setting('size'), setting('damping')]).toEqual([0.1, 0.2, 0.3])
  })

  it('leaves each edit outside a group as its own step, as before', async () => {
    d.setParameter('a', 'mix', 0.1)
    d.setParameter('a', 'size', 0.2)
    await d.undo()
    expect(setting('mix')).toBe(0.1)
    expect(setting('size')).toBeUndefined()
  })

  it('records nothing for a group that changed nothing, so an empty run leaves no step', async () => {
    await d.grouped(async () => {})
    expect(d.canUndo()).toBe(false)
  })

  it('returns what the function returned', async () => {
    expect(await d.grouped(async () => 42)).toBe(42)
  })

  it('records recording again after the function throws, and keeps the edits it made', async () => {
    await expect(d.grouped(async () => { d.setParameter('a', 'mix', 0.4); throw new Error('boom') })).rejects.toThrow('boom')
    expect(setting('mix')).toBe(0.4)
    expect(d.canUndo()).toBe(true)
    d.setParameter('a', 'size', 0.5)
    await d.undo()
    expect(setting('size')).toBeUndefined()
    expect(setting('mix')).toBe(0.4)
  })

  it('joins a group already open, so nesting makes one step and not two', async () => {
    await d.grouped(async () => {
      d.setParameter('a', 'mix', 0.1)
      await d.grouped(async () => d.setParameter('a', 'size', 0.2))
      d.setParameter('a', 'damping', 0.3)
    })
    await d.undo()
    expect([setting('mix'), setting('size'), setting('damping')]).toEqual([undefined, undefined, undefined])
    expect(d.canUndo()).toBe(false)
  })

  it('clears redo, as any new edit does', async () => {
    d.setParameter('a', 'mix', 0.1)
    await d.undo()
    expect(d.canRedo()).toBe(true)
    await d.grouped(async () => d.setParameter('a', 'size', 0.2))
    expect(d.canRedo()).toBe(false)
  })
})

describe('what happens after the group, for a performance', () => {
  it('does not record an unrecorded firing, so the history is not filled by a script playing', async () => {
    await d.grouped(async () => d.setParameter('a', 'mix', 0.1))
    for (let i = 0; i < 150; i++) await d.withoutRecording(async () => d.setParameter('a', 'size', i / 150))
    // One step for the run, however many firings, and the history limit is not reached.
    await d.undo()
    expect(setting('mix')).toBeUndefined()
    expect(d.canUndo()).toBe(false)
  })

  it('keeps what the performance left behind in the model, so a save holds it', async () => {
    await d.withoutRecording(async () => d.setParameter('a', 'size', 0.8))
    expect(setting('size')).toBe(0.8)
  })

  it('ends only its own suppression: an unrecorded call inside a group does not end the group early', async () => {
    await d.grouped(async () => {
      d.setParameter('a', 'mix', 0.1)
      await d.withoutRecording(async () => d.setParameter('a', 'size', 0.2))
      d.setParameter('a', 'damping', 0.3)
    })
    await d.undo()
    expect([setting('mix'), setting('size'), setting('damping')]).toEqual([undefined, undefined, undefined])
    expect(d.canUndo()).toBe(false)
  })

  it('keeps recording for ordinary edits after an unrecorded firing finishes', async () => {
    await d.withoutRecording(async () => d.setParameter('a', 'size', 0.8))
    d.setParameter('a', 'mix', 0.1)
    expect(d.canUndo()).toBe(true)
  })
})
