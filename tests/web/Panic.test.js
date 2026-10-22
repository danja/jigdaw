// tests/web/Panic.test.js
import { describe, it, expect } from 'vitest'
import { createTransport, isPanicShortcut } from '../../web/app/Transport.js'

function build (nodes, rack = undefined) {
  const posted = []
  const logged = []
  const ctx = {
    document: {},
    $: () => ({ setAttribute () {} }),
    log: message => logged.push(message),
    rack,
    engine: { nodes: () => nodes.map(id => ({ id })), post: (id, message) => posted.push([id, message]) }
  }
  return { transport: createTransport(ctx), posted, logged }
}

describe('the panic shortcut', () => {
  it('is Ctrl or Cmd with a full stop and nothing else', () => {
    expect(isPanicShortcut({ ctrlKey: true, key: '.' })).toBe(true)
    expect(isPanicShortcut({ metaKey: true, key: '.' })).toBe(true)
    expect(isPanicShortcut({ key: '.' })).toBe(false)
    expect(isPanicShortcut({ ctrlKey: true, key: ',' })).toBe(false)
    expect(isPanicShortcut({ ctrlKey: true, altKey: true, key: '.' })).toBe(false)
  })
})

describe('panic', () => {
  it('sends all notes off and all sound off to every node', () => {
    const { transport, posted } = build(['a', 'b'])
    transport.panic()
    expect(posted.map(([id]) => id)).toEqual(['a', 'b'])
    for (const [, message] of posted) {
      expect(message.type).toBe('events')
      expect(message.events.map(e => [...e.bytes])).toEqual([[0xb0, 123, 0], [0xb0, 120, 0]])
    }
  })

  it('lets go of the notes held on the on-screen keyboards before it silences the nodes', () => {
    const order = []
    const { transport } = build(['a'], { releaseKeys: () => order.push('release') })
    transport.panic()
    expect(order).toEqual(['release'])
  })

  it('does not stop a transport that is not running, and does nothing with no engine', () => {
    const { transport, posted } = build([])
    transport.panic()
    expect(posted).toEqual([])
    expect(transport.playing()).toBe(false)
  })
})
