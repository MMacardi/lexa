// Typed client for the Express backend. One place that knows the URL shape.

// When NEXT_PUBLIC_API_URL is set (local dev), call the backend directly. When it's
// empty/unset (Vercel prod), BASE is "" so every request is same-origin (/api/…) and
// the Next rewrite proxies it to the backend (see next.config.ts). Same-origin keeps
// the session/beta cookies first-party, so Safari ITP won't drop them.
const BASE = process.env.NEXT_PUBLIC_API_URL || "";

export interface Example {
  id: string;
  wordId: string;
  sentenceEn: string;
  sentenceZh: string;
  sourceName: string;
  sourceUrl: string;
  register?: string | null; // AI example register/style (casual/dialogue/…)
  level?: string | null; // AI example CEFR level
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
  // Credit when the card was copied from someone's shared deck.
  sharedFrom?: string | null;
  sharedDeck?: string | null;
  sharedDeckId?: string | null;
  // FSRS scheduler state (used to preview intervals on the grade buttons)
  stability?: number | null;
  difficulty?: number | null;
  due?: string | null;
  reps?: number;
  lapses?: number;
  state?: number;
  learningSteps?: number;
  lastReview?: string | null;
  // Production ledger — "can use it", tracked apart from the review schedule.
  produceAttempts?: number;
  produceCorrect?: number;
  produceStreak?: number;
  lastProducedAt?: string | null;
  canUseAt?: string | null; // non-null = the learner can use this word
}

// One Pleco-style sense of a word: part of speech, a short gloss in the learner's
// language, and 1–2 short phrases (with a reading for CJK).
export interface WordSense {
  pos: string;
  meaning: string;
  onCard: boolean; // the sense the card's meaning was written for
  phrases: { text: string; reading: string; translation: string }[];
}

export type Visibility = "private" | "friends" | "code" | "public";

export interface Collection {
  id: string;
  name: string;
  count: number;
  description?: string | null;
  folderId?: string | null;
  visibility?: Visibility;
  shareCode?: string | null;
  delisted?: boolean; // taken out of Community by the admin; can't go public again
  learners?: number; // real learners who took words from it
  copiedFrom?: { deck: string; author: string; official: boolean } | null;
}

export interface Folder {
  id: string;
  name: string;
}

export interface DeckSummary {
  id: string;
  name: string;
  description: string | null;
  sourceLang: string;
  targetLang: string;
  count: number;
  preview: string[];
  author: { id: string | null; name: string; official: boolean }; // id → /profile/<id>
  mikaPick: boolean;
  visibility: Visibility;
  mine: boolean;
  learners: number;
  weekLearners: number;
}

export interface DeckWord {
  id: string;
  word: string;
  sourceLang: string;
  targetLang: string;
  phonetic: string | null;
  partOfSpeech: string | null;
  meaning: string | null;
  synonyms: string[];
  example: { sentenceEn: string; sentenceZh: string } | null;
  owned: boolean;
}

export interface LearnerProfile {
  id: string;
  name: string;
  since: string;
  isMe: boolean;
  isFriend: boolean;
  stats: {
    total: number;
    mastered: number;
    streak: number;
    reviews: number;
    languages: string[];
    heat: { date: string; count: number }[];
  } | null; // null = their profile stats are closed to you
  decks: DeckSummary[];
  decksHidden: boolean;
  privacy: { profile: PrivacyLevel; decks: PrivacyLevel } | null; // only on your own profile
}

export interface DeckDetail extends DeckSummary {
  shareCode: string | null;
  copiedCollectionId: string | null;
  words: DeckWord[];
}

export interface AuthIdentity {
  provider: string; // "telegram" | "google" | "email" | "dev"
  subject: string;
}

export interface ReaderTextSummary {
  id: string;
  title: string;
  snippet: string;
  status: string; // ready | generating | failed
  collection?: string | null;
  level?: string | null;
  sourceLang?: string | null;
  targetLang?: string | null;
  updatedAt: string;
}
export interface ReaderTextFull {
  id: string;
  title: string;
  content: string;
  status: string;
  collection?: string | null;
  translation?: string | null;
  clickedWords?: string[];
  level?: string | null;
  sourceLang?: string | null;
  targetLang?: string | null;
}

