import { Router } from "express";
import { z } from "zod";
import { readSession } from "../lib/auth.js";
import { suggestWord } from "../services/suggest.js";
import { previewImportedWords, importWordsForUser } from "../services/importWords.js";
import { getImportJobForUser } from "../services/importWorker.js";
import { importedCardSchema } from "../lib/schemas.js";
import {
  addWordForUser,
  addWordManual,
  listWordsForUser,
  getWord,
  recordReview,
  deleteWord,
  updateWord,
  addExampleToWord,
  explainWord,
  getStats,
  listCollections,
  createCollection,
  renameCollection,
  deleteCollection,
  setWordInCollection,
} from "../services/vocab.js";

// REST API consumed by the Next.js frontend. All word endpoints live here.
export const wordsRouter = Router();

const listQuery = z.object({
  telegramId: z.string().min(1).default("dev-user"),
});

// GET /api/words?telegramId=...  -> the user's saved words (with examples)
wordsRouter.get("/words", async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  // Prefer the logged-in session; fall back to the query param (used by the bot).
  const telegramId = readSession(req) ?? parsed.data.telegramId;
  const words = await listWordsForUser(telegramId);
  res.json(words);
});

// GET /api/stats  -> learning-progress aggregates for the dashboard
wordsRouter.get("/stats", async (req, res) => {
  const telegramId = readSession(req) ?? String(req.query.telegramId ?? "dev-user");
  const stats = await getStats(telegramId);
  res.json(stats);
});

// ---------------- Collections ----------------

// GET /api/collections  -> the user's word sets (with counts)
wordsRouter.get("/collections", async (req, res) => {
  const telegramId = readSession(req) ?? String(req.query.telegramId ?? "dev-user");
  res.json(await listCollections(telegramId));
});

const collectionBody = z.object({
  name: z.string().min(1).max(60),
  telegramId: z.string().min(1).default("dev-user"),
});

