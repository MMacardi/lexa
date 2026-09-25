import { segmentChinese, type Token } from "./segment.js";

/**
 * How much of a text the learner knows — Migaku's comprehension score, on the
 * Reader's own counts. The Reader computes the same number for the open text
 * (app/reader/page.tsx), so every rule here has a twin there; change both.
 *
 *   - Words are the Reader's tokens: Chinese cut by segmentChinese, any other
 *     language by ICU. A token counts only if it has a letter — a year or a
 *     page number is not a word to know.
 *   - Running words, repeats included: a text where 的 appears twelve times is
 *     that much easier for knowing 的.
 *   - Known = a card for the pair that is past FSRS's learning steps (state 2
 *     Review or 3 Relearning), or one the learner can use — the readiness
 *     mark's "recognise" (hsk.ts). A card still in learning is not known yet.
 */

export function readerTokens(text: string, lang: string): Token[] {
  if (lang === "zh" || lang === "zh-Hant") return segmentChinese(text);
  const seg = new Intl.Segmenter(lang, { granularity: "word" });
  return Array.from(seg.segment(text), (s) => ({ text: s.segment, wordLike: Boolean(s.isWordLike) }));
}

export const countsAsWord = (t: Token) => t.wordLike && /\p{L}/u.test(t.text);

/** The Reader's key for matching a token against the learner's cards. */
export const readerKey = (s: string) => s.trim().toLowerCase();

export const isKnownCard = (c: { state: number; canUseAt: Date | null }) => c.canUseAt != null || c.state >= 2;

/** Percent of the running words that are known, or null for a text with none. */
export function knownPercent(tokens: Token[], known: Set<string>): number | null {
  let total = 0;
  let hit = 0;
  for (const t of tokens) {
    if (!countsAsWord(t)) continue;
    total++;
    if (known.has(readerKey(t.text))) hit++;
  }
  return total ? Math.round((hit / total) * 100) : null;
}
