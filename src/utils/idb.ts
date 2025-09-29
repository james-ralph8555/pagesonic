// Lightweight IndexedDB helper without external deps.
// DB name: 'pagesonic', with object stores:
// - 'models': { key: string, id: string, version: string, url: string, blob: ArrayBuffer, updatedAt: number }
// - 'prefs': { key: string, value: any }

export type IDBModelRecord = {
  key: string
  id: string
  version: string
  url: string
  blob: ArrayBuffer
  updatedAt: number
}

const DB_NAME = 'pagesonic'
const DB_VERSION = 1

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains('models')) {
        db.createObjectStore('models', { keyPath: 'key' })
      }
      if (!db.objectStoreNames.contains('prefs')) {
        db.createObjectStore('prefs', { keyPath: 'key' })
      }
    }
    req.onerror = () => reject(req.error)
    req.onsuccess = () => resolve(req.result)
  })
}

function tx<T = unknown>(db: IDBDatabase, store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore, setResult: (value: T) => void) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode)
    const s = t.objectStore(store)
    let result: T | undefined
    const setResult = (value: T) => { result = value }
    
    t.oncomplete = () => resolve(result as T)
    t.onerror = () => reject(t.error)
    fn(s, setResult)
  })
}

export async function getPref<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDB()
  return tx<T | undefined>(db, 'prefs', 'readonly', (s, setResult) => {
    const req = s.get(key)
    req.onsuccess = () => {
      setResult(req.result ? (req.result.value as T) : undefined)
    }
  })
}

export async function setPref<T = unknown>(key: string, value: T): Promise<void> {
  const db = await openDB()
  await tx<void>(db, 'prefs', 'readwrite', (s) => {
    s.put({ key, value })
  })
}

export async function hasAnyData(): Promise<boolean> {
  const db = await openDB()
  const modelsCount = await tx<number>(db, 'models', 'readonly', (s, setResult) => {
    const req = s.count()
    req.onsuccess = () => {
      setResult(req.result || 0)
    }
  })
  if (modelsCount > 0) return true
  const anyPref = await tx<number>(db, 'prefs', 'readonly', (s, setResult) => {
    const req = s.count()
    req.onsuccess = () => {
      setResult(req.result || 0)
    }
  })
  return anyPref > 0
}

export async function getModelRecord(key: string): Promise<IDBModelRecord | undefined> {
  const db = await openDB()
  return tx<IDBModelRecord | undefined>(db, 'models', 'readonly', (s, setResult) => {
    const req = s.get(key)
    req.onsuccess = () => {
      setResult(req.result as IDBModelRecord | undefined)
    }
  })
}

export async function putModelRecord(rec: IDBModelRecord): Promise<void> {
  const db = await openDB()
  await tx<void>(db, 'models', 'readwrite', (s) => {
    s.put(rec)
  })
}

export async function deleteModelByIdPrefix(id: string): Promise<number> {
  // Remove all versions for a given model id
  const db = await openDB()
  return tx<number>(db, 'models', 'readwrite', (s, setResult) => {
    let count = 0
    const req = s.openCursor()
    req.onsuccess = () => {
      const cursor = req.result
      if (!cursor) {
        setResult(count)
        return
      }
      const val = cursor.value as IDBModelRecord
      if (val.id === id) {
        cursor.delete()
        count++
      }
      cursor.continue()
    }
  })
}