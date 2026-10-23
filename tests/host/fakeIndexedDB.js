// tests/host/fakeIndexedDB.js
//
// The IndexedDB stand-in is asynchronous as the real one is, and refuses what the real one refuses: a store
// that was never created, a write in a read-only transaction, a request on a transaction that has finished, and
// a value that cannot be structured-cloned. A fake that accepted these would pass code that fails in a browser.
export function fakeIndexedDB () {
  const databases = new Map()
  const tick = fn => queueMicrotask(fn)
  const clone = value => {
    if (typeof value === 'function') throw new DOMException('a function cannot be cloned', 'DataCloneError')
    return structuredClone(value)
  }

  function transaction (db, names, mode) {
    const tx = { oncomplete: null, onerror: null, onabort: null, active: true, mode }
    let pending = 0
    // Commits once the task that made the last request is over, microtasks included, as a real transaction does.
    const settle = () => { if (pending === 0 && tx.active) tx.active = false, setTimeout(() => tx.oncomplete?.(), 0) }
    tx.objectStore = name => {
      if (!names.includes(name)) throw new DOMException(`no such store: ${name}`, 'NotFoundError')
      const data = db.stores.get(name)
      const request = work => {
        if (!tx.active) throw new DOMException('the transaction has finished', 'TransactionInactiveError')
        const r = { onsuccess: null, onerror: null, result: undefined }
        pending++
        tick(() => { r.result = work(); pending--; r.onsuccess?.(); setTimeout(settle, 0) })
        return r
      }
      return {
        get: key => request(() => (data.has(key) ? structuredClone(data.get(key)) : undefined)),
        put: (value, key) => {
          if (mode === 'readonly') throw new DOMException('the transaction is read-only', 'ReadOnlyError')
          const copy = clone(value)
          return request(() => { data.set(key, copy); return key })
        },
        delete: key => {
          if (mode === 'readonly') throw new DOMException('the transaction is read-only', 'ReadOnlyError')
          return request(() => { data.delete(key); return undefined })
        }
      }
    }
    setTimeout(() => { if (pending === 0) settle() }, 0)
    return tx
  }

  return {
    databases,
    open (name) {
      const request = { onsuccess: null, onerror: null, onupgradeneeded: null, onblocked: null, result: null }
      tick(() => {
        let db = databases.get(name)
        const fresh = !db
        if (fresh) { db = { stores: new Map(), closed: false }; databases.set(name, db) }
        const connection = {
          closed: false,
          createObjectStore: store => { if (db.stores.has(store)) throw new DOMException('exists', 'ConstraintError'); db.stores.set(store, new Map()) },
          transaction: (names, mode) => {
            if (connection.closed) throw new DOMException('the connection is closed', 'InvalidStateError')
            const list = Array.isArray(names) ? names : [names]
            for (const n of list) if (!db.stores.has(n)) throw new DOMException(`no such store: ${n}`, 'NotFoundError')
            return transaction(db, list, mode)
          },
          close: () => { connection.closed = true }
        }
        request.result = connection
        if (fresh) request.onupgradeneeded?.()
        request.onsuccess?.()
      })
      return request
    }
  }
}
