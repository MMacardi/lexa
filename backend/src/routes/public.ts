import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "../lib/rateLimit.js";
import { asHskVersion, hskCheckWords, hskGuestDeck } from "../services/hsk.js";

// The onboarding before sign-in: a guest answers the questions, taps through the
// check and sees their first deck, and only then makes an account to keep it.
// These two routes are all that needs, and they only read the public HSK lists —
// no account, no model call, nothing stored. Exempt from the session and invite
// gates in index.ts; rate-limited per caller instead.

export const publicRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 30, name: "public" });

// GET /api/public/hsk/check?version=3.0&level=4&size=24 — the same sample the
// signed-in check uses.
publicRouter.get("/public/hsk/check", limiter, (req, res) => {
  const version = asHskVersion(req.query.version) ?? "3.0";
  const level = Number(req.query.level) || 4;
  const size = Math.min(Math.max(Number(req.query.size) || 24, 6), 60);
  res.json({ version, level, words: hskCheckWords(version, level, size) });
});

// POST /api/public/hsk/deck — the first deck from the guest's own taps: the words
// they didn't know first, then the target level, then downwards, minus the ones
// they knew. The signed-in gap deck, with the answers passed in instead of read.
const deckBody = z.object({
  version: z.string().optional(),
  level: z.number().int().min(1).max(9),
  known: z.array(z.string().max(20)).max(100).default([]),
  unknown: z.array(z.string().max(20)).max(100).default([]),
  size: z.number().int().min(1).max(40).default(20),
});
publicRouter.post("/public/hsk/deck", limiter, (req, res) => {
  const parsed = deckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { level, known, unknown, size } = parsed.data;
  const version = asHskVersion(parsed.data.version) ?? "3.0";
  res.json({ version, level, words: hskGuestDeck(version, level, known, unknown, size) });
});
