import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import { Router } from "express";
import type { Request, Response } from "express";
import { env } from "../lib/env.js";
import { rateLimit } from "../lib/rateLimit.js";

// Pre-login shared beta gate. A guest enters the single BETA_KEY before choosing
// TG/email login; on success we set a signed httpOnly "beta" cookie. finishLogin
// (auth.ts) reads that cookie and marks the new account invited. This runs BEFORE
// any session exists, so both endpoints are exempt from requireIdentity and
// requireInvited in index.ts. Single-use invite codes (/invites/redeem) remain the
// alternative path for testers handed a personal code.
export const betaRouter = Router();

export const BETA_COOKIE = "beta";

// Brute-force guard: a real guest types the code once or twice.
const unlockLimiter = rateLimit({ windowMs: 60_000, max: 10, name: "beta" });

function signBeta(): string {
  return jwt.sign({ beta: 1 }, env.JWT_SECRET, { expiresIn: "30d" });
}

/** Is a valid, unexpired beta cookie present on this request? */
export function readBetaCookie(req: Request): boolean {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[BETA_COOKIE];
  if (!token) return false;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { beta?: number };
    return payload.beta === 1;
  } catch {
    return false;
  }
}

function setBetaCookie(res: Response): void {
  const secure = env.COOKIE_SECURE === "true";
  res.cookie(BETA_COOKIE, signBeta(), {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

// POST /api/beta/unlock — verify the shared code, set the beta cookie.
betaRouter.post("/beta/unlock", unlockLimiter, (req: Request, res: Response) => {
  if (!env.BETA_KEY) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const code = String((req.body as { code?: unknown })?.code ?? "").trim().toUpperCase();
  const expected = env.BETA_KEY.trim().toUpperCase();
  // Constant-time compare so the code can't be guessed byte-by-byte from timing.
  const a = Buffer.from(code);
  const b = Buffer.from(expected);
  const ok = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!ok) {
    res.status(400).json({ error: "Invalid beta code", code: "beta_invalid" });
    return;
  }
  setBetaCookie(res);
  res.json({ ok: true });
});

// GET /api/beta/status — is the shared gate on, and has this guest already
// unlocked? Lets the frontend skip the screen entirely when BETA_KEY is empty
// (guests go straight to login; the post-login personal-code gate still applies),
// and skip re-prompting a returning visitor whose beta cookie is still valid.
betaRouter.get("/beta/status", (req: Request, res: Response) => {
  res.json({ enabled: Boolean(env.BETA_KEY), unlocked: readBetaCookie(req) });
});