// A saved coach scene playthrough. Summaries carry the studied words so the
// history list renders chips without the transcript; the full row is the resume
// state (the scene engine is stateless — bible + turns are everything).
export interface SceneSessionSummary {
  id: string;
  title: string;
  status: string; // active | done
  sceneKey?: string | null;
  sourceLang?: string | null;
  targetLang?: string | null;
  used: string[];
  addedWords: string[];
  reviewedCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface SceneSessionFull extends SceneSessionSummary {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  bible: Record<string, any>;
  turns: { role: "user" | "assistant"; content: string }[];
  corrections: { original: string; corrected: string; note: string }[];
}

export interface Friend {
  friendshipId: string;
  userId: string;
  telegramId: string;
  profileHidden?: boolean; // they set their profile to hidden: name only
  name: string;
  total: number;
  mastered: number;
  reviews: number;
  languages: string[];
  streak: number;
}
export interface FriendRequest {
  friendshipId: string;
  telegramId: string;
  name: string;
}

export type PrivacyLevel = "hidden" | "friends" | "everyone";

export interface Profile {
  id?: string; // user id (opens /profile/<id>)
  telegramId: string;
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
  username?: string | null;
  photoUrl?: string | null;
  email?: string | null;
  authVia?: string; // "telegram" | "google" | "email" | "dev"
  hideEmail?: boolean;
  hideTag?: boolean;
  profileVisibility?: PrivacyLevel; // who sees my stats / activity
  decksVisibility?: PrivacyLevel; // who sees my shared decks listed on my profile
  invited?: boolean; // closed-beta gate: has the user redeemed an invite code?
  isAdmin?: boolean; // owner allowlist: may open the /admin dashboard
  identities?: AuthIdentity[];
  // Learner settings, now kept on the account rather than in this browser (see
  // lib/learnPrefs). Null/absent means the account has never saved one, so the
  // local value stands and gets uploaded on the next sync.
  levels?: Record<string, string> | null;
  nativeLang?: string | null;
  dailyGoal?: number | null;
  retention?: number | null;
}

/** The settings half of the learner model, as sent to PATCH /api/auth/me. */
export interface LearnerPrefs {
  levels?: Record<string, string> | null;
  nativeLang?: string | null;
  dailyGoal?: number | null;
  retention?: number | null;
}

// Which surface graded an answer. Logged per review so the learner model can tell
// "recognised it on a card" from "produced it in a sentence".
export type ReviewSource = "review" | "quiz" | "drill" | "scene" | "chat";

// A use-step answer: the learner produced the word instead of recognising it.
// Recorded on its own endpoint — it must never move the review schedule.
export type ProductionVerdict = "correct" | "partial" | "wrong";
export type ProductionSource = "drill" | "scene" | "chat";
export type ProductionError = "meaning" | "form" | "collocation" | "register";

export interface Stats {
  total: number;
  mastered: number;
  learning: number;
  due: number;
  trainedToday: number;
  streak: number;
  reviews: number; // lifetime graded reviews
  canUse: number; // words the learner can use, not just recognise
  canUseWeek: number; // of those, how many crossed over in the last 7 days
  tried: number; // words attempted in a use-step at least once
  languages: string[]; // distinct source languages studied
  days: { date: string; added: number; reviews: number }[];
  heat: { date: string; count: number }[];
}

// Owner-only admin dashboard snapshot (GET /api/admin/stats).
export type ReportReason = "spam" | "offensive" | "wrong" | "other";

export interface ModeratedDeck {
  id: string;
  name: string;
  visibility: Visibility;
  words: number;
  author: { id: string | null; name: string; official: boolean };
  delisted: boolean;
}

export interface ModerationQueue {
  hideAt: number; // open reports that hold a deck out of the Community lists
  reported: { deck: ModeratedDeck; reports: { reason: ReportReason; note: string | null; by: string; at: string }[] }[];
  delisted: ModeratedDeck[];
}

export interface AdminStats {
  users: { total: number; invited: number; newToday: number; new7d: number; new30d: number };
  signups: { date: string; count: number }[];
  content: {
    words: number;
    examples: number;
    readerTexts: number;
    sceneSessions: number;
    importJobs: number;
    collections: number;
  };
  engagement: { reviewsTotal: number; reviewsToday: number; dau: number; wau: number };
  invites: { minted: number; redeemed: number };
  tokens: {
    totals: { calls: number; prompt: number; completion: number; total: number; costCny: number };
    byModel: { model: string; calls: number; prompt: number; completion: number; total: number; costCny: number }[];
    byFeature: { feature: string; calls: number; total: number; costCny: number }[];
    // telegramId/name are null for spend logged before per-user attribution.
    byUser: { telegramId: string | null; name: string | null; calls: number; total: number; costCny: number }[];
    byDay: { date: string; calls: number; total: number; costCny: number }[];
  };
}

// Activation funnel, rolling retention and use-step quality (admin only). Every
// number is "since instrumentation shipped", not since launch — `since` says when.
export interface AdminFunnel {
  since: string | null;
  events: number;
  cohort: number;
  funnel: { step: "signin" | "firstCard" | "firstReview" | "firstUseStep"; users: number; pct: number }[];
  retention: { day: number; eligible: number; returned: number; pct: number }[];
  useSteps: {
    total: number;
    byKind: { kind: string; count: number }[];
    byGrade: { grade: string; count: number }[];
  };
  byDay: { date: string; count: number }[];
}

// Learner's FSRS desired retention, from the local mirror (see lib/learnPrefs).
// Read here so every review call (from any page) carries it without prop-drilling.
// Undefined when this browser has no value yet: the request then omits the field
// and the server falls back to the setting stored on the account, rather than the
// client asserting a default that would mask it.
function readRetention(): number | undefined {
  if (typeof window === "undefined") return undefined;
  const v = Number(localStorage.getItem("lexa.retention"));
  return Number.isFinite(v) && v >= 0.7 && v <= 0.98 ? v : undefined;
}

// The "test the free tier" toggle (localStorage). Read directly to avoid a React
// dependency here; it only ever restricts the caller, so it's safe to send.
function simulateFreeHeader(): Record<string, string> {
  try {
    return typeof window !== "undefined" && localStorage.getItem("lexa.simulateFree") === "1"
      ? { "X-Simulate-Free": "1" }
      : {};
  } catch {
    return {};
  }
}

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include", // send the session cookie cross-site
    ...init,
    headers: { "Content-Type": "application/json", ...simulateFreeHeader(), ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `Request failed: ${res.status}`);
    if (body.code) (err as Error & { code?: string }).code = body.code;
    throw err;
  }
  return res.json() as Promise<T>;
}

