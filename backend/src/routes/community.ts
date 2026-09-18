import { Router } from "express";
import { z } from "zod";
import { callerId } from "../lib/entitlements.js";
import { rateLimit } from "../lib/rateLimit.js";
import { listPublicDecks, listFriendDecks, findByCode, getDeck, copyFromDeck } from "../services/community.js";
import { REPORT_REASONS, reportDeck } from "../services/moderation.js";

// Community tab + shared decks. Behind the same session + invite gate as every
// /api route; identity is the session (callerId), never a body/query telegramId.
export const communityRouter = Router();

function sendError(res: import("express").Response, err: unknown) {
  const code = (err as { code?: string }).code;
  res.status(code === "no_deck" ? 404 : 400).json({ error: (err as Error).message, code });
}

const langCode = z.string().min(2).max(10).optional();
const listQuery = z.object({ q: z.string().max(60).optional(), lang: langCode, target: langCode });

// GET /api/community/decks?q=&lang=&target= -> public decks, most popular this week first
communityRouter.get("/community/decks", async (req, res) => {
  const parsed = listQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid filters" });
    return;
  }
  try {
    res.json(await listPublicDecks(callerId(req), parsed.data));
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/community/friends -> decks my friends shared with friends or publicly
communityRouter.get("/community/friends", async (req, res) => {
  try {
    res.json(await listFriendDecks(callerId(req)));
  } catch (err) {
    sendError(res, err);
  }
});

// Share codes are short, so throttle guessing.
const codeLimiter = rateLimit({ windowMs: 60_000, max: 20, name: "deck-code" });

// GET /api/community/code/:code -> { id } of the deck behind a share code
communityRouter.get("/community/code/:code", (req, res, next) => codeLimiter(req, res, next), async (req, res) => {
  try {
    res.json(await findByCode(String(req.params.code)));
  } catch (err) {
    sendError(res, err);
  }
});

// GET /api/community/decks/:id?code= -> read-only deck view
communityRouter.get("/community/decks/:id", async (req, res) => {
  const code = typeof req.query.code === "string" ? req.query.code : undefined;
  try {
    res.json(await getDeck(callerId(req), String(req.params.id), code));
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/community/decks/:id/copy { code?, wordIds? } -> take the whole deck or some words
const copyBody = z.object({
  code: z.string().max(16).optional(),
  wordIds: z.array(z.string().min(1)).max(500).optional(),
});
communityRouter.post("/community/decks/:id/copy", async (req, res) => {
  const parsed = copyBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request" });
    return;
  }
  try {
    res.json(await copyFromDeck(callerId(req), String(req.params.id), parsed.data));
  } catch (err) {
    sendError(res, err);
  }
});

// POST /api/community/decks/:id/report { reason, note?, code? } -> flag a deck for the admin
const reportLimiter = rateLimit({ windowMs: 60 * 60_000, max: 10, name: "deck-report" });
const reportBody = z.object({
  reason: z.enum(REPORT_REASONS),
  note: z.string().max(500).optional(),
  code: z.string().max(16).optional(),
});
communityRouter.post("/community/decks/:id/report", (req, res, next) => reportLimiter(req, res, next), async (req, res) => {
  const parsed = reportBody.safeParse(req.body ?? {});
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid report" });
    return;
  }
  try {
    res.json(await reportDeck(callerId(req), String(req.params.id), parsed.data));
  } catch (err) {
    sendError(res, err);
  }
});
