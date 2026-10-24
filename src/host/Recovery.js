// src/host/Recovery.js
//
// A recovery copy of the open session, kept in IndexedDB so work is not lost to a crash or a closed tab. It is the session as
// Save would write it (Turtle, or a zip with its audio and layout), under one key, and it is never the saved file: it sits in the
// browser's own storage, is overwritten by the next snapshot, and is removed when the person saves or discards it. Nothing here
// opens it. The page offers it, and opening is a person's click.
const DATABASE = 'jigdaw-recovery'
const STORE = 'recovery'
const KEY = 'latest'

const asPromise = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB refused the request'))
})

const finished = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB refused the transaction'))
  transaction.onabort = () => reject(transaction.error ?? new Error('the transaction was aborted'))
})

export function createRecovery ({ indexedDB = globalThis.indexedDB, now = () => Date.now() } = {}) {
  if (!indexedDB) throw new Error('this browser has no IndexedDB to keep a recovery copy in')

  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'))
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
  })

  return {
    /** Keep a copy: `{ kind, bytes, nodes, title }`, replacing any earlier one. */
    async put ({ kind, bytes, nodes, title = null }) {
      if (!(bytes instanceof Uint8Array) || (kind !== 'turtle' && kind !== 'zip') || !Number.isInteger(nodes)) throw new Error('a recovery copy needs kind, bytes and a node count')
      const db = await open()
      try {
        const transaction = db.transaction(STORE, 'readwrite')
        transaction.objectStore(STORE).put({ kind, bytes, nodes, title, savedAt: now() }, KEY)
        await finished(transaction)
      } finally { db.close() }
    },

    /** The copy as it was kept, or null. It stays until `clear` or the next `put`. */
    async read () {
      const db = await open()
      try {
        return (await asPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY))) ?? null
      } finally { db.close() }
    },

    /** Forget the copy. */
    async clear () {
      const db = await open()
      try {
        const transaction = db.transaction(STORE, 'readwrite')
        transaction.objectStore(STORE).delete(KEY)
        await finished(transaction)
      } finally { db.close() }
    }
  }
}
