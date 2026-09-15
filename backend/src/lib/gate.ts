import type { Request, Response, NextFunction } from "express";
import { prisma } from "../services/db.js";
import { readSession } from "./auth.js";
import { callerId, isProAllowlisted, isAdmin } from "./entitlements.js";

// Two layers that protect every non-auth /api route during the closed beta.
//
//   requireIdentity — the caller must carry a verified session cookie. Closes the
//     old "anyone can POST a telegramId" spoofing hole: identity is the session,
//     full stop (no body/query telegramId is ever trusted).
//   requireInvited  — an identified caller has redeemed a beta invite, so a random
//     visitor who signs in still can't reach the AI/data routes and drain tokens.
//     The owner (PRO_ALLOWLIST) is never locked out.
//
// Mounted in index.ts as app.use("/api", …), so req.path here is the un-prefixed
// route ("/auth/me", "/words", …); the auth/invites/feedback exemptions live there.

/** Reject callers without a verified session cookie. */
export function requireIdentity(req: Request, res: Response, next: NextFunction): void {
  if (readSession(req)) return next();
  res.status(401).json({ error: "Authentication required", code: "no_identity" });
}

/** Reject identified callers who haven't redeemed a beta invite code. */
export async function requireInvited(req: Request, res: Response, next: NextFunction): Promise<void> {
  const id = callerId(req);
  // Owner / comped accounts on the Pro allowlist always pass.
  if (isProAllowlisted(id)) return next();
  const user = await prisma.user.findUnique({ where: { telegramId: id }, select: { invited: true } });
  if (user?.invited) return next();
  res.status(403).json({
    error: "Onomika is in closed beta. Enter your invite code to continue.",
    code: "invite_required",
  });
}

/** Reject anyone who isn't on the owner admin allowlist (guards /api/admin/*). */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (isAdmin(callerId(req))) return next();
  res.status(403).json({ error: "Forbidden", code: "forbidden" });
}
