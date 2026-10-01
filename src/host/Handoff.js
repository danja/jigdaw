// src/host/Handoff.js
//
// Carrying the open piece from one of the pages to the other. The studio and the simple page are separate
// documents, so a piece in one is gone when the person follows the link to the other; this keeps it for the
// next page to pick up. The piece is the session as saved (Turtle, or a zip with its audio and layout), held in
// IndexedDB because it can hold audio and a Storage value cannot.
//
// One piece at a time, under one key, and it is taken once: reading it removes it, so it is not offered again
// on the next visit, and a newer one replaces an older one that was never taken. It expires after
// `maxAgeMs` (from web/host.json), so a piece left from last week is not mistaken for what was just open.
// Nothing here opens it: that needs a person's click, since a page that starts audio without one is not allowed to.
const DATABASE = 'jigdaw-handoff'
const STORE = 'handoff'
const KEY = 'piece'

/** A request as a promise. */
const asPromise = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result)
  request.onerror = () => reject(request.error ?? new Error('IndexedDB refused the request'))
})

/** A transaction as a promise that settles when it is done, which is when the data is safely written. */
const finished = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve()
  transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB refused the transaction'))
  transaction.onabort = () => reject(transaction.error ?? new Error('the transaction was aborted'))
})

export function createHandoff ({ indexedDB = globalThis.indexedDB, now = () => Date.now(), maxAgeMs }) {
  if (!indexedDB) throw new Error('this browser has no IndexedDB to carry a piece in')
  if (!(maxAgeMs > 0)) throw new Error('Handoff needs maxAgeMs, from the host configuration')

  const open = () => new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1)
    request.onupgradeneeded = () => request.result.createObjectStore(STORE)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB could not be opened'))
    request.onblocked = () => reject(new Error('IndexedDB is blocked by another tab'))
  })

  const fresh = record => record && now() - record.savedAt <= maxAgeMs

  return {
    /** Keep a piece: `{ from, kind, bytes }`, `from` the page it came from, `kind` 'turtle' or 'zip'. */
    async put ({ from, kind, bytes }) {
      if (!from || !(bytes instanceof Uint8Array) || (kind !== 'turtle' && kind !== 'zip')) throw new Error('a handoff needs from, kind and bytes')
      const db = await open()
      try {
        const transaction = db.transaction(STORE, 'readwrite')
        transaction.objectStore(STORE).put({ from, kind, bytes, savedAt: now() }, KEY)
        await finished(transaction)
      } finally { db.close() }
    },

    /** Whether there is a piece to offer and where it came from, without taking it. */
    async peek () {
      const db = await open()
      try {
        const record = await asPromise(db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY))
        return fresh(record) ? { from: record.from, savedAt: record.savedAt } : null
      } finally { db.close() }
    },

    /** Take the piece: the record, removed, or null when there is none or it has expired. */
    async take () {
      const db = await open()
      try {
        const transaction = db.transaction(STORE, 'readwrite')
        const store = transaction.objectStore(STORE)
        const record = await asPromise(store.get(KEY))
        store.delete(KEY)
        await finished(transaction)
        return fresh(record) ? record : null
      } finally { db.close() }
    },

    /** Forget any piece that is waiting. */
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
