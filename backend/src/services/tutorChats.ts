import { prisma } from "./db.js";
import { Prisma } from "@prisma/client";

// Mika's chat history, on the account (it was each browser's localStorage, so the
// phone and the laptop each had their own list). The client owns the chat id and
// the thread's shape; the server keeps the newest chats and the few fields the
// history menu lists, so the list loads without the threads.

// Enough to scroll back a few weeks; older chats drop off as new ones are saved.
export const KEEP_CHATS = 40;

type Msg = { role: string; content: string; images?: string[] };

async function userId(telegramId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  return u?.id ?? null;
}

// What the menu shows and searches, read off the thread the way the client used
// to: titled by the opening question, searched through the whole conversation.
function summary(messages: Msg[]) {
  const first = messages.find((m) => m.role === "user");
  return {
    title: (first?.content ?? "").trim().slice(0, 80),
    photo: !!first?.images?.length,
    count: messages.length,
    hay: messages
      .map((m) => m.content)
      .join(" ")
      .slice(0, 2000)
      .toLowerCase(),
  };
}

const LIST = { chatId: true, title: true, photo: true, count: true, hay: true, updatedAt: true } as const;
type Row = { chatId: string; title: string; photo: boolean; count: number; hay: string; updatedAt: Date };
// The client's TutorChatEntry: `at` is when the chat last changed.
const entry = (r: Row) => ({ id: r.chatId, at: r.updatedAt.getTime(), title: r.title, photo: r.photo, n: r.count, hay: r.hay });

export async function listChats(telegramId: string) {
  const uid = await userId(telegramId);
  if (!uid) return [];
  const rows = await prisma.tutorChat.findMany({
    where: { userId: uid },
    orderBy: { updatedAt: "desc" },
    take: KEEP_CHATS,
    select: LIST,
  });
  return rows.map(entry);
}

export async function getChat(telegramId: string, chatId: string) {
  const uid = await userId(telegramId);
  if (!uid) return null;
  const row = await prisma.tutorChat.findUnique({
    where: { userId_chatId: { userId: uid, chatId } },
    select: { ...LIST, messages: true },
  });
  return row ? { ...entry(row), messages: row.messages } : null;
}

// Drop everything past the newest KEEP_CHATS.
async function prune(uid: string) {
  const old = await prisma.tutorChat.findMany({
    where: { userId: uid },
    orderBy: { updatedAt: "desc" },
    skip: KEEP_CHATS,
    select: { id: true },
  });
  if (old.length) await prisma.tutorChat.deleteMany({ where: { id: { in: old.map((r) => r.id) } } });
}

// Create or replace one chat's thread; returns its list entry.
export async function saveChat(telegramId: string, chatId: string, messages: Msg[]) {
  const uid = await userId(telegramId);
  if (!uid) return null;
  const data = { ...summary(messages), messages: messages as unknown as Prisma.InputJsonValue };
  const row = await prisma.tutorChat.upsert({
    where: { userId_chatId: { userId: uid, chatId } },
    create: { userId: uid, chatId, ...data },
    update: data,
    select: LIST,
  });
  await prune(uid);
  return entry(row);
}

// A browser's old local history, uploaded once. A chat the account already has
// is left alone: the copy on the server is the one other devices have been adding to.
export async function importChats(telegramId: string, chats: { id: string; at: number; messages: Msg[] }[]) {
  const uid = await userId(telegramId);
  if (!uid) return 0;
  const have = new Set(
    (
      await prisma.tutorChat.findMany({
        where: { userId: uid, chatId: { in: chats.map((c) => c.id) } },
        select: { chatId: true },
      })
    ).map((r) => r.chatId),
  );
  const fresh = chats.filter((c) => !have.has(c.id) && c.messages.length);
  if (fresh.length) {
    await prisma.tutorChat.createMany({
      data: fresh.map((c) => ({
        userId: uid,
        chatId: c.id,
        ...summary(c.messages),
        messages: c.messages as unknown as Prisma.InputJsonValue,
        createdAt: new Date(c.at),
        updatedAt: new Date(c.at),
      })),
      skipDuplicates: true,
    });
    await prune(uid);
  }
  return fresh.length;
}

export async function deleteChat(telegramId: string, chatId: string): Promise<boolean> {
  const uid = await userId(telegramId);
  if (!uid) return false;
  const r = await prisma.tutorChat.deleteMany({ where: { userId: uid, chatId } });
  return r.count > 0;
}
