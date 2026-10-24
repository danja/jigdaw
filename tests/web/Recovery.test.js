// tests/web/Recovery.test.js
//
// Autosave and recovery on the page: a copy only when something changed, never while an earlier copy is waiting to be offered, never
// as an undo step, removed by a save, and offered with the time and a choice to recover or discard.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { parseHTML } from 'linkedom'

let document
beforeEach(() => {
  ({ document } = parseHTML(`<!doctype html><body><div id="recover" hidden><span id="recover-text"></span><button id="recover-open"></button><button id="recover-dismiss"></button></div><p id="recovery-status"></p></body>`))
})

async function load (kept = null) {
  const state = { record: kept }
  const api = {
    put: vi.fn(async copy => { state.record = { ...copy, savedAt: 1_700_000_000_000 } }),
    read: vi.fn(async () => state.record),
    clear: vi.fn(async () => { state.record = null })
  }
  vi.resetModules()
  vi.doMock('../../src/host/Recovery.js', () => ({ createRecovery: () => api }))
  vi.stubGlobal('fetch', async () => ({ ok: true, status: 200, json: async () => ({ recoverySeconds: 30 }) }))
  const { createRecoveryCopy } = await import('../../web/app/Recovery.js')
  return { createRecoveryCopy, api, state }
}

function context (over = {}) {
  const logs = []
  const opened = []
  const project = { revision: 1, nodes: [{ id: 'n' }], info: { title: 'Tide' } }
  const packs = []
  return {
    logs, opened, project, packs,
    ctx: {
      document: new Proxy(document, { get: (target, key) => (key === 'baseURI' ? 'http://x.test/' : (typeof target[key] === 'function' ? target[key].bind(target) : target[key])) }),
      $: id => document.getElementById(id),
      log: (message, kind = 'info') => logs.push({ message, kind }),
      dispatcher: { project },
      sessions: {
        pack: async options => { packs.push(options); return { kind: 'turtle', bytes: new Uint8Array([1, 2, 3]), nodes: 1 } },
        openBytes: async bytes => { opened.push([...bytes]) }
      },
      ...over
    }
  }
}

describe('keeping copies', () => {
  it('keeps a copy of a changed session, without an undo step, and not again until it changes', async () => {
    const { createRecoveryCopy, api } = await load()
    const { ctx, project, packs } = context()
    const recovery = createRecoveryCopy(ctx)
    await recovery.snapshot()
    expect(packs).toEqual([{ recorded: false }])
    expect(api.put).toHaveBeenCalledWith({ kind: 'turtle', bytes: new Uint8Array([1, 2, 3]), nodes: 1, title: 'Tide' })
    expect(document.getElementById('recovery-status').textContent).toMatch(/recovery copy was kept/)
    await recovery.snapshot()
    expect(api.put).toHaveBeenCalledTimes(1)
    project.revision = 2
    await recovery.snapshot()
    expect(api.put).toHaveBeenCalledTimes(2)
  })

  it('keeps nothing for an empty session, or before there is one', async () => {
    const { createRecoveryCopy, api } = await load()
    const empty = context()
    empty.project.nodes = []
    await createRecoveryCopy(empty.ctx).snapshot()
    await createRecoveryCopy(context({ dispatcher: null }).ctx).snapshot()
    expect(api.put).not.toHaveBeenCalled()
  })

  it('says so, and goes on, when a copy could not be kept', async () => {
    const { createRecoveryCopy, api } = await load()
    api.put.mockRejectedValueOnce(new Error('quota exceeded'))
    const { ctx, project } = context()
    const recovery = createRecoveryCopy(ctx)
    await recovery.snapshot()
    expect(document.getElementById('recovery-status').textContent).toMatch(/could not be kept: quota exceeded/)
    project.revision = 2
    await recovery.snapshot()
    expect(api.put).toHaveBeenCalledTimes(2)
  })

  it('removes the copy when the person saves, and then copies only real changes', async () => {
    const { createRecoveryCopy, api } = await load()
    const { ctx, project } = context()
    const recovery = createRecoveryCopy(ctx)
    await recovery.snapshot()
    await recovery.saved()
    expect(api.clear).toHaveBeenCalled()
    await recovery.snapshot()
    expect(api.put).toHaveBeenCalledTimes(1)
    project.revision = 3
    await recovery.snapshot()
    expect(api.put).toHaveBeenCalledTimes(2)
  })
})

describe('offering a copy', () => {
  const kept = { kind: 'turtle', bytes: new Uint8Array([9, 8]), nodes: 3, title: 'Tide', savedAt: 1_700_000_000_000 }

  it('offers what was kept, said as not the saved file, and quiet when nothing was', async () => {
    const none = await load()
    await none.createRecoveryCopy(context().ctx).offer()
    expect(document.getElementById('recover').hidden).toBe(true)
    const { createRecoveryCopy } = await load(kept)
    await createRecoveryCopy(context().ctx).offer()
    expect(document.getElementById('recover').hidden).toBe(false)
    const text = document.getElementById('recover-text').textContent
    expect(text).toContain('"Tide"')
    expect(text).toContain('3 plugins')
    expect(text).toContain('not your saved file')
  })

  it('opens the copy on Recover, from the bytes that were kept', async () => {
    const { createRecoveryCopy } = await load(kept)
    const { ctx, opened } = context()
    await createRecoveryCopy(ctx).offer()
    await document.getElementById('recover-open').onclick()
    expect(opened).toEqual([[9, 8]])
    expect(document.getElementById('recover').hidden).toBe(true)
  })

  it('forgets the copy on Discard', async () => {
    const { createRecoveryCopy, api, state } = await load(kept)
    await createRecoveryCopy(context().ctx).offer()
    await document.getElementById('recover-dismiss').onclick()
    expect(api.clear).toHaveBeenCalled()
    expect(state.record).toBeNull()
  })

  it('does not replace the waiting copy with a new one while the offer is open', async () => {
    const { createRecoveryCopy, api } = await load(kept)
    const { ctx } = context()
    const recovery = createRecoveryCopy(ctx)
    await recovery.offer()
    await recovery.snapshot()
    expect(api.put).not.toHaveBeenCalled()
    await document.getElementById('recover-dismiss').onclick()
    await recovery.snapshot()
    expect(api.put).toHaveBeenCalledTimes(1)
  })
})
