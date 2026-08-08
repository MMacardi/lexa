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

export interface Profile {
  telegramId: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  authVia?: string; // "telegram" | "dev"
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
  level?: string; // learner CEFR level for example difficulty
  exampleStyle?: "news" | "casual" | "dialogue" | "literary";
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

export interface ImportedCard {
  word: string;
  meaning: string;
  example: string;
  exampleTranslation: string;
  synonyms: string[];
}

export interface ImportOptions {
  telegramId: string;
  sourceLang: string;
  targetLang: string;
  items: ImportedCard[];
  collectionIds?: string[];
  keepProvidedExtras: boolean;
  generateDetails: boolean;
  generateExamples: boolean;
  level?: string;
  exampleStyle?: "news" | "casual" | "dialogue" | "literary";
}

export interface ImportJob {
  id: string;
  status: "queued" | "processing" | "completed" | "failed";
  total: number;
  processed: number;
  errors: string[];
  errorMessage: string | null;
  createdAt: string;
  completedAt: string | null;
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
  suggestWord: (word: string, sourceLang: string) =>
    http<{ corrected: string; suggestions: string[]; detectedLang?: string; ambiguousHan?: boolean }>(`/api/words/suggest`, {
      method: "POST",
      body: JSON.stringify({ word, sourceLang }),
    }),
  addWordManual: (payload: AddManual) =>
    http<Word>(`/api/words`, {
      method: "POST",
      body: JSON.stringify({ ...payload, mode: "manual" }),
    }),
  previewImport: (payload: { text: string; sourceLang: string; targetLang: string }) =>
    http<{ items: ImportedCard[] }>(`/api/words/import/preview`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  importWords: (payload: ImportOptions) =>
    http<{ created: number; skipped: number; job: Pick<ImportJob, "id" | "status" | "total" | "processed"> | null }>(`/api/words/import`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  getImportJob: (id: string, telegramId: string) =>
    http<ImportJob>(`/api/words/import/${id}?telegramId=${encodeURIComponent(telegramId)}`),
  reviewWord: (id: string, known = true) =>
    http<Word>(`/api/words/${id}/review`, { method: "POST", body: JSON.stringify({ known }) }),
  deleteWord: (id: string) =>
    http<{ ok: true }>(`/api/words/${id}`, { method: "DELETE" }),
  updateWord: (
    id: string,
    payload: {
      word?: string;
      phonetic?: string;
      partOfSpeech?: string;
      meaningZh?: string;
      collocations?: string[];
      synonyms?: string[];
      antonyms?: string[];
      sourceLang?: string;
      targetLang?: string;
      examples?: { id?: string; sentenceEn: string; sentenceZh?: string; sourceName?: string }[];
    },
  ) => http<Word>(`/api/words/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  addExample: (
    id: string,
    payload: { exampleStyle?: "news" | "casual" | "dialogue" | "literary"; level?: string; replace?: boolean } = {},
  ) => http<Word>(`/api/words/${id}/example`, { method: "POST", body: JSON.stringify(payload) }),
  explainWord: (id: string) =>
    http<{ explanation: string }>(`/api/words/${id}/explain`, { method: "POST" }),
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
  me: () => http<Profile>(`/api/auth/me`),
  loginTelegram: (data: Record<string, unknown>) =>
    http<Profile>(`/api/auth/telegram`, {
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
