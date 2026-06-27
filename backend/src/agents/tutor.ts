import { prisma } from "../services/db.js";
import { chatJson } from "../services/llm.js";
import { tutorSchema } from "../lib/schemas.js";
import { langName } from "../lib/langs.js";

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
}): Promise<void> {
  const sourceName = langName(params.sourceLang ?? "en");
  const targetName = langName(params.targetLang ?? "zh");
  const result = await chatJson({
    system:
      `You are a ${sourceName}-to-${targetName} dictionary. For the given ` +
      `${sourceName} word, respond as JSON with: phonetic (pronunciation, e.g. ` +
      "IPA in slashes), partOfSpeech, meaningZh (the definition written in " +
      `${targetName}), collocations (2-3 common ${sourceName} phrases), synonyms ` +
      `(exactly 2 ${sourceName} words), antonyms (exactly 2 ${sourceName} words). ` +
      'Shape: {"phonetic": string, "partOfSpeech": string, "meaningZh": string, ' +
      '"collocations": string[], "synonyms": string[], "antonyms": string[]}.',
    user: params.word,
    schema: tutorSchema,
  });

  await prisma.word.update({
    where: { id: params.wordId },
    data: {
      phonetic: result.phonetic,
      partOfSpeech: result.partOfSpeech,
      meaningZh: result.meaningZh,
      collocations: result.collocations,
      synonyms: result.synonyms,
      antonyms: result.antonyms,
    },
  });
}
