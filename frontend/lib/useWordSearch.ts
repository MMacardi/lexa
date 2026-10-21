import { useEffect, useMemo, useState } from "react";
import type { Word } from "./api";
import { localTranscribe } from "./transcribe";

// Preserve ü as v before dropping tones, so 女 (nv) stays distinct from 努 (nu).
export function normalizePinyin(value: string): string {
  const normalized = value.toLowerCase().normalize("NFD")
    .replace(/u\u0308|u:/g, "v")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[0-5\s'’ʼ\-‐‑–—·]/g, "");
  return /^[a-z]+$/.test(normalized) ? normalized : "";
}

const isChinese = (lang: string) => lang === "zh" || lang === "zh-Hant";

/** Prepare saved-card fields when the deck changes, never on a search keystroke. */
export function useWordSearch(words: Word[] | undefined) {
  const [fallback, setFallback] = useState<Map<string, string>>(new Map());
  // Only old cards without a saved reading need local transcription. Keep this
  // independent of display preferences and of unrelated enrichment/poll updates.
  const missingKey = useMemo(() => JSON.stringify([...new Set((words ?? [])
    .filter((w) => isChinese(w.sourceLang) && !w.phonetic?.trim())
    .map((w) => w.word))]), [words]);

  useEffect(() => {
    let active = true;
    const missing: string[] = JSON.parse(missingKey);
    void (async () => {
      const next = new Map<string, string>();
      for (const word of missing) {
        if (!active) return;
        try {
          next.set(word, await localTranscribe(word, "zh"));
        } catch {
          // A missing local chunk must not prevent hanzi/meaning search.
        }
      }
      if (active) setFallback(next);
    })();
    return () => { active = false; };
  }, [missingKey]);

  return useMemo(() => (words ?? []).map((card) => ({
    card,
    spelling: card.word.toLowerCase(),
    meaning: (card.meaningZh ?? "").toLowerCase(),
    // Saved/dictionary readings win for polyphonic words; don't add guessed
    // alternate readings to cards that already have a specific pronunciation.
    pinyin: isChinese(card.sourceLang)
      ? normalizePinyin(card.phonetic?.trim() || fallback.get(card.word) || "")
      : "",
  })), [words, fallback]);
}
