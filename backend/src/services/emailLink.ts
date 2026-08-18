import crypto from "node:crypto";

// One-time email magic-link tokens (single instance → in-memory). A token maps to
// the email that requested it; clicking the emailed link verifies it and starts
// a session. Tokens are single-use and expire.

interface Pending {
  email: string;
  createdAt: number;
}

const pending = new Map<string, Pending>();
const TTL_MS = 15 * 60_000;

function sweep() {
  const now = Date.now();
  for (const [k, v] of pending) if (now - v.createdAt > TTL_MS) pending.delete(k);
}

export function createEmailToken(email: string): string {
  sweep();
  const token = crypto.randomBytes(32).toString("base64url");
  pending.set(token, { email: email.toLowerCase(), createdAt: Date.now() });
  return token;
}

/** Consume a valid, unexpired token and return the email it was issued for. */
export function consumeEmailToken(token: string): string | null {
  const p = pending.get(token);
  if (!p) return null;
  pending.delete(token);
  if (Date.now() - p.createdAt > TTL_MS) return null;
  return p.email;
}
