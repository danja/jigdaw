// tests/web/Panic.test.js
import { describe, it, expect } from 'vitest'
import { createTransport } from '../../web/app/Transport.js'

function build (nodes) {
  const posted = []
  const logged = []
  const ctx = {
    document: {},
    $: () => ({ setAttribute () {} }),
    log: message => logged.push(message),
    engine: { nodes: () => nodes.map(id => ({ id })), post: (id, message) => posted.push([id, message]) }
  }
  return { transport: createTransport(ctx), posted, logged }
}

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

  it('does not stop a transport that is not running, and does nothing with no engine', () => {
    const { transport, posted } = build([])
    transport.panic()
    expect(posted).toEqual([])
    expect(transport.playing()).toBe(false)
  })
})
