// web/app/Recovery.js
//
// Autosave and recovery on the studio page. While there is a session with something in it, and it has changed since the last
// copy, a recovery copy is kept (src/host/Recovery.js) every `recoverySeconds` from web/host.json. The copy is the same bytes Save
// writes, but it goes only to the browser's own storage and never over a file the person saved. Saving removes it. At the next
// visit a bar offers it, with the time it was kept, and while that offer is waiting no new copy replaces it.
//
// Taking a copy asks every plugin for its state and applies it to the model without a history step, so a copy is not an edit to step
// back over. The revision it moves is noted afterwards, so only a real edit makes the next copy.
import { createRecovery } from '../../src/host/Recovery.js'

export function createRecoveryCopy (ctx) {
  const { document, $, log } = ctx
  let store = null
  let seconds = null
  let lastRevision = null
  let busy = false
  let offering = false

  async function ready () {
    if (store) return store
    const response = await fetch(new URL('host.json', document.baseURI))
    if (!response.ok) throw new Error(`web/host.json could not be read: ${response.status}`)
    const config = await response.json()
    if (!(config.recoverySeconds > 0)) throw new Error('web/host.json has no recoverySeconds')
    seconds = config.recoverySeconds
    store = createRecovery()
    return store
  }

  const when = ms => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  function say (text) {
    const line = $('recovery-status')
    if (line) line.textContent = text
  }

  /** Keep a copy now if the session has changed since the last one. Quiet when there is nothing to keep. */
  async function snapshot () {
    const d = ctx.dispatcher
    if (busy || offering || !d || d.project.nodes.length === 0 || d.project.revision === lastRevision) return
    busy = true
    try {
      const packed = await ctx.sessions.pack({ recorded: false })
      await (await ready()).put({ kind: packed.kind, bytes: packed.bytes, nodes: packed.nodes, title: d.project.info?.title ?? null })
      lastRevision = d.project.revision
      say(`A recovery copy was kept at ${when(Date.now())}. It is not your saved file.`)
    } catch (error) {
      say(`A recovery copy could not be kept: ${error.message}`)
    } finally { busy = false }
  }

  return {
    snapshot,
    /** Start keeping copies. */
    async start () {
      try { await ready() } catch (error) { say(`Recovery copies are off: ${error.message}`); return }
      setInterval(() => { snapshot() }, seconds * 1000)
    },
    /** The person saved: the copy is now the older of the two, so it goes. */
    async saved () {
      lastRevision = ctx.dispatcher?.project.revision ?? null
      try { await (await ready()).clear(); say('Saved. No recovery copy is kept.') } catch { /* nothing was kept */ }
    },
    /** Show the bar if an earlier visit left a copy. Quiet when there is none, or storage is not available. */
    async offer () {
      let kept = null
      try { kept = await (await ready()).read() } catch { return }
      if (!kept) return
      offering = true
      const name = kept.title ? `"${kept.title}", ` : ''
      $('recover-text').textContent = `Unsaved work from ${when(kept.savedAt)}: ${name}${kept.nodes} plugin${kept.nodes === 1 ? '' : 's'}. This is a recovery copy kept in this browser, not your saved file.`
      $('recover').hidden = false
      $('recover-open').onclick = async () => {
        $('recover').hidden = true
        offering = false
        try { await ctx.sessions.openBytes(kept.bytes) } catch (error) { log(error.message, 'error') }
      }
      $('recover-dismiss').onclick = async () => {
        $('recover').hidden = true
        offering = false
        try { await (await ready()).clear() } catch { /* nothing to forget */ }
      }
    }
  }
}
