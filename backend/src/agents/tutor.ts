import { prisma } from "../services/db.js";
import { chatJson } from "../services/llm.js";
import { tutorSchema } from "../lib/schemas.js";
import { langName, scriptNote } from "../lib/langs.js";
import { localPhonetic } from "../lib/transcribe.js";

/**
 * Vocabulary Tutor Agent.
 * One LLM call produces the full dictionary entry, then we update the word row.
 * Runs after the Example Search Agent has created the word.
 */
export async function runTutor(params: {
  wordId: string;
  word: string;
  sourceLang?: string;
  targetLang?: string;
  /** Keep a translation the user reviewed during import instead of replacing it. */
  preserveMeaning?: boolean;
  /** Aim synonyms at a target CEFR level (exam prep); "" = the most natural ones. */
  synonymLevel?: string;
}): Promise<void> {
  const sourceName = langName(params.sourceLang ?? "en");
  const targetName = langName(params.targetLang ?? "zh");
  const synClause = params.synonymLevel
    ? `synonyms (up to 3 genuine ${sourceName} synonyms, chosen at roughly CEFR ${params.synonymLevel} — ` +
      `richer, more advanced alternatives suitable for exam prep like IELTS, but still TRUE synonyms)`
    : `synonyms (up to 3 genuine ${sourceName} synonyms)`;
  const result = await chatJson({
    system:
      `You are a ${sourceName}-to-${targetName} dictionary. For the given ` +
      `${sourceName} word, respond as JSON with: phonetic (pronunciation, e.g. ` +
      "IPA in slashes), partOfSpeech, meaningZh, " +
      `collocations (2-3 common ${sourceName} phrases), ${synClause}, antonyms (up to 3 genuine ` +
      `${sourceName} antonyms). CRITICAL: "meaningZh" is only a field NAME — its value ` +
      `MUST be written in ${targetName}, NOT in ${sourceName} ` +
      `(even when the word itself is ${sourceName}). ` +
      `Make "meaningZh" a CONCISE translation: the direct ${targetName} equivalent, ` +
      `usually 1-4 words (e.g. for a pronoun just the pronoun, for a country just its ` +
      `name). Add a short parenthetical clarifier ONLY when the word is ambiguous or has ` +
      `no single equivalent. Do NOT write a long dictionary-style definition. ` +
      `synonyms and antonyms MUST be written in ` +
      `${sourceName} — the SAME language as the word — never in ${targetName}. ` +
      scriptNote(params.sourceLang ?? "en") +
      scriptNote(params.targetLang ?? "zh") +
      `Only include TRUE synonyms/antonyms. Many words (especially nouns and abstract ` +
      `concepts) have no real antonyms — in that case return an empty array rather ` +
      `than inventing a loose or merely-contrasting word. Quality over quantity; an empty list is fine. ` +
      'Shape: {"phonetic": string, "partOfSpeech": string, "meaningZh": string, ' +
      '"collocations": string[], "synonyms": string[], "antonyms": string[]}.',
    user: params.word,
    schema: tutorSchema,
    label: "tutor(dictionary)",
  });

  // Chinese/Korean: use deterministic local pinyin/romanization for the phonetic
  // (the model sometimes returns IPA for Chinese, e.g. 中国 → /tʂʊŋ.kwǒ/).
  const localPh = await localPhonetic(params.word, params.sourceLang);

  await prisma.word.update({
    where: { id: params.wordId },
    data: {
      phonetic: localPh ?? result.phonetic,
      partOfSpeech: result.partOfSpeech,
      ...(params.preserveMeaning ? {} : { meaningZh: result.meaningZh }),
      collocations: result.collocations,
      synonyms: result.synonyms,
      antonyms: result.antonyms,
    },
  });
}
