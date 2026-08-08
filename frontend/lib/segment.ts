// Tokenize a block of text into words + separators for the Reader. Uses the
// browser-native Intl.Segmenter when available, which handles languages without
// spaces (Chinese/Japanese) by segmenting on real word boundaries — no jieba or
// server round-trip needed. Falls back to a Unicode-aware regex split otherwise.

export interface Token {
  text: string;
  wordLike: boolean;
}

type SegmenterCtor = new (
  locale?: string,
  opts?: { granularity?: "grapheme" | "word" | "sentence" },
) => { segment: (input: string) => Iterable<{ segment: string; isWordLike?: boolean }> };

export function segment(text: string, lang: string): Token[] {
  const Seg = (Intl as unknown as { Segmenter?: SegmenterCtor }).Segmenter;
  if (Seg) {
    try {
      const seg = new Seg(lang || undefined, { granularity: "word" });
      const out: Token[] = [];
      for (const s of seg.segment(text)) {
        out.push({ text: s.segment, wordLike: Boolean(s.isWordLike) });
      }
      return out;
    } catch {
      /* unsupported locale → fall through to the regex tokenizer */
    }
  }
  // Fallback: contiguous letter/number runs are words, everything else is a
  // separator. Keeps apostrophes/hyphens inside words (e.g. "don't", "well-known").
  const re = /[\p{L}\p{N}][\p{L}\p{N}\p{M}'’-]*|[^\p{L}\p{N}]+/gu;
  const out: Token[] = [];
  for (const m of text.matchAll(re)) {
    const tok = m[0];
    out.push({ text: tok, wordLike: /[\p{L}\p{N}]/u.test(tok[0]) });
  }
  return out;
}

// Normalized key for matching a token against the saved vocabulary.
export function wordKey(s: string): string {
  return s.trim().toLowerCase();
}
