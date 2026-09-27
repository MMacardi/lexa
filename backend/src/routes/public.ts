import { Router } from "express";
import { z } from "zod";
import { rateLimit } from "../lib/rateLimit.js";
import { asHskVersion, hskGuestDeck } from "../services/hsk.js";
import { checkBodySchema, checkResult, nextCheckScreen } from "../services/placementCheck.js";
import { guestPlan, isoDay } from "../services/studyPlan.js";

// The onboarding before sign-in: a guest answers the questions, taps through the
// check and sees their first deck, and only then makes an account to keep it.
// These routes are all that needs, and they only read the public HSK lists —
// no account, no model call, nothing stored. Exempt from the session and invite
// gates in index.ts; rate-limited per caller instead.

export const publicRouter = Router();

const limiter = rateLimit({ windowMs: 60_000, max: 30, name: "public" });

// POST /api/public/hsk/check — the adaptive check before sign-in: the next
// screen, or `result` once it's over. The signed-in check, with nothing known
// about the guest yet; `native` picks the language of the meaning questions.
publicRouter.post("/public/hsk/check", limiter, (req, res) => {
  const parsed = checkBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const b = parsed.data;
  const version = asHskVersion(b.version) ?? "3.0";
  const screen = nextCheckScreen({ version, target: b.target, claimed: b.claimed, native: b.native, done: b.done });
  res.json({ screen, result: screen ? null : checkResult(version, b.done) });
});

// GET /api/public/hsk/plan?version=3.0&level=4&known=3&examDate=2026-11-22&today=…&daily=12
//   &knew=你好,喜欢&missed=宣布,巨大&fakes=1/5
// — the plan's paces before sign-in: from the check's taps (`knew`/`missed`,
// comma-separated) once it has run, else from the level the guest said they have.
// `fakes`: made-up words claimed / shown, which discount the taps.
const day = z.string().regex(/^20\d\d-\d\d-\d\d$/);
const planQuery = z.object({
  version: z.string().optional(),
  level: z.coerce.number().int().min(1).max(9),
  known: z.coerce.number().int().min(0).max(9).default(0),
  examDate: day.optional(),
  today: day.optional(),
  daily: z.coerce.number().int().min(1).max(100).default(10),
  knew: z.string().max(1000).optional(),
  missed: z.string().max(1000).optional(),
  fakes: z.string().regex(/^\d{1,2}\/\d{1,2}$/).optional(),
});
// A tap list: the check shows ~24 words, so 100 is a ceiling, not a limit anyone meets.
const tapList = (s: string | undefined) => (s ? s.split(",").map((w) => w.trim()).filter(Boolean).slice(0, 100) : []);
publicRouter.get("/public/hsk/plan", limiter, (req, res) => {
  const parsed = planQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const q = parsed.data;
  const version = asHskVersion(q.version) ?? "3.0";
  res.json(
    guestPlan({
      version,
      level: q.level,
      known: q.known,
      answers: { known: tapList(q.knew), unknown: tapList(q.missed) },
      fakes: q.fakes ? { claimed: Number(q.fakes.split("/")[0]), shown: Number(q.fakes.split("/")[1]) } : undefined,
      today: q.today ?? isoDay(new Date()),
      examDate: q.examDate ?? null,
      daily: q.daily,
    }),
  );
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
