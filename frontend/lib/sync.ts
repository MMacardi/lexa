"use client";

import { api, isTransientError, type ReviewSource, type Word } from "./api";
import { kvGet, kvSet, outboxAdd, outboxAll, outboxCount, outboxDelete } from "./idb";
import { cacheScope, sameScope, ConnectionError } from "./sessionCache";

// Offline sync: mirror the words list for offline review, queue mutations made
// offline (review grades, new words' first grades, word adds), and flush the queue
// when back online.

const wordsKey = (accountId: string) => `words:${accountId}`;
const wordKey = (accountId: string, id: string) => `word:${accountId}:${id}`;

export async function readWordsCache(accountId: string) {
  const { revision } = cacheScope();
  const words = await kvGet<Word[]>(wordsKey(accountId));
  return sameScope(accountId, revision) ? words : undefined;
}

export function isOnline(): boolean {
  return typeof navigator === "undefined" ? true : navigator.onLine;
}

/** Load words from the network (and mirror for offline), falling back to the
 *  last cached copy when offline. Use as the review page's queryFn. */
export async function fetchWordsCached(accountId: string): Promise<Word[]> {
  const { revision, verified } = cacheScope();
  try {
    if (!verified || !isOnline()) throw new ConnectionError();
    const w = await api.listWords(accountId);
    if (!sameScope(accountId, revision)) throw new ConnectionError();
    await kvSet(wordsKey(accountId), w, () => sameScope(accountId, revision));
    return w;
  } catch (e) {
    if (!isTransientError(e) || !sameScope(accountId, revision)) throw e;
    const cached = await readWordsCache(accountId);
    if (cached) return cached;
    throw e;
  }
}

export async function fetchWordCached(accountId: string, id: string): Promise<Word> {
  const { revision, verified } = cacheScope();
  try {
    if (!verified || !isOnline()) throw new ConnectionError();
    const word = await api.getWord(id);
    if (!sameScope(accountId, revision)) throw new ConnectionError();
    await kvSet(wordKey(accountId, id), word, () => sameScope(accountId, revision));
    return word;
  } catch (error) {
    if (!isTransientError(error) || !sameScope(accountId, revision)) throw error;
    const cached = await readWordCache(accountId, id);
    if (cached) return cached;
    throw error;
  }
}

export async function readWordCache(accountId: string, id: string) {
  const { revision } = cacheScope();
  const detail = await kvGet<Word>(wordKey(accountId, id));
  const word = detail ?? (await readWordsCache(accountId))?.find((w) => w.id === id);
  return sameScope(accountId, revision) ? word : undefined;
}

/** Overwrite the offline words snapshot (after an optimistic local update). */
export async function mirrorWords(accountId: string, words: Word[]): Promise<void> {
  const { revision } = cacheScope();
  if (cacheScope().owner !== accountId) return;
  await kvSet(wordsKey(accountId), words, () => sameScope(accountId, revision));
}

/** Send a review grade now, or queue it if offline/failed. Returns true if it
 *  reached the server. */
export async function submitReview(wordId: string, grade: number, source: ReviewSource = "review"): Promise<boolean> {
  const scope = cacheScope();
  if (isOnline()) {
    try {
      await api.reviewWord(wordId, grade, source);
      return true;
    } catch (error) {
      if (!isTransientError(error)) throw error;
      /* fall through to queue */
    }
  }
  if (!sameScope(scope.owner, scope.revision)) throw new ConnectionError();
  await outboxAdd({ kind: "review", wordId, grade, source, at: Date.now() });
  notify();
  return false;
}

/** Take back a card's last grade. A grade still waiting in the offline queue is
 *  simply dropped from it; one the server has is undone there. Returns false if
 *  there was nothing to take back. */
export async function undoReview(wordId: string): Promise<boolean> {
  const queued = (await outboxAll())
    .filter((op) => op.kind === "review" && op.wordId === wordId)
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
  if (queued?.id != null) {
    await outboxDelete(queued.id);
    notify();
    return true;
  }
  try {
    await api.undoReview(wordId);
    return true;
  } catch {
    return false;
  }
}

/** A new word's first grade (`api.learnWord`: the card is made then), sent now or
 *  queued. Returns the server's answer, or null when it was queued. */
export async function submitLearn(word: string, grade: number, source: "review" | "write" = "review") {
  const scope = cacheScope();
  if (isOnline()) {
    try {
      return await api.learnWord(word, grade, source);
    } catch (error) {
      if (!isTransientError(error)) throw error;
      /* fall through to queue */
    }
  }
  if (!sameScope(scope.owner, scope.revision)) throw new ConnectionError();
  await outboxAdd({ kind: "learn", word, grade, source, at: Date.now() });
  notify();
  return null;
}

/** Take a new word's first grade back: dropped from the queue, or undone on the
 *  server, card and all. Returns false if there was nothing to take back. */
export async function undoLearn(word: string): Promise<boolean> {
  const queued = (await outboxAll())
    .filter((op) => op.kind === "learn" && op.word === word)
    .sort((a, b) => (b.id ?? 0) - (a.id ?? 0))[0];
  if (queued?.id != null) {
    await outboxDelete(queued.id);
    notify();
    return true;
  }
  try {
    await api.unlearnWord(word);
    return true;
  } catch {
    return false;
  }
}

/** Queue a word to be added (with AI enrichment) once back online. */
export async function queueAdd(word: string, sourceLang: string, targetLang: string, notes?: string): Promise<void> {
  await outboxAdd({ kind: "add", word, sourceLang, targetLang, notes, at: Date.now() });
  notify();
}

let flushing = false;
/** Flush queued mutations in FIFO order. Stops at the first failure so order is
 *  preserved and the rest retry later. Returns how many synced. */
export async function flushOutbox(accountId: string): Promise<number> {
  const { revision, verified } = cacheScope();
  if (flushing || !isOnline() || !verified || !sameScope(accountId, revision)) return 0;
  flushing = true;
  let done = 0;
  try {
    const ops = (await outboxAll()).sort((a, b) => (a.id ?? 0) - (b.id ?? 0));
    for (const op of ops) {
      if (!sameScope(accountId, revision) || !cacheScope().verified) break;
      try {
        if (op.kind === "review") {
          await api.reviewWord(op.wordId, op.grade, op.source ?? "review");
        } else if (op.kind === "learn") {
          await api.learnWord(op.word, op.grade, op.source);
        } else {
          await api.addWord({ telegramId: accountId, word: op.word, sourceLang: op.sourceLang, targetLang: op.targetLang, notes: op.notes });
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
