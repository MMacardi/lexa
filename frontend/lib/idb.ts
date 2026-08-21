"use client";

// Minimal promise wrapper around IndexedDB (no dependency). Two stores:
//  - "kv": simple key/value (used to mirror the words list for offline review)
//  - "outbox": queued mutations (review grades, word adds) awaiting sync
const DB_NAME = "lexa";
const DB_VERSION = 1;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("outbox")) db.createObjectStore("outbox", { keyPath: "id", autoIncrement: true });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx<T>(store: string, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = run(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

// --- kv ---
export async function kvGet<T>(key: string): Promise<T | undefined> {
  try {
    return await tx<T>("kv", "readonly", (s) => s.get(key) as IDBRequest<T>);
  } catch {
    return undefined;
  }
}
export async function kvSet<T>(key: string, value: T): Promise<void> {
  try {
    await tx("kv", "readwrite", (s) => s.put(value as unknown as never, key));
  } catch {
    /* storage unavailable — offline cache just won't persist */
  }
}

// --- outbox ---
export type OutboxOp =
  | { id?: number; kind: "review"; wordId: string; grade: number; at: number }
  | { id?: number; kind: "add"; word: string; sourceLang: string; targetLang: string; at: number };

export async function outboxAdd(op: OutboxOp): Promise<void> {
  try {
    await tx("outbox", "readwrite", (s) => s.add(op));
  } catch {
    /* ignore */
  }
}
export async function outboxAll(): Promise<OutboxOp[]> {
  try {
    return (await tx<OutboxOp[]>("outbox", "readonly", (s) => s.getAll() as IDBRequest<OutboxOp[]>)) ?? [];
  } catch {
    return [];
  }
}
export async function outboxDelete(id: number): Promise<void> {
  try {
    await tx("outbox", "readwrite", (s) => s.delete(id));
  } catch {
    /* ignore */
  }
}
export async function outboxCount(): Promise<number> {
  try {
    return (await tx<number>("outbox", "readonly", (s) => s.count())) ?? 0;
  } catch {
    return 0;
  }
}