// Streaming variant of http() for the NDJSON coach endpoints. POSTs the payload with
// stream:true, forwards each {"type":"delta","t"} chunk to onDelta the moment it arrives
// (so the reply types out live), and resolves with the {"type":"final","result"} payload —
// the same validated object the non-stream endpoint returns. An {"type":"error"} line, a
// non-ok response, or a stream that ends without a final all reject. `signal` aborts the
// fetch (used on unmount / send-while-streaming); the rejection is a DOMException named
// "AbortError", which callers swallow.
async function streamHttp<T>(
  path: string,
  payload: unknown,
  opts: { onDelta?: (t: string) => void; signal?: AbortSignal },
): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    signal: opts.signal,
    headers: { "Content-Type": "application/json", ...simulateFreeHeader() },
    body: JSON.stringify({ ...(payload as object), stream: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const err = new Error(body.error ?? `Request failed: ${res.status}`);
    if (body.code) (err as Error & { code?: string }).code = body.code;
    throw err;
  }

  const state: { final?: T; error?: string } = {};
  const handleLine = (line: string) => {
    if (!line.trim()) return;
    let msg: { type?: string; t?: string; result?: T; error?: string };
    try {
      msg = JSON.parse(line);
    } catch {
      return; // a split/garbage line — the final pass re-flushes the tail
    }
    if (msg.type === "delta" && msg.t) opts.onDelta?.(msg.t);
    else if (msg.type === "final") state.final = msg.result as T;
    else if (msg.type === "error") state.error = msg.error ?? "stream error";
  };

  // Fallback: no readable stream (a proxy buffered it) — read the whole body at once.
  if (!res.body) {
    for (const line of (await res.text()).split("\n")) handleLine(line);
  } else {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        handleLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
      }
    }
    buf += decoder.decode(); // flush the decoder
    if (buf.trim()) handleLine(buf); // a trailing final line with no newline
  }

  if (state.error) throw new Error(state.error);
  if (state.final === undefined) throw new Error("Stream ended without a final result");
  return state.final;
}

// A tutor-suggested word carrying the meaning + example it already wrote in chat,
// so saving it as a card needs no extra AI call.
export interface TutorCard {
  word: string;
  meaning: string;
  example: string;
  exampleTr: string;
  // Set when the word is NOT in the chat's source language (a Chinese word asked
  // about inside an English chat) — the card is then saved in that pair instead.
  lang?: string;
}

