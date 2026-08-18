import crypto from "node:crypto";

// One-time "log in with Telegram via the bot" tokens. The web asks for a token,
// opens t.me/<bot>?start=login_<token>, the bot (which trusts ctx.from.id) binds
// the token to that Telegram user, and the web polls until it's bound — then a
// session is issued. Works everywhere (incl. localhost), unlike the domain-bound
// Login Widget. Single instance: an in-memory map is enough.

export interface LoginProfile {
  firstName?: string | null;
  lastName?: string | null;
  username?: string | null;
}

interface Pending {
  telegramId?: string;
  profile?: LoginProfile;
  createdAt: number;
}

const pending = new Map<string, Pending>();
const TTL_MS = 5 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > TTL_MS) pending.delete(k);
}

/** Create an unguessable, single-use token the web will poll on. */
export function createLoginToken(): string {
  sweep();
  const token = crypto.randomBytes(24).toString("base64url");
  pending.set(token, { createdAt: Date.now() });
  return token;
}

/** Bot side: bind a (valid, unexpired) token to the confirming Telegram user. */
export function bindLoginToken(token: string, telegramId: string, profile: LoginProfile): boolean {
  const p = pending.get(token);
  if (!p || Date.now() - p.createdAt > TTL_MS) {
    pending.delete(token);
    return false;
  }
  p.telegramId = telegramId;
  p.profile = profile;
  return true;
}

/** Web side: if the token has been confirmed, consume it and return who it is. */
export function consumeLoginToken(token: string): { telegramId: string; profile: LoginProfile } | null {
  const p = pending.get(token);
  if (!p || !p.telegramId) return null;
  pending.delete(token);
  return { telegramId: p.telegramId, profile: p.profile ?? {} };
}
