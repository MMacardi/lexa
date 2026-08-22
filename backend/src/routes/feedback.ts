import { Router } from "express";
import { z } from "zod";
import { readSession } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { deliverFeedback } from "../services/feedback.js";
import type { Request, Response } from "express";

// In-app beta bug/idea report. Anyone signed in (or not) can submit; the payload
// carries a short message plus auto-collected context and an optional screenshot.
export const feedbackRouter = Router();

// A person files a handful of reports at most; this only stops scripted flooding
// (each report can carry a multi-MB screenshot).
const feedbackLimiter = rateLimit({ windowMs: 60_000, max: 6, name: "feedback" });

const errorSchema = z.object({
  message: z.string().max(2000),
  source: z.string().max(80).optional(),
  time: z.string().max(40).optional(),
});

const bodySchema = z.object({
  message: z.string().trim().min(1).max(4000),
  kind: z.enum(["bug", "idea", "other"]).default("bug"),
  url: z.string().max(2000).optional(),
  route: z.string().max(2000).optional(),
  userAgent: z.string().max(500).optional(),
  viewport: z.string().max(40).optional(),
  locale: z.string().max(40).optional(),
  appLang: z.string().max(20).optional(),
  theme: z.string().max(20).optional(),
  errors: z.array(errorSchema).max(30).optional(),
  screenshot: z.string().max(12_000_000).optional(), // base64 data URL, ~8MB decoded
});

feedbackRouter.post("/feedback", feedbackLimiter, async (req: Request, res: Response) => {
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid feedback payload", code: "no_input" });
    return;
  }
  try {
    const result = await deliverFeedback({ ...parsed.data, telegramId: readSession(req) });
    res.json({ ok: true, delivered: result });
  } catch (e) {
    console.error("[feedback] delivery error", e);
    res.status(500).json({ error: "Failed to deliver feedback", code: "server_error" });
  }
});
