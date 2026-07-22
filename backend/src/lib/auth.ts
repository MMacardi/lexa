import crypto from "node:crypto";
import jwt from "jsonwebtoken";
import type { Request, Response } from "express";
import { env } from "./env.js";

export const SESSION_COOKIE = "session";

export interface TelegramAuthData {
  id: number | string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number | string;
  hash: string;
}

/**
 * Verify a Telegram Login Widget payload.
 * https://core.telegram.org/widgets/login#checking-authorization
 * secret = SHA256(bot_token); HMAC-SHA256 of the sorted "k=v\n" data must equal hash.
 */
export function verifyTelegramAuth(data: TelegramAuthData, botToken: string): boolean {
  if (!botToken) return false;
  const { hash, ...fields } = data;
  const checkString = Object.keys(fields)
    .sort()
    .map((k) => `${k}=${(fields as Record<string, unknown>)[k]}`)
    .join("\n");
  const secret = crypto.createHash("sha256").update(botToken).digest();
  const hmac = crypto.createHmac("sha256", secret).update(checkString).digest("hex");
  if (hmac !== hash) return false;
  const authDate = Number(data.auth_date);
  // reject logins older than 1 day
  if (!authDate || Date.now() / 1000 - authDate > 86400) return false;
  return true;
}

export function createSessionToken(telegramId: string): string {
  return jwt.sign({ tid: telegramId }, env.JWT_SECRET, { expiresIn: "30d" });
}

/** Read the telegram id from the session cookie, or null. */
export function readSession(req: Request): string | null {
  const token = (req as Request & { cookies?: Record<string, string> }).cookies?.[SESSION_COOKIE];
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.JWT_SECRET) as { tid?: string };
    return payload.tid ?? null;
  } catch {
    return null;
  }
}

/** Set the session cookie. Cross-site (Vercel -> Railway) needs SameSite=None+Secure. */
export function setSessionCookie(res: Response, telegramId: string): void {
  const secure = env.COOKIE_SECURE === "true";
  res.cookie(SESSION_COOKIE, createSessionToken(telegramId), {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
}

export function clearSessionCookie(res: Response): void {
  const secure = env.COOKIE_SECURE === "true";
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure,
    sameSite: secure ? "none" : "lax",
  });
}
