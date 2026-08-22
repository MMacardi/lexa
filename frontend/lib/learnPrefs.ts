"use client";

import { useEffect, useState } from "react";

// Learner preferences kept locally (like customLangs/goal): the CEFR level per
// language and the preferred example source. These feed the AI example search so
// sentences match the learner's level and chosen register.

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
  window.dispatchEvent(new Event(EVT));
}

export function removeLevel(lang: string) {
  const all = readLevels();
  delete all[lang];
  localStorage.setItem(LEVELS_KEY, JSON.stringify(all));
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

// --- Example source style (register), a single global default ---
export const EXAMPLE_STYLES = ["news", "casual", "dialogue", "literary", "none"] as const;
export type ExampleStyle = (typeof EXAMPLE_STYLES)[number];

export function getExampleStyle(): ExampleStyle {
  if (typeof window === "undefined") return "news";
  const v = localStorage.getItem(STYLE_KEY);
  return (EXAMPLE_STYLES as readonly string[]).includes(v ?? "") ? (v as ExampleStyle) : "news";
}

export function setExampleStyle(style: ExampleStyle) {
  localStorage.setItem(STYLE_KEY, style);
  window.dispatchEvent(new Event(EVT));
}

export function useExampleStyle(): ExampleStyle {
  const [style, setState] = useState<ExampleStyle>("news");
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
