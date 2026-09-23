import { z } from "zod";
import { chatJson, FAST_MODEL } from "./llm.js";
import { translationSchema, glossSchema } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";
import { cedictInventory, isChinese } from "./cedict.js";

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
  // Idioms: a single tapped token can be part of a fixed expression whose meaning is
  // not the literal word meaning ("cake" in "piece of cake"), so prefer the whole
  // expression's sense when the sentence shows one.
  const idiomNote =
    ` If the word forms part of an idiom, phrasal verb or compound in that sentence ` +
    `(e.g. "cake" in "piece of cake", "clear" in "clear-cut"), give the meaning of the WHOLE ` +
    `expression as used there, not the literal single-word meaning.`;
  // Chinese: the dictionary states which senses exist and the model only picks
  // the one the sentence uses, as the add path does (agents/enrich.ts). Left to
  // itself the tap read 了 in 他打了三个小时 as «уже», 只 in 一只猫 as «один» and
  // 过 in 我去过北京 as «проходить» — a particle, a classifier and an aspect
  // marker, each glossed as some other word.
  const inventory = isChinese(params.sourceLang) ? cedictInventory(word, 10, { count: false }) : null;
  if (inventory) {
    return groundedGloss({
      word,
      sentence,
      source,
      target,
      targetLang: params.targetLang ?? "zh",
      inventory,
      trName: wantTr ? transcriptionName(params.sourceLang ?? "zh") : "",
    });
  }

  if (!wantTr) {
    const result = await chatJson({
      system:
        `You are a professional ${source}-to-${target} translator. Reply with the ${target} meaning ` +
        `of the ${source} word or phrase the user sends — a few words, no explanation.${ctx}` +
        idiomNote +
        scriptNote(params.targetLang ?? "zh") +
        ` Respond as JSON: {"translation": string}.`,
      user: word,
      schema: translationSchema,
      timeoutMs: 30000,
      label: "gloss",
      model: FAST_MODEL,
    });
    return { gloss: result.translation.trim(), transcription: "" };
  }

  const trName = transcriptionName(params.sourceLang ?? "en");
  const result = await chatJson({
    system:
      `You are a professional ${source}-to-${target} translator. For the ${source} word or phrase the ` +
      `user sends, reply with "translation" — its ${target} meaning (a few words, no explanation)${ctx} ` +
      `— and "transcription" — its ${trName}.` +
      idiomNote +
      scriptNote(params.targetLang ?? "zh") +
      ` Respond as JSON: {"translation": string, "transcription": string}.`,
    user: word,
    schema: glossSchema,
    timeoutMs: 30000,
    label: "gloss",
    model: FAST_MODEL,
  });
  return { gloss: result.translation.trim(), transcription: (result.transcription ?? "").trim() };
}

/**
 * The contextual gloss for a word the dictionary covers. The sentence, the word
 * and its listed senses all go in the user message, and the model names the
 * sense it picked before glossing it: with the sentence as an aside in the
 * system prompt it glossed 打 in 打了三个小时篮球 as "hit" and 过 in 我去过北京
 * as a completed action. The default model rather than the fast one — choosing
 * among listed senses is exactly what the fast one got wrong, and a grounded tap
 * holds nothing up any more: the dictionary's own line shows at once.
 */
async function groundedGloss(p: {
  word: string;
  sentence: string;
  source: string;
  target: string;
  targetLang: string;
  inventory: string;
  trName: string;
}): Promise<{ gloss: string; transcription: string }> {
  const result = await chatJson({
    system:
      `You gloss one ${p.source} word as it is used in a sentence, for a learner who speaks ${p.target}. ` +
      `The user message gives the sentence, the word, and the word's senses as listed by CC-CEDICT, a ` +
      `${p.source}–English dictionary. First decide which listed sense the word has in this sentence — look at ` +
      `its neighbours: the object it takes, the number before it, the verb it follows. Then write that sense's ` +
      `meaning in ${p.target}, 1–4 words. A particle, a classifier or an aspect marker gets what it does, in ` +
      `brackets (e.g. "(experienced action)", "(counter for animals)"), written in ${p.target}. A light verb whose ` +
      `sense comes from its object (打 + 篮球) gets the meaning it has with that object. Never use a sense that is ` +
      `not listed. The list is in English only because of the dictionary — answer in ${p.target}. ` +
      scriptNote(p.targetLang) +
      (p.trName ? `Also give "transcription": the word's ${p.trName} in the reading you picked. ` : "") +
      `Respond as JSON: {"sense": string, "translation": string${p.trName ? ', "transcription": string' : ""}}, ` +
      `where "sense" is the reading and number you picked, e.g. "guo5 1".`,
    user: `Sentence: ${p.sentence}\nWord: ${p.word}\nSenses:\n${p.inventory}`,
    schema: glossSchema,
    timeoutMs: 30000,
    label: "gloss(grounded)",
  });
  return { gloss: result.translation.trim(), transcription: p.trName ? (result.transcription ?? "").trim() : "" };
}

/**
 * Batch-transcribe many words in ONE call (for the reader's "pinyin over
 * characters" mode). Returns a transcription per input word, in the same order,
 * so the whole passage costs a single request instead of one per word.
 */
export async function transcribeWords(params: { words: string[]; sourceLang?: string }): Promise<string[]> {
  const lang = params.sourceLang ?? "zh";
  if (!TRANSCRIBABLE.has(lang)) return [];
  const words = params.words.map((w) => w.trim()).filter(Boolean).slice(0, 400);
  if (words.length === 0) return [];
  const source = langName(lang);
  const trName = transcriptionName(lang);
  const result = await chatJson({
    system:
      `You transcribe ${source}. The user sends a JSON array of ${source} words/phrases. ` +
      `Output its ${trName} for each item. Respond as JSON {"items": string[]} with EXACTLY the ` +
      `same length and order as the input — transcription only, no translation, no extra text.`,
    user: JSON.stringify(words),
    schema: z.object({ items: z.array(z.string()) }),
    timeoutMs: 45000,
    label: "transcribe.words",
    model: FAST_MODEL,
  });
  return result.items.map((s) => s.trim());
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
    label: "translate.text",
    model: FAST_MODEL,
  });
  return { translation: result.translation };
}
