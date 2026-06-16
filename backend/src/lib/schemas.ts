import { z } from "zod";

// LLM step 1 of the Example Search Agent: pick the best sentence and tell us
// which excerpt it came from, so we can attribute the correct source URL.
export const sentenceSelectionSchema = z.object({
  sentence: z.string().min(1),
  sourceIndex: z.number().int().nonnegative(),
});
export type SentenceSelection = z.infer<typeof sentenceSelectionSchema>;

// LLM step 2: the Chinese translation of the chosen sentence.
export const translationSchema = z.object({
  translation: z.string().min(1),
});
export type Translation = z.infer<typeof translationSchema>;

// Vocabulary Tutor Agent: the full dictionary entry for a word.
export const tutorSchema = z.object({
  phonetic: z.string(),
  partOfSpeech: z.string(),
  meaningZh: z.string(),
  collocations: z.array(z.string()),
  synonyms: z.array(z.string()),
  antonyms: z.array(z.string()),
});
export type TutorResult = z.infer<typeof tutorSchema>;
