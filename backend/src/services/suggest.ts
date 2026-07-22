import { chatJson } from "./llm.js";
import { suggestSchema, type SuggestResult } from "../lib/schemas.js";
import { langName } from "../lib/langs.js";

/**
 * Spell-check a word the user typed in the AI add flow. Returns the most likely
 * intended spelling plus a few alternative candidates ("did you mean…").
 * If the input already looks like a valid word, `corrected` equals the input.
 */
export async function suggestWord(word: string, sourceLang = "en"): Promise<SuggestResult> {
  const lang = langName(sourceLang);
  const result = await chatJson({
    system:
      `You are a ${lang} spelling assistant. The user typed a word that may be ` +
      `misspelled. Respond as JSON: {"corrected": string, "suggestions": string[]}. ` +
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
  const corrected = result.corrected.trim().toLowerCase() || word.trim().toLowerCase();
  const seen = new Set<string>();
  const suggestions = [corrected, ...(result.suggestions ?? []).map((s) => s.trim().toLowerCase())].filter(
    (s) => s && !seen.has(s) && seen.add(s),
  );
  return { corrected, suggestions: suggestions.slice(0, 5) };
}
