import { prisma } from "./db.js";

// Server-side helpers for the Telegram tutor bot. The bot has no browser
// localStorage, so the learner's language pair lives on the User row (resolved
// lazily). Review/tutor logic itself is reused from vocab.ts / tutorChat.ts.

export interface Pair {
  source: string;
  target: string;
}

/** Ensure the bot user exists and remember their chat id for proactive messages. */
export async function ensureBotUser(
  telegramId: string,
  chatId: string,
  profile?: { firstName?: string | null; username?: string | null },
): Promise<void> {
  await prisma.user.upsert({
    where: { telegramId },
    create: {
      telegramId,
      botChatId: chatId,
      authVia: "telegram",
      firstName: profile?.firstName ?? null,
      username: profile?.username ?? null,
    },
    update: { botChatId: chatId },
  });
}

/**
 * The learner's active language pair: their explicit preference, else inferred
 * from their most recent card, else the app default (en → zh).
 */
export async function resolveUserPair(telegramId: string): Promise<Pair> {
  const user = await prisma.user.findUnique({
    where: { telegramId },
    select: { preferredSource: true, preferredTarget: true },
  });
  if (user?.preferredSource && user?.preferredTarget) {
    return { source: user.preferredSource, target: user.preferredTarget };
  }
  const recent = await prisma.word.findFirst({
    where: { user: { telegramId } },
    orderBy: { createdAt: "desc" },
    select: { sourceLang: true, targetLang: true },
  });
  if (recent) return { source: recent.sourceLang, target: recent.targetLang };
  return { source: "en", target: "zh" };
}

export async function setUserPair(telegramId: string, source: string, target: string): Promise<void> {
  await prisma.user.update({ where: { telegramId }, data: { preferredSource: source, preferredTarget: target } });
}

const dueWhere = (telegramId: string, pair: Pair, now: Date) => ({
  user: { telegramId },
  sourceLang: pair.source,
  targetLang: pair.target,
  OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }],
});

/** Cards due for review right now, oldest-due first (new cards first). */
export async function dueWordsForUser(telegramId: string, pair: Pair, limit = 20) {
  const now = new Date();
  return prisma.word.findMany({
    where: dueWhere(telegramId, pair, now),
    orderBy: [{ nextReviewAt: { sort: "asc", nulls: "first" } }],
    take: limit,
    include: { examples: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}

export async function dueCountForUser(telegramId: string, pair: Pair): Promise<number> {
  const now = new Date();
  return prisma.word.count({ where: dueWhere(telegramId, pair, now) });
}

/** One card by id, scoped to the owner (defence-in-depth for callback ids). */
export async function ownedWord(telegramId: string, wordId: string) {
  return prisma.word.findFirst({
    where: { id: wordId, user: { telegramId } },
    include: { examples: { orderBy: { createdAt: "desc" }, take: 1 } },
  });
}

/** Users with due cards and a known chat id — for the daily reminder sweep. */
export async function usersWithDueCards(): Promise<{ telegramId: string; botChatId: string }[]> {
  const now = new Date();
  const rows = await prisma.user.findMany({
    where: {
      botChatId: { not: null },
      words: { some: { OR: [{ nextReviewAt: null }, { nextReviewAt: { lte: now } }] } },
    },
    select: { telegramId: true, botChatId: true },
  });
  return rows.filter((r): r is { telegramId: string; botChatId: string } => Boolean(r.botChatId));
}
