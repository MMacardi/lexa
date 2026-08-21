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
  // Constant-time comparison so a forged payload can't be guessed byte-by-byte
  // from response timing. Lengths must match for timingSafeEqual.
  const a = Buffer.from(hmac, "hex");
  const b = Buffer.from(typeof hash === "string" ? hash : "", "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
  const authDate = Number(data.auth_date);
  // reject logins older than 1 day
  if (!authDate || Date.now() / 1000 - authDate > 86400) return false;
  return true;
}

export interface WebAppUser {
  id: string;
  first_name?: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

/**
 * Verify Telegram Mini App initData.
 * secret = HMAC-SHA256(key="WebAppData", bot_token); the HMAC of the sorted
 * "k=v\n" data-check-string (minus hash) must equal the provided hash.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyTelegramWebApp(initData: string, botToken: string): WebAppUser | null {
  if (!botToken || !initData) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  params.delete("hash");
  const dataCheckString = [...params.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = crypto.createHmac("sha256", "WebAppData").update(botToken).digest();
  const calc = crypto.createHmac("sha256", secret).update(dataCheckString).digest("hex");
  const a = Buffer.from(calc, "hex");
  const b = Buffer.from(hash, "hex");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get("auth_date"));
  if (!authDate || Date.now() / 1000 - authDate > 86400) return null;
  try {
    const u = JSON.parse(params.get("user") ?? "");
    if (!u?.id) return null;
    return { id: String(u.id), first_name: u.first_name, last_name: u.last_name, username: u.username, photo_url: u.photo_url };
  } catch {
    return null;
  }
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
