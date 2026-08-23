import type { Request, Response, NextFunction } from "express";
import { prisma } from "../services/db.js";
import { readSession } from "./auth.js";
import { env } from "./env.js";

// Billing entitlements + a per-user daily cap on the token-spending endpoints.
// Free users get FREE_DAILY_AI AI actions a day; Pro users are uncapped. During
// the closed beta BETA_ALL_PRO makes everyone Pro, so nobody hits the wall.

const BETA_ALL_PRO = env.BETA_ALL_PRO === "true";
const FREE_DAILY_AI = env.FREE_DAILY_AI;
const FREE_IMPORT_MAX = env.FREE_IMPORT_MAX;
// Accounts that are always Pro regardless of beta flag / billing (owner, comped
// friends). Comma-separated telegramIds in PRO_ALLOWLIST.
const PRO_ALLOWLIST = new Set(
  env.PRO_ALLOWLIST.split(",").map((s) => s.trim()).filter(Boolean),
);

// The caller's identity for quota purposes: the verified session, else the
// telegramId a server-to-server caller sends, else "anon".
function callerId(req: Request): string {
  const s = readSession(req);
  if (s) return s;
  const b = req.body as { telegramId?: unknown } | undefined;
  if (b && typeof b.telegramId === "string" && b.telegramId.trim()) return b.telegramId.trim();
  const q = req.query?.telegramId;
  if (typeof q === "string" && q.trim()) return q.trim();
  return "anon";
}

// A client can ask to be treated as a FREE user for this request (the "test the
// free tier" toggle). It can only ever RESTRICT the caller — never grant Pro — so
// it's safe to honour for anyone.
export function simulatingFree(req: Request): boolean {
  const h = req.headers["x-simulate-free"];
  return h === "1" || h === "true";
}

/** Is this account currently on the Pro plan (uncapped)? */
export async function isPro(telegramId: string): Promise<boolean> {
  if (BETA_ALL_PRO) return true;
  if (!telegramId || telegramId === "anon") return false;
  if (PRO_ALLOWLIST.has(telegramId)) return true;
  const u = await prisma.user.findUnique({ where: { telegramId }, select: { plan: true, planUntil: true } });
  if (!u) return false;
  return u.plan === "pro" && (!u.planUntil || u.planUntil.getTime() > Date.now());
}

// Persistent usage counters (Postgres): a restart or a second instance can't
// reset or multiply a user's allowance — required for real billing. The `key`
// encodes the period + user (+ feature), so each new day/month is a fresh row.
const dayNumber = () => Math.floor(Date.now() / 86_400_000);
const monthNumber = () => new Date().getUTCFullYear() * 12 + new Date().getUTCMonth();
const dailyKey = (id: string) => `d:${id}:${dayNumber()}`;
const monthKey = (id: string, name: string) => `m:${id}:${monthNumber()}:${name}`;
function endOfDay(): Date {
  const d = new Date();
  d.setUTCHours(23, 59, 59, 999);
  return d;
}
function endOfMonth(): Date {
  const n = new Date();
  return new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 1));
}

async function peekCounter(key: string): Promise<number> {
  try {
    const r = await prisma.usageCounter.findUnique({ where: { key }, select: { count: true } });
    return r?.count ?? 0;
  } catch {
    return 0; // never block a request on a counter-read failure
  }
}
async function bumpCounter(key: string, resetAt: Date): Promise<void> {
  try {
    await prisma.usageCounter.upsert({
      where: { key },
      create: { key, count: 1, resetAt },
      update: { count: { increment: 1 } },
    });
  } catch {
    /* ignore counter-write failures */
  }
}
// Drop expired rows so the table can't grow unbounded.
const sweep = setInterval(() => {
  prisma.usageCounter.deleteMany({ where: { resetAt: { lt: new Date() } } }).catch(() => {});
}, 6 * 3_600_000);
sweep.unref?.();

/** Current daily usage without incrementing (for the UI indicator). */
export async function peekUsage(id: string): Promise<{ used: number; limit: number }> {
  return { used: await peekCounter(dailyKey(id)), limit: FREE_DAILY_AI };
}

/** Plan + today's usage, for GET /api/ai/usage. `forceFree` reflects the test toggle. */
export async function usageStatus(id: string, forceFree = false) {
  const pro = !forceFree && (await isPro(id));
  const { used, limit } = await peekUsage(id);
  return { pro, plan: pro ? "pro" : "free", used, limit, remaining: Math.max(0, limit - used), simulatingFree: forceFree };
}

/**
 * Express guard for the daily "generation" pool: Pro passes through untouched;
 * free users consume one of their daily actions, and get a 429 with a machine-
 * readable `code: "ai_quota"` once the cap is hit.
 */
export async function aiQuotaGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = callerId(req);
  // Skip the Pro fast-path when the caller is simulating the free tier (test mode).
  if (!simulatingFree(req) && (await isPro(id))) return next();
  const key = dailyKey(id);
  if ((await peekCounter(key)) >= FREE_DAILY_AI) {
    res.status(429).json({
      error: "You've used today's free AI actions. Upgrade to Pro for unlimited, or come back tomorrow.",
      code: "ai_quota",
      used: FREE_DAILY_AI,
      limit: FREE_DAILY_AI,
    });
    return;
  }
  await bumpCounter(key, endOfDay());
  next();
}

/** Guard factory: free users get `limit` of a named action per month; Pro is uncapped. */
export function monthlyGuard(name: string, limit: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const id = callerId(req);
    if (!simulatingFree(req) && (await isPro(id))) return next();
    const key = monthKey(id, name);
    if ((await peekCounter(key)) >= limit) {
      res.status(429).json({
        error: "You've used this month's free allowance for this feature. Upgrade to Pro for unlimited.",
        code: "quota_monthly",
        feature: name,
        used: limit,
        limit,
      });
      return;
    }
    await bumpCounter(key, endOfMonth());
    next();
  };
}

/**
 * Reject Pro-only request parameters for free users (web-sourced examples, a
 * custom meaning style, or more than one example per word). Pro passes through.
 */
export async function requireProFeature(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = callerId(req);
  if (!simulatingFree(req) && (await isPro(id))) return next();
  const b = (req.body ?? {}) as { exampleSource?: unknown; meaningPrompt?: unknown; exampleCount?: unknown };
  const features: string[] = [];
  if (b.exampleSource === "web") features.push("web_examples");
  if (typeof b.meaningPrompt === "string" && b.meaningPrompt.trim()) features.push("meaning_style");
  if (typeof b.exampleCount === "number" && b.exampleCount > 1) features.push("multi_example");
  if (features.length) {
    res.status(403).json({ error: "That's a Pro feature. Upgrade to use it.", code: "pro_only", features });
    return;
  }
  next();
}

/** How many cards a caller may import at once (free users are capped). */
export async function importAllowance(req: Request): Promise<number> {
  if (!simulatingFree(req) && (await isPro(callerId(req)))) return Infinity;
  return FREE_IMPORT_MAX;
}