// POST /api/collections  -> create a new collection
wordsRouter.post("/collections", async (req, res) => {
  const parsed = collectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const telegramId = readSession(req) ?? parsed.data.telegramId;
  try {
    res.status(201).json(await createCollection(telegramId, parsed.data.name));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// PATCH /api/collections/:id  -> rename
wordsRouter.patch("/collections/:id", async (req, res) => {
  const name = z.string().min(1).max(60).safeParse(req.body?.name);
  if (!name.success) {
    res.status(400).json({ error: "Invalid name" });
    return;
  }
  try {
    res.json(await renameCollection(req.params.id, name.data));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// DELETE /api/collections/:id  -> remove the collection (words kept)
wordsRouter.delete("/collections/:id", async (req, res) => {
  try {
    await deleteCollection(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Collection not found" });
  }
});

// PUT/DELETE /api/collections/:id/words/:wordId  -> add / remove a word
wordsRouter.put("/collections/:id/words/:wordId", async (req, res) => {
  try {
    res.json(await setWordInCollection(req.params.id, req.params.wordId, true));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});
wordsRouter.delete("/collections/:id/words/:wordId", async (req, res) => {
  try {
    res.json(await setWordInCollection(req.params.id, req.params.wordId, false));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET /api/words/:id  -> one word with examples
wordsRouter.get("/words/:id", async (req, res) => {
  const word = await getWord(req.params.id);
  if (!word) {
    res.status(404).json({ error: "Word not found" });
    return;
  }
  res.json(word);
});

const addBody = z.object({
  word: z.string().min(1),
  telegramId: z.string().min(1).default("dev-user"),
  sourceLang: z.string().min(2).default("en"),
  targetLang: z.string().min(2).default("zh"),
  mode: z.enum(["auto", "manual"]).default("auto"),
  // auto-mode example tuning (ignored in manual mode)
  level: z.string().max(4).optional(),
  exampleStyle: z.enum(["news", "casual", "dialogue", "literary"]).optional(),
  // manual-mode fields (ignored in auto mode)
  phonetic: z.string().optional(),
  partOfSpeech: z.string().optional(),
  meaningZh: z.string().optional(),
  collocations: z.array(z.string()).optional(),
  synonyms: z.array(z.string()).optional(),
  antonyms: z.array(z.string()).optional(),
  example: z
    .object({
      sentenceEn: z.string(),
      sentenceZh: z.string().optional(),
      sourceName: z.string().optional(),
      sourceUrl: z.string().optional(),
    })
    .optional(),
});

const suggestBody = z.object({
  word: z.string().min(1),
  sourceLang: z.string().min(2).default("en"),
});

const importPreviewBody = z.object({
  text: z.string().min(1).max(20_000),
  sourceLang: z.string().min(2).default("en"),
  targetLang: z.string().min(2).default("zh"),
});

const importCommitBody = z.object({
  telegramId: z.string().min(1).default("dev-user"),
  sourceLang: z.string().min(2).default("en"),
  targetLang: z.string().min(2).default("zh"),
  items: z.array(importedCardSchema).min(1).max(100),
  collectionIds: z.array(z.string().min(1)).max(20).default([]),
  keepProvidedExtras: z.boolean().default(true),
  generateDetails: z.boolean().default(false),
  generateExamples: z.boolean().default(false),
  level: z.string().max(4).optional(),
  exampleStyle: z.enum(["news", "casual", "dialogue", "literary"]).optional(),
});

// POST /api/words/suggest  -> "did you mean" spell-check for the AI add flow
wordsRouter.post("/words/suggest", async (req, res) => {
  const parsed = suggestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    res.json(await suggestWord(parsed.data.word, parsed.data.sourceLang));
  } catch (err) {
    console.error(err);
    // On any LLM hiccup, fall back to the original word so adding still works.
    res.json({ corrected: parsed.data.word.trim().toLowerCase(), suggestions: [] });
  }
});

// POST /api/words/import/preview -> AI parses pasted notes / .txt into cards.
// No database write happens in this step; the client shows a review checklist.
wordsRouter.post("/words/import/preview", async (req, res) => {
  const parsed = importPreviewBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    res.json({ items: await previewImportedWords(parsed.data) });
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /api/words/import -> create the checked cards in one batch.
wordsRouter.post("/words/import", async (req, res) => {
  const parsed = importCommitBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const telegramId = readSession(req) ?? parsed.data.telegramId;
  try {
    res.status(201).json(await importWordsForUser({ ...parsed.data, telegramId }));
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// GET /api/words/import/:jobId -> progress for the optional background enrichment.
wordsRouter.get("/words/import/:jobId", async (req, res) => {
  const telegramId = readSession(req) ?? String(req.query.telegramId ?? "dev-user");
  const job = await getImportJobForUser(req.params.jobId, telegramId);
  if (!job) {
    res.status(404).json({ error: "Import job not found" });
    return;
  }
  res.json(job);
});

// POST /api/words  -> auto (runs both agents) or manual (uses provided fields)
wordsRouter.post("/words", async (req, res) => {
  const parsed = addBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  // Logged-in session wins over the body telegramId (the bot has no session).
  const telegramId = readSession(req) ?? parsed.data.telegramId;
  const input = { ...parsed.data, telegramId };
  try {
    const word =
      input.mode === "manual"
        ? await addWordManual(input)
        : await addWordForUser(input);
    res.status(201).json(word);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

const editBody = z.object({
  word: z.string().min(1).optional(),
  phonetic: z.string().nullable().optional(),
  partOfSpeech: z.string().nullable().optional(),
  meaningZh: z.string().nullable().optional(),
  collocations: z.array(z.string()).optional(),
  synonyms: z.array(z.string()).optional(),
  antonyms: z.array(z.string()).optional(),
  sourceLang: z.string().optional(),
  targetLang: z.string().optional(),
  examples: z
    .array(
      z.object({
        id: z.string().optional(),
        sentenceEn: z.string(),
        sentenceZh: z.string().optional(),
        sourceName: z.string().optional(),
      }),
    )
    .max(20)
    .optional(),
});

// PATCH /api/words/:id  -> edit a word's fields (and its first example)
wordsRouter.patch("/words/:id", async (req, res) => {
  const parsed = editBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const word = await updateWord(req.params.id, parsed.data);
    res.json(word);
  } catch (err) {
    console.error(err);
    res.status(400).json({ error: (err as Error).message });
  }
});

// DELETE /api/words/:id  -> remove a word (examples cascade)
wordsRouter.delete("/words/:id", async (req, res) => {
  try {
    await deleteWord(req.params.id);
    res.json({ ok: true });
  } catch {
    res.status(404).json({ error: "Word not found" });
  }
});

// POST /api/words/:id/review  -> advance the interval ladder ({known:true}) or
// reset it so the word returns soon ({known:false}, i.e. "still learning").
wordsRouter.post("/words/:id/review", async (req, res) => {
  const known = req.body?.known !== false;
  const word = await recordReview(req.params.id, known);
  if (!word) {
    res.status(404).json({ error: "Word not found" });
    return;
  }
  res.json(word);
});

// POST /api/words/:id/example -> fetch a fresh AI example (add or regenerate).
const exampleBody = z.object({
  exampleStyle: z.enum(["news", "casual", "dialogue", "literary"]).optional(),
  level: z.string().max(4).optional(),
  replace: z.boolean().default(false),
});
wordsRouter.post("/words/:id/example", async (req, res) => {
  const parsed = exampleBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    res.json(await addExampleToWord(req.params.id, parsed.data));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

// POST /api/words/:id/explain -> on-demand AI explanation (nuance, usage, etc.)
wordsRouter.post("/words/:id/explain", async (req, res) => {
  try {
    res.json({ explanation: await explainWord(req.params.id) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});
