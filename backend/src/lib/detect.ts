// Script-based language detection shared across the add/suggest flows. Uses
// Unicode code-point ranges so it needs no model call and never mislabels a
// clear script. Latin scripts stay ambiguous (return null).
export function detectScriptLang(word: string): string | null {
  let hasHan = false;
  let hasCyrillic = false;
  for (const ch of word) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x3040 && c <= 0x30ff) return "ja"; // hiragana / katakana
    if (c >= 0xac00 && c <= 0xd7af) return "ko"; // hangul
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) hasHan = true; // Han
    else if (c >= 0x0400 && c <= 0x04ff) hasCyrillic = true; // Cyrillic
  }
  if (hasHan) return "zh";
  if (hasCyrillic) return "ru";
  return null;
}

/**
 * Resolve a concrete source language: a word must never be stored with "auto".
 * If the caller passes "auto" (or nothing), detect from the word's script and
 * fall back to English for ambiguous Latin input.
 */
export function normalizeLang(word: string, lang?: string): string {
  if (lang && lang !== "auto") return lang;
  return detectScriptLang(word.trim()) ?? "en";
}
