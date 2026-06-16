import { prisma } from "../services/db.js";
import { chatJson } from "../services/llm.js";
import { tutorSchema } from "../lib/schemas.js";

/**
 * Vocabulary Tutor Agent.
 * One LLM call produces the full dictionary entry, then we update the word row.
 * Runs after the Example Search Agent has created the word.
 */
export async function runTutor(params: {
  wordId: string;
  word: string;
}): Promise<void> {
  const result = await chatJson({
    system:
      "You are a bilingual English-Chinese dictionary. For the given English " +
      "word, respond as JSON with: phonetic (IPA, in slashes), partOfSpeech, " +
      "meaningZh (Simplified Chinese definition), collocations (2-3 common " +
      "phrases), synonyms (exactly 2), antonyms (exactly 2). Shape: " +
      '{"phonetic": string, "partOfSpeech": string, "meaningZh": string, ' +
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
