import { chatJson } from "./llm.js";
import { suggestSchema, type SuggestResult } from "../lib/schemas.js";
import { langName } from "../lib/langs.js";

// Detect a language from the word's script when it's unambiguous. This is far
// more reliable than asking the LLM (which sometimes omits detectedLang), so we
// prefer it for auto-detect. Returns null for Latin scripts, which stay
// ambiguous (en/es/de/fr…) and need the model.
// Classify a word by its script. Kana and Hangul are script-exclusive so they
// win outright. Han ideographs are shared by Chinese/Japanese/Korean, so a word
// made of ONLY ideographs (no kana/hangul) is genuinely ambiguous: we guess
// Chinese but flag `ambiguousHan` so the UI can ask "Chinese or Japanese?".
function classifyScript(word: string): { lang: string | null; ambiguousHan: boolean } {
  let hasHan = false;
  let hasCyrillic = false;
  for (const ch of word) {
    const c = ch.codePointAt(0) ?? 0;
    if (c >= 0x3040 && c <= 0x30ff) return { lang: "ja", ambiguousHan: false }; // kana → Japanese
    if (c >= 0xac00 && c <= 0xd7af) return { lang: "ko", ambiguousHan: false }; // hangul → Korean
    if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf)) hasHan = true; // shared ideographs
    else if (c >= 0x0400 && c <= 0x04ff) hasCyrillic = true; // Cyrillic
  }
  if (hasHan) return { lang: "zh", ambiguousHan: true }; // ideographs only → guess zh, but ambiguous
  if (hasCyrillic) return { lang: "ru", ambiguousHan: false };
  return { lang: null, ambiguousHan: false };
}

/**
 * Spell-check a word the user typed in the AI add flow. Returns the most likely
 * intended spelling plus a few alternative candidates ("did you mean…").
 * If the input already looks like a valid word, `corrected` equals the input.
 */
export async function suggestWord(
  word: string,
  sourceLang = "en",
): Promise<SuggestResult & { ambiguousHan: boolean }> {
  const autoDetect = sourceLang === "auto";
  const lang = autoDetect ? "the language of the word the user typed" : langName(sourceLang);
  const result = await chatJson({
    system:
      `You are a spelling assistant for ${lang}. The user typed a word that may be ` +
      `misspelled. Respond as JSON: {"corrected": string, "suggestions": string[]${autoDetect ? ', "detectedLang": string' : ''}}. ` +
      (autoDetect
        ? `"detectedLang" must be one of: en, zh, ru, es, de, fr, ja, ko, based on the language of the input word. ` +
          `Use it to identify the word's language before correcting spelling.`
        : "") +
      `"corrected" is the single most likely intended ${lang} word — it MUST be a real, ` +
      `correctly spelled ${lang} dictionary word. "suggestions" is an array of up to 4 ` +
      `REAL ${lang} dictionary words the user might have meant, most likely first. ` +
      `CRITICAL: never include a word that is not a real dictionary word. If the user's ` +
      `input is itself not a real word (e.g. a typo), do NOT include it in "suggestions". ` +
      `Only include the input if it is genuinely a real, correctly spelled ${lang} word. ` +
      `All words lowercase, no definitions or punctuation. If the input is already a real, ` +
      `correctly spelled word, set "corrected" to the input unchanged.`,
    user: word.trim(),
    schema: suggestSchema,
  });

  // Normalise: lowercase, de-dupe, drop empties.
  const corrected = (result.corrected ?? "").trim().toLowerCase() || word.trim().toLowerCase();
  const seen = new Set<string>();
  const suggestions = [corrected, ...(result.suggestions ?? []).map((s) => s.trim().toLowerCase())].filter(
    (s) => s && !seen.has(s) && seen.add(s),
  );
  // Prefer script detection (reliable) over the model's detectedLang, then fall
  // back to "en" for ambiguous Latin input.
  const script = autoDetect ? classifyScript(word.trim()) : { lang: sourceLang, ambiguousHan: false };
  const detectedLang = autoDetect
    ? script.lang || result.detectedLang?.trim().toLowerCase() || "en"
    : sourceLang;
  return { corrected, suggestions: suggestions.slice(0, 5), detectedLang, ambiguousHan: script.ambiguousHan };
}
