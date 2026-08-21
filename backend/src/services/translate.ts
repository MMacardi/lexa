import { chatJson } from "./llm.js";
import { translationSchema, glossSchema } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";

// Languages written in a script where a transcription (pinyin/romaji/romanization)
// genuinely helps a quick lookup.
const TRANSCRIBABLE = new Set(["zh", "zh-Hant", "ja", "ko"]);
function transcriptionName(lang: string): string {
  if (lang === "zh" || lang === "zh-Hant") return "Hanyu Pinyin (with tone marks)";
  if (lang === "ja") return "romaji";
  if (lang === "ko") return "Revised Romanization";
  return "";
}

/**
 * Contextual gloss: the short meaning of a single word AS USED IN a sentence
 * (its sense in this context), for the Reader's press-and-hold lookup. When
 * `withTranscription` is on and the source is CJK, also returns the word's
 * transcription (pinyin / romaji / romanization).
 */
export async function glossInContext(params: {
  word: string;
  sentence: string;
  sourceLang?: string;
  targetLang?: string;
  withTranscription?: boolean;
}): Promise<{ gloss: string; transcription: string }> {
  const word = params.word.trim().slice(0, 100);
  if (!word) return { gloss: "", transcription: "" };
  const source = langName(params.sourceLang ?? "en");
  const target = langName(params.targetLang ?? "zh");
  const sentence = params.sentence.trim().slice(0, 600) || word;
  const wantTr = Boolean(params.withTranscription) && TRANSCRIBABLE.has(params.sourceLang ?? "en");

  // Same style as the working translateText: the word to translate goes in the
  // USER message; the sentence is only optional context in the system prompt.
  const ctx = sentence && sentence !== word ? ` (For sense, it appears in: "${sentence}".)` : "";

  if (!wantTr) {
    const result = await chatJson({
      system:
        `You are a professional ${source}-to-${target} translator. Reply with the ${target} meaning ` +
        `of the ${source} word or phrase the user sends — a few words, no explanation.${ctx}` +
        scriptNote(params.targetLang ?? "zh") +
        ` Respond as JSON: {"translation": string}.`,
      user: word,
      schema: translationSchema,
      timeoutMs: 30000,
    });
    return { gloss: result.translation.trim(), transcription: "" };
  }

  const trName = transcriptionName(params.sourceLang ?? "en");
  const result = await chatJson({
    system:
      `You are a professional ${source}-to-${target} translator. For the ${source} word or phrase the ` +
      `user sends, reply with "translation" — its ${target} meaning (a few words, no explanation)${ctx} ` +
      `— and "transcription" — its ${trName}.` +
      scriptNote(params.targetLang ?? "zh") +
      ` Respond as JSON: {"translation": string, "transcription": string}.`,
    user: word,
    schema: glossSchema,
    timeoutMs: 30000,
  });
  return { gloss: result.translation.trim(), transcription: (result.transcription ?? "").trim() };
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
      `and do not add commentary.` +
      scriptNote(params.targetLang ?? "zh") +
      ` Respond as JSON: {"translation": string} where ` +
      `translation is only the ${target} rendering of the text.`,
    user: text,
    schema: translationSchema,
    timeoutMs: 60000,
  });
  return { translation: result.translation };
}
