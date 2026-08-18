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
import { createLoginToken, consumeLoginToken } from "../services/loginLink.js";
import { verifyGoogleIdToken } from "../services/googleAuth.js";
import { createEmailToken, consumeEmailToken } from "../services/emailLink.js";
import { sendEmail, emailConfigured } from "../services/mailer.js";

export const authRouter = Router();

async function ensureUser(telegramId: string) {
  return prisma.user.upsert({
    where: { telegramId },
    create: { telegramId },
    update: {},
  });
}

function publicProfile(u: {
  telegramId: string;
  firstName: string | null;
  lastName: string | null;
  username: string | null;
  photoUrl: string | null;
  email: string | null;
  authVia: string;
}) {
  return {
    telegramId: u.telegramId,
    firstName: u.firstName,
    lastName: u.lastName,
    username: u.username,
    photoUrl: u.photoUrl,
    email: u.email,
    authVia: u.authVia,
  };
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
  const profile = {
    firstName: data.first_name ?? null,
    lastName: data.last_name ?? null,
    username: data.username ?? null,
    photoUrl: data.photo_url ?? null,
    authVia: "telegram",
  };
  const user = await prisma.user.upsert({
    where: { telegramId },
    create: { telegramId, ...profile },
    update: profile,
  });
  setSessionCookie(res, telegramId);
  res.json(publicProfile(user));
});

// POST /api/auth/telegram/start — begin "login via the bot". Returns a one-time
// token; the web opens t.me/<bot>?start=login_<token> and then polls /poll.
authRouter.post("/auth/telegram/start", (_req, res) => {
  res.json({ token: createLoginToken() });
});

// GET /api/auth/telegram/poll?token=… — has the bot confirmed this token yet?
// 200 + profile (and a session cookie) once confirmed; 204 while still pending.
authRouter.get("/auth/telegram/poll", async (req, res) => {
  const token = String(req.query.token ?? "");
  const bound = token ? consumeLoginToken(token) : null;
  if (!bound) {
    res.status(204).end();
    return;
  }
  const profile = {
    firstName: bound.profile.firstName ?? null,
    lastName: bound.profile.lastName ?? null,
    username: bound.profile.username ?? null,
    authVia: "telegram",
  };
  const user = await prisma.user.upsert({
    where: { telegramId: bound.telegramId },
    create: { telegramId: bound.telegramId, ...profile },
    update: profile,
  });
  setSessionCookie(res, bound.telegramId);
  res.json(publicProfile(user));
});

// Email-based identities (Google + magic-link) share one account per email: the
// subject is `email:<addr>`, so signing in with Google or a link for the same
// address lands on the same account.
async function upsertEmailIdentity(
  email: string,
  data: { firstName?: string | null; photoUrl?: string | null; authVia: string },
) {
  const subject = `email:${email.toLowerCase()}`;
  const profile = {
    email: email.toLowerCase(),
    firstName: data.firstName ?? null,
    photoUrl: data.photoUrl ?? null,
    authVia: data.authVia,
  };
  return prisma.user.upsert({
    where: { telegramId: subject },
    create: { telegramId: subject, ...profile },
    update: profile,
  });
}

// POST /api/auth/google — verify a Google Sign-In ID token, start a session.
authRouter.post("/auth/google", async (req, res) => {
  const credential = String((req.body as { credential?: unknown })?.credential ?? "");
  if (!credential) {
    res.status(400).json({ error: "Missing credential" });
    return;
  }
  try {
    const g = await verifyGoogleIdToken(credential);
    const user = await upsertEmailIdentity(g.email, {
      firstName: g.name ?? null,
      photoUrl: g.picture ?? null,
      authVia: "google",
    });
    setSessionCookie(res, user.telegramId);
    res.json(publicProfile(user));
  } catch (err) {
    res.status(401).json({ error: (err as Error).message });
  }
});

// POST /api/auth/email/start — email a magic sign-in link.
const emailBody = z.object({ email: z.string().email().max(200) });
authRouter.post("/auth/email/start", async (req, res) => {
  const parsed = emailBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid email" });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  const token = createEmailToken(email);
  const link = `${env.FRONTEND_URL.replace(/\/+$/, "")}/login/verify?token=${token}`;
  const text = `Sign in to Lexa:\n${link}\n\nThis link expires in 15 minutes. If you didn't request it, ignore this email.`;
  const html =
    `<p>Tap to sign in to <b>Lexa</b>:</p>` +
    `<p><a href="${link}" style="display:inline-block;background:#7c9885;color:#fff;padding:10px 18px;border-radius:999px;text-decoration:none;font-weight:600">Sign in to Lexa</a></p>` +
    `<p style="color:#8a8273;font-size:13px">This link expires in 15 minutes. If you didn't request it, ignore this email.</p>`;
  try {
    await sendEmail(email, "Your Lexa sign-in link", html, text);
  } catch (err) {
    console.error("sendEmail failed:", err);
    res.status(502).json({ error: "Couldn't send the email. Try again." });
    return;
  }
  // In dev (no SMTP), surface the link so the flow is testable without a mailbox.
  const devLink = !emailConfigured() && env.ALLOW_DEV_LOGIN === "true" ? link : undefined;
  res.json({ sent: true, devLink });
});

// GET /api/auth/email/verify?token=… — consume a magic-link token, start session.
authRouter.get("/auth/email/verify", async (req, res) => {
  const email = consumeEmailToken(String(req.query.token ?? ""));
  if (!email) {
    res.status(400).json({ error: "This sign-in link is invalid or has expired." });
    return;
  }
  const user = await upsertEmailIdentity(email, { authVia: "email" });
  setSessionCookie(res, user.telegramId);
  res.json(publicProfile(user));
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

// GET /api/auth/me — current session profile, or 401.
authRouter.get("/auth/me", async (req, res) => {
  const telegramId = readSession(req);
  if (!telegramId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = await prisma.user.findUnique({ where: { telegramId } });
  res.json(user ? publicProfile(user) : { telegramId });
});

// POST /api/auth/logout
authRouter.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
