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

// In-memory daily counters (single instance): telegramId -> {day, count}. Reset
// at the UTC day boundary; a restart just gives everyone a fresh count (harmless).
const daily = new Map<string, { day: number; count: number }>();
const dayNumber = () => Math.floor(Date.now() / 86_400_000);
function bucket(id: string): { day: number; count: number } {
  const day = dayNumber();
  let b = daily.get(id);
  if (!b || b.day !== day) {
    b = { day, count: 0 };
    daily.set(id, b);
  }
  return b;
}
// Drop stale day-buckets so the map can't grow unbounded.
const sweep = setInterval(() => {
  const day = dayNumber();
  for (const [k, b] of daily) if (b.day !== day) daily.delete(k);
}, 3_600_000);
sweep.unref?.();

/** Current usage without incrementing (for the UI indicator). */
export function peekUsage(id: string): { used: number; limit: number } {
  return { used: bucket(id).count, limit: FREE_DAILY_AI };
}

/** Plan + today's usage, for GET /api/ai/usage. `forceFree` reflects the test toggle. */
export async function usageStatus(id: string, forceFree = false) {
  const pro = !forceFree && (await isPro(id));
  const { used, limit } = peekUsage(id);
  return { pro, plan: pro ? "pro" : "free", used, limit, remaining: Math.max(0, limit - used), simulatingFree: forceFree };
}

/**
 * Express guard for the expensive LLM endpoints: Pro passes through untouched;
 * free users consume one of their daily actions, and get a 429 with a machine-
 * readable `code: "ai_quota"` once the cap is hit.
 */
export async function aiQuotaGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = callerId(req);
  // Skip the Pro fast-path when the caller is simulating the free tier (test mode).
  if (!simulatingFree(req) && (await isPro(id))) return next();
  const b = bucket(id);
  if (b.count >= FREE_DAILY_AI) {
    res.status(429).json({
      error: "You've used today's free AI actions. Upgrade to Pro for unlimited, or come back tomorrow.",
      code: "ai_quota",
      used: b.count,
      limit: FREE_DAILY_AI,
    });
    return;
  }
  b.count++;
  next();
}

// --- Monthly quotas for the pricier one-off actions (reader text generation, OCR).
// Same in-memory pattern as the daily pool, keyed by the UTC month. ---
const monthly = new Map<string, { month: number; counts: Record<string, number> }>();
const monthNumber = () => new Date().getUTCFullYear() * 12 + new Date().getUTCMonth();
const monthSweep = setInterval(() => {
  const m = monthNumber();
  for (const [k, b] of monthly) if (b.month !== m) monthly.delete(k);
}, 6 * 3_600_000);
monthSweep.unref?.();

/** Guard factory: free users get `limit` of a named action per month; Pro is uncapped. */
export function monthlyGuard(name: string, limit: number) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const id = callerId(req);
    if (!simulatingFree(req) && (await isPro(id))) return next();
    const m = monthNumber();
    let b = monthly.get(id);
    if (!b || b.month !== m) {
      b = { month: m, counts: {} };
      monthly.set(id, b);
    }
    const used = b.counts[name] ?? 0;
    if (used >= limit) {
      res.status(429).json({
        error: "You've used this month's free allowance for this feature. Upgrade to Pro for unlimited.",
        code: "quota_monthly",
        feature: name,
        used,
        limit,
      });
      return;
    }
    b.counts[name] = used + 1;
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
