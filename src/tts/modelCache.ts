const DB = "tts-cache"; const STORE = "models";
let dbPromise: Promise<IDBDatabase> | null = null;

function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "url" });
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
  return dbPromise;
}

export async function cachedFetchArrayBuffer(url: string): Promise<ArrayBuffer> {
  const db = await openDB();
  const tx = db.transaction(STORE, "readonly");
  const getReq = tx.objectStore(STORE).get(url);
  const buf = await new Promise<ArrayBuffer | null>((res, rej) => {
    getReq.onsuccess = () => res(getReq.result?.data ?? null);
    getReq.onerror = () => rej(getReq.error);
  });
  if (buf) return buf;

  const r = await fetch(url);
  if (!r.ok) throw new Error(`fetch ${url} ${r.status}`);
  const ab = await r.arrayBuffer();

  const txw = db.transaction(STORE, "readwrite");
  txw.objectStore(STORE).put({ url, data: ab, ts: Date.now() });
  return ab;
}

export async function cachedFetchJSON<T = unknown>(url: string): Promise<T> {
  const ab = await cachedFetchArrayBuffer(url);
  const dec = new TextDecoder();
  return JSON.parse(dec.decode(new Uint8Array(ab))) as T;
}