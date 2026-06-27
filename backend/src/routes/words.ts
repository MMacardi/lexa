import { Router } from "express";
import { z } from "zod";
import { readSession } from "../lib/auth.js";
import {
  addWordForUser,
  addWordManual,
  listWordsForUser,
  getWord,
  recordReview,
  deleteWord,
  updateWord,
  getStats,
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
  example: z
    .object({
      sentenceEn: z.string().optional(),
      sentenceZh: z.string().optional(),
      sourceName: z.string().optional(),
      sourceUrl: z.string().optional(),
    })
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
    res.status(500).json({ error: (err as Error).message });
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

// POST /api/words/:id/review  -> bump review count + schedule next review
wordsRouter.post("/words/:id/review", async (req, res) => {
  const word = await recordReview(req.params.id);
  if (!word) {
    res.status(404).json({ error: "Word not found" });
    return;
  }
  res.json(word);
});
