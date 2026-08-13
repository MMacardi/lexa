import type { Request, Response, NextFunction } from "express";
import { readSession } from "./auth.js";

// Tiny in-memory fixed-window rate limiter (single backend instance). Guards the
// expensive LLM endpoints against scripted cost-abuse without a new dependency.
// Keyed by the caller's identity (verified session, else the telegramId a
// server-to-server caller like OpenClaw sends, else IP) so one noisy client
// can't exhaust the budget for everyone — and a shared gateway IP still gets
// per-user buckets.

type Bucket = { count: number; resetAt: number };
const buckets = new Map<string, Bucket>();

// Low-level fixed-window check reusable outside Express (e.g. the Telegram bot).
// Returns true if the call is allowed, false if the key is over its limit.
export function take(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  let b = buckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    buckets.set(key, b);
  }
  b.count++;
  return b.count <= max;
}

// Drop expired buckets periodically so the map can't grow unbounded.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
}, 60_000);
sweep.unref?.();

function callerKey(req: Request): string {
  const session = readSession(req);
  if (session) return `s:${session}`;
  const body = req.body as { telegramId?: unknown } | undefined;
  if (body && typeof body.telegramId === "string" && body.telegramId.trim()) {
    return `t:${body.telegramId.trim()}`;
  }
  return `ip:${req.ip ?? "anon"}`;
}

export function rateLimit(opts: { windowMs: number; max: number; name?: string }) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const key = `${opts.name ?? "g"}|${callerKey(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + opts.windowMs };
      buckets.set(key, b);
    }
    b.count++;
    if (b.count > opts.max) {
      res.setHeader("Retry-After", String(Math.ceil((b.resetAt - now) / 1000)));
      res.status(429).json({ error: "Too many requests — slow down and try again shortly." });
      return;
    }
    next();
  };
}
