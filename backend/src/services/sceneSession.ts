import { prisma } from "./db.js";
import { Prisma } from "@prisma/client";

// Saved coach scene playthroughs (history + resume). All operations are scoped to
// the owner (resolved by telegramId, like the rest of vocab). The scene engine is
// stateless — the client echoes the bible every turn — so a row (bible + turns +
// used + corrections) is the complete resume state; the Json blobs are never queried.

async function userId(telegramId: string): Promise<string | null> {
  const u = await prisma.user.findUnique({ where: { telegramId }, select: { id: true } });
  return u?.id ?? null;
}

// Summaries for the history list — no bible/turns blobs, but with the studied
// words so rows can show chips without opening the session.
export async function listSessions(telegramId: string, q?: string) {
  const uid = await userId(telegramId);
  if (!uid) return [];
  const query = q?.trim();
  return prisma.sceneSession.findMany({
    where: {
      userId: uid,
      ...(query ? { title: { contains: query, mode: "insensitive" } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true, title: true, status: true, sceneKey: true,
      sourceLang: true, targetLang: true, used: true, addedWords: true,
      reviewedCount: true, createdAt: true, updatedAt: true,
    },
  });
}

// Full row (resume state) or null when missing / owned by someone else.
export async function getSession(telegramId: string, id: string) {
  const uid = await userId(telegramId);
  if (!uid) return null;
  return prisma.sceneSession.findFirst({ where: { id, userId: uid } });
}

export async function createSession(
  telegramId: string,
  data: { title: string; sceneKey?: string | null; sourceLang?: string | null; targetLang?: string | null; bible: unknown },
) {
  const uid = await userId(telegramId);
  if (!uid) throw new Error("Account not found");
  return prisma.sceneSession.create({
    data: {
      userId: uid,
      title: data.title.trim().slice(0, 120) || "Scene",
      sceneKey: data.sceneKey?.trim() || null,
      sourceLang: data.sourceLang ?? null,
      targetLang: data.targetLang ?? null,
      bible: data.bible as Prisma.InputJsonValue,
    },
    select: { id: true },
  });
}

// Update-only save (the client PUTs after each turn). Missing/foreign id → null,
// which the route turns into a 404 so the client can silently drop its sessionId.
export async function saveSession(
  telegramId: string,
  id: string,
  data: {
    title?: string;
    status?: string;
    bible?: unknown;
    turns?: unknown;
    corrections?: unknown;
    used?: string[];
    addedWords?: string[];
    reviewedCount?: number;
  },
) {
  const uid = await userId(telegramId);
  if (!uid) return null;
  const owned = await prisma.sceneSession.findFirst({ where: { id, userId: uid }, select: { id: true } });
  if (!owned) return null;
  return prisma.sceneSession.update({
    where: { id },
    data: {
      ...(data.title !== undefined ? { title: data.title.trim().slice(0, 120) || "Scene" } : {}),
      ...(data.status !== undefined ? { status: data.status } : {}),
      ...(data.bible !== undefined ? { bible: data.bible as Prisma.InputJsonValue } : {}),
      ...(data.turns !== undefined ? { turns: data.turns as Prisma.InputJsonValue } : {}),
      ...(data.corrections !== undefined ? { corrections: data.corrections as Prisma.InputJsonValue } : {}),
      ...(data.used !== undefined ? { used: data.used } : {}),
      ...(data.addedWords !== undefined ? { addedWords: data.addedWords } : {}),
      ...(data.reviewedCount !== undefined ? { reviewedCount: data.reviewedCount } : {}),
    },
    select: { id: true },
  });
}

export async function deleteSession(telegramId: string, id: string): Promise<boolean> {
  const uid = await userId(telegramId);
  if (!uid) return false;
  const r = await prisma.sceneSession.deleteMany({ where: { id, userId: uid } });
  return r.count > 0;
}
