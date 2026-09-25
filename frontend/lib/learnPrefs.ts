"use client";

import { useEffect, useState } from "react";
import { api, type LearnerPrefs } from "@/lib/api";

// Learner preferences. Most are local-only display settings (example style, card
// layout, reader source). Four of them — level, native language, daily goal and
// retention — belong to the learner model and live on the account: the bot and a
// second device have to see the same numbers. Those are still mirrored into
// localStorage, which stays the synchronous read path for the whole app and keeps
// working offline; `pushPrefs` writes the change through to the server.

// --- CEFR level, stored per source language ---
export const CEFR_LEVELS = ["A1", "A2", "B1", "B2", "C1", "C2"] as const;
export type CefrLevel = (typeof CEFR_LEVELS)[number];

// Short descriptions shown next to each level in the picker.
export const LEVEL_HINT: Record<CefrLevel, string> = {
  A1: "beginner",
  A2: "elementary",
  B1: "intermediate",
  B2: "upper-intermediate",
  C1: "advanced",
  C2: "proficient",
};

const LEVELS_KEY = "lexa.levels"; // { [lang]: CefrLevel }
const STYLE_KEY = "lexa.exampleStyle";
const SOURCE_KEY = "lexa.exampleSource";
const TRANSCRIPTION_KEY = "lexa.showTranscription";
const EVT = "lexa-prefs-changed";

// --- Account sync for the four learner-model settings ---
// Which account the local mirror belongs to. Without it, signing in as someone
// else on the same browser would upload the previous learner's level and goal
// into the new account (the server only defers to local when it has nothing).
const PREFS_ACCOUNT_KEY = "lexa.prefsAccount";

/** Write a changed setting through to the account; local already has it. */
function pushPrefs(patch: LearnerPrefs) {
  // Best-effort: the local mirror is authoritative for this tab either way, and a
  // failed sync must never block the click that caused it.
  void api.updateLearnerPrefs(patch).catch(() => {});
}

/**
 * Upload each migrated setting on its own. The server rejects a whole PATCH on a
 * single bad field, and this browser's mirror may hold anything a past version
 * wrote, so one stale value must not take the other three down with it.
 */
function pushPrefsSeparately(patch: LearnerPrefs) {
  for (const [k, v] of Object.entries(patch)) pushPrefs({ [k]: v } as LearnerPrefs);
}

/**
 * Reconcile the local mirror with the account, once the profile is known.
 * The server wins wherever it has a value; where it has none, the value this
 * browser has been carrying is uploaded, so existing learners keep their settings
 * instead of silently resetting on the first load after this change.
 */
