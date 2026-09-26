import { Router } from "express";
import { readSession, clearSessionCookie } from "../lib/auth.js";
import { rateLimit } from "../lib/rateLimit.js";
import { exportAccount, deleteAccount, scheduleDeletion, cancelDeletion } from "../services/accountData.js";

export const accountRouter = Router();

// Both routes read the whole account, so they are cheap to call and expensive to
// serve. Nobody needs either more than a few times an hour. Attached per route,
// never with router.use(): this router is mounted at "/api" alongside the others,
// so a router-level middleware would run for every API request and spend this
// budget on /words.
const accountLimiter = rateLimit({ windowMs: 3_600_000, max: 10, name: "account-data" });

// GET /api/account/export — everything we hold about the caller, as a download.
accountRouter.get("/account/export", accountLimiter, async (req, res) => {
  const telegramId = readSession(req);
  if (!telegramId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  const data = await exportAccount(telegramId);
  if (!data) {
    res.status(404).json({ error: "Account not found" });
    return;
  }
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="onomika-export-${stamp}.json"`);
  res.send(JSON.stringify(data, null, 2));
});

// POST /api/account/delete — schedule the erase (DELETE_GRACE_DAYS away; signing
// in before then offers "keep my account"), or with `now: true` erase at once —
// irreversible, the rows are gone. Either way the session ends.
//
// The typed confirmation is not only UX. Session cookies are SameSite=None in
// prod (frontend and backend can sit on different origins), so a cross-site POST
// does carry them; CORS blocks a JSON fetch, but a plain HTML form post has no
// preflight to block. express.json() won't parse a form body, so `confirm` comes
// back undefined and the request dies here — which is exactly what we want.
accountRouter.post("/account/delete", accountLimiter, async (req, res) => {
  const telegramId = readSession(req);
  if (!telegramId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (req.body?.confirm !== "DELETE") {
    res.status(400).json({ error: "Confirmation required", code: "confirm_required" });
    return;
  }
  if (req.body?.now === true) {
    const ok = await deleteAccount(telegramId);
    clearSessionCookie(res);
    res.json({ ok, deleted: true });
    return;
  }
  const deleteAfter = await scheduleDeletion(telegramId);
  // Log them out either way: the account is on its way out, and "keep it" is
  // offered at the next sign-in, not in a tab left open.
  clearSessionCookie(res);
  res.json({ ok: deleteAfter !== null, deleteAfter });
});

// POST /api/account/restore — "keep my account": the scheduled erase is off.
accountRouter.post("/account/restore", accountLimiter, async (req, res) => {
  const telegramId = readSession(req);
  if (!telegramId) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  res.json({ ok: await cancelDeletion(telegramId) });
});
