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
  notes: string | null;
  reviewCount: number;
  nextReviewAt: string | null;
  createdAt: string;
  examples: Example[];
  collections?: { id: string; name: string }[];
  // FSRS scheduler state (used to preview intervals on the grade buttons)
  stability?: number | null;
  difficulty?: number | null;
  due?: string | null;
  reps?: number;
  lapses?: number;
  state?: number;
  learningSteps?: number;
  lastReview?: string | null;
}

export interface Collection {
  id: string;
  name: string;
  count: number;
}

export interface AuthIdentity {
  provider: string; // "telegram" | "google" | "email" | "dev"
  subject: string;
}

export interface ReaderTextSummary {
  id: string;
  title: string;
  snippet: string;
  sourceLang?: string | null;
  targetLang?: string | null;
  updatedAt: string;
}
export interface ReaderTextFull {
  id: string;
  title: string;
  content: string;
  sourceLang?: string | null;
  targetLang?: string | null;
}

export interface Profile {
  telegramId: string;
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  email?: string | null;
  authVia?: string; // "telegram" | "google" | "email" | "dev"
  identities?: AuthIdentity[];
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

// Learner's FSRS desired retention, stored locally (see lib/learnPrefs). Read
// here so every review call (from any page) carries it without prop-drilling.
function readRetention(): number {
  if (typeof window === "undefined") return 0.9;
  const v = Number(localStorage.getItem("lexa.retention"));
  return Number.isFinite(v) && v >= 0.7 && v <= 0.98 ? v : 0.9;
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
  exampleSource?: "ai" | "web";
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
  exampleSource?: "ai" | "web";
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
  // grade: 1=Again 2=Hard 3=Good 4=Easy (FSRS). Default Good. Sends the learner's
  // desired retention (FSRS) so the server schedules with their chosen setting.
  reviewWord: (id: string, grade = 3) =>
    http<Word>(`/api/words/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ grade, retention: readRetention() }),
    }),
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
      notes?: string | null;
      sourceLang?: string;
      targetLang?: string;
      examples?: { id?: string; sentenceEn: string; sentenceZh?: string; sourceName?: string }[];
    },
  ) => http<Word>(`/api/words/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  addExample: (
    id: string,
    payload: { exampleStyle?: "news" | "casual" | "dialogue" | "literary"; exampleSource?: "ai" | "web"; level?: string; replace?: boolean } = {},
  ) => http<Word>(`/api/words/${id}/example`, { method: "POST", body: JSON.stringify(payload) }),
  explainWord: (id: string) =>
    http<{ explanation: string }>(`/api/words/${id}/explain`, { method: "POST" }),
  askWord: (id: string, messages: { role: "user" | "assistant"; content: string }[]) =>
    http<{
      answer: string;
      addSynonyms: string[];
      addAntonyms: string[];
      addWords: string[];
      addExamples: { sentence: string; translation: string }[];
    }>(`/api/words/${id}/ask`, {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
  // Append a ready-made example (from tutor chat) to a card.
  addManualExample: (id: string, sentenceEn: string, sentenceZh: string) =>
    http<Word>(`/api/words/${id}/example/manual`, {
      method: "POST",
      body: JSON.stringify({ sentenceEn, sentenceZh }),
    }),
  // Global AI tutor chat (not tied to a card).
  tutorAsk: (payload: { messages: { role: "user" | "assistant"; content: string }[]; sourceLang?: string; targetLang?: string }) =>
    http<{ answer: string; addWords: string[] }>(`/api/tutor/ask`, { method: "POST", body: JSON.stringify(payload) }),
  translate: (payload: { text: string; sourceLang: string; targetLang: string }) =>
    http<{ translation: string }>(`/api/translate`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  // OCR: extract text from a photo (base64 data URL) for the Reader.
  ocr: (payload: { image: string; sourceLang?: string }) =>
    http<{ text: string }>(`/api/ocr`, { method: "POST", body: JSON.stringify(payload) }),
  // Contextual meaning of one word within its sentence (Reader press-and-hold).
  gloss: (payload: { word: string; sentence: string; sourceLang?: string; targetLang?: string }) =>
    http<{ gloss: string }>(`/api/gloss`, { method: "POST", body: JSON.stringify(payload) }),
  // Add many bare words at once; AI enrichment runs in the background worker.
  batchAddWords: (payload: {
    telegramId: string;
    sourceLang: string;
    targetLang: string;
    words?: string[];
    // Reader: each word plus the sentence it came from (kept as the card's example).
    items?: { word: string; sentence?: string }[];
    source?: string; // attribution for the provided example
    level?: string;
    exampleStyle?: "news" | "casual" | "dialogue" | "literary";
    exampleSource?: "ai" | "web";
    collectionIds?: string[];
    enrich?: boolean;
  }) =>
    http<{ created: number; skipped: number; job: Pick<ImportJob, "id" | "status" | "total" | "processed"> | null }>(
      `/api/words/batch`,
      { method: "POST", body: JSON.stringify(payload) },
    ),
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
  // Telegram Mini App: sign in with the WebApp initData (verified server-side).
  loginTelegramWebApp: (initData: string) =>
    http<Profile>(`/api/auth/telegram/webapp`, { method: "POST", body: JSON.stringify({ initData }) }),
  // Deep-link login via the bot: get a one-time token, then poll until the user
  // confirms in Telegram (poll returns null while still pending).
  startTelegramLogin: () => http<{ token: string }>(`/api/auth/telegram/start`, { method: "POST" }),
  pollTelegramLogin: async (token: string): Promise<Profile | null> => {
    const res = await fetch(`${BASE}/api/auth/telegram/poll?token=${encodeURIComponent(token)}`, {
      credentials: "include",
    });
    if (res.status === 204) return null; // still waiting
    if (!res.ok) throw new Error(`Request failed: ${res.status}`);
    return (await res.json()) as Profile;
  },
  // Google Sign-In: exchange the Google ID token (credential) for a session.
  loginGoogle: (credential: string) =>
    http<Profile>(`/api/auth/google`, { method: "POST", body: JSON.stringify({ credential }) }),
  // Email magic-link: request a link, then the /login/verify page consumes it.
  startEmailLogin: (email: string) =>
    http<{ sent: boolean; devLink?: string }>(`/api/auth/email/start`, {
      method: "POST",
      body: JSON.stringify({ email }),
    }),
  verifyEmailLogin: (token: string) =>
    http<Profile>(`/api/auth/email/verify?token=${encodeURIComponent(token)}`),
  unlinkIdentity: (provider: string) =>
    http<{ identities: AuthIdentity[] }>(`/api/auth/identity/${encodeURIComponent(provider)}`, { method: "DELETE" }),

  // Reader: saved texts + AI generation.
  readerTexts: (telegramId: string, q?: string) =>
    http<ReaderTextSummary[]>(`/api/reader/texts?telegramId=${encodeURIComponent(telegramId)}${q ? `&q=${encodeURIComponent(q)}` : ""}`),
  readerText: (id: string, telegramId: string) =>
    http<ReaderTextFull>(`/api/reader/texts/${id}?telegramId=${encodeURIComponent(telegramId)}`),
  saveReaderText: (payload: { telegramId: string; title: string; content: string; sourceLang?: string; targetLang?: string }) =>
    http<{ id: string; title: string }>(`/api/reader/texts`, { method: "POST", body: JSON.stringify(payload) }),
  updateReaderText: (id: string, payload: { telegramId: string; title?: string; content?: string }) =>
    http<{ id: string; title: string }>(`/api/reader/texts/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteReaderText: (id: string, telegramId: string) =>
    http<{ ok: true }>(`/api/reader/texts/${id}`, { method: "DELETE", body: JSON.stringify({ telegramId }) }),
  generateReaderText: (payload: { telegramId: string; topic: string; sourceLang?: string; targetLang?: string; level?: string }) =>
    http<{ title: string; content: string }>(`/api/reader/generate`, { method: "POST", body: JSON.stringify(payload) }),
  logout: () => http<{ ok: true }>(`/api/auth/logout`, { method: "POST" }),
};

// A word is "due" if it has never been reviewed, or its scheduled review time
// has passed. Used for the due badges and the header counter.
export function isDue(word: Word): boolean {
  if (!word.nextReviewAt) return true;
  return new Date(word.nextReviewAt).getTime() <= Date.now();
}
