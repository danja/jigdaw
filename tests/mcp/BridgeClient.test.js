// tests/mcp/BridgeClient.test.js
//
// The fake EventSource and fetch refuse what the real ones would: the event
// stream only ever delivers strings, and a request body that is not a string
// is a mistake the real fetch would send as "[object Object]".
import { describe, it, expect } from 'vitest'
import { connectBridge } from '../../src/mcp/BridgeClient.js'

class FakeEventSource {
  static last = null
  constructor (url) {
    this.url = url
    this.readyState = 0
    this.listeners = new Map()
    this.closed = false
    FakeEventSource.last = this
  }
  addEventListener (type, fn) { this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]) }
  emit (type, data) {
    if (data !== undefined && typeof data !== 'string') throw new Error('an event stream delivers strings')
    for (const fn of this.listeners.get(type) ?? []) fn({ data })
  }
  close () { this.closed = true; this.readyState = 2 }
}

function rig (surface = { call: async (name, input) => ({ ok: true, name, input }) }) {
  const posted = []
  const states = []
  const calls = []
  const fetch = async (url, options) => {
    if (typeof options.body !== 'string') throw new Error('fetch would send this as [object Object]')
    posted.push({ url, ...options, body: JSON.parse(options.body) })
    return { ok: true, status: 204 }
  }
  const client = connectBridge({
    url: 'http://127.0.0.1:8749', token: 'a b/c', surface, EventSource: FakeEventSource, fetch,
    onState: (s, d) => states.push(d ? `${s}: ${d}` : s), onCall: name => calls.push(name)
  })
  return { client, source: FakeEventSource.last, posted, states, calls }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

describe('connecting', () => {
  it('opens the stream with the token, encoded, and says when it is connected', () => {
    const { source, states } = rig()
    expect(source.url).toBe('http://127.0.0.1:8749/tab?token=a%20b%2Fc')
    source.emit('hello', '{"tools":30}')
    expect(states).toEqual(['connecting', 'connected'])
  })

  it('tells a refusal from a dropped connection', () => {
    const refused = rig()
    refused.source.readyState = 2
    refused.source.emit('error')
    expect(refused.states.at(-1)).toBe('refused')

    const dropped = rig()
    dropped.source.emit('hello', '{}')
    dropped.source.readyState = 0
    dropped.source.emit('error')
    expect(dropped.states.at(-1)).toBe('retrying')
    dropped.source.readyState = 2
    dropped.source.emit('error')
    expect(dropped.states.at(-1)).toBe('closed')
  })

  it('needs what it connects with', () => {
    expect(() => connectBridge({ url: 'x', surface: { call () {} }, EventSource: FakeEventSource, fetch () {} })).toThrow(/token/)
    expect(() => connectBridge({ url: 'x', token: 't', surface: {}, EventSource: FakeEventSource, fetch () {} })).toThrow(/surface/)
  })
})

describe('answering calls', () => {
  it('runs a call through the surface and posts the result back with the token', async () => {
    const { source, posted, calls } = rig()
    source.emit('call', JSON.stringify({ id: 'c1', name: 'track_add', input: { label: 'Drums' } }))
    await settle()
    expect(calls).toEqual(['track_add'])
    expect(posted).toEqual([{
      url: 'http://127.0.0.1:8749/tab/result',
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: { token: 'a b/c', id: 'c1', result: { ok: true, name: 'track_add', input: { label: 'Drums' } } }
    }])
  })

  it('says so rather than timing out when a result will not serialise', async () => {
    const cyclic = {}
    cyclic.self = cyclic
    const { source, posted } = rig({ call: async () => cyclic })
    source.emit('call', JSON.stringify({ id: 'c2', name: 'status', input: {} }))
    await settle()
    expect(posted[0].body.result).toEqual({ ok: false, error: expect.stringMatching(/status returned something that cannot be sent/) })
  })

  it('ignores a call it cannot read', async () => {
    const { source, posted } = rig()
    source.emit('call', 'not json')
    await settle()
    expect(posted).toEqual([])
  })

  it('stops when closed', () => {
    const { client, source, states } = rig()
    client.close()
    expect(source.closed).toBe(true)
    expect(states.at(-1)).toBe('closed')
  })
})
