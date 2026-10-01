// tests/engine/EventRouterMonitor.test.js
//
// The monitor's history: bounded, per route, and gone with the route.
import { describe, it, expect } from 'vitest'
import { EventRouter, MONITOR_EVENTS } from '../../src/engine/EventRouter.js'

function setup () {
  const listeners = new Map()
  const posted = []
  const engine = {
    onMessage: (id, fn) => { listeners.set(id, fn); return () => listeners.delete(id) },
    post: (id, message) => posted.push([id, message]),
    nodes: () => []
  }
  const router = new EventRouter({ engine })
  const emit = (id, events) => listeners.get(id)({ type: 'events', events })
  return { router, emit, posted }
}
const on = (frame, pitch) => ({ frame, bytes: Uint8Array.from([0x90, pitch, 100]) })

describe('what the router remembers for a monitor', () => {
  it('keeps the events that went over a route, oldest first, and still delivers them', () => {
    const { router, emit, posted } = setup()
    router.setRoutes([{ from: 'a', to: 'b' }, { from: 'a', to: 'c' }])
    emit('a', [on(10, 60), on(20, 62)])
    expect(router.recent('a', 'b').map(e => [e.frame, e.bytes[1]])).toEqual([[10, 60], [20, 62]])
    expect(router.recent('a', 'c')).toHaveLength(2)
    expect(router.recent('b', 'a')).toEqual([])
    expect(posted.map(p => p[0])).toEqual(['b', 'c'])
  })

  it('is bounded: only the last few are kept, however many went over', () => {
    const { router, emit } = setup()
    router.setRoutes([{ from: 'a', to: 'b' }])
    for (let i = 0; i < MONITOR_EVENTS * 3; i++) emit('a', [on(i, i % 128)])
    const kept = router.recent('a', 'b')
    expect(kept).toHaveLength(MONITOR_EVENTS)
    expect(kept.at(-1).frame).toBe(MONITOR_EVENTS * 3 - 1)
  })

  it('hands out a copy, so a monitor cannot change the history', () => {
    const { router, emit } = setup()
    router.setRoutes([{ from: 'a', to: 'b' }])
    emit('a', [on(1, 60)])
    router.recent('a', 'b').length = 0
    expect(router.recent('a', 'b')).toHaveLength(1)
  })

  it('forgets a route that is gone when the routes are replaced', () => {
    const { router, emit } = setup()
    router.setRoutes([{ from: 'a', to: 'b' }])
    emit('a', [on(1, 60)])
    router.setRoutes([{ from: 'a', to: 'c' }])
    expect(router.recent('a', 'b')).toEqual([])
    router.setRoutes([{ from: 'a', to: 'b' }])
    expect(router.recent('a', 'b')).toEqual([])
  })
})
