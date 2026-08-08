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

// --- Example source style (register), a single global default ---
export const EXAMPLE_STYLES = ["news", "casual", "dialogue", "literary"] as const;
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
