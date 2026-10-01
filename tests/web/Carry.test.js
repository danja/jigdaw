// tests/web/Carry.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseHTML } from 'linkedom'

let document, window
beforeEach(() => {
  ({ document, window } = parseHTML(`<!doctype html><body><a id="go" href="http://x.test/?studio">Studio</a>
    <div id="carry" hidden><span id="carry-text"></span><button id="carry-open"></button><button id="carry-dismiss"></button></div></body>`))
})

// A stand-in for the browser's own pieces the module reaches for: fetch of host.json, the location, IndexedDB.
async function load (stored = null) {
  const records = new Map(stored ? [['piece', stored]] : [])
  const handoffApi = {
    put: vi.fn(async piece => { records.set('piece', { ...piece, savedAt: 1 }) }),
    peek: vi.fn(async () => (records.has('piece') ? { from: records.get('piece').from, savedAt: 1 } : null)),
    take: vi.fn(async () => { const r = records.get('piece') ?? null; records.delete('piece'); return r }),
    clear: vi.fn(async () => { records.delete('piece') })
  }
  vi.resetModules()
  vi.doMock('../../src/host/Handoff.js', () => ({ createHandoff: vi.fn(({ maxAgeMs }) => { handoffApi.maxAgeMs = maxAgeMs; return handoffApi }) }))
  const location = { href: '' }
  vi.stubGlobal('window', { location })
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ handoffMinutes: 30 }) }))
  const { createCarry } = await import('../../web/app/Carry.js')
  return { createCarry, handoffApi, records, location }
}

function context (over = {}) {
  const logs = []
  const opened = []
  return {
    logs, opened,
    ctx: {
      document: new Proxy(document, { get: (target, key) => (key === 'baseURI' ? 'http://x.test/' : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) }),
      $: id => document.getElementById(id),
      log: (message, kind = 'info') => logs.push({ message, kind }),
      dispatcher: { project: { nodes: [{ id: 'n' }] } },
      sessions: { pack: async () => ({ kind: 'turtle', bytes: new Uint8Array([1, 2, 3]), nodes: 1 }), openBytes: async bytes => { opened.push([...bytes]) } },
      ...over
    }
  }
}

describe('carrying a piece to the other page', () => {
  it('keeps the open piece, saying which page it came from, and then goes where the link goes', async () => {
    const { createCarry, handoffApi, location } = await load()
    const { ctx } = context()
    const carry = createCarry(ctx, { self: 'simple', offerText: 'x' })
    await carry.leave('http://x.test/?studio')
    expect(handoffApi.put).toHaveBeenCalledWith({ from: 'simple', kind: 'turtle', bytes: new Uint8Array([1, 2, 3]) })
    expect(handoffApi.maxAgeMs).toBe(30 * 60000)
    expect(location.href).toBe('http://x.test/?studio')
  })

  it('goes without keeping anything when no piece is open, and goes anyway, saying so, when keeping fails', async () => {
    const empty = await load()
    const a = context({ dispatcher: { project: { nodes: [] } } })
    await empty.createCarry(a.ctx, { self: 'simple', offerText: 'x' }).leave('http://x.test/')
    expect(empty.handoffApi.put).not.toHaveBeenCalled()
    expect(empty.location.href).toBe('http://x.test/')

    const failing = await load()
    failing.handoffApi.put.mockRejectedValue(new Error('storage is full'))
    const b = context()
    await failing.createCarry(b.ctx, { self: 'simple', offerText: 'x' }).leave('http://x.test/?studio')
    expect(b.logs.at(-1)).toEqual({ message: 'the piece could not be carried over: storage is full', kind: 'error' })
    expect(failing.location.href).toBe('http://x.test/?studio')
  })

  it('a plain click on the link carries the piece; a modified click, which opens a new tab, leaves it alone', async () => {
    const { createCarry, handoffApi } = await load()
    const { ctx } = context()
    const carry = createCarry(ctx, { self: 'simple', offerText: 'x' })
    const link = document.getElementById('go')
    carry.carryOnClick(link)
    const click = fields => Object.assign(new window.Event('click', { cancelable: true }), { button: 0, ...fields })
    const modified = click({ ctrlKey: true })
    link.dispatchEvent(modified)
    expect(modified.defaultPrevented).toBe(false)
    const plain = click({})
    link.dispatchEvent(plain)
    expect(plain.defaultPrevented).toBe(true)
    await new Promise(r => setTimeout(r, 0))
    expect(handoffApi.put).toHaveBeenCalledTimes(1)
  })
})

describe('offering the piece on the other page', () => {
  it('shows the bar when the other page left one, and opens it only when asked, once', async () => {
    const { createCarry, handoffApi } = await load({ from: 'simple', kind: 'turtle', bytes: new Uint8Array([9, 8]) })
    const { ctx, opened } = context()
    const carry = createCarry(ctx, { self: 'studio', offerText: 'A piece from the simple page.' })
    await carry.offer()
    expect(document.getElementById('carry').hidden).toBe(false)
    expect(document.getElementById('carry-text').textContent).toBe('A piece from the simple page.')
    expect(opened).toEqual([])
    document.getElementById('carry-open').onclick()
    await new Promise(r => setTimeout(r, 0))
    expect(opened).toEqual([[9, 8]])
    expect(document.getElementById('carry').hidden).toBe(true)
    expect(handoffApi.take).toHaveBeenCalledTimes(1)
  })

  it('does not offer a piece this page left itself, or when there is none', async () => {
    const mine = await load({ from: 'studio', kind: 'turtle', bytes: new Uint8Array([1]) })
    await mine.createCarry(context().ctx, { self: 'studio', offerText: 'x' }).offer()
    expect(document.getElementById('carry').hidden).toBe(true)
    const none = await load()
    await none.createCarry(context().ctx, { self: 'studio', offerText: 'x' }).offer()
    expect(document.getElementById('carry').hidden).toBe(true)
  })

  it('forgets the piece on Not now, and says so when the piece has gone by the time it is asked for', async () => {
    const dismissed = await load({ from: 'simple', kind: 'turtle', bytes: new Uint8Array([1]) })
    await dismissed.createCarry(context().ctx, { self: 'studio', offerText: 'x' }).offer()
    await document.getElementById('carry-dismiss').onclick()
    expect(dismissed.handoffApi.clear).toHaveBeenCalled()
    expect(document.getElementById('carry').hidden).toBe(true)

    const gone = await load({ from: 'simple', kind: 'turtle', bytes: new Uint8Array([1]) })
    const { ctx, logs } = context()
    await gone.createCarry(ctx, { self: 'studio', offerText: 'x' }).offer()
    gone.records.clear()
    document.getElementById('carry-open').onclick()
    await new Promise(r => setTimeout(r, 0))
    expect(logs.at(-1)).toEqual({ message: 'the piece is no longer there', kind: 'error' })
  })

  it('stays quiet when storage is not available at all', async () => {
    const { createCarry, handoffApi } = await load()
    handoffApi.peek.mockRejectedValue(new Error('IndexedDB is blocked'))
    const { ctx, logs } = context()
    await createCarry(ctx, { self: 'studio', offerText: 'x' }).offer()
    expect(document.getElementById('carry').hidden).toBe(true)
    expect(logs).toEqual([])
  })
})
