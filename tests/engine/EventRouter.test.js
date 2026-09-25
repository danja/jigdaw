// tests/engine/EventRouter.test.js
import { describe, it, expect } from 'vitest'
import { EventRouter, isMidi, carriesNotes } from '../../src/engine/EventRouter.js'
import { vocabulary } from '../../src/rdf/Vocabulary.js'

const T = 'http://purl.org/stuff/transmissions/'

/** An engine that records posts and can deliver a message from a processor. */
function fakeEngine (ids = ['a', 'b', 'c']) {
  const handlers = new Map(ids.map(id => [id, new Set()]))
  return {
    posts: [],
    nodes: () => ids.map(id => ({ id })),
    onMessage (id, handler) {
      handlers.get(id).add(handler)
      return () => handlers.get(id).delete(handler)
    },
    post (id, message) { this.posts.push({ id, message }) },
    /** Pretend a processor said something. */
    emit (id, message) { for (const h of handlers.get(id)) h(message, { id }) },
    listenerCount: id => handlers.get(id).size
  }
}

const note = (frame, data = [0x90, 60, 100]) => ({ frame, bytes: Uint8Array.from(data) })

describe('isMidi', () => {
  it('recognises every MIDI signal type, and only those', () => {
    for (const kind of ['Midi', 'BassMidi', 'DrumMidi', 'MelodyMidi', 'ControlMidi', 'MidiCC']) {
      expect(isMidi(`${T}${kind}`), kind).toBe(true)
    }
    expect(isMidi(`${T}Audio`)).toBe(false)
    expect(isMidi(`${T}AudioSidechain`)).toBe(false)
    // Enumerated rather than matched by substring, so a future term whose name
    // merely contains "Midi" is not swept in.
    expect(isMidi(`${T}NotMidiAtAll`)).toBe(false)
  })
})

describe('routing', () => {
  it('carries events from one processor to another', () => {
    // The Web Audio graph carries no MIDI, so this is the host doing it.
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.setRoutes([{ from: 'a', to: 'b' }])

    engine.emit('a', { type: 'events', events: [note(128)] })

    expect(engine.posts).toHaveLength(1)
    expect(engine.posts[0].id).toBe('b')
    expect(engine.posts[0].message.events[0].frame).toBe(128)
  })

  it('fans out to several targets', () => {
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.setRoutes([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }])
    engine.emit('a', { type: 'events', events: [note(0)] })
    expect(engine.posts.map(p => p.id).sort()).toEqual(['b', 'c'])
  })

  it('sends nothing back to the source', () => {
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.setRoutes([{ from: 'a', to: 'b' }])
    engine.emit('a', { type: 'events', events: [note(0)] })
    expect(engine.posts.every(p => p.id !== 'a')).toBe(true)
  })

  it('orders events by frame before sending', () => {
    // messaging.md 1.4: the host posts in non-decreasing frame order, so a
    // processor may stop scanning once it passes the quantum.
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.setRoutes([{ from: 'a', to: 'b' }])
    engine.emit('a', { type: 'events', events: [note(512), note(0), note(256)] })
    expect(engine.posts[0].message.events.map(e => e.frame)).toEqual([0, 256, 512])
  })

  it('ignores an empty batch rather than posting nothing', () => {
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.setRoutes([{ from: 'a', to: 'b' }])
    engine.emit('a', { type: 'events', events: [] })
    expect(engine.posts).toEqual([])
  })

  it('drops routes that are gone when rebuilt', () => {
    // Rebuilt whole rather than diffed, so no stale target keeps receiving
    // notes from a node it is no longer connected to.
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.setRoutes([{ from: 'a', to: 'b' }])
    router.setRoutes([{ from: 'a', to: 'c' }])
    engine.emit('a', { type: 'events', events: [note(0)] })
    expect(engine.posts.map(p => p.id)).toEqual(['c'])
  })

  it('listens to a node once however often routes are rebuilt', () => {
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    for (let i = 0; i < 5; i++) router.setRoutes([{ from: 'a', to: 'b' }])
    expect(engine.listenerCount('a')).toBe(1)
  })

  it('reports its routes', () => {
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.setRoutes([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }])
    expect(router.routes).toEqual([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }])
  })
})

describe('overflow', () => {
  it('accumulates what a processor reports dropping', () => {
    // A processor cannot grow its queue and cannot allocate, so saying so is
    // the only thing it can do about overflow.
    const reported = []
    const engine = fakeEngine()
    const router = new EventRouter({ engine, onDropped: r => reported.push(r) })
    router.setRoutes([{ from: 'a', to: 'b' }])

    engine.emit('a', { type: 'dropped', count: 3 })
    engine.emit('a', { type: 'dropped', count: 2 })

    expect(router.droppedFor('a')).toBe(5)
    expect(reported.map(r => r.count)).toEqual([3, 2])
    expect(reported[1].total).toBe(5)
  })

  it('reports zero for a node that has dropped nothing', () => {
    const router = new EventRouter({ engine: fakeEngine() })
    expect(router.droppedFor('a')).toBe(0)
  })
})

describe('transport', () => {
  it('reaches every loaded node, routed or not', () => {
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.broadcastTransport({ type: 'transport', beat: 4 })
    expect(engine.posts.map(p => p.id)).toEqual(['a', 'b', 'c'])
    expect(engine.posts[0].message.beat).toBe(4)
  })
})

describe('dispose', () => {
  it('stops listening', () => {
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.setRoutes([{ from: 'a', to: 'b' }])
    router.dispose()
    engine.emit('a', { type: 'events', events: [note(0)] })
    expect(engine.posts).toEqual([])
    expect(engine.listenerCount('a')).toBe(0)
  })
})

describe('construction', () => {
  it('refuses an engine it does not have', () => {
    expect(() => new EventRouter({})).toThrow(/needs an engine/)
  })
})

describe('observing a node that has no routes', () => {
  it('still hears that it dropped events', () => {
    // Overflow matters regardless of wiring: an instrument dropping notes is
    // worth knowing about even when nothing is listening to its MIDI output.
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.observe('a')
    engine.emit('a', { type: 'dropped', count: 4 })
    expect(router.droppedFor('a')).toBe(4)
  })

  it('forwards nothing from it, having no route to forward along', () => {
    const engine = fakeEngine()
    const router = new EventRouter({ engine })
    router.observe('a')
    engine.emit('a', { type: 'events', events: [note(0)] })
    expect(engine.posts).toEqual([])
  })
})

describe('carriesNotes', () => {
  // A plugin taking only control changes must not be offered a keyboard or a
  // clip: nothing played into it would sound. Quefrency is the case.
  it('is true of MIDI that plays, and false of MIDI that only controls', () => {
    expect(carriesNotes(vocabulary.trn.Midi)).toBe(true)
    expect(carriesNotes('http://purl.org/stuff/transmissions/BassMidi')).toBe(true)
    expect(carriesNotes(vocabulary.trn.ControlMidi)).toBe(false)
    expect(carriesNotes(vocabulary.trn.MidiCC)).toBe(false)
    expect(isMidi(vocabulary.trn.ControlMidi)).toBe(true)
    expect(carriesNotes(vocabulary.trn.Audio)).toBe(false)
  })
})
