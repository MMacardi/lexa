// The dictionary's answer for a tapped Chinese word, fetched once per word and
// language for the page's lifetime. The Reader shows it the moment a word is
// tapped, and resolveMeaning asks the same question to decide whether the model
// is needed at all — sharing one request (and its inflight promise) between them.

import { api, type DictEntry } from "./api";

const known = new Map<string, DictEntry | null>();
const inflight = new Map<string, Promise<DictEntry | null>>();

export function isChineseLang(lang: string): boolean {
  return lang === "zh" || lang === "zh-Hant";
}

/** Synchronous peek: the entry if it has been fetched already (null = not in the dictionary). */
export function peekDictEntry(word: string, targetLang: string): DictEntry | null | undefined {
  return known.get(`${targetLang}|${word}`);
}

/** The entry, or null outside CC-CEDICT. A failed request resolves to null and isn't remembered. */
export function dictEntry(word: string, targetLang: string): Promise<DictEntry | null> {
  const key = `${targetLang}|${word}`;
  if (known.has(key)) return Promise.resolve(known.get(key)!);
  const running = inflight.get(key);
  if (running) return running;
  const task = api
    .dictLookup(word, targetLang)
    .then((r) => {
      known.set(key, r.entry);
      return r.entry;
    })
    .catch(() => null)
    .finally(() => inflight.delete(key));
  inflight.set(key, task);
  return task;
}
