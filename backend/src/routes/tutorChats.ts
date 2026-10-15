import { Router } from "express";
import { z } from "zod";
import { callerId } from "../lib/entitlements.js";
import { rateLimit } from "../lib/rateLimit.js";
import { deleteChat, getChat, importChats, KEEP_CHATS, listChats, saveChat } from "../services/tutorChats.js";
import type { Request, Response } from "express";

// Mika's chat history (services/tutorChats.ts). The client saves a chat after each
// answer, so the limit only stops a runaway loop.
export const tutorChatsRouter = Router();

const saveLimiter = rateLimit({ windowMs: 60_000, max: 60, name: "tutorChats" });

const chatId = z.string().regex(/^[a-z0-9]{4,40}$/i);
// A message as the thread shows it. Its word offers (addWords, addCards, …) are the
// client's own and pass through; what is checked is what could make a row huge.
const message = z
  .object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(20_000),
    // Thumbnails (~320 px JPEGs) — the full-size photos never leave the tab.
    images: z.array(z.string().startsWith("data:image/").max(400_000)).max(8).optional(),
  })
  .passthrough()
  .transform(({ streaming: _s, ...m }) => m);
const thread = z
  .array(message)
  .max(60)
  .refine((m) => JSON.stringify(m).length <= 2_000_000, "Chat too large");

tutorChatsRouter.get("/tutor/chats", async (req: Request, res: Response) => {
  res.json(await listChats(callerId(req)));
});

tutorChatsRouter.get("/tutor/chats/:id", async (req: Request, res: Response) => {
  const row = await getChat(callerId(req), String(req.params.id));
  if (!row) {
    res.status(404).json({ error: "Chat not found" });
    return;
  }
  res.json(row);
});

tutorChatsRouter.put("/tutor/chats/:id", saveLimiter, async (req: Request, res: Response) => {
  const id = chatId.safeParse(req.params.id);
  const parsed = z.object({ messages: thread.refine((m) => m.length > 0) }).safeParse(req.body);
  if (!id.success || !parsed.success) {
    res.status(400).json({ error: "Invalid chat", code: "no_input" });
    return;
  }
  res.json(await saveChat(callerId(req), id.data, parsed.data.messages));
});

// A browser's history from before it lived on the account, uploaded once.
const importBody = z.object({
  chats: z.array(z.object({ id: chatId, at: z.number().int().positive(), messages: thread })).max(KEEP_CHATS),
});

tutorChatsRouter.post("/tutor/chats/import", saveLimiter, async (req: Request, res: Response) => {
  const parsed = importBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid chats", code: "no_input" });
    return;
  }
  res.json({ imported: await importChats(callerId(req), parsed.data.chats) });
});

tutorChatsRouter.delete("/tutor/chats/:id", async (req: Request, res: Response) => {
  await deleteChat(callerId(req), String(req.params.id));
  res.json({ ok: true });
});
