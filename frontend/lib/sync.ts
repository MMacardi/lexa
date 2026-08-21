"use client";

import { api, type Word } from "./api";
import { kvGet, kvSet, outboxAdd, outboxAll, outboxCount, outboxDelete } from "./idb";

// Offline sync: mirror the words list for offline review, queue mutations made
// offline (review grades, word adds), and flush the queue when back online.

const wordsKey = (accountId: string) => `words:${accountId}`;

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Load words from the network (and mirror for offline), falling back to the
 *  last cached copy when offline. Use as the review page's queryFn. */
export async function fetchWordsCached(accountId: string): Promise<Word[]> {
  try {
    const w = await api.listWords(accountId);
    void kvSet(wordsKey(accountId), w);
    return w;
  } catch (e) {
    const cached = await kvGet<Word[]>(wordsKey(accountId));
    if (cached) return cached;
    throw e;
  }
}

/** Overwrite the offline words snapshot (after an optimistic local update). */
export async function mirrorWords(accountId: string, words: Word[]): Promise<void> {
  await kvSet(wordsKey(accountId), words);
}

/** Send a review grade now, or queue it if offline/failed. Returns true if it
 *  reached the server. */
export async function submitReview(wordId: string, grade: number): Promise<boolean> {
  if (isOnline()) {
    try {
      await api.reviewWord(wordId, grade);
      return true;
    } catch {
      /* fall through to queue */
    }
  }
  await outboxAdd({ kind: "review", wordId, grade, at: Date.now() });
  notify();
  return false;
}

/** Queue a word to be added (with AI enrichment) once back online. */
export async function queueAdd(word: string, sourceLang: string, targetLang: string): Promise<void> {
  await outboxAdd({ kind: "add", word, sourceLang, targetLang, at: Date.now() });
  notify();
}

let flushing = false;
/** Flush queued mutations in FIFO order. Stops at the first failure so order is
 *  preserved and the rest retry later. Returns how many synced. */
export async function flushOutbox(accountId: string): Promise<number> {
  if (flushing || !isOnline()) return 0;
  flushing = true;
  let done = 0;
  try {
    const ops = (await outboxAll()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    for (const op of ops) {
      try {
        if (op.kind === "review") {
          await api.reviewWord(op.wordId, op.grade);
        } else {
          await api.addWord({ telegramId: accountId, word: op.word, sourceLang: op.sourceLang, targetLang: op.targetLang });
        }
        if (op.id != null) await outboxDelete(op.id);
        done++;
      } catch {
        break; // network hiccup — keep the rest queued, retry next time
      }
    }
  } finally {
    flushing = false;
    notify();
  }
  return done;
}

export async function pendingCount(): Promise<number> {
  return outboxCount();
}

// --- tiny pub/sub so the UI can show the pending count live ---
type Cb = () => void;
const subs = new Set<Cb>();
export function subscribeSync(cb: Cb): () => void {
  subs.add(cb);
  return () => {
    subs.delete(cb);
  };
}
function notify(): void {
  subs.forEach((c) => c());
}