export function syncLearnerPrefs(profile: {
  telegramId?: string;
  levels?: Record<string, string> | null;
  nativeLang?: string | null;
  dailyGoal?: number | null;
  retention?: number | null;
}) {
  if (typeof window === "undefined") return;
  try {
    // A *different* account on this browser: drop the mirror rather than merge
    // it. No marker at all means the mirror predates this sync, so it belongs to
    // whoever is signed in — that is the one-time migration of existing learners
    // and must not be wiped.
    const id = profile.telegramId ?? "";
    const owner = localStorage.getItem(PREFS_ACCOUNT_KEY);
    if (owner !== null && owner !== id) {
      for (const k of [LEVELS_KEY, NATIVE_KEY, GOAL_KEY, RETENTION_KEY]) localStorage.removeItem(k);
    }
    localStorage.setItem(PREFS_ACCOUNT_KEY, id);

    const upload: LearnerPrefs = {};

    // Levels are the one map. Once the account holds any, it is the whole truth:
    // merging instead would let a device with a stale mirror re-upload a level
    // the learner deleted on another one. Only an account that has none at all
    // adopts this browser's set — the one-time migration.
    const remote = (profile.levels ?? null) as Record<string, CefrLevel> | null;
    if (remote && Object.keys(remote).length) {
      localStorage.setItem(LEVELS_KEY, JSON.stringify(remote));
    } else {
      // Drop anything a past version may have written that the server would
      // reject; a single bad entry must not cost the learner every level.
      const clean = Object.fromEntries(
        Object.entries(readLevels()).filter(([lang, lv]) => lang.length >= 2 && (CEFR_LEVELS as readonly string[]).includes(lv)),
      ) as Record<string, CefrLevel>;
      if (Object.keys(clean).length) upload.levels = clean;
    }

    // The scalars: the account wins where it has one, otherwise this browser's
    // value migrates up. Each is range-checked the same way the server will.
    const mine = {
      nativeLang: localStorage.getItem(NATIVE_KEY) || null,
      dailyGoal: Number(localStorage.getItem(GOAL_KEY)),
      retention: Number(localStorage.getItem(RETENTION_KEY)),
    };
    if (profile.nativeLang) localStorage.setItem(NATIVE_KEY, profile.nativeLang);
    else if (mine.nativeLang && mine.nativeLang.length >= 2) upload.nativeLang = mine.nativeLang;

    if (profile.dailyGoal != null) localStorage.setItem(GOAL_KEY, String(profile.dailyGoal));
    else if (Number.isFinite(mine.dailyGoal) && mine.dailyGoal >= 1) upload.dailyGoal = Math.min(100, Math.round(mine.dailyGoal));

    if (profile.retention != null) localStorage.setItem(RETENTION_KEY, String(profile.retention));
    else if (mine.retention >= 0.7 && mine.retention <= 0.98) upload.retention = mine.retention;

    if (Object.keys(upload).length) pushPrefsSeparately(upload);
    window.dispatchEvent(new Event(EVT));
  } catch {
    /* private mode / quota — the app still works off its defaults */
  }
}

function readLevels(): Record<string, CefrLevel> {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(LEVELS_KEY) ?? "{}") as Record<string, CefrLevel>;
  } catch {
    return {};
  }
}

/** The stored CEFR level for a language, or null if the user hasn't set one. */
export function getLevel(lang: string): CefrLevel | null {
  return readLevels()[lang] ?? null;
}

export function setLevel(lang: string, level: CefrLevel) {
  const all = readLevels();
  all[lang] = level;
  localStorage.setItem(LEVELS_KEY, JSON.stringify(all));
  pushPrefs({ levels: all });
  window.dispatchEvent(new Event(EVT));
}

export function removeLevel(lang: string) {
  const all = readLevels();
  delete all[lang];
  localStorage.setItem(LEVELS_KEY, JSON.stringify(all));
  pushPrefs({ levels: all });
  window.dispatchEvent(new Event(EVT));
}

/** All languages the user has set a level for. */
export function getAllLevels(): Record<string, CefrLevel> {
  return readLevels();
}

