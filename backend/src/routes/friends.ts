import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { readSession } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import {
  getReferral,
  listFriends,
  listRequests,
  listSentRequests,
  sendRequestByCode,
  acceptRequest,
  removeFriendship,
} from "../services/friends.js";
import { getProfile } from "../services/profiles.js";

export const friendsRouter = Router();

// Friends are private: every route needs a real signed-in session (no telegramId
// body fallback), so nobody can read another person's social graph.
function requireSession(req: Request, res: Response): string | null {
  const id = readSession(req);
  if (!id) {
    res.status(401).json({ error: "Not authenticated" });
    return null;
  }
  return id;
}

const addLimiter = rateLimit({ windowMs: 60_000, max: 20, name: "friends-add" });

// GET /api/friends -> accepted friends + their public progress
friendsRouter.get("/friends", async (req, res) => {
  const id = requireSession(req, res);
  if (!id) return;
  res.json(await listFriends(id));
});

// GET /api/friends/requests -> incoming friend requests
friendsRouter.get("/friends/requests", async (req, res) => {
  const id = requireSession(req, res);
  if (!id) return;
  res.json(await listRequests(id));
});

// GET /api/friends/sent -> my outgoing friend requests, still pending
friendsRouter.get("/friends/sent", async (req, res) => {
  const id = requireSession(req, res);
  if (!id) return;
  res.json(await listSentRequests(id));
});

// GET /api/friends/referral -> my invite code + link
friendsRouter.get("/friends/referral", async (req, res) => {
  const id = requireSession(req, res);
  if (!id) return;
  try {
    res.json(await getReferral(id));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: (err as { code?: string }).code });
  }
});

// POST /api/friends/add { code } -> send a friend request (or accept a mutual one)
const addBody = z.object({ code: z.string().min(1).max(16) });
friendsRouter.post("/friends/add", (req, res, next) => addLimiter(req, res, next), async (req, res) => {
  const id = requireSession(req, res);
  if (!id) return;
  const parsed = addBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "A code is required", code: "no_input" });
    return;
  }
  try {
    res.json(await sendRequestByCode(id, parsed.data.code));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: (err as { code?: string }).code });
  }
});

// POST /api/friends/:id/accept
friendsRouter.post("/friends/:id/accept", async (req, res) => {
  const id = requireSession(req, res);
  if (!id) return;
  try {
    res.json(await acceptRequest(id, String(req.params.id)));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message, code: (err as { code?: string }).code });
  }
});

// DELETE /api/friends/:id -> remove a friend or decline/cancel a request
friendsRouter.delete("/friends/:id", async (req, res) => {
  const id = requireSession(req, res);
  if (!id) return;
  res.json(await removeFriendship(id, String(req.params.id)));
});

// GET /api/profiles/:userId -> a learner's profile (progress + shared decks), as far
// as their privacy switches allow this viewer; 404 when closed.
friendsRouter.get("/profiles/:userId", async (req, res) => {
  const id = requireSession(req, res);
  if (!id) return;
  try {
    res.json(await getProfile(id, String(req.params.userId)));
  } catch (err) {
    const code = (err as { code?: string }).code;
    res.status(code === "no_profile" ? 404 : 400).json({ error: (err as Error).message, code });
  }
});
