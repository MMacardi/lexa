// Persistent cache for quick word glosses (tap-to-translate in the Reader and on
// the word page). Tapping the same word again — even in a later session — then
// costs no model call. Kept in localStorage, capped so it can't grow unbounded;
// an in-memory mirror keeps reads instant.

export interface GlossEntry {
  gloss: string;
  tr: string; // transcription (pinyin/romaji/…); may be ""
}

const KEY = "lexa.glossCache";
const MAX = 600; // most-recent entries kept

type Store = Record<string, GlossEntry>;
let mem: Store | null = null;
// Insertion order of keys we've touched, to evict the oldest when over MAX.
let order: string[] = [];

function load(): Store {
  if (mem) return mem;
  if (typeof window === "undefined") return (mem = {});
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}") as Store;
    mem = raw && typeof raw === "object" ? raw : {};
  } catch {
    mem = {};
  }
  order = Object.keys(mem);
  return mem;
}

function persist() {
  if (typeof window === "undefined" || !mem) return;
  try {
    localStorage.setItem(KEY, JSON.stringify(mem));
  } catch {
    /* quota — ignore */
  }
}

const cacheKey = (text: string, sourceLang: string, targetLang: string) =>
  `${sourceLang}|${targetLang}|${text.trim()}`;

export function getGloss(text: string, sourceLang: string, targetLang: string): GlossEntry | null {
  const store = load();
  return store[cacheKey(text, sourceLang, targetLang)] ?? null;
}

export function setGloss(text: string, sourceLang: string, targetLang: string, entry: GlossEntry) {
  const store = load();
  const k = cacheKey(text, sourceLang, targetLang);
  if (!(k in store)) order.push(k);
  store[k] = entry;
  // Evict oldest keys beyond the cap.
  while (order.length > MAX) {
    const old = order.shift();
    if (old && old !== k) delete store[old];
  }
  persist();
}