/** Reactive map of every stored level (for the account settings screen). */
export function useAllLevels(): Record<string, CefrLevel> {
  const [levels, setState] = useState<Record<string, CefrLevel>>({});
  useEffect(() => {
    const sync = () => setState(getAllLevels());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return levels;
}

/** Reactive level for a language (updates when set anywhere). */
export function useLevel(lang: string): CefrLevel | null {
  const [level, setState] = useState<CefrLevel | null>(null);
  useEffect(() => {
    const sync = () => setState(getLevel(lang));
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, [lang]);
  return level;
}

// --- Reader: default "source" of pasted/scanned text (used to attribute the
// example/context when adding words from the Reader). Defaults to the user's own. ---
const READER_SOURCE_KEY = "lexa.readerSource";

export function getReaderSource(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(READER_SOURCE_KEY) ?? "";
}

export function setReaderSource(src: string) {
  localStorage.setItem(READER_SOURCE_KEY, src);
  window.dispatchEvent(new Event(EVT));
}

export function useReaderSource(): string {
  const [src, setState] = useState("");
  useEffect(() => {
    const sync = () => setState(getReaderSource());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return src;
}

// --- Recently used language pairs (for quick re-selection when adding) ---
export interface LangPair {
  s: string;
  t: string;
}
const PAIRS_KEY = "lexa.recentPairs";

export function getRecentPairs(): LangPair[] {
  if (typeof window === "undefined") return [];
  try {
    return JSON.parse(localStorage.getItem(PAIRS_KEY) ?? "[]") as LangPair[];
  } catch {
    return [];
  }
}

export function pushRecentPair(s: string, t: string) {
  if (!s || !t || s === "auto") return;
  const next = [{ s, t }, ...getRecentPairs().filter((p) => !(p.s === s && p.t === t))].slice(0, 5);
  localStorage.setItem(PAIRS_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event(EVT));
}

export function useRecentPairs(): LangPair[] {
  const [pairs, setState] = useState<LangPair[]>([]);
  useEffect(() => {
    const sync = () => setState(getRecentPairs());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return pairs;
}

// --- Han disambiguation: which language pure-ideograph input means ---
// (auto-detect can't tell Chinese from Japanese for kanji-only words, so we
// ask once and remember the answer to avoid nagging on every Chinese word.)
const HAN_KEY = "lexa.hanLang";

export function getHanLang(): "zh" | "ja" | "ko" | null {
  if (typeof window === "undefined") return null;
  const v = localStorage.getItem(HAN_KEY);
  return v === "zh" || v === "ja" || v === "ko" ? v : null;
}

export function setHanLang(lang: "zh" | "ja" | "ko") {
  localStorage.setItem(HAN_KEY, lang);
  window.dispatchEvent(new Event(EVT));
}

export function clearHanLang() {
  localStorage.removeItem(HAN_KEY);
  window.dispatchEvent(new Event(EVT));
}

/** Reactive remembered Han language (for the account settings screen). */
export function useHanLang(): "zh" | "ja" | "ko" | null {
  const [han, setState] = useState<"zh" | "ja" | "ko" | null>(null);
  useEffect(() => {
    const sync = () => setState(getHanLang());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return han;
}

// --- Native language: the one the learner already knows ---
// Tells the add form which side of a pair is theirs, so a pair set backwards can
// be caught. Guessing it from the interface language misfired: plenty of people
// run the app in the very language they study. Saved by the first run and the add
// form's pair nudge, editable in Settings.
const NATIVE_KEY = "lexa.nativeLang";

// The pair every surface shares (Add form, Reader, Coach, Mika), as last set —
// onboarding writes it, so on the HSK track it is Chinese → your language.
export function getStudyPair(): { sourceLang: string; targetLang: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const p = JSON.parse(localStorage.getItem("lexa.wordPair") ?? "null") as { sourceLang?: string; targetLang?: string } | null;
    return p?.sourceLang && p.targetLang && p.sourceLang !== "auto" ? { sourceLang: p.sourceLang, targetLang: p.targetLang } : null;
  } catch {
    return null;
  }
}

export function getNativeLang(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(NATIVE_KEY) || null;
}

export function setNativeLang(lang: string) {
  localStorage.setItem(NATIVE_KEY, lang);
  pushPrefs({ nativeLang: lang });
  window.dispatchEvent(new Event(EVT));
}

export function useNativeLang(): string | null {
  const [lang, setState] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => setState(getNativeLang());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return lang;
}

// --- Flashcard layout: which fields show on the front vs the back ---
// Lets the learner train e.g. word → synonyms instead of word → meaning.
export type CardField =
  | "word"
  | "phonetic"
  | "pos"
  | "meaning"
  | "example"
  | "exampleTr"
  | "synonyms"
  | "antonyms"
  | "collocations"
  | "notes";

export const CARD_FIELDS: CardField[] = [
  "word",
  "phonetic",
  "pos",
  "meaning",
  "example",
  "exampleTr",
  "synonyms",
  "antonyms",
  "collocations",
  "notes",
];

export interface CardLayout {
  front: CardField[];
  back: CardField[];
}

export const CARD_PRESETS: { id: string; front: CardField[]; back: CardField[] }[] = [
  // Recognition: see the word, recall its meaning.
  { id: "default", front: ["word", "phonetic", "pos"], back: ["meaning", "example", "exampleTr"] },
  // Production (active recall): see the meaning, recall the word yourself.
  { id: "reverse", front: ["meaning"], back: ["word", "phonetic", "example", "exampleTr"] },
  // Train the word's synonym/antonym family.
  { id: "synonyms", front: ["word"], back: ["synonyms", "antonyms", "meaning"] },
];

export const DEFAULT_LAYOUT: CardLayout = { front: CARD_PRESETS[0].front, back: CARD_PRESETS[0].back };
const CARD_KEY = "lexa.cardLayout";

function isField(x: unknown): x is CardField {
  return typeof x === "string" && (CARD_FIELDS as string[]).includes(x);
}

export function getCardLayout(): CardLayout {
  if (typeof window === "undefined") return DEFAULT_LAYOUT;
  try {
    const raw = JSON.parse(localStorage.getItem(CARD_KEY) ?? "null") as CardLayout | null;
    if (raw && Array.isArray(raw.front) && Array.isArray(raw.back)) {
      const front = raw.front.filter(isField);
      const back = raw.back.filter(isField);
      if (front.length && back.length) return { front, back };
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_LAYOUT;
}

export function setCardLayout(layout: CardLayout) {
  localStorage.setItem(CARD_KEY, JSON.stringify(layout));
  window.dispatchEvent(new Event(EVT));
}

export function useCardLayout(): CardLayout {
  const [layout, setState] = useState<CardLayout>(DEFAULT_LAYOUT);
  useEffect(() => {
    const sync = () => setState(getCardLayout());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return layout;
}

// --- Daily review goal: how many cards the learner wants to train per day ---
// Part of the learner model (it is what the bot's nudge and the streak measure
// against), so it syncs with the account; `useDailyGoal` in lib/goal.ts reads it.
export const DEFAULT_GOAL = 5;
const GOAL_KEY = "lexa.dailyGoal";

export function getDailyGoal(): number {
  if (typeof window === "undefined") return DEFAULT_GOAL;
  const v = Number(localStorage.getItem(GOAL_KEY));
  return Number.isFinite(v) && v >= 1 ? Math.min(100, Math.round(v)) : DEFAULT_GOAL;
}

export function setDailyGoal(n: number) {
  const clamped = Math.max(1, Math.min(100, Math.round(n)));
  localStorage.setItem(GOAL_KEY, String(clamped));
  pushPrefs({ dailyGoal: clamped });
  window.dispatchEvent(new Event(EVT));
}

// --- FSRS desired retention (how well you want to remember at review time) ---
// Higher = shorter intervals + more reviews; lower = longer intervals, less work.
export const RETENTION_OPTIONS = [0.8, 0.85, 0.9, 0.95] as const;
export const DEFAULT_RETENTION = 0.9;
const RETENTION_KEY = "lexa.retention";

export function getRetention(): number {
  if (typeof window === "undefined") return DEFAULT_RETENTION;
  const v = Number(localStorage.getItem(RETENTION_KEY));
  return Number.isFinite(v) && v >= 0.7 && v <= 0.98 ? v : DEFAULT_RETENTION;
}

export function setRetention(r: number) {
  localStorage.setItem(RETENTION_KEY, String(r));
  pushPrefs({ retention: r });
  window.dispatchEvent(new Event(EVT));
}

export function useRetention(): number {
  const [r, setState] = useState<number>(DEFAULT_RETENTION);
  useEffect(() => {
    const sync = () => setState(getRetention());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return r;
}

// --- Testing: pretend to be a free-tier user (applies the daily AI cap even for
// Pro/beta accounts). Only ever restricts the caller, so it's harmless. ---
const SIM_FREE_KEY = "lexa.simulateFree";
export function getSimulateFree(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SIM_FREE_KEY) === "1";
}
export function setSimulateFree(on: boolean) {
  localStorage.setItem(SIM_FREE_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(EVT));
}
export function useSimulateFree(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(getSimulateFree());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

// --- Meaning style: how card meanings are written. A preset for most people
// ("concise" default, or "detailed" with nuance/register), plus a free-text
// "custom" mode for a personal instruction (e.g. a topic focus). Sets Onomika apart
// from a plain translator without forcing anyone to write a prompt. ---
export type MeaningMode = "concise" | "detailed" | "custom";
const MEANING_MODE_KEY = "lexa.meaningMode";
const MEANING_CUSTOM_KEY = "lexa.meaningPrompt"; // free-text used only in "custom" mode

// The instruction the "detailed" preset sends (kept in English to match the
// surrounding enrichment prompt; the output language is fixed elsewhere).
const DETAILED_INSTRUCTION =
  "the translation, then a brief note on nuance, register and typical usage — keep it compact (at most 1-2 short extra lines).";

export function getMeaningMode(): MeaningMode {
  if (typeof window === "undefined") return "concise";
  const v = localStorage.getItem(MEANING_MODE_KEY);
  return v === "detailed" || v === "custom" ? v : "concise";
}
export function setMeaningMode(m: MeaningMode) {
  localStorage.setItem(MEANING_MODE_KEY, m);
  window.dispatchEvent(new Event(EVT));
}
export function getMeaningCustom(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(MEANING_CUSTOM_KEY) ?? "";
}
export function setMeaningCustom(v: string) {
  localStorage.setItem(MEANING_CUSTOM_KEY, v);
  window.dispatchEvent(new Event(EVT));
}

/** The effective instruction sent to the backend (empty = the concise default). */
export function getMeaningPrompt(): string {
  const mode = getMeaningMode();
  if (mode === "detailed") return DETAILED_INSTRUCTION;
  if (mode === "custom") return getMeaningCustom().trim();
  return "";
}

export function useMeaningMode(): MeaningMode {
  const [m, setM] = useState<MeaningMode>("concise");
  useEffect(() => {
    const sync = () => setM(getMeaningMode());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return m;
}
export function useMeaningCustom(): string {
  const [v, setV] = useState("");
  useEffect(() => {
    const sync = () => setV(getMeaningCustom());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return v;
}

// --- Example source style (register), a single global default ---
// How many examples to auto-generate per word (1–2). Default 1.
const EX_COUNT_KEY = "lexa.exampleCount";
export function getExampleCount(): number {
  if (typeof window === "undefined") return 1;
  const v = Number(localStorage.getItem(EX_COUNT_KEY));
  return v >= 1 && v <= 2 ? Math.round(v) : 1;
}
export function setExampleCount(n: number) {
  localStorage.setItem(EX_COUNT_KEY, String(Math.max(1, Math.min(2, Math.round(n)))));
  window.dispatchEvent(new Event(EVT));
}
export function useExampleCount(): number {
  const [n, setN] = useState(1);
  useEffect(() => {
    const sync = () => setN(getExampleCount());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return n;
}

// --- Synonym level: aim the card's synonyms at a target CEFR level (e.g. for
// IELTS prep you want richer, higher-level alternatives). Global; "" = natural. ---
const SYN_LEVEL_KEY = "lexa.synonymLevel";
export function getSynonymLevel(): CefrLevel | "" {
  if (typeof window === "undefined") return "";
  const v = localStorage.getItem(SYN_LEVEL_KEY);
  return (CEFR_LEVELS as readonly string[]).includes(v ?? "") ? (v as CefrLevel) : "";
}
export function setSynonymLevel(level: CefrLevel | "") {
  if (level) localStorage.setItem(SYN_LEVEL_KEY, level);
  else localStorage.removeItem(SYN_LEVEL_KEY);
  window.dispatchEvent(new Event(EVT));
}
export function useSynonymLevel(): CefrLevel | "" {
  const [lv, setLv] = useState<CefrLevel | "">("");
  useEffect(() => {
    const sync = () => setLv(getSynonymLevel());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return lv;
}

export const EXAMPLE_STYLES = ["news", "casual", "dialogue", "literary", "none"] as const;
export type ExampleStyle = (typeof EXAMPLE_STYLES)[number];
// Everyday sentences suit most learners; the backend defaults to the same.
export const DEFAULT_EXAMPLE_STYLE: ExampleStyle = "casual";
// Order the pickers show the registers in (most common first).
export const STYLE_ORDER: ExampleStyle[] = ["casual", "dialogue", "news", "literary"];

export function getExampleStyle(): ExampleStyle {
  if (typeof window === "undefined") return DEFAULT_EXAMPLE_STYLE;
  const v = localStorage.getItem(STYLE_KEY);
  return (EXAMPLE_STYLES as readonly string[]).includes(v ?? "") ? (v as ExampleStyle) : DEFAULT_EXAMPLE_STYLE;
}

// Has the learner ever picked a register (vs running on the default)? The
// first AI add asks once when not (useEnsureStyle).
export function hasChosenExampleStyle(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return localStorage.getItem(STYLE_KEY) !== null;
  } catch {
    return true;
  }
}

export function setExampleStyle(style: ExampleStyle) {
  localStorage.setItem(STYLE_KEY, style);
  window.dispatchEvent(new Event(EVT));
}

export function useExampleStyle(): ExampleStyle {
  const [style, setState] = useState<ExampleStyle>(DEFAULT_EXAMPLE_STYLE);
  useEffect(() => {
    const sync = () => setState(getExampleStyle());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return style;
}

// --- Example SOURCE: where sentences come from ---
// "ai" (default): the model composes a fresh sentence — always on the learner's
// level, cheaper, and free of any third-party copyright question.
// "web": mine a real, attributed sentence from news/articles for authenticity.
export type ExampleSource = "ai" | "web";
export const DEFAULT_EXAMPLE_SOURCE: ExampleSource = "ai";

export function getExampleSource(): ExampleSource {
  if (typeof window === "undefined") return DEFAULT_EXAMPLE_SOURCE;
  return localStorage.getItem(SOURCE_KEY) === "web" ? "web" : "ai";
}

export function setExampleSource(source: ExampleSource) {
  localStorage.setItem(SOURCE_KEY, source);
  window.dispatchEvent(new Event(EVT));
}

export function useExampleSource(): ExampleSource {
  const [source, setState] = useState<ExampleSource>(DEFAULT_EXAMPLE_SOURCE);
  useEffect(() => {
    const sync = () => setState(getExampleSource());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return source;
}

// --- Show transcription (pinyin / romaji / romanization) in quick tap-lookups ---
// Handy when reading CJK: a fast tap shows the reading alongside the meaning.
export function getShowTranscription(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(TRANSCRIPTION_KEY) !== "0"; // default on
}

export function setShowTranscription(on: boolean) {
  localStorage.setItem(TRANSCRIPTION_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(EVT));
}

export function useShowTranscription(): boolean {
  const [on, setState] = useState(true);
  useEffect(() => {
    const sync = () => setState(getShowTranscription());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

// Auto-translate a word when you select it in the Reader (a per-tap model call).
// Off = tapping just selects it, no request — handy for batch-adding.
const AUTOGLOSS_KEY = "lexa.autoGloss";
export function getAutoGloss(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(AUTOGLOSS_KEY) !== "0"; // default on
}
export function setAutoGloss(on: boolean) {
  localStorage.setItem(AUTOGLOSS_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(EVT));
}
export function useAutoGloss(): boolean {
  const [on, setState] = useState(true);
  useEffect(() => {
    const sync = () => setState(getAutoGloss());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

// Reader pinyin: only over the words you don't know yet (Du Chinese's toggle),
// or over every word. Off by default — pinyin over 我 and 是 is what makes a
// learner stop reading the characters.
const RUBY_ALL_KEY = "lexa.rubyAll";
export function setRubyAll(on: boolean) {
  localStorage.setItem(RUBY_ALL_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(EVT));
}
export function useRubyAll(): boolean {
  const [on, setState] = useState(false);
  useEffect(() => {
    const sync = () => setState(localStorage.getItem(RUBY_ALL_KEY) === "1");
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

// Pinyin over the characters of a card's example sentences (word page, review).
// Off by default for the Reader's reason; one tap on the word page turns it on.
const EXAMPLE_PINYIN_KEY = "lexa.examplePinyin";
export function setExamplePinyin(on: boolean) {
  try {
    localStorage.setItem(EXAMPLE_PINYIN_KEY, on ? "1" : "0");
  } catch {}
  window.dispatchEvent(new Event(EVT));
}
export function useExamplePinyin(): boolean {
  const [on, setState] = useState(false);
  useEffect(() => {
    const sync = () => {
      try {
        setState(localStorage.getItem(EXAMPLE_PINYIN_KEY) === "1");
      } catch {}
    };
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

// Coach: make EVERY word in a chat/scene bubble tappable for an instant gloss (and
// one-tap add to the deck), not just the words already in play. Off = only the
// highlighted words respond, so no lookup request can fire.
const TAP_ANY_KEY = "lexa.tapAnyGloss";
export function getTapAnyGloss(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(TAP_ANY_KEY) !== "0"; // default on
}
export function setTapAnyGloss(on: boolean) {
  localStorage.setItem(TAP_ANY_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(EVT));
}
export function useTapAnyGloss(): boolean {
  const [on, setState] = useState(true);
  useEffect(() => {
    const sync = () => setState(getTapAnyGloss());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

// Show an estimated CEFR level on saved texts (and estimate it at save time).
const LEVEL_BADGE_KEY = "lexa.showTextLevel";
export function getShowTextLevel(): boolean {
  if (typeof window === "undefined") return true;
  return localStorage.getItem(LEVEL_BADGE_KEY) !== "0"; // default on
}
export function setShowTextLevel(on: boolean) {
  localStorage.setItem(LEVEL_BADGE_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(EVT));
}
export function useShowTextLevel(): boolean {
  const [on, setState] = useState(true);
  useEffect(() => {
    const sync = () => setState(getShowTextLevel());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

// Languages where a transcription is meaningful.
export function hasTranscription(lang: string): boolean {
  return lang === "zh" || lang === "zh-Hant" || lang === "ja" || lang === "ko";
}

// --- Study pacing: how many brand-new words to introduce per review session ---
// A big import (e.g. 500 HSK words) shouldn't dump every new card on you at once.
// The review queue serves all due cards + at most this many new ones, so learning
// is paced into a plan instead of an avalanche.
export const NEW_PER_DAY_OPTIONS = [5, 10, 15, 20, 30, 50] as const;
export const DEFAULT_NEW_PER_DAY = 15;
const NEW_PER_DAY_KEY = "lexa.newPerDay";
export function getNewPerDay(): number {
  if (typeof window === "undefined") return DEFAULT_NEW_PER_DAY;
  const v = Number(localStorage.getItem(NEW_PER_DAY_KEY));
  return Number.isFinite(v) && v >= 1 && v <= 200 ? Math.round(v) : DEFAULT_NEW_PER_DAY;
}
export function setNewPerDay(n: number) {
  localStorage.setItem(NEW_PER_DAY_KEY, String(Math.max(1, Math.min(200, Math.round(n)))));
  window.dispatchEvent(new Event(EVT));
}
export function useNewPerDay(): number {
  const [n, setN] = useState(DEFAULT_NEW_PER_DAY);
  useEffect(() => {
    const sync = () => setN(getNewPerDay());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return n;
}

// --- Review gestures: swiping up/down for Easy/Hard ---
// Left/right always grade Again/Good. Up/down are opt-in because claiming the
// vertical axis means the card itself can no longer scroll the page under it.
const SWIPE_UP_DOWN_KEY = "lexa.swipeUpDown";
export function getSwipeUpDown(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(SWIPE_UP_DOWN_KEY) === "1";
}
export function setSwipeUpDown(on: boolean) {
  localStorage.setItem(SWIPE_UP_DOWN_KEY, on ? "1" : "0");
  window.dispatchEvent(new Event(EVT));
}
export function useSwipeUpDown(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const sync = () => setOn(getSwipeUpDown());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return on;
}

// --- Word-family graph: how a tapped synonym/antonym is added ---
// "ask" (default) pops the AI-vs-manual chooser each time; "ai"/"manual" skip it
// (set via the chooser's "remember my choice" checkbox; reset in Account).
export type GraphAddMethod = "ask" | "ai" | "manual";
const GRAPH_ADD_KEY = "lexa.graphAddMethod";
export function getGraphAddMethod(): GraphAddMethod {
  if (typeof window === "undefined") return "ask";
  const v = localStorage.getItem(GRAPH_ADD_KEY);
  return v === "ai" || v === "manual" ? v : "ask";
}
export function setGraphAddMethod(m: GraphAddMethod) {
  localStorage.setItem(GRAPH_ADD_KEY, m);
  window.dispatchEvent(new Event(EVT));
}
export function useGraphAddMethod(): GraphAddMethod {
  const [m, setM] = useState<GraphAddMethod>("ask");
  useEffect(() => {
    const sync = () => setM(getGraphAddMethod());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return m;
}

// --- Voice input engine: how the composer/pronunciation mics transcribe speech ---
// "auto" (default) uses the browser's free realtime Web Speech where it works and falls
// back to server STT (qwen3-asr) where it doesn't — iPhone Safari and mainland China both
// lack working Web Speech. "browser"/"server" pin one engine. See lib/micEngine.ts.
export type MicEngine = "auto" | "browser" | "server";
const MIC_ENGINE_KEY = "lexa.micEngine";
export function getMicEngine(): MicEngine {
  if (typeof window === "undefined") return "auto";
  const v = localStorage.getItem(MIC_ENGINE_KEY);
  return v === "browser" || v === "server" ? v : "auto";
}
export function setMicEngine(m: MicEngine) {
  localStorage.setItem(MIC_ENGINE_KEY, m);
  window.dispatchEvent(new Event(EVT));
}
export function useMicEngine(): MicEngine {
  const [m, setM] = useState<MicEngine>("auto");
  useEffect(() => {
    const sync = () => setM(getMicEngine());
    sync();
    window.addEventListener(EVT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  return m;
}

// Sticky flag: set the first time browser Web Speech errors at runtime, so "auto" goes
// straight to server STT afterwards instead of failing once more. Cleared by switching
// the engine pref back to "browser" explicitly (the learner insists it works for them).
const MIC_BROWSER_FAILED_KEY = "lexa.micBrowserFailed";
export function micBrowserFailed(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MIC_BROWSER_FAILED_KEY) === "1";
}
export function markMicBrowserFailed() {
  localStorage.setItem(MIC_BROWSER_FAILED_KEY, "1");
  window.dispatchEvent(new Event(EVT));
}
export function clearMicBrowserFailed() {
  localStorage.removeItem(MIC_BROWSER_FAILED_KEY);
  window.dispatchEvent(new Event(EVT));
}
