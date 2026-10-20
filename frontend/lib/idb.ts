"use client";

import type { ReviewSource } from "./api";
import { cacheScope, sameScope } from "./sessionCache";

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
        t.oncomplete = () => { db.close(); resolve(req.result); };
        t.onabort = () => { db.close(); reject(t.error); };
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
export async function kvSet<T>(key: string, value: T, shouldWrite = () => true): Promise<void> {
  try {
    await tx("kv", "readwrite", (s) => shouldWrite() ? s.put(value as unknown as never, key) : s.get(key));
  } catch {
    /* storage unavailable — offline cache just won't persist */
  }
}

/** Remove an account's snapshots and queued writes on logout/revocation/switch. */
export async function clearAccountCache(accountId: string): Promise<void> {
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(["kv", "outbox"], "readwrite");
      const kv = t.objectStore("kv").openCursor();
      kv.onsuccess = () => {
        const cursor = kv.result;
        if (!cursor) return;
        const key = String(cursor.key);
        if (key === `words:${accountId}` || key.startsWith(`word:${accountId}:`)) cursor.delete();
        cursor.continue();
      };
      const ops = t.objectStore("outbox").openCursor();
      ops.onsuccess = () => {
        const cursor = ops.result;
        if (!cursor) return;
        if (!cursor.value.accountId || cursor.value.accountId === accountId) cursor.delete();
        cursor.continue();
      };
      t.oncomplete = () => { db.close(); resolve(); };
      t.onabort = () => { db.close(); reject(t.error); };
    });
  } catch { /* storage unavailable */ }
}

/** Bind legacy operations before learner prefs can overwrite the old owner marker. */
export async function scopeLegacyOutbox(accountId: string): Promise<void> {
  try {
    const legacyOwner = localStorage.getItem("lexa.prefsAccount");
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction("outbox", "readwrite");
      const request = t.objectStore("outbox").openCursor();
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) return;
        if (!cursor.value.accountId) {
          if (legacyOwner === accountId) cursor.update({ ...cursor.value, accountId });
          else cursor.delete();
        }
        cursor.continue();
      };
      t.oncomplete = () => { db.close(); resolve(); };
      t.onabort = () => { db.close(); reject(t.error); };
    });
  } catch { /* storage unavailable */ }
}

// --- outbox ---
export type OutboxOp = (
  // `source` is the surface that graded it; absent on ops queued before it was
  // logged, which only ever came from the review page.
  | { id?: number; kind: "review"; wordId: string; grade: number; source?: ReviewSource; at: number }
  | { id?: number; kind: "add"; word: string; sourceLang: string; targetLang: string; notes?: string; at: number }
  // A new word's first grade (it becomes a card then).
  | { id?: number; kind: "learn"; word: string; grade: number; source: "review" | "write"; at: number }
) & { accountId?: string };

export async function outboxAdd(op: OutboxOp): Promise<void> {
  const { owner, revision } = cacheScope();
  if (!owner) return;
  try {
    await tx("outbox", "readwrite", (s) => sameScope(owner, revision) ? s.add({ ...op, accountId: owner }) : s.get(-1));
  } catch {
    /* ignore */
  }
}
export async function outboxAll(): Promise<OutboxOp[]> {
  try {
    const ops = (await tx<OutboxOp[]>("outbox", "readonly", (s) => s.getAll() as IDBRequest<OutboxOp[]>)) ?? [];
    const { owner } = cacheScope();
    if (!owner) return [];
    return ops.filter((op) => op.accountId === owner);
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
  return (await outboxAll()).length;
}
