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
import { resolveIdentity, listIdentities, unlinkIdentity } from "../services/authIdentity.js";
import { rateLimit, take } from "../lib/rateLimit.js";

export const authRouter = Router();

// Throttle the abusable auth endpoints (token minting, email sending, credential
// checks) per caller/IP. The /poll and /me lookups are cheap and polled, so they
// stay unlimited.
const authLimiter = rateLimit({ windowMs: 60_000, max: 30, name: "auth" });
const LIMITED = new Set(["/auth/email/start", "/auth/telegram/start", "/auth/google", "/auth/dev"]);
authRouter.use((req, res, next) => {
  if (req.method === "POST" && LIMITED.has(req.path)) return authLimiter(req, res, next);
  next();
});

// Load the resolved account and reply with its profile + linked methods, setting
// the session cookie. Shared by every login route.
async function finishLogin(res: import("express").Response, telegramId: string) {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: {
      telegramId: true,
      firstName: true,
      lastName: true,
      username: true,
      photoUrl: true,
      email: true,
      authVia: true,
      identities: { select: { provider: true, subject: true }, orderBy: { createdAt: "asc" } },
    },
  });
  setSessionCookie(res, telegramId);
  res.json(user ? user : { telegramId, identities: [] });
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
  const { telegramId } = await resolveIdentity({
    provider: "telegram",
    subject: String(data.id),
    profile: {
      firstName: data.first_name ?? null,
      lastName: data.last_name ?? null,
      username: data.username ?? null,
      photoUrl: data.photo_url ?? null,
    },
    authVia: "telegram",
    sessionTelegramId: readSession(req),
  });
  await finishLogin(res, telegramId);
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
  const { telegramId } = await resolveIdentity({
    provider: "telegram",
    subject: bound.telegramId,
    profile: {
      firstName: bound.profile.firstName ?? null,
      lastName: bound.profile.lastName ?? null,
      username: bound.profile.username ?? null,
    },
    authVia: "telegram",
    sessionTelegramId: readSession(req),
  });
  await finishLogin(res, telegramId);
});

// POST /api/auth/google — verify a Google Sign-In ID token, start a session.
authRouter.post("/auth/google", async (req, res) => {
  const credential = String((req.body as { credential?: unknown })?.credential ?? "");
  if (!credential) {
    res.status(400).json({ error: "Missing credential" });
    return;
  }
  try {
    const g = await verifyGoogleIdToken(credential);
    const { telegramId } = await resolveIdentity({
      provider: "google",
      subject: g.email,
      email: g.email,
      profile: { firstName: g.name ?? null, photoUrl: g.picture ?? null },
      authVia: "google",
      sessionTelegramId: readSession(req),
    });
    await finishLogin(res, telegramId);
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
  // Cap links per address so nobody can be email-bombed via this endpoint.
  if (!take(`emailstart:${email}`, 5, 10 * 60_000)) {
    res.status(429).json({ error: "Too many attempts for this email. Try again later." });
    return;
  }
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
  const { telegramId } = await resolveIdentity({
    provider: "email",
    subject: email,
    email,
    authVia: "email",
    sessionTelegramId: readSession(req),
  });
  await finishLogin(res, telegramId);
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
  const subject = parsed.data.telegramId.trim();
  // Route dev sign-in through the identity system so it converges with a real
  // Telegram account of the same id and gets a listed identity.
  const { telegramId } = await resolveIdentity({ provider: "dev", subject, authVia: "dev" });
  await finishLogin(res, telegramId);
});

// GET /api/auth/me — current session profile (+ linked methods), or 401.
authRouter.get("/auth/me", async (req, res) => {
  const telegramId = readSession(req);
  if (!telegramId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: {
      telegramId: true,
      firstName: true,
      lastName: true,
      username: true,
      photoUrl: true,
      email: true,
      authVia: true,
      identities: { select: { provider: true, subject: true }, orderBy: { createdAt: "asc" } },
    },
  });
  res.json(user ?? { telegramId, identities: [] });
});

// DELETE /api/auth/identity/:provider — unlink a sign-in method from the account.
authRouter.delete("/auth/identity/:provider", async (req, res) => {
  const telegramId = readSession(req);
  if (!telegramId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  try {
    await unlinkIdentity(telegramId, req.params.provider);
    res.json({ identities: await listIdentities(telegramId) });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

// POST /api/auth/logout
authRouter.post("/auth/logout", (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});
