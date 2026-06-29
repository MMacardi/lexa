// Typed client for the Express backend. One place that knows the URL shape.

const BASE = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3000";

// Default account when the user hasn't picked one yet (see lib/account.tsx).
export const DEFAULT_TELEGRAM_ID = process.env.NEXT_PUBLIC_TELEGRAM_ID ?? "dev-user";

export interface Example {
  id: string;
  wordId: string;
  sentenceEn: string;
  sentenceZh: string;
  sourceName: string;
  sourceUrl: string;
  createdAt: string;
}

export interface Word {
  id: string;
  word: string;
  sourceLang: string;
  targetLang: string;
  phonetic: string | null;
  partOfSpeech: string | null;
  meaningZh: string | null;
  collocations: string[];
  synonyms: string[];
  antonyms: string[];
  reviewCount: number;
  nextReviewAt: string | null;
  createdAt: string;
  examples: Example[];
  collections?: { id: string; name: string }[];
}

export interface Collection {
  id: string;
  name: string;
  count: number;
}

export interface Stats {
  total: number;
  mastered: number;
  learning: number;
  due: number;
  trainedToday: number;
  streak: number;
  days: { date: string; added: number; reviews: number }[];
  heat: { date: string; count: number }[];
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    credentials: "include", // send the session cookie cross-site
    ...init,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `Request failed: ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export interface AddAuto {
  word: string;
  telegramId: string;
  sourceLang: string;
  targetLang: string;
}

export interface AddManual extends AddAuto {
  phonetic?: string;
  partOfSpeech?: string;
  meaningZh?: string;
  collocations?: string[];
  synonyms?: string[];
  antonyms?: string[];
  example?: {
    sentenceEn: string;
    sentenceZh?: string;
    sourceName?: string;
    sourceUrl?: string;
  };
}

export const api = {
  listWords: (telegramId: string) =>
    http<Word[]>(`/api/words?telegramId=${encodeURIComponent(telegramId)}`),
  getWord: (id: string) => http<Word>(`/api/words/${id}`),
  addWord: (payload: AddAuto) =>
    http<Word>(`/api/words`, {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "auto" }),
    }),
  addWordManual: (payload: AddManual) =>
    http<Word>(`/api/words`, {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "manual" }),
    }),
  reviewWord: (id: string) =>
    http<Word>(`/api/words/${id}/review`, { method: "POST" }),
  deleteWord: (id: string) =>
    http<{ ok: true }>(`/api/words/${id}`, { method: "DELETE" }),
  updateWord: (id: string, payload: Partial<AddManual> & { word?: string }) =>
    http<Word>(`/api/words/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  stats: (telegramId: string) =>
    http<Stats>(`/api/stats?telegramId=${encodeURIComponent(telegramId)}`),

  // --- collections ---
  collections: (telegramId: string) =>
    http<Collection[]>(`/api/collections?telegramId=${encodeURIComponent(telegramId)}`),
  createCollection: (name: string, telegramId: string) =>
    http<Collection>(`/api/collections`, {
      method: "POST",
      body: JSON.stringify({ name, telegramId }),
    }),
  renameCollection: (id: string, name: string) =>
    http<{ id: string; name: string }>(`/api/collections/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ name }),
    }),
  deleteCollection: (id: string) =>
    http<{ ok: true }>(`/api/collections/${id}`, { method: "DELETE" }),
  addWordToCollection: (collectionId: string, wordId: string) =>
    http<{ ok: true }>(`/api/collections/${collectionId}/words/${wordId}`, { method: "PUT" }),
  removeWordFromCollection: (collectionId: string, wordId: string) =>
    http<{ ok: true }>(`/api/collections/${collectionId}/words/${wordId}`, { method: "DELETE" }),

  // --- auth ---
  me: () => http<{ telegramId: string }>(`/api/auth/me`),
  loginTelegram: (data: Record<string, unknown>) =>
    http<{ telegramId: string }>(`/api/auth/telegram`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  loginDev: (telegramId: string) =>
    http<{ telegramId: string }>(`/api/auth/dev`, {
      method: "POST",
      body: JSON.stringify({ telegramId }),
    }),
  logout: () => http<{ ok: true }>(`/api/auth/logout`, { method: "POST" }),
};

// A word is "due" if it has never been reviewed, or its scheduled review time
// has passed. Used for the due badges and the header counter.
export function isDue(word: Word): boolean {
  if (!word.nextReviewAt) return true;
  return new Date(word.nextReviewAt).getTime() <= Date.now();
}
