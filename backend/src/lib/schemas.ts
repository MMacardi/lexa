import { z } from "zod";

// LLM step 1 of the Example Search Agent: pick the best sentence and tell us
// which excerpt it came from, so we can attribute the correct source URL.
export const sentenceSelectionSchema = z.object({
  sentence: z.string().min(1),
  sourceIndex: z.number().int(), // -1 when the model composed the sentence itself
  composed: z.boolean().default(false),
});
export type SentenceSelection = z.infer<typeof sentenceSelectionSchema>;

// LLM step 2: the Chinese translation of the chosen sentence.
export const translationSchema = z.object({
  translation: z.string().min(1),
});
export type Translation = z.infer<typeof translationSchema>;

// A single composed example sentence — used as a fallback when the web search
// yields nothing usable in the target script/language.
export const exampleSentenceSchema = z.object({
  sentence: z.string().min(1),
});

// Global tutor chat (not tied to a card): a reply plus optional vocabulary the
// learner wants saved / that the tutor suggests to study.
export const tutorChatSchema = z.object({
  answer: z.string().min(1),
  addWords: z.array(z.string()).default([]),
});
export type TutorChatResult = z.infer<typeof tutorChatSchema>;

// Actionable tutor chat: a prose reply plus optional suggested edits to the card
// (synonyms/antonyms to add), which the UI offers as one-tap actions.
export const wordChatSchema = z.object({
  answer: z.string().min(1),
  addSynonyms: z.array(z.string()).default([]),
  addAntonyms: z.array(z.string()).default([]),
  // Brand-new vocabulary the learner asked to save as its own card(s).
  addWords: z.array(z.string()).default([]),
});
export type WordChatResult = z.infer<typeof wordChatSchema>;

// On-demand "explain this word" for the word page: written in the learner's own
// language, covering nuance, usage, synonym differences and common mistakes.
export const explanationSchema = z.object({
  explanation: z.string().min(1),
});

// Spell-check / "did you mean" for the AI add flow: the most likely intended
// spelling plus a couple of alternative candidates.
export const suggestSchema = z.object({
  // Tolerate an empty/absent correction (common for CJK, where there's nothing
  // to "spell-fix") — suggestWord falls back to the input word.
  corrected: z.string().default(""),
  suggestions: z.array(z.string()).default([]),
  detectedLang: z.string().optional(),
});
export type SuggestResult = z.infer<typeof suggestSchema>;

// The import assistant turns loose text (or a .txt file) into reviewable card
// rows. The user sees every row before anything is written to the database.
// Tolerate the model returning null (not just missing) for optional fields.
const nullableStr = z
  .string()
  .max(1200)
  .nullish()
  .transform((v) => v ?? "");

export const importedCardSchema = z.object({
  word: z.string().min(1).max(100),
  meaning: z
    .string()
    .max(500)
    .nullish()
    .transform((v) => v ?? ""),
  example: nullableStr,
  exampleTranslation: nullableStr,
  synonyms: z
    .array(z.string().max(100))
    .max(8)
    .nullish()
    .transform((v) => v ?? []),
});
export type ImportedCard = z.infer<typeof importedCardSchema>;

export const importPreviewSchema = z.object({
  // May be empty (e.g. blank input) — the service turns that into a friendly error
  // instead of a raw validation crash.
  items: z.array(importedCardSchema).max(100).default([]),
});
export type ImportPreview = z.infer<typeof importPreviewSchema>;

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
