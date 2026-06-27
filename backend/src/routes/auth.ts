import { Router } from "express";
import { z } from "zod";
import { env } from "../lib/env.js";
import { prisma } from "../services/db.js";
import {
  verifyTelegramAuth,
  setSessionCookie,
  clearSessionCookie,
  readSession,
  type TelegramAuthData,
} from "../lib/auth.js";

export const authRouter = Router();

async function ensureUser(telegramId: string) {
  return prisma.user.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
  });
}

// POST /api/auth/telegram — verify the Telegram Login Widget payload, start a session.
authRouter.post("/auth/telegram", async (req, res) => {
  const data = req.body as TelegramAuthData;
  if (!data?.id || !data?.hash) {
    res.status(400).json({ error: "Invalid Telegram payload" });
    return;
  }
  if (!verifyTelegramAuth(data, env.TELEGRAM_BOT_TOKEN)) {
    res.status(401).json({ error: "Telegram verification failed" });
    return;
  }
  const telegramId = String(data.id);
  await ensureUser(telegramId);
  setSessionCookie(res, telegramId);
  res.json({
    telegramId,
    username: data.username ?? null,
    firstName: data.first_name ?? null,
    photoUrl: data.photo_url ?? null,
  });
});

// POST /api/auth/dev — local-only shortcut to log in without the Telegram widget
// (the widget needs a public domain). Disabled unless ALLOW_DEV_LOGIN=true.
const devBody = z.object({ telegramId: z.string().min(1) });
authRouter.post("/auth/dev", async (req, res) => {
  if (env.ALLOW_DEV_LOGIN !== "true") {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const parsed = devBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const telegramId = parsed.data.telegramId.trim();
  await ensureUser(telegramId);
  setSessionCookie(res, telegramId);
  res.json({ telegramId, dev: true });
});

// GET /api/auth/me — current session, or 401.
authRouter.get("/auth/me", (req, res) => {
  const telegramId = readSession(req);
  if (!telegramId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ telegramId });
});

// POST /api/auth/logout
authRouter.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
