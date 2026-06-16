import { Router } from "express";
import { z } from "zod";
import {
  addWordForUser,
  listWordsForUser,
  getWord,
  recordReview,
  deleteWord,
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
  const words = await listWordsForUser(parsed.data.telegramId);
  res.json(words);
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
});

// POST /api/words  { word, telegramId }  -> runs both agents, returns the word
wordsRouter.post("/words", async (req, res) => {
  const parsed = addBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  try {
    const word = await addWordForUser(parsed.data);
    res.status(201).json(word);
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
