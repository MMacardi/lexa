import type { Request, Response, NextFunction } from "express";
import { prisma } from "../services/db.js";
import { readSession } from "./auth.js";
import { env } from "./env.js";

// Billing entitlements + a per-user daily cap on the token-spending endpoints.
// Free users get FREE_DAILY_AI AI actions a day; Pro users are uncapped. During
// the closed beta BETA_ALL_PRO makes everyone Pro, so nobody hits the wall.

const BETA_ALL_PRO = env.BETA_ALL_PRO === "true";
const FREE_DAILY_AI = env.FREE_DAILY_AI;
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

/** Plan + today's usage, for GET /api/ai/usage. */
export async function usageStatus(id: string) {
  const pro = await isPro(id);
  const { used, limit } = peekUsage(id);
  return { pro, plan: pro ? "pro" : "free", used, limit, remaining: Math.max(0, limit - used) };
}

/**
 * Express guard for the expensive LLM endpoints: Pro passes through untouched;
 * free users consume one of their daily actions, and get a 429 with a machine-
 * readable `code: "ai_quota"` once the cap is hit.
 */
export async function aiQuotaGuard(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = callerId(req);
  if (await isPro(id)) return next();
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
