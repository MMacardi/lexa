import { Router } from "express";
import { z } from "zod";
import { prisma } from "../services/db.js";
import { readSession } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import type { Request, Response } from "express";

// Closed-beta invite redemption. Mounted at /api and exempt from requireInvited
// (a signed-in-but-uninvited user must be able to reach it) but NOT from
// requireIdentity, so a session cookie is mandatory here.
export const invitesRouter = Router();

// Brute-force guard: a real tester types their code once or twice; cap guesses so
// nobody can enumerate the code space.
const redeemLimiter = rateLimit({ windowMs: 60_000, max: 10, name: "invite" });

const body = z.object({ code: z.string().trim().min(1).max(64) });

// The same profile shape GET /auth/me returns, so the client can swap it in.
const profileSelect = {
  telegramId: true,
  firstName: true,
  lastName: true,
  displayName: true,
  username: true,
  photoUrl: true,
  email: true,
  authVia: true,
  hideEmail: true,
  hideTag: true,
  invited: true,
  identities: { select: { provider: true, subject: true }, orderBy: { createdAt: "asc" as const } },
};

// A typed error so the transaction can roll back and the handler can map it to a
// clean status + machine-readable code.
class HttpError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message);
  }
}

invitesRouter.post("/invites/redeem", redeemLimiter, async (req: Request, res: Response) => {
  const telegramId = readSession(req);
  if (!telegramId) {
    res.status(401).json({ error: "Sign in first", code: "no_identity" });
    return;
  }
  const parsed = body.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter your invite code", code: "invite_invalid" });
    return;
  }
  // Codes are issued uppercase; accept any casing from the tester.
  const code = parsed.data.code.toUpperCase();

  try {
    const profile = await prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { telegramId }, select: { id: true, invited: true } });
      if (!user) throw new HttpError(401, "no_identity", "Account not found");
      if (user.invited) throw new HttpError(409, "already_invited", "You're already in the beta");

      // Atomically claim a still-unused code. updateMany only matches a row whose
      // redeemedAt is null, so two concurrent redeems of the same code can't both win.
      const claimed = await tx.inviteCode.updateMany({
        where: { code, redeemedAt: null },
        data: { redeemedById: user.id, redeemedAt: new Date() },
      });
      if (claimed.count === 0) throw new HttpError(400, "invite_invalid", "That code is invalid or already used");

      return tx.user.update({
        where: { id: user.id },
        data: { invited: true, invitedAt: new Date() },
        select: profileSelect,
      });
    });
    res.json(profile);
  } catch (err) {
    if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message, code: err.code });
      return;
    }
    console.error("[invites] redeem error", err);
    res.status(500).json({ error: "Couldn't redeem that code", code: "server_error" });
  }
});
