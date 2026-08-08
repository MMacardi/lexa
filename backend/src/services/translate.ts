import { chatJson } from "./llm.js";
import { translationSchema } from "../lib/schemas.js";
import { langName } from "../lib/langs.js";

/**
 * Contextual gloss: the short meaning of a single word AS USED IN a sentence
 * (its sense in this context), for the Reader's press-and-hold lookup.
 */
export async function glossInContext(params: {
  word: string;
  sentence: string;
  sourceLang?: string;
  targetLang?: string;
}): Promise<{ gloss: string }> {
  const word = params.word.trim().slice(0, 100);
  if (!word) return { gloss: "" };
  const source = langName(params.sourceLang ?? "en");
  const target = langName(params.targetLang ?? "zh");
  const sentence = params.sentence.trim().slice(0, 600) || word;
  const result = await chatJson({
    system:
      `You are a ${source}-to-${target} reading assistant. Given a ${source} SENTENCE and one ` +
      `WORD taken from it, reply with the concise ${target} meaning of that word AS USED IN THIS ` +
      `SENTENCE (its contextual sense) — a few words, no explanation. Respond as JSON: ` +
      `{"translation": string}.`,
    user: `SENTENCE: ${sentence}\nWORD: ${word}`,
    schema: translationSchema,
    timeoutMs: 30000,
  });
  return { gloss: result.translation.trim() };
}

// Cap the text we send to the model so a giant paste can't blow up latency/cost.
const MAX_CHARS = 6000;

/**
 * Translate a whole block of text from one language to another (used by the
 * Reader's "Translate all" button). One LLM call; no database writes.
 */
export async function translateText(params: {
  text: string;
  sourceLang?: string;
  targetLang?: string;
}): Promise<{ translation: string }> {
  const text = params.text.trim().slice(0, MAX_CHARS);
  if (!text) return { translation: "" };
  const source = langName(params.sourceLang ?? "en");
  const target = langName(params.targetLang ?? "zh");
  const result = await chatJson({
    system:
      `You are a professional ${source}-to-${target} translator. Translate the ` +
      `user's ${source} text into natural, fluent ${target}. Keep paragraph breaks ` +
      `and do not add commentary. Respond as JSON: {"translation": string} where ` +
      `translation is only the ${target} rendering of the text.`,
    user: text,
    schema: translationSchema,
    timeoutMs: 60000,
  });
  return { translation: result.translation };
}