// Mika (global tutor) chat, in both the streaming and non-streaming flavours.
export type TutorAskPayload = {
  messages: { role: "user" | "assistant"; content: string }[];
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  telegramId?: string;
};
export type TutorAskResult = { answer: string; addWords: string[]; addCards?: TutorCard[] };

// Coach chat/scene-turn payloads + results, named so the streaming and non-streaming
// client methods share one definition.
export interface CoachChatPayload {
  messages: { role: "user" | "assistant"; content: string }[];
  words: { word: string; meaning: string }[];
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  topic?: string;
  wrap?: boolean;
  telegramId?: string;
}
export interface CoachChatResult {
  say: string;
  used: string[];
  seeded: string[];
  newWords: { word: string; meaning: string }[];
}
export interface CoachSceneTurnPayload {
  messages: { role: "user" | "assistant"; content: string }[];
  scene: {
    title?: string;
    setting?: string;
    character?: string;
    characterName?: string;
    learnerRole?: string;
    goal?: string;
    twist?: string;
    missionWords: { word: string; meaning: string }[];
    newWords?: { word: string; meaning: string }[];
  };
  sourceLang?: string;
  targetLang?: string;
  level?: string;
  wrap?: boolean;
  telegramId?: string;
}
export interface CoachSceneTurnResult {
  say: string;
  used: string[];
  corrections: { original: string; corrected: string; note: string; severity?: "minor" | "wrong" }[];
  sceneDone: boolean;
}

export interface FeedbackPayload {
  message: string;
  kind: "bug" | "idea" | "other";
  url?: string;
  route?: string;
  userAgent?: string;
  viewport?: string;
  locale?: string;
  appLang?: string;
  theme?: string;
  errors?: { message: string; source?: string; time?: string }[];
  screenshot?: string; // data URL
}

export interface AddAuto {
  word: string;
  telegramId: string;
  sourceLang: string;
  targetLang: string;
  level?: string; // learner CEFR level for example difficulty
  synonymLevel?: string; // target CEFR level for the card's synonyms (exam prep)
  exampleStyle?: "news" | "casual" | "dialogue" | "literary" | "none";
  exampleSource?: "ai" | "web";
  exampleCount?: number; // how many examples to generate (1–2)
  meaningPrompt?: string; // learner override for how the meaning is written
  sense?: string; // known-language word it was translated from, so the card leads with that sense
  notes?: string; // learner's own notes (P.S.), saved as typed
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
  exampleStyle?: "news" | "casual" | "dialogue" | "literary" | "none";
  exampleSource?: "ai" | "web";
}

