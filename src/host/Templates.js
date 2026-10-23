// src/host/Templates.js
//
// Sessions kept in this browser to start new ones from. A template is a session as saved (Turtle, or a zip with
// its audio and layout), under a name, in IndexedDB because it can hold audio. Unlike the handoff it stays until
// it is removed, and nothing opens one but a person's choice: a template is data, and a page that started a
// session with sound on its own would be refused by the browser anyway.
//
// Layout: one record per template under `t:<name>`, and one `index` record listing the names and when each was
// saved, so listing never reads the audio. Both are written in one transaction, so the index never names a
// template that is not there.
const DATABASE = 'jigdaw-templates'
const STORE = 'templates'
const INDEX = 'index'
export const NAME_LIMIT = 60

const asPromise = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB refused the request'))
})

const finished = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB refused the transaction'))
  transaction.onabort = () => reject(transaction.error ?? new Error('the transaction was aborted'))
})

/** A template's name as stored: spaces squeezed, 1 to 60 characters. Throws otherwise. */
export function templateName (name) {
  if (typeof name !== 'string') throw new Error('a template needs a name')
  const text = name.trim().replace(/\s+/g, ' ')
  if (text === '') throw new Error('a template needs a name')
  if (text.length > NAME_LIMIT) throw new Error(`a template name is at most ${NAME_LIMIT} characters`)
  return text
}

export function createTemplates ({ indexedDB = globalThis.indexedDB, now = () => Date.now() } = {}) {
  if (!indexedDB) throw new Error('this browser has no IndexedDB to keep templates in')

  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'))
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
  })

  /** Run `work(store)` in one transaction on a fresh connection, closing it whatever happens. */
  async function within (mode, work) {
    const db = await open()
    try {
      const transaction = db.transaction(STORE, mode)
      const result = await work(transaction.objectStore(STORE))
      await finished(transaction)
      return result
    } finally { db.close() }
  }

  const readIndex = async store => (await asPromise(store.get(INDEX))) ?? []

  return {
    /** Every template, by name: `[{ name, savedAt }]`. */
    list () {
      return within('readonly', async store => [...(await readIndex(store))].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)))
    },

    /** Keep a session under a name, replacing any template of that name. `{ kind: 'turtle' | 'zip', bytes }`. */
    async save (name, { kind, bytes }) {
      const key = templateName(name)
      if (!(bytes instanceof Uint8Array) || (kind !== 'turtle' && kind !== 'zip')) throw new Error('a template needs kind and bytes')
      const savedAt = now()
      await within('readwrite', async store => {
        const index = (await readIndex(store)).filter(entry => entry.name !== key)
        index.push({ name: key, savedAt })
        await asPromise(store.put({ kind, bytes, savedAt }, `t:${key}`))
        await asPromise(store.put(index, INDEX))
      })
      return key
    },

    /** `{ kind, bytes }`, or null when there is no such template. */
    get (name) {
      const key = templateName(name)
      return within('readonly', async store => {
        const record = await asPromise(store.get(`t:${key}`))
        return record ? { kind: record.kind, bytes: record.bytes } : null
      })
    },

    /** Forget a template. Removing one that is not there is not an error. */
    remove (name) {
      const key = templateName(name)
      return within('readwrite', async store => {
        const index = (await readIndex(store)).filter(entry => entry.name !== key)
        await asPromise(store.delete(`t:${key}`))
        await asPromise(store.put(index, INDEX))
      })
    }
  }
}