export interface ImportJob {
  id: string;
  status: "queued" | "processing" | "completed" | "failed" | "cancelled";
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
  cancelImportJob: (id: string) => http<ImportJob>(`/api/words/import/${id}/cancel`, { method: "POST" }),
  // grade: 1=Again 2=Hard 3=Good 4=Easy (FSRS). Default Good. Sends the learner's
  // desired retention (FSRS) so the server schedules with their chosen setting,
  // and the surface that graded it, which is logged but never scheduled on.
  reviewWord: (id: string, grade = 3, source: ReviewSource = "review") =>
    http<Word>(`/api/words/${id}/review`, {
      method: "POST",
      body: JSON.stringify({ grade, retention: readRetention(), source }),
    }),
  // A use-step answer: the learner said or wrote the word. Separate from review
  // on purpose — it moves the "can use" state and leaves the interval alone.
  recordProduction: (
    id: string,
    verdict: ProductionVerdict,
    source: ProductionSource,
    errorKind?: ProductionError | null,
  ) =>
    http<Word>(`/api/words/${id}/production`, {
      method: "POST",
      body: JSON.stringify({ verdict, source, errorKind: errorKind ?? null }),
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
      // Which senses of the word page's "Meanings" list the card tests; sent
      // alongside the meaning they compose so the ticks survive a reload.
      senseIndexes?: number[];
      examples?: { id?: string; sentenceEn: string; sentenceZh?: string; sourceName?: string }[];
    },
  ) => http<Word>(`/api/words/${id}`, { method: "PATCH", body: JSON.stringify(payload) }),
  addExample: (
    id: string,
    payload: { exampleStyle?: "news" | "casual" | "dialogue" | "literary" | "none"; exampleSource?: "ai" | "web"; level?: string; replace?: boolean } = {},
  ) => http<Word>(`/api/words/${id}/example`, { method: "POST", body: JSON.stringify(payload) }),
  wordSenses: (id: string) =>
    http<{ senses: WordSense[] }>(`/api/words/${id}/senses`, { method: "POST" }),
  wordFamily: (id: string) =>
    http<{ synonyms: string[]; antonyms: string[] }>(`/api/words/${id}/family`, { method: "POST" }),
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
  tutorAsk: (payload: TutorAskPayload) =>
    http<TutorAskResult>(`/api/tutor/ask`, { method: "POST", body: JSON.stringify(payload) }),
  // Same answer, streamed: the "answer" text arrives via onDelta as Mika writes it
  // and the promise resolves with the identical validated result.
  tutorAskStream: (payload: TutorAskPayload, opts: { onDelta?: (t: string) => void; signal?: AbortSignal }) =>
    streamHttp<TutorAskResult>(`/api/tutor/ask`, payload, opts),
  translate: (payload: { text: string; sourceLang: string; targetLang: string }) =>
    http<{ translation: string }>(`/api/translate`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  // Batch transcription of many words in one call (Reader "pinyin over characters").
  transcribe: (words: string[], sourceLang: string) =>
    http<{ items: string[] }>(`/api/transcribe`, { method: "POST", body: JSON.stringify({ words, sourceLang }) }).then((r) => r.items),
  // OCR: extract text from a photo (base64 data URL) for the Reader.
  ocr: (payload: { image: string; sourceLang?: string }) =>
    http<{ text: string }>(`/api/ocr`, { method: "POST", body: JSON.stringify(payload) }),
  // Contextual meaning of one word within its sentence (Reader press-and-hold).
  gloss: (payload: { word: string; sentence: string; sourceLang?: string; targetLang?: string; withTranscription?: boolean }) =>
    http<{ gloss: string; transcription?: string }>(`/api/gloss`, { method: "POST", body: JSON.stringify(payload) }),
  // Is a learner-typed custom language name a real language? Decides whether AI stays on for it.
  checkLanguage: (name: string) =>
    http<{ isLanguage: boolean; canonicalName: string }>(`/api/languages/check`, { method: "POST", body: JSON.stringify({ name }) }),
  // Add many bare words at once; AI enrichment runs in the background worker.
  batchAddWords: (payload: {
    telegramId: string;
    sourceLang: string;
    targetLang: string;
    words?: string[];
    // Reader: each word plus the sentence it came from (kept as the card's example).
    // Tutor chat also passes a ready meaning/translation so the card needs no AI call.
    items?: { word: string; sentence?: string; meaning?: string; exampleTr?: string }[];
    source?: string; // attribution for the provided example
    level?: string;
    exampleStyle?: "news" | "casual" | "dialogue" | "literary" | "none";
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
  updateCollection: (
    id: string,
    patch: { name?: string; description?: string | null; folderId?: string | null; visibility?: Visibility },
  ) =>
    http<{ id: string; name: string; visibility: Visibility; shareCode: string | null; folderId: string | null }>(
      `/api/collections/${id}`,
      { method: "PATCH", body: JSON.stringify(patch) },
    ),
  deleteCollection: (id: string) =>
    http<{ ok: true }>(`/api/collections/${id}`, { method: "DELETE" }),
  // --- folders (one level; they hold collections) ---
  folders: () => http<Folder[]>(`/api/folders`),
  createFolder: (name: string) => http<Folder>(`/api/folders`, { method: "POST", body: JSON.stringify({ name }) }),
  renameFolder: (id: string, name: string) =>
    http<Folder>(`/api/folders/${id}`, { method: "PATCH", body: JSON.stringify({ name }) }),
  deleteFolder: (id: string) => http<{ ok: true }>(`/api/folders/${id}`, { method: "DELETE" }),
  // --- community (shared decks) ---
  communityDecks: (f: { q?: string; lang?: string; target?: string } = {}) => {
    const p = new URLSearchParams();
    if (f.q) p.set("q", f.q);
    if (f.lang) p.set("lang", f.lang);
    if (f.target) p.set("target", f.target);
    const qs = p.toString();
    return http<DeckSummary[]>(`/api/community/decks${qs ? `?${qs}` : ""}`);
  },
  learnerProfile: (userId: string) => http<LearnerProfile>(`/api/profiles/${userId}`),
  friendDecks: () => http<DeckSummary[]>(`/api/community/friends`),
  deckByCode: (code: string) => http<{ id: string }>(`/api/community/code/${encodeURIComponent(code.trim())}`),
  deck: (id: string, code?: string) =>
    http<DeckDetail>(`/api/community/decks/${id}${code ? `?code=${encodeURIComponent(code)}` : ""}`),
  copyDeck: (id: string, body: { code?: string; wordIds?: string[] } = {}) =>
    http<{ added: number; skipped: number; collectionId: string | null }>(`/api/community/decks/${id}/copy`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  reportDeck: (id: string, body: { reason: ReportReason; note?: string; code?: string }) =>
    http<{ ok: true }>(`/api/community/decks/${id}/report`, { method: "POST", body: JSON.stringify(body) }),
  addWordToCollection: (collectionId: string, wordId: string) =>
    http<{ ok: true }>(`/api/collections/${collectionId}/words/${wordId}`, { method: "PUT" }),
  removeWordFromCollection: (collectionId: string, wordId: string) =>
    http<{ ok: true }>(`/api/collections/${collectionId}/words/${wordId}`, { method: "DELETE" }),

  // --- auth ---
  me: () => http<Profile>(`/api/auth/me`),
  updateName: (displayName: string) =>
    http<{ displayName: string | null }>(`/api/auth/me`, { method: "PATCH", body: JSON.stringify({ displayName }) }),
  updatePrivacy: (patch: { hideEmail?: boolean; hideTag?: boolean; profileVisibility?: PrivacyLevel; decksVisibility?: PrivacyLevel }) =>
    http<{ hideEmail: boolean; hideTag: boolean; profileVisibility: PrivacyLevel; decksVisibility: PrivacyLevel }>(`/api/auth/me`, { method: "PATCH", body: JSON.stringify(patch) }),
  // Learner settings (level / native language / daily goal / retention) on the
  // account, so the bot and a second device see the same numbers.
  updateLearnerPrefs: (patch: LearnerPrefs) =>
    http<LearnerPrefs>(`/api/auth/me`, { method: "PATCH", body: JSON.stringify(patch) }),
  // Closed-beta gate: redeem an invite code, unlocking the app. Returns the fresh profile.
  redeemInvite: (code: string) =>
    http<Profile>(`/api/invites/redeem`, { method: "POST", body: JSON.stringify({ code }) }),
  // Pre-login shared beta key: unlock sets a signed httpOnly cookie; status reports
  // whether this guest already unlocked (so we don't re-prompt a returning visitor).
  unlockBeta: (code: string) =>
    http<{ ok: true }>(`/api/beta/unlock`, { method: "POST", body: JSON.stringify({ code }) }),
  betaStatus: () => http<{ enabled: boolean; unlocked: boolean }>(`/api/beta/status`),
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

  // Friends + referral (session-authenticated).
  friends: () => http<Friend[]>(`/api/friends`),
  friendRequests: () => http<FriendRequest[]>(`/api/friends/requests`),
  sentFriendRequests: () => http<FriendRequest[]>(`/api/friends/sent`),
  referral: () => http<{ code: string; link: string }>(`/api/friends/referral`),
  addFriend: (code: string) => http<{ status: "pending" | "accepted" }>(`/api/friends/add`, { method: "POST", body: JSON.stringify({ code }) }),
  acceptFriend: (friendshipId: string) => http<{ ok: true }>(`/api/friends/${friendshipId}/accept`, { method: "POST" }),
  removeFriend: (friendshipId: string) => http<{ ok: true }>(`/api/friends/${friendshipId}`, { method: "DELETE" }),

  // Coach "Daily picks": level-appropriate words the learner doesn't have yet.
  coachPicks: (payload: { sourceLang: string; targetLang: string; level?: string; count?: number; theme?: string }) =>
    http<{ picks: { word: string; meaning: string; reason: string }[] }>(`/api/coach/picks`, { method: "POST", body: JSON.stringify(payload) }),

  // Onboarding placement mini-test: themed clusters of level-appropriate words in the
  // studied language; the learner taps the ones they DON'T know to seed their deck.
  starterCandidates: (payload: { sourceLang: string; targetLang: string; level?: string; clusters?: number; perCluster?: number }) =>
    http<{ clusters: { theme: string; words: string[] }[] }>(`/api/words/starter-candidates`, { method: "POST", body: JSON.stringify(payload) }),
  // Keep the test's verdict: `unknown` are the words they tapped (the starter deck),
  // `known` the ones they left — an explicit "I already know this" that used to be
  // thrown away with the component's state.
  savePlacement: (payload: { sourceLang: string; targetLang: string; level?: string; known: string[]; unknown: string[] }) =>
    http<{ saved: number }>(`/api/words/placement`, { method: "POST", body: JSON.stringify(payload) }),

  // Transcribe a recorded voice answer to text (Coach practice).
  stt: (payload: { audio: string; format?: string; sourceLang?: string }) =>
    http<{ text: string }>(`/api/coach/stt`, { method: "POST", body: JSON.stringify(payload) }),

  // What the coach remembers about the learner for ONE source language (goal / interests / notes).
  coachProfile: (telegramId: string, lang: string) =>
    http<{ goal: string; interests: string; notes: string }>(
      `/api/coach/profile?telegramId=${encodeURIComponent(telegramId)}&lang=${encodeURIComponent(lang)}`,
    ),
  updateCoachProfile: (payload: { telegramId: string; lang: string; goal?: string; interests?: string; notes?: string }) =>
    http<{ goal: string; interests: string; notes: string }>(`/api/coach/profile`, { method: "PUT", body: JSON.stringify(payload) }),
  coachRemember: (payload: {
    telegramId: string;
    sourceLang: string;
    messages: { role: "user" | "assistant"; content: string }[];
  }) => http<{ ok: true }>(`/api/coach/remember`, { method: "POST", body: JSON.stringify(payload) }),

  // Adaptive Coach practice: one drill turn (the client keeps the message thread).
  coachDrill: (payload: {
    messages: { role: "user" | "assistant"; content: string }[];
    words: { word: string; meaning: string }[];
    sourceLang?: string;
    targetLang?: string;
    level?: string;
    telegramId?: string;
  }) =>
    http<{
      say: string;
      drillWord: string;
      grade: "none" | "correct" | "partial" | "wrong";
      gradedWord: string;
      errorKind: "none" | ProductionError;
      done: boolean;
    }>(
      `/api/coach/drill`,
      { method: "POST", body: JSON.stringify(payload) },
    ),

  // Casual "learn by chatting": one conversational turn. Returns the coach's reply
  // plus which words-in-play the learner used ("used") and which the coach seeded.
  coachChat: (payload: CoachChatPayload) =>
    http<CoachChatResult>(`/api/coach/chat`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Same turn, but streamed: the "say" text arrives via onDelta as it is generated and
  // the promise resolves with the identical validated CoachChatResult.
  coachChatStream: (
    payload: CoachChatPayload,
    opts: { onDelta?: (t: string) => void; signal?: AbortSignal },
  ) => streamHttp<CoachChatResult>(`/api/coach/chat`, payload, opts),

  // Scene roleplay — generate the premise card (one call), then run it turn by turn.
  // The client keeps the message thread AND echoes the scene "bible" each turn (the
  // engine is stateless). "used" mission words feed FSRS on the client.
  coachSceneSetup: (payload: {
    words: { word: string; meaning: string }[];
    sourceLang?: string;
    targetLang?: string;
    level?: string;
    idea?: string;
    avoid?: string[];
    telegramId?: string;
  }) =>
    http<{
      title: string;
      setting: string;
      character: string;
      characterName: string;
      learnerRole: string;
      goal: string;
      briefing: string;
      missionWords: { word: string; meaning: string }[];
      newWords: { word: string; meaning: string }[];
      opening: string;
      twist?: string;
    }>(`/api/coach/scene/setup`, { method: "POST", body: JSON.stringify(payload) }),

  coachSceneTurn: (payload: CoachSceneTurnPayload) =>
    http<CoachSceneTurnResult>(`/api/coach/scene/turn`, { method: "POST", body: JSON.stringify(payload) }),

  // Same scene turn, streamed: live "say" deltas via onDelta, resolving with the
  // identical validated CoachSceneTurnResult.
  coachSceneTurnStream: (
    payload: CoachSceneTurnPayload,
    opts: { onDelta?: (t: string) => void; signal?: AbortSignal },
  ) => streamHttp<CoachSceneTurnResult>(`/api/coach/scene/turn`, payload, opts),

  // Beta bug/idea report (message + auto-collected context + optional screenshot).
  sendFeedback: (payload: FeedbackPayload) =>
    http<{ ok: true; delivered: { email: boolean; telegram: boolean; logged: boolean } }>(`/api/feedback`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),

  // Billing: current plan + today's AI-action usage.
  aiUsage: (telegramId: string) =>
    http<{ pro: boolean; plan: string; used: number; limit: number; remaining: number }>(
      `/api/ai/usage?telegramId=${encodeURIComponent(telegramId)}`,
    ),
  // Reader: saved texts + AI generation.
  readerTexts: (telegramId: string, q?: string, collection?: string) =>
    http<ReaderTextSummary[]>(
      `/api/reader/texts?telegramId=${encodeURIComponent(telegramId)}${q ? `&q=${encodeURIComponent(q)}` : ""}${collection ? `&collection=${encodeURIComponent(collection)}` : ""}`,
    ),
  readerCollections: (telegramId: string) =>
    http<string[]>(`/api/reader/collections?telegramId=${encodeURIComponent(telegramId)}`),
  readerText: (id: string, telegramId: string) =>
    http<ReaderTextFull>(`/api/reader/texts/${id}?telegramId=${encodeURIComponent(telegramId)}`),
  saveReaderText: (payload: {
    telegramId: string;
    title: string;
    content: string;
    collection?: string;
    autoName?: boolean;
    translation?: string;
    clickedWords?: string[];
    estimateLevel?: boolean;
    level?: string;
    sourceLang?: string;
    targetLang?: string;
  }) => http<{ id: string; title: string; level?: string | null }>(`/api/reader/texts`, { method: "POST", body: JSON.stringify(payload) }),
  updateReaderText: (
    id: string,
    payload: {
      telegramId: string;
      title?: string;
      content?: string;
      collection?: string | null;
      level?: string | null;
      translation?: string | null;
      clickedWords?: string[];
    },
  ) => http<{ id: string; title: string; level?: string | null }>(`/api/reader/texts/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteReaderText: (id: string, telegramId: string) =>
    http<{ ok: true }>(`/api/reader/texts/${id}`, { method: "DELETE", body: JSON.stringify({ telegramId }) }),
  // Kicks off background generation; returns the new row id (poll readerText for status).
  generateReaderText: (payload: { telegramId: string; topic: string; sourceLang?: string; targetLang?: string; level?: string }) =>
    http<{ id: string; title: string; status: string }>(`/api/reader/generate`, { method: "POST", body: JSON.stringify(payload) }),
  // Coach scenes: saved sessions (history + resume).
  sceneSessions: (telegramId: string, q?: string) =>
    http<SceneSessionSummary[]>(
      `/api/scene/sessions?telegramId=${encodeURIComponent(telegramId)}${q ? `&q=${encodeURIComponent(q)}` : ""}`,
    ),
  sceneSession: (id: string, telegramId: string) =>
    http<SceneSessionFull>(`/api/scene/sessions/${id}?telegramId=${encodeURIComponent(telegramId)}`),
  createSceneSession: (payload: {
    telegramId: string;
    title: string;
    sceneKey?: string;
    sourceLang?: string;
    targetLang?: string;
    bible: unknown;
  }) => http<{ id: string }>(`/api/scene/sessions`, { method: "POST", body: JSON.stringify(payload) }),
  saveSceneSession: (
    id: string,
    payload: {
      telegramId: string;
      title?: string;
      status?: "active" | "done";
      bible?: unknown;
      turns?: unknown;
      corrections?: unknown;
      used?: string[];
      addedWords?: string[];
      reviewedCount?: number;
    },
  ) => http<{ id: string }>(`/api/scene/sessions/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteSceneSession: (id: string, telegramId: string) =>
    http<{ ok: true }>(`/api/scene/sessions/${id}`, { method: "DELETE", body: JSON.stringify({ telegramId }) }),
  // Owner-only admin dashboard snapshot.
  adminStats: () => http<AdminStats>(`/api/admin/stats`),
  adminFunnel: () => http<AdminFunnel>(`/api/admin/funnel`),
  adminReports: () => http<ModerationQueue>(`/api/admin/reports`),
  moderateDeck: (id: string, action: "dismiss" | "delist" | "restore") =>
    http<{ ok: true }>(`/api/admin/decks/${id}/moderate`, { method: "POST", body: JSON.stringify({ action }) }),
  logout: () => http<{ ok: true }>(`/api/auth/logout`, { method: "POST" }),
};

// A word is "due" if it has never been reviewed, or its scheduled review time
// has passed. Used for the due badges and the header counter.
export function isDue(word: Word): boolean {
  if (!word.nextReviewAt) return true;
  return new Date(word.nextReviewAt).getTime() <= Date.now();
}
